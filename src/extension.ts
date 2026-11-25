import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as path from 'path';
import { checkProject, syncRequirements } from './core/check';
import { CheckReport, RequirementResult, normName } from './core/types';

const DEP_BASENAMES = ['pyproject.toml', 'uv.lock', 'requirements.txt'];
const IGNORE_KEY = 'depsSync.ignore';

let statusItem: vscode.StatusBarItem;
let diagnostics: vscode.DiagnosticCollection;
let output: vscode.OutputChannel;
/** one report per workspace folder (multi-root) */
let latest: CheckReport[] = [];
let lastCheckAt = 0;
let checking = false;
let lastBannerSig = '';
let ctx: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
  ctx = context;
  output = vscode.window.createOutputChannel('Deps Sync');
  diagnostics = vscode.languages.createDiagnosticCollection('deps-sync');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'depsSync.showReport';
  statusItem.text = '$(sync) deps';
  statusItem.tooltip = 'Deps Sync: check dependencies';
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    diagnostics,
    output,
    vscode.commands.registerCommand('depsSync.checkNow', () => runCheck(true)),
    vscode.commands.registerCommand('depsSync.syncProject', () => syncProject()),
    vscode.commands.registerCommand('depsSync.showReport', () => showReport()),
    vscode.workspace.onDidSaveTextDocument(e => {
      if (cfg().checkOnSave && DEP_BASENAMES.includes(path.basename(e.fileName))) runCheck(false);
    }),
    vscode.window.onDidChangeWindowState(s => {
      if (s.focused && cfg().checkOnFocus && Date.now() - lastCheckAt > 60_000) runCheck(false);
    }),
  );

  setTimeout(() => runCheck(false), 2000);
}

export function deactivate(): void {
  // nothing to hold outside context.subscriptions
}

function cfg(): {
  enabled: boolean;
  checkOnFocus: boolean;
  checkOnSave: boolean;
  banner: boolean;
  syncMode: 'targeted' | 'uv-sync';
  uvSyncArgs: string[];
} {
  const c = vscode.workspace.getConfiguration('depsSync');
  return {
    enabled: c.get<boolean>('enabled', true),
    checkOnFocus: c.get<boolean>('checkOnFocus', true),
    checkOnSave: c.get<boolean>('checkOnSave', true),
    banner: c.get<boolean>('banner', true),
    syncMode: c.get<'targeted' | 'uv-sync'>('syncMode', 'targeted'),
    uvSyncArgs: c.get<string[]>('uvSyncArgs', []),
  };
}

async function runCheck(manual: boolean): Promise<void> {
  const c = cfg();
  if (!c.enabled || checking) return;
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return;

  checking = true;
  statusItem.text = '$(sync~spin) deps…';
  try {
    const ignored = (await ctx.workspaceState.get<string[]>(IGNORE_KEY)) ?? [];
    const reports = (await Promise.all(folders.map(f => checkProject(f.uri.fsPath, ignored))))
      .filter(r => r.project.kind !== 'none');
    latest = reports;
    lastCheckAt = Date.now();
    render(reports);

    const withProblems = reports.find(r => r.problems.length > 0);
    const sig = JSON.stringify(reports.flatMap(r => r.problems.map(p => `${r.project.root}::${p.name}:${p.status}`)));
    if (withProblems && c.banner && !manual && sig !== lastBannerSig) {
      lastBannerSig = sig;
      const first = withProblems.problems[0];
      const count = withProblems.problems.length;
      const msg =
        count === 1
          ? describe(first)
          : `${describe(first)}  (+ ${count - 1} more)`;
      const prefix = reports.length > 1 ? ` [${path.basename(withProblems.project.root)}]` : '';
      const pick = await vscode.window.showInformationMessage(`Deps Sync${prefix}: ${msg}`, 'Sync project', 'Ignore…', 'Show report');
      if (pick === 'Sync project') await syncProject();
      else if (pick === 'Ignore…') await ignoreFlow();
      else if (pick === 'Show report') showReport();
    }
  } catch (e) {
    output.appendLine(`check failed: ${String(e)}`);
    if (manual) vscode.window.showWarningMessage(`Deps Sync: check failed: ${String(e)}`);
  } finally {
    checking = false;
  }
}

function render(reports: CheckReport[]): void {
  diagnostics.clear();
  const errors = reports.filter(r => r.checkError);
  const problems = reports.flatMap(r => r.problems);
  if (problems.length > 0) {
    statusItem.text = `$(warning) deps: ${problems.length}`;
    statusItem.tooltip = `Deps Sync: ${problems.length} problem(s). Click for report.`;
  } else if (errors.length > 0) {
    statusItem.text = '$(warning) deps: error';
    statusItem.tooltip = errors.map(r => r.checkError).join('\n');
    return;
  } else {
    const total = reports.reduce((n, r) => n + r.results.length, 0);
    statusItem.text = '$(check) deps';
    statusItem.tooltip = `Deps Sync: ok (${total} checked, ${new Date(Date.now()).toLocaleTimeString()})`;
  }

  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const p of problems) {
    if (!p.file || p.line === 0) continue;
    const d = new vscode.Diagnostic(
      new vscode.Range(p.line - 1, 0, p.line - 1, 1000),
      describe(p),
      vscode.DiagnosticSeverity.Warning,
    );
    d.source = 'deps-sync';
    const arr = byFile.get(p.file) ?? [];
    arr.push(d);
    byFile.set(p.file, arr);
  }
  for (const [f, arr] of byFile) diagnostics.set(vscode.Uri.file(f), arr);
}

