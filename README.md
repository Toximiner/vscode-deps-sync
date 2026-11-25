# Deps Sync (vscode-deps-sync)

A VS Code extension that replicates PyCharm's inline banner «Package requirement 'x==y' is not satisfied — Sync project / Ignore requirement».

## What it does

When you open a folder with a Python project (and after saves/focus), it compares the **declared** dependencies against what is **installed** in your venv and, on drift, shows:

- a banner notification with **Sync project** / **Ignore…** / **Show report** actions;
- diagnostics (yellow squiggles) at the lines in `pyproject.toml` / `uv.lock` / `requirements.txt` + the Problems panel;
- a status-bar item: `✓ deps` or `⚠ deps: N` (click — report in the *Deps Sync* output channel).

Supported projects:

| Type | Files | Sources | Sync |
|---|---|---|---|
| uv | `pyproject.toml` + `uv.lock` | `[project].dependencies` + the whole lock | `uv pip install …` |
| pip | `requirements.txt` (or `pyproject.toml` only) | requirement lines | `<venv>/python -m pip install …` |

Check logic:

1. **mismatch** — installed version does not satisfy the spec (for uv: all installed packages are also checked against `uv.lock`, including transitive — catches drift like `tornado 6.6.1` against a locked `6.6`);
2. **missing** — declared but not installed;
3. **extra** — installed but not in the lock (informational, not a problem);
4. uninstalled uv group packages are *not* a problem (a deliberately partial sync, e.g. `default-groups = []`, is fine).

PEP 440: `==`, `!=`, `>=`, `<=`, `>`, `<`, `~=`, `===`, wildcard `==x.y.*`; version normalization per PEP 440 (`6.6` ≡ `6.6.0`), names per PEP 503.

## Commands

- `Deps Sync: Check now`
- `Deps Sync: Sync project (fix problems)` — sync (mode: see settings below)
- `Deps Sync: Show report` — full report in the *Deps Sync* output channel

## Settings

- `depsSync.enabled`, `depsSync.checkOnFocus`, `depsSync.checkOnSave`, `depsSync.banner` — all `true` by default.
- `depsSync.syncMode` — how "Sync project" runs:
  - `targeted` (default) — installs only the problem packages: `uv pip install …` / `<venv>/python -m pip install …` (mismatch → pin to the locked version);
  - `uv-sync` — a full `uv sync` with the args from `depsSync.uvSyncArgs` (uv projects only; pip projects fall back to targeted).
- `depsSync.uvSyncArgs` — arguments for `uv sync`, e.g. `["--all-groups", "--inexact"]`:

  ```jsonc
  // settings.json
  "depsSync.syncMode": "uv-sync",
  "depsSync.uvSyncArgs": ["--all-groups", "--inexact"]
  ```

  > ⚠️ Without `--inexact`, `uv sync` may remove packages that are not in the sync set — especially when `default-groups = []` in pyproject.

## Development

```bash
npm install
npm run compile
# F5 → "Run Extension" → open your Python project folder in the Extension Host
```

Smoke-test the core without VS Code:

```bash
npm run smoke -- /path/to/your/uv-project
```

## Packaging and install

```bash
npm run package            # → vscode-deps-sync-<version>.vsix in the project root
code --install-extension vscode-deps-sync-0.3.0.vsix
```

## Limitations (MVP)

- single workspace folder (the first one in the list);
- PEP 440 lite: `+local` versions are ignored in comparisons;
- the ignore list is workspace-scoped (workspaceState);
- `requirements.txt`: options (`-r`, `-e`, …) are skipped, environment markers are dropped.
