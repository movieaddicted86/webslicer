/**
 * Import-graph cycle check for `server/src` and `web/src` (the job madge does in T-021, without the
 * dependency).
 *
 * Only runtime imports count: `import type`, `export type` and type-only specifiers are erased by the
 * compiler, so they cannot create a runtime cycle (that is exactly the difference between the old
 * `api ↔ projects` cycle and the remaining type-level ones). Re-exports (`export … from`) are
 * runtime imports – they run the module too.
 *
 *   npx tsx server/scripts/cycles.ts            # server/src
 *   npx tsx server/scripts/cycles.ts web/src    # the web app
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..', 'src'));

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sources(abs)));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(abs);
  }
  return out;
}

/** Runtime specifiers of one file, resolved to absolute source paths (`.ts`/`.tsx`, `index`). */
function runtimeImports(file: string, code: string, files: string[]): string[] {
  const found: string[] = [];
  const re = /^\s*(?:import|export)\s+(?!type\s)([^'"]*?)from\s+['"](\.[^'"]+)['"]/gm;
  for (const m of code.matchAll(re)) {
    const clause = m[1].trim();
    // `import { type A, type B } from …` alone is a type-only import
    if (clause.startsWith('{')) {
      const named = clause.slice(1, clause.lastIndexOf('}'));
      if (named.split(',').every((s) => /^\s*type\s/.test(s) || !s.trim())) continue;
    }
    const base = path.resolve(path.dirname(file), m[2]).replace(/\.js$/, '');
    const hit = [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find((p) => files.includes(p));
    if (hit) found.push(hit);
  }
  return found;
}

const files = await sources(ROOT);
const graph = new Map<string, string[]>();
for (const f of files) {
  graph.set(f, runtimeImports(f, await fs.readFile(f, 'utf8'), files));
}

const cycles: string[][] = [];
const state = new Map<string, number>();
const stack: string[] = [];
function visit(node: string) {
  state.set(node, 1);
  stack.push(node);
  for (const dep of graph.get(node) ?? []) {
    if (state.get(dep) === 1) cycles.push([...stack.slice(stack.indexOf(dep)), dep]);
    else if (!state.has(dep)) visit(dep);
  }
  stack.pop();
  state.set(node, 2);
}
for (const f of files) if (!state.has(f)) visit(f);

const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, '/');
if (cycles.length) {
  console.log(`${cycles.length} runtime cycle(s):`);
  for (const c of cycles) console.log('  ' + c.map(rel).join(' -> '));
  process.exitCode = 1;
} else {
  console.log(`no runtime cycle in ${graph.size} modules of ${rel(ROOT) || '.'}`);
}
