import * as path from 'path';
import { checkProject } from './check';

/**
 * Smoke-CLI: node out/core/cli.js [root] [--json]
 * Example: node out/core/cli.js ~/projects/FT-MLAD
 */
const root = path.resolve(process.argv[2] ?? '.');

checkProject(root)
  .then(rep => {
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(rep, null, 2));
      return;
    }
    console.log(`Project: ${rep.project.root} (${rep.project.kind})`);
    if (rep.checkError) {
      console.log(`ERROR: ${rep.checkError}`);
      process.exitCode = 2;
      return;
    }
    const problems = rep.problems;
    console.log(`Problems: ${problems.length}`);
    for (const p of problems) {
      const loc = p.file && p.line ? `  [${path.relative(rep.project.root, p.file)}:${p.line}]` : '';
      console.log(
        `  • ${p.status}: ${p.name ?? p.requirement}` +
          (p.installed ? ` (installed ${p.installed})` : '') +
          (p.spec ? ` (want ${p.spec})` : '') +
          (p.lockedVersion ? ` (locked ${p.lockedVersion})` : '') +
          loc,
      );
    }
    const extras = rep.results.filter(r => r.status === 'extra');
    if (extras.length) {
      console.log(`Extras (installed, not in lock): ${extras.length}`);
      for (const e of extras) console.log(`  • ${e.name} ${e.installed}`);
    }
    const ok = rep.results.filter(r => r.status === 'ok').length;
    console.log(`OK: ${ok}`);
  })
  .catch(e => {
    console.error(`check failed: ${String(e)}`);
    process.exitCode = 1;
  });
