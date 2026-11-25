import * as path from 'path';
import { checkProject } from './check';

/**
 * Smoke-CLI: node out/core/cli.js [root1 [root2 …]] [--json]
 * Examples:
 *   node out/core/cli.js ~/projects/FT-MLAD
 *   node out/core/cli.js ~/projects/FT-MLAD ~/projects/LLM/deps-test --json
 */
const args = process.argv.slice(2).filter(a => a !== '--json');
const roots = args.length > 0 ? args.map(a => path.resolve(a)) : ['.'];

Promise.all(roots.map(root => checkProject(root)))
  .then(reps => {
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(reps, null, 2));
      return;
    }
    for (const rep of reps) {
      console.log(`\nProject: ${rep.project.root} (${rep.project.kind})`);
      if (rep.checkError) {
        console.log(`ERROR: ${rep.checkError}`);
        process.exitCode = 2;
        continue;
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
      if (rep.notApplicable.length > 0) {
        console.log(`Not applicable (env marker false): ${rep.notApplicable.length}`);
        for (const n of rep.notApplicable) console.log(`  • ${n.requirement}  [${n.marker}]`);
      }
      const extras = rep.results.filter(r => r.status === 'extra');
      if (extras.length) {
        console.log(`Extras (installed, not in lock): ${extras.length}`);
        for (const e of extras) console.log(`  • ${e.name} ${e.installed}`);
      }
      const ok = rep.results.filter(r => r.status === 'ok').length;
      console.log(`OK: ${ok}`);
    }
  })
  .catch(e => {
    console.error(`check failed: ${String(e)}`);
    process.exitCode = 1;
  });
