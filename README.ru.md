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
4. не установленные group-пакеты uv *не* считаются проблемой (допустим намеренно неполный синк — `default-groups = []`);
5. **маркер окружения false** — требование, чей маркер PEP 508 не выполняется для интерпретатора проекта (например, `pywin32; sys_platform == "win32"` на Linux), пропускается и выводится в отчёте как «не применимо».

PEP 440: `==`, `!=`, `>=`, `<=`, `>`, `<`, `~=`, `===`, wildcard `==x.y.*`; нормализация версий по PEP 440 (`6.6` ≡ `6.6.0`), имена — по PEP 503.
Маркеры PEP 508 (подмножество): `and` / `or`, операторы `===, ==, !=, >=, <=, >, <, ~=, in, not in`; имена `python_version`, `python_full_version`, `implementation_name`, `implementation_version`, `sys_platform`, `os_name`, `platform_system`, `platform_release`, `platform_machine`. Факты берутся из python проекта (venv); если python недоступен — маркеры считаются применимыми (мягко).

Multi-root workspace: проверяется каждая папка с Python-проектом; проблемы, diagnostics и отчёт сводятся по всем фолдерам.

## Команды

- `Deps Sync: Check now`
- `Deps Sync: Sync project (fix problems)` — синхронизация (режим см. настройки ниже)
- `Deps Sync: Show report` — полный отчёт в Output-канале *Deps Sync*

## Настройки

- `depsSync.enabled`, `depsSync.checkOnFocus`, `depsSync.checkOnSave`, `depsSync.banner` — все `true` по умолчанию.
- `depsSync.syncMode` — как выполняется «Sync project»:
  - `uv-sync` (по умолчанию) — полный `uv sync` с аргументами из `depsSync.uvSyncArgs` (только uv-проекты; для pip-проектов автоматически делается точечная установка);
  - `targeted` — точечная установка только проблемных пакетов: `uv pip install …` / `<venv>/python -m pip install …` (mismatch → пин к зафиксированной версии).
- `depsSync.uvSyncArgs` — аргументы для `uv sync`; по умолчанию `["--all-groups", "--inexact"]` (синк всех групп, только добавление/обновление, **ничего не удаляется**):

  ```jsonc
  // settings.json
  "depsSync.syncMode": "uv-sync",
  "depsSync.uvSyncArgs": ["--all-groups", "--inexact"]
  ```

  > ⚠️ `--inexact` не даёт uv удалять пакеты, которых нет в sync-наборе. Без него `uv sync` может вынести всё, что не входит в sync-набор (особенно при `default-groups = []` в pyproject).

## Разработка

```bash
npm install
npm run compile
# F5 → «Run Extension» → открой в Extension Host папку с Python-проектом
```

Smoke-тест ядра без VS Code (допускается несколько корней):

```bash
npm run smoke -- /home/smirnov_alex/projects/FT-MLAD /path/to/another-project
```

## Упаковка и установка

```bash
npm run package            # → vscode-deps-sync-<версия>.vsix в корне проекта
code --install-extension vscode-deps-sync-0.4.0.vsix
```

## Ограничения (MVP)

- PEP 440 lite: локальные версии `+local` в сравнении игнорируются;
- ignore-список — на уровне workspace (workspaceState);
- `requirements.txt`: опции (`-r`, `-e`, …) пропускаются;
- маркеры PEP 508 — практичное подмножество (см. выше); неизвестные имена условий считаются применимыми.
