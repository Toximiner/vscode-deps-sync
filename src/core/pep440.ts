/**
 * Minimal PEP 440 support for dependency checks:
 * operators ===, ==, !=, >=, <=, >, <, ~= and wildcard ==x.y.*
 * Version normalization per PEP 440 (trailing .0 dropped, v prefix, ./-/_ separators).
 * Local versions (+local) are ignored in comparisons (MVP).
 */

export interface ParsedVersion {
  release: number[];
  pre: string | null;
  post: number | null;
  raw: string;
}

const PRE_BASE: Record<string, number> = { a: 0, b: 1, rc: 2 };

export function parseVersion(v: string): ParsedVersion {
  let s = v.trim().toLowerCase().replace(/^v/, '');
  const plus = s.indexOf('+');
  if (plus >= 0) s = s.slice(0, plus); // +local — ignored

  let post: number | null = null;
  const pm = s.match(/\.post(\d*)$/);
  if (pm) {
    post = pm[1] === '' ? 0 : parseInt(pm[1], 10);
    s = s.slice(0, s.length - pm[0].length);
  }

  let pre: string | null = null;
  const preM = s.match(/(?:a|b|rc)(\d*)$/);
  if (preM) {
    pre = preM[0];
    s = s.slice(0, s.length - preM[0].length);
  }

  s = s.replace(/[._-]+/g, '.');
  const release: number[] = [];
  for (const part of s.split('.')) {
    if (/^\d+$/.test(part)) release.push(parseInt(part, 10));
    else break;
  }
  if (release.length === 0) release.push(0);
  while (release.length > 1 && release[release.length - 1] === 0) release.pop();
  return { release, pre, post, raw: v.trim() };
}

function preRank(v: ParsedVersion): number {
  if (v.pre === null) return 1; // no pre-suffix = final release
  const kind = v.pre.startsWith('rc') ? 'rc' : v.pre[0];
  const numStr = v.pre.slice(kind.length);
  const n = numStr === '' ? 0 : parseInt(numStr, 10);
  return (PRE_BASE[kind] + 1) / 10 + n / 1000000;
}

function postRank(v: ParsedVersion): number {
  return v.post === null ? 0 : 1 + v.post / 1000000;
}

export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  const n = Math.max(va.release.length, vb.release.length);
  for (let i = 0; i < n; i++) {
    const x = va.release[i] ?? 0;
    const y = vb.release[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  const pr = preRank(va) - preRank(vb);
  if (pr !== 0) return pr < 0 ? -1 : 1;
  const po = postRank(va) - postRank(vb);
  if (po !== 0) return po < 0 ? -1 : 1;
  return 0;
}

/** Does the version satisfy a comma-separated spec list? Empty spec = always ok. */
export function satisfies(version: string, spec: string): boolean {
  for (const clause of spec.split(',').map(c => c.trim()).filter(Boolean)) {
    if (!satisfiesClause(version, clause)) return false;
  }
  return true;
}

function satisfiesClause(version: string, clause: string): boolean {
  const m = clause.match(/^(===|~=|==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!m) return true; // unrecognized fragment — don't fail (lenient, MVP)
  const op = m[1];
  const targetRaw = m[2].trim();
  if (op === '===') return version.trim().toLowerCase() === targetRaw.toLowerCase();

  const wildcard = targetRaw.endsWith('.*');
  const base = wildcard ? targetRaw.slice(0, -2) : targetRaw;
  const t = parseVersion(base);

  const wildcardMatch = (): boolean => {
    const v = parseVersion(version);
    return (
      v.release.length >= t.release.length &&
      v.release.slice(0, t.release.length).join('.') === t.release.join('.')
    );
  };

  switch (op) {
    case '==':
      return wildcard ? wildcardMatch() : compareVersions(version, base) === 0;
    case '!=':
      return wildcard ? !wildcardMatch() : compareVersions(version, base) !== 0;
    case '>=':
      return compareVersions(version, base) >= 0;
    case '<=':
      return compareVersions(version, base) <= 0;
    case '>':
      return compareVersions(version, base) > 0;
    case '<':
      return compareVersions(version, base) < 0;
    case '~=': {
      // ~=X.Y.Z → >=X.Y.Z, <X.(Y+1).0 ; ~=X.Y → >=X.Y, <(X+1).0
      if (t.release.length < 2) return compareVersions(version, base) >= 0;
      const upper = t.release.slice(0, -1);
      upper[upper.length - 1] += 1;
      return (
        compareVersions(version, base) >= 0 &&
        compareVersions(version, upper.join('.')) < 0
      );
    }
  }
  return true;
}