function describe(p: RequirementResult): string {
  if (p.status === 'mismatch') {
    const head = p.requirement
      ? `Requirement '${p.requirement}' is not satisfied`
      : `Locked version is not satisfied`;
    return p.lockedVersion
      ? `${head} — installed ${p.installed}, locked ${p.lockedVersion}`
      : `${head} — installed ${p.installed}`;
  }
  if (p.status === 'missing') return `Package '${p.name}' is required but not installed`;
  return `Cannot parse requirement '${p.requirement}'${p.error ? `: ${p.error}` : ''}`;
}

function showReport(): void {
  output.clear();
  if (latest.length === 0) {
    output.appendLine('No data yet — run "Deps Sync: Check now".');
    output.show(true);
    return;
  }
  for (const r of latest) {
    output.appendLine(`\nProject: ${r.project.root} (${r.project.kind})`);
    output.appendLine(`Checked: ${new Date(r.checkedAt).toLocaleString()}`);
    if (r.checkError) output.appendLine(`ERROR: ${r.checkError}`);
    output.appendLine(`PROBLEMS (${r.problems.length}):`);
    for (const p of r.problems) {
      const loc = p.file && p.line ? `  [${path.relative(r.project.root, p.file)}:${p.line}]` : '';
      output.appendLine(`  • ${describe(p)}${loc}`);
    }
    if (r.notApplicable.length > 0) {
      output.appendLine(`\nNot applicable for this environment (env marker false):`);
      for (const n of r.notApplicable) output.appendLine(`  • ${n.requirement}  [${n.marker}]`);
    }
    const extras = r.results.filter(x => x.status === 'extra');
    if (extras.length) {
      output.appendLine(`\nInstalled, but not in lock (informational):`);
      for (const e of extras) output.appendLine(`  • ${e.name} ${e.installed}`);
    }
    output.appendLine(`\nOK: ${r.results.filter(x => x.status === 'ok').length} requirement(s) satisfied`);
  }
  output.show(true);
}

/** Banner "Ignore…": adds the package name to the workspace-level ignore list. */
async function ignoreFlow(): Promise<void> {
  const report = latest.find(r => r.problems.length > 0);
  if (!report) return;
  const items = report.problems
    .filter(p => p.name)
    .map(p => ({ label: p.name!, description: p.requirement ?? p.status }));
  if (items.length === 0) return;
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Ignore a requirement (repeat to add more)…',
  });
  if (!picked) return;
  const cur = (await ctx.workspaceState.get<string[]>(IGNORE_KEY)) ?? [];
  const add = [normName(picked.label)];
  await ctx.workspaceState.update(IGNORE_KEY, [...cur, ...add]);
  lastBannerSig = '';
  await runCheck(false);
}

/**
 * "Sync project":
 * - syncMode "uv-sync" (uv projects): a full `uv sync` + depsSync.uvSyncArgs
 *   (e.g. ["--all-groups", "--inexact"]);
 * - otherwise a targeted install of the problem packages
 *   (mismatch → pin to the locked version; missing → per spec).
 *   uv: `uv pip install …`; pip: `<venv>/python -m pip install …`.
 */
async function syncProject(): Promise<void> {
  if (latest.length === 0) await runCheck(true);
  const report = latest.find(r => r.problems.length > 0) ?? latest[0];
  if (!report) return;
  if (report.problems.length === 0) {
    vscode.window.showInformationMessage('Deps Sync: all requirements are satisfied.');
    return;
  }
  const p = report.project;
  const c = cfg();

  if (c.syncMode === 'uv-sync' && p.kind === 'uv') {
    const args = ['sync', ...c.uvSyncArgs];
    await runCommand('uv', args, `Deps Sync: uv sync ${c.uvSyncArgs.join(' ')}`.trim(), p.root);
    lastBannerSig = '';
    await runCheck(true);
    return;
  }
  if (c.syncMode === 'uv-sync') {
    vscode.window.showInformationMessage('Deps Sync: uv sync is not available for pip projects — falling back to a targeted install.');
  }

  const reqs = syncRequirements(report);
  if (reqs.length === 0) {
    vscode.window.showInformationMessage('Deps Sync: nothing to install (see the report).');
    return;
  }
  const cmd = p.kind === 'uv' ? 'uv' : p.python ?? 'python3';
  const args = p.kind === 'uv' ? ['pip', 'install', ...reqs] : ['-m', 'pip', 'install', ...reqs];
  await runCommand(cmd, args, `Deps Sync: installing ${reqs.length} package(s)…`, p.root);
  lastBannerSig = '';
  await runCheck(true);
}

/** Run a command at the project root: logs to the Output channel + a progress notification. */
async function runCommand(cmd: string, args: string[], title: string, cwd: string): Promise<void> {
  output.appendLine(`\n$ ${cmd} ${args.join(' ')}  (cwd: ${cwd})`);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title },
    async () => {
      await new Promise<void>((resolve, reject) => {
        execFile(cmd, args, { cwd, timeout: 300_000 }, (err, stdout, stderr) => {
          if (stdout) output.append(stdout);
          if (stderr) output.append(stderr);
          if (err) reject(new Error(stderr || err.message));
          else resolve();
        });
      }).catch(async e => {
        await vscode.window.showErrorMessage(`Deps Sync: sync failed: ${String(e)}`);
        throw e;
      });
    },
  );
}
