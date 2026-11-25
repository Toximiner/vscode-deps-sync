# Changelog

## 0.3.0

- All UI strings and setting descriptions switched to English (marketplace standard); the Russian README is kept as `README.ru.md` (shown to Russian users on the marketplace).
- Code comments translated to English.

## 0.2.0

- Configurable sync: `depsSync.syncMode` (`targeted` | `uv-sync`) and `depsSync.uvSyncArgs` (e.g. `["--all-groups", "--inexact"]` → `uv sync --all-groups --inexact`).
- Publisher set to Toximiner.
- Packaging fix: vsce 3.x `--out` takes a file path, not a directory — the package script now uses the default `<name>-<version>.vsix` in the project root.

## 0.1.0

- Initial release: PyCharm-style banner (Sync project / Ignore… / Show report), diagnostics at declaration lines, status-bar item, output-channel report.
- Project detection: uv (`pyproject.toml` + `uv.lock`) and pip (`requirements.txt`).
- PEP 440-lite comparison (==, !=, >=, <=, >, <, ~=, ===, wildcards; `+local` ignored).
- For uv: full lock map check catches transitive/group drift; extras are informational.
