import { execFile } from 'child_process';
import * as path from 'path';
import { ProjectInfo, normName } from './types';

interface PipEntry {
  name: string;
  version: string;
}

function parseListJson(stdout: string): PipEntry[] {
  const t = stdout.trim();
  if (t.startsWith('[')) return JSON.parse(t) as PipEntry[];
  // older pip prints one JSON object per line
  return t
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('{'))
    .map(l => JSON.parse(l) as PipEntry);
}

function runListJson(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, env, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(`${cmd} ${args.join(' ')}: ${err.message}`));
      try {
        const map: Record<string, string> = {};
        for (const e of parseListJson(stdout)) map[normName(e.name)] = e.version;
        resolve(map);
      } catch (e) {
        reject(new Error(`cannot parse package list: ${String(e)}`));
      }
    });
  });
}

/**
 * Installed packages → map(normalized name → version).
 * uv project: `uv pip list --format json` (uv finds .venv from cwd itself).
 * pip project: `<venv>/python -m pip list --format json`, fallback — `uv pip list` with VIRTUAL_ENV.
 */
export function getInstalled(p: ProjectInfo): Promise<Record<string, string>> {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  if (p.python) env.VIRTUAL_ENV = path.dirname(path.dirname(p.python));

  if (p.kind === 'uv') {
    return runListJson('uv', ['pip', 'list', '--format', 'json'], p.root, env);
  }
  const py = p.python ?? 'python3';
  return runListJson(py, ['-m', 'pip', 'list', '--format', 'json'], p.root, env).catch(() =>
    runListJson('uv', ['pip', 'list', '--format', 'json'], p.root, env),
  );
}
