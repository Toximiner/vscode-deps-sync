export type ProjectKind = 'uv' | 'pip' | 'none';

export interface ProjectInfo {
  kind: ProjectKind;
  root: string;
  /** path to the venv python (null if no venv was found) */
  python: string | null;
  /** primary declaration file for the report: uv.lock / requirements.txt / pyproject.toml */
  declaredFile: string | null;
}

export type ReqStatus = 'ok' | 'missing' | 'mismatch' | 'parse-error' | 'extra';

export interface RequirementResult {
  /** original declaration, e.g. "tornado==6.6.0"; null when checking installed against the lock */
  requirement: string | null;
  name: string | null;
  status: ReqStatus;
  installed?: string;
  /** spec from the declaration: "==6.6.0" */
  spec?: string;
  /** version pinned in the lock (for drift) */
  lockedVersion?: string;
  error?: string;
  /** requirement manually ignored */
  ignored?: boolean;
  /** absolute file path for diagnostics */
  file?: string;
  /** 1-based line in the file, 0 = unknown */
  line: number;
}

export interface CheckReport {
  project: ProjectInfo;
  results: RequirementResult[];
  problems: RequirementResult[];
  /** the check itself failed (no uv, no venv, etc.) */
  checkError?: string;
  checkedAt: number;
}

/** PEP 503 package-name normalization: lowercase, _ → - */
export function normName(name: string): string {
  return name.trim().toLowerCase().replace(/_/g, '-');
}
