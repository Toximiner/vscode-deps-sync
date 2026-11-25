import * as fs from 'fs';
import * as path from 'path';
import { parse as parseToml } from 'smol-toml';
import { ProjectInfo, normName } from './types';
import { splitMarker } from './markers';

export interface TopRequirement {
  /** the requirement without the env marker */
  requirement: string;
  /** PEP 508 environment marker, if declared */
  marker: string | null;
  line: number;
  file: string;
}

export interface Declared {
  /** top-level requirements (from [project].dependencies / requirements.txt) */
  top: TopRequirement[];
  /** full lock map: normalized name → { version, line, file } (uv only) */
  lock: Map<string, { version: string; line: number; file: string }>;
}

export function getDeclared(p: ProjectInfo): Declared {
  if (p.kind === 'uv') return declaredUv(p);
  const f = p.declaredFile ?? '';
  if (f.endsWith('requirements.txt')) return declaredRequirements(f);
  return f ? declaredPyproject(f) : { top: [], lock: new Map() };
}

/** uv: top-level from pyproject.toml + the full version map from uv.lock */
function declaredUv(p: ProjectInfo): Declared {
  const lockPath = path.join(p.root, 'uv.lock');
  const lock = new Map<string, { version: string; line: number; file: string }>();

  if (fs.existsSync(lockPath)) {
    const lines = fs.readFileSync(lockPath, 'utf8').split(/\r?\n/);
    let name: string | null = null;
    let version: string | null = null;
    let nameLine = 0;
    const flush = () => {
      if (name && version) lock.set(normName(name), { version, line: nameLine, file: lockPath });
      name = null;
      version = null;
      nameLine = 0;
    };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === '[[package]]') {
        flush();
        continue;
      }
      const mn = /^name\s*=\s*"([^"]+)"\s*$/.exec(l);
      if (mn && name === null) {
        name = mn[1];
        nameLine = i + 1;
        continue;
      }
      const mv = /^version\s*=\s*"([^"]+)"\s*$/.exec(l);
      if (mv && version === null) version = mv[1];
    }
    flush();
  }

  return { top: topLevelFromPyproject(path.join(p.root, 'pyproject.toml')), lock };
}

/** Top-level requirements from [project].dependencies (with pyproject.toml line numbers) */
function topLevelFromPyproject(file: string): TopRequirement[] {
  const out: TopRequirement[] = [];
  if (!fs.existsSync(file)) return out;
  const raw = fs.readFileSync(file, 'utf8');
  let deps: string[] = [];
  try {
    deps = (parseToml(raw) as { project?: { dependencies?: string[] } }).project?.dependencies ?? [];
  } catch {
    return out;
  }
  const lines = raw.split(/\r?\n/);
  for (const req of deps) {
    const { spec, marker } = splitMarker(req);
    const nm = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec)?.[1] ?? '';
    const idx = nm ? lines.findIndex(l => l.includes(`"${nm}`)) : -1;
    out.push({ requirement: spec, marker, line: idx >= 0 ? idx + 1 : 0, file });
  }
  return out;
}

/** requirements.txt: each requirement line, without comments/options; env markers preserved */
function declaredRequirements(file: string): Declared {
  const top: TopRequirement[] = [];
  if (fs.existsSync(file)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((raw, i) => {
      let l = raw.trim();
      if (!l || l.startsWith('#')) return;
      const hash = l.indexOf(' #');
      if (hash >= 0) l = l.slice(0, hash).trim();
      if (l.startsWith('-')) return; // -r, -e, -i, --hash, etc.
      const { spec, marker } = splitMarker(l);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(\[[^\]]*\])?(\s*(===|==|!=|>=|<=|~=|>|<)\s*[A-Za-z0-9][A-Za-z0-9.*+!-]*)?\s*$/.test(spec)) return;
      top.push({ requirement: spec, marker, line: i + 1, file });
    });
  }
  return { top, lock: new Map() };
}

function declaredPyproject(file: string): Declared {
  return { top: topLevelFromPyproject(file), lock: new Map() };
}
