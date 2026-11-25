import * as fs from 'fs';
import * as path from 'path';
import { ProjectInfo } from './types';

/**
 * Detect the project type from the workspace root:
 *  - pyproject.toml + uv.lock  → uv
 *  - requirements.txt          → pip
 *  - pyproject.toml only       → pip (declarations from [project].dependencies)
 */
export function detect(root: string): ProjectInfo {
  const pyproject = path.join(root, 'pyproject.toml');
  const uvLock = path.join(root, 'uv.lock');
  const reqs = path.join(root, 'requirements.txt');
  const python = findVenvPython(root);

  if (fs.existsSync(pyproject) && fs.existsSync(uvLock)) {
    return { kind: 'uv', root, python, declaredFile: uvLock };
  }
  if (fs.existsSync(reqs)) {
    return { kind: 'pip', root, python, declaredFile: reqs };
  }
  if (fs.existsSync(pyproject)) {
    return { kind: 'pip', root, python, declaredFile: pyproject };
  }
  return { kind: 'none', root, python: null, declaredFile: null };
}

function findVenvPython(root: string): string | null {
  for (const name of ['.venv', 'venv', 'env']) {
    const p = path.join(root, name, 'bin', 'python');
    if (fs.existsSync(p)) return p;
  }
  return null;
}
