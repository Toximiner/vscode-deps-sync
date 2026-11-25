# Deps Sync (vscode-deps-sync)

Расширение VS Code, повторяющее баннер PyCharm «Package requirement 'x==y' is not satisfied — Sync project / Ignore requirement».

## Что делает

При открытии папки с Python-проектом (и после сохранения/фокуса) сверяет **задекларированные** зависимости с **установленными** в venv и при расхождениях показывает:

- баннер-уведомление с кнопками **Sync project** / **Ignore…** / **Show report**;
- diagnostics (жёлтая волнистая) в строках `pyproject.toml` / `uv.lock` / `requirements.txt` + Problems;
- status bar: `✓ deps` или `⚠ deps: N` (клик — отчёт в канале *Deps Sync*).

Поддерживаемые проекты:

| Тип | Файлы | Источники | Синк |
|---|---|---|---|
| uv | `pyproject.toml` + `uv.lock` | `[project].dependencies` + весь lock | `uv pip install …` |
| pip | `requirements.txt` (или только `pyproject.toml`) | строки-требования | `<venv>/python -m pip install …` |

Логика сверки:

1. **мismatch** — установлена версия не удовлетворяет спецификации (для uv: плюс сверка *всех* установленных пакетов с версиями из `uv.lock`, включая transitive — ловит drift вроде `tornado 6.6.1` при локе `6.6`);
2. **missing** — задекларировано, но не установлено;
3. **extra** — установлено, но нет в локе (справочно, не считается проблемой);
4. не установленные group-пакеты uv *не* считаются проблемой (допустим намеренно неполный синк — `default-groups = []`).

PEP 440: `==`, `!=`, `>=`, `<=`, `>`, `<`, `~=`, `===`, wildcard `==x.y.*`; нормализация версий по PEP 440 (`6.6` ≡ `6.6.0`), имена — по PEP 503.

## Команды

- `Deps Sync: Check now`
- `Deps Sync: Sync project (fix problems)` — синхронизация (режим см. настройки ниже)
- `Deps Sync: Show report` — полный отчёт в Output-канале *Deps Sync*

## Настройки

- `depsSync.enabled`, `depsSync.checkOnFocus`, `depsSync.checkOnSave`, `depsSync.banner` — все `true` по умолчанию.
- `depsSync.syncMode` — как выполняется «Sync project»:
  - `targeted` (по умолчанию) — точечная установка только проблемных пакетов: `uv pip install …` / `<venv>/python -m pip install …` (mismatch → пин к зафиксированной версии);
  - `uv-sync` — полный `uv sync` с аргументами из `depsSync.uvSyncArgs` (только uv-проекты; для pip-проектов автоматически делается точечная установка).
- `depsSync.uvSyncArgs` — аргументы для `uv sync`, например `["--all-groups", "--inexact"]`:

  ```jsonc
  // settings.json
  "depsSync.syncMode": "uv-sync",
  "depsSync.uvSyncArgs": ["--all-groups", "--inexact"]
  ```

  > ⚠️ `--inexact` не даёт uv удалять пакеты, которых нет в sync-наборе. Без него `uv sync` может вынести всё, что не входит в базовые зависимости (особенно при `default-groups = []` в pyproject).

## Разработка

```bash
npm install
npm run compile
# F5 → «Run Extension» → открой в Extension Host папку с Python-проектом
```

Smoke-тест ядра без VS Code:

```bash
npm run smoke -- /home/smirnov_alex/projects/FT-MLAD
```

## Упаковка и установка

```bash
npm run package            # → vscode-deps-sync-<версия>.vsix в корне проекта
code --install-extension vscode-deps-sync-0.2.0.vsix
```

## Ограничения (MVP)

- один workspace-фолдер (первый в списке);
- PEP 440 lite: локальные версии `+local` в сравнении игнорируются;
- ignore-список — на уровне workspace (workspaceState);
- `requirements.txt`: опции (`-r`, `-e`, …) пропускаются, маркеры окружения отбрасываются.
