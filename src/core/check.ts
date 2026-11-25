import { CheckReport, ProjectInfo, RequirementResult, normName } from './types';
import { detect } from './detect';
import { getDeclared } from './declared';
import { getInstalled } from './installed';
import { satisfies } from './pep440';
import { evaluateMarker, getInterpreterFacts } from './markers';

export function extractName(req: string): string | null {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?:[<>=!~;]|$)/.exec(req);
  return m ? m[1] : null;
}

export function extractSpec(req: string): string {
  const m = /^\s*[A-Za-z0-9][A-Za-z0-9._-]*\s*(?:\[[^\]]*\])?\s*([<>=!~].*)$/.exec(req);
  return m ? m[1].trim() : '';
}

/**
 * Project check:
 *  1) top-level declarations × installed (missing / mismatch);
 *  2) everything installed (except top-level) × lock versions (drift:
 *     transitive and group packages are caught too; uninstalled group
 *     packages are NOT a problem — a deliberately partial sync is fine).
 */
export async function checkProject(root: string, ignored: string[] = []): Promise<CheckReport> {
  const project = detect(root);
  const base: CheckReport = { project, results: [], problems: [], notApplicable: [], checkedAt: Date.now() };
  if (project.kind === 'none') return base;

  const declared = getDeclared(project);
  let installed: Record<string, string>;
  try {
    installed = await getInstalled(project);
  } catch (e) {
    return { ...base, checkError: `Cannot list installed packages: ${String(e)}` };
  }

  const hasMarkers = declared.top.some(t => t.marker);
  const facts = hasMarkers ? await getInterpreterFacts(project.python) : null;

  const results: RequirementResult[] = [];
  const isIgnored = (name: string) => ignored.includes(normName(name));

  for (const t of declared.top) {
    const nm = extractName(t.requirement);
    if (!nm) {
      results.push({
        requirement: t.requirement, name: null, status: 'parse-error',
        line: t.line, file: t.file, error: 'unparseable requirement',
      });
      continue;
    }
    // PEP 508: the marker is false for this interpreter → the requirement
    // does not apply to this environment and is not a problem
    if (t.marker && !evaluateMarker(t.marker, facts)) {
      base.notApplicable.push({
        requirement: t.requirement, name: nm, status: 'ok',
        line: t.line, file: t.file, marker: t.marker,
      });
      continue;
    }
    const spec = extractSpec(t.requirement);
    const inst = installed[normName(nm)];
    if (isIgnored(nm)) {
      results.push({ requirement: t.requirement, name: nm, status: 'ok', installed: inst, line: t.line, file: t.file, ignored: true });
      continue;
    }
    if (inst === undefined) {
      results.push({ requirement: t.requirement, name: nm, status: 'missing', line: t.line, file: t.file, spec });
    } else if (!spec || satisfies(inst, spec)) {
      results.push({ requirement: t.requirement, name: nm, status: 'ok', installed: inst, line: t.line, file: t.file });
    } else {
      results.push({ requirement: t.requirement, name: nm, status: 'mismatch', installed: inst, spec, line: t.line, file: t.file });
    }
  }

  // "installed × lock" only makes sense for uv (there is a lock reference);
  // for pip projects it is noise (every installed package would become "extra")
  if (declared.lock.size === 0) {
    const problems = results.filter(
      r => !r.ignored && (r.status === 'mismatch' || r.status === 'missing' || r.status === 'parse-error'),
    );
    return { project, results, problems, notApplicable: base.notApplicable, checkedAt: Date.now() };
  }

  const seenTop = new Set<string>();
  for (const t of declared.top) {
    const n = extractName(t.requirement);
    if (n) seenTop.add(normName(n));
  }

  for (const [key, version] of Object.entries(installed)) {
    if (seenTop.has(key)) continue;
    const locked = declared.lock.get(key);
    if (!locked) {
      results.push({ requirement: null, name: key, status: 'extra', installed: version, line: 0 });
      continue;
    }
    if (satisfies(version, `==${locked.version}`)) {
      results.push({ requirement: null, name: key, status: 'ok', installed: version, line: locked.line, file: locked.file });
    } else {
      results.push({
        requirement: null, name: key, status: 'mismatch', installed: version,
        spec: `==${locked.version}`, lockedVersion: locked.version, line: locked.line, file: locked.file,
      });
    }
  }

  const problems = results.filter(
    r => !r.ignored && (r.status === 'mismatch' || r.status === 'missing' || r.status === 'parse-error'),
  );
  return { project, results, problems, notApplicable: base.notApplicable, checkedAt: Date.now() };
}

/** Requirements to fix: mismatch → pin to the locked version; missing → the spec (or latest). */
export function syncRequirements(report: CheckReport): string[] {
  const map = new Map<string, string>();
  for (const p of report.problems) {
    if (!p.name || map.has(normName(p.name))) continue;
    if (p.status === 'missing') {
      map.set(normName(p.name), p.spec ? `${p.name}${p.spec}` : p.name);
    } else if (p.status === 'mismatch') {
      const target =
        p.lockedVersion ?? (p.spec ? p.spec.replace(/^[<>=!~]+\s*/, '').replace(/\.?\*$/, '') : undefined);
      map.set(normName(p.name), target ? `${p.name}==${target}` : p.name);
    }
  }
  return [...map.values()];
}
