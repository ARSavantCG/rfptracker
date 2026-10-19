/**
 * Every column named inside a drizzle `.select({...})` must exist on its table.
 *
 * WHY THIS EXISTS: `executedLeases.suiteNumber` did not exist. executed_leases
 * has bay_numbers, not suite_number. Drizzle received `undefined` for that
 * column and threw on every request, so the Project Team Directory returned a
 * 500 from the day the line was added (2026-08-11) until someone first clicked
 * it on 2026-10-19 — two months later. It was not reachable from the Reports
 * page until the report catalog put it there, which is the only reason anyone
 * noticed at all.
 *
 * TypeScript did flag it. It was invisible among the pre-existing errors nobody
 * reads, and `npm run build` uses esbuild, which does not typecheck. So this
 * check reports exactly one class of fault, loudly, with nothing else in the way.
 *
 * Run: npx tsx scripts/check-select-columns.mts
 *
 * Scoped deliberately to `.select({...})` bodies. Elsewhere "properties.edit"
 * is a permission string and "bidCollections.length" is a local array, and
 * neither is a column reference — checking the whole file produced 50 false
 * positives and would have been ignored like every other noisy check.
 */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as schema from '../shared/schema';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'server');

// Drizzle marks its table objects with this symbol; plain exports do not have it.
const DRIZZLE_COLUMNS = Symbol.for('drizzle:Columns');
const tables: Record<string, any> = {};
for (const [name, value] of Object.entries(schema as any)) {
  if (value && typeof value === 'object' && (value as any)[DRIZZLE_COLUMNS]) {
    tables[name] = value;
  }
}

/** Every `.select({ ... })` body in a source file, brace-matched. */
function selectBodies(src: string): Array<{ body: string; offset: number }> {
  const out: Array<{ body: string; offset: number }> = [];
  const re = /\.select\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    out.push({ body: src.slice(m.index + m[0].length, i - 1), offset: m.index });
  }
  return out;
}

let checked = 0;
const bad: string[] = [];

for (const file of readdirSync(serverDir).filter((f) => f.endsWith('.ts'))) {
  const src = readFileSync(join(serverDir, file), 'utf8');
  for (const { body, offset } of selectBodies(src)) {
    const re = /\b([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      const [, tableName, column] = m;
      const table = tables[tableName];
      if (!table) continue;
      checked++;
      if (table[column] === undefined) {
        const line = src.slice(0, offset).split('\n').length;
        bad.push(`${file}: near line ${line} — ${tableName}.${column} does not exist on that table`);
      }
    }
  }
}

console.log(`tables known: ${Object.keys(tables).length}`);
console.log(`column references checked inside .select(): ${checked}`);

if (bad.length > 0) {
  console.error('\nNONEXISTENT COLUMNS — these throw at runtime, not at build time:\n');
  for (const b of Array.from(new Set(bad))) console.error('  ' + b);
  console.error(`\n${new Set(bad).size} bad reference(s).`);
  process.exit(1);
}

console.log('ALL SELECTED COLUMNS RESOLVE');
