import { execFile } from 'child_process';
import { compareVersions } from './pep440';

/**
 * PEP 508 environment markers (subset): clauses joined by `and` / `or`,
 * operators ===, ==, !=, >=, <=, >, <, ~=, in, not in.
 * Clause names supported: python_version, python_full_version,
 * implementation_version, implementation_name, sys_platform, os_name,
 * platform_system, platform_release, platform_machine.
 * Unknown clause names are treated as true (lenient, MVP).
 */

export interface InterpreterFacts {
  python_version: string;
  python_full_version: string;
  implementation_version: string;
  implementation_name: string;
  sys_platform: string;
  os_name: string;
  platform_system: string;
  platform_release: string;
  platform_machine: string;
}

// NOTE: platform.python_implementation_version() was removed in Python 3.12 —
// use sys.implementation.* instead.
const FACTS_SCRIPT =
  'import sys, os, platform, json;' +
  'print(json.dumps({' +
  '"python_version": ".".join(map(str, sys.version_info[:2])),' +
  '"python_full_version": ".".join(map(str, sys.version_info[:3])),' +
  '"implementation_version": ".".join(map(str, sys.implementation.version)),' +
  '"implementation_name": sys.implementation.name.lower(),' +
  '"sys_platform": sys.platform,' +
  '"os_name": os.name,' +
  '"platform_system": platform.system().lower(),' +
  '"platform_release": platform.release(),' +
  '"platform_machine": platform.machine()' +
  '}))';

const VERSIONISH = new Set(['python_version', 'python_full_version', 'implementation_version']);

/**
 * Ask the project venv's python for interpreter facts.
 * Returns null when no python is available (markers then stay "applicable").
 */
export function getInterpreterFacts(python: string | null): Promise<InterpreterFacts | null> {
  if (!python) return Promise.resolve(null);
  return new Promise(resolve => {
    execFile(python, ['-c', FACTS_SCRIPT], { timeout: 10_000, maxBuffer: 64 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(JSON.parse(stdout.trim()) as InterpreterFacts);
      } catch {
        resolve(null);
      }
    });
  });
}

/** Evaluate a marker against interpreter facts. null facts → true (lenient). */
export function evaluateMarker(marker: string, facts: InterpreterFacts | null): boolean {
  const m = marker.trim();
  if (!m) return true;
  if (facts === null) return true;
  return m.split(/\s+or\s+/).some(part =>
    part.split(/\s+and\s+/).every(clause => evalClause(clause.trim(), facts)),
  );
}

function evalClause(clause: string, facts: InterpreterFacts): boolean {
  const m = /^\s*([a-z_]+)\s*(===|==|!=|>=|<=|~=|>|<|not in|in)\s*(.+?)\s*$/i.exec(clause);
  if (!m) return true; // unrecognized clause — don't fail (lenient, MVP)
  const [, nameRaw, opRaw, rawValue] = m;
  const name = nameRaw.toLowerCase();
  const op = opRaw.toLowerCase();
  const value = rawValue.trim().replace(/^['"]|['"]$/g, '');

  if (!(name in facts)) return true;
  const fact = facts[name as keyof InterpreterFacts];
  const versionish = VERSIONISH.has(name);

  switch (op) {
    case 'in':
      return splitValue(value).some(v => versionish ? compareVersions(fact, v) === 0 : v.toLowerCase() === fact.toLowerCase());
    case 'not in':
      return !splitValue(value).some(v => versionish ? compareVersions(fact, v) === 0 : v.toLowerCase() === fact.toLowerCase());
    case '===':
      return fact.toLowerCase() === value.toLowerCase();
    case '==':
      return versionish ? compareVersions(fact, value) === 0 : value.toLowerCase() === fact.toLowerCase();
    case '!=':
      return versionish ? compareVersions(fact, value) !== 0 : value.toLowerCase() !== fact.toLowerCase();
    case '>=':
      return versionish ? compareVersions(fact, value) >= 0 : false;
    case '<=':
      return versionish ? compareVersions(fact, value) <= 0 : false;
    case '>':
      return versionish ? compareVersions(fact, value) > 0 : false;
    case '<':
      return versionish ? compareVersions(fact, value) < 0 : false;
    case '~=': {
      if (!versionish) return false;
      // ~=X.Y → >=X.Y, <(X+1) ; ~=X.Y.Z → >=X.Y.Z, <X.(Y+1)
      const parts = value.split('.').map(n => parseInt(n, 10) || 0);
      const ge = compareVersions(fact, value) >= 0;
      if (!ge) return false;
      if (parts.length < 2) return true;
      const upper = parts.slice(0, -1);
      upper[upper.length - 1] += 1;
      return compareVersions(fact, upper.join('.')) < 0;
    }
  }
  return true;
}

function splitValue(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

/**
 * Split a requirement into the spec part and the environment marker, if any:
 * `tornado==6.6; python_version < "3.13"` → spec `tornado==6.6`, marker `python_version < "3.13"`.
 */
export function splitMarker(requirement: string): { spec: string; marker: string | null } {
  const idx = requirement.indexOf(';');
  if (idx < 0) return { spec: requirement.trim(), marker: null };
  return { spec: requirement.slice(0, idx).trim(), marker: requirement.slice(idx + 1).trim() || null };
}
