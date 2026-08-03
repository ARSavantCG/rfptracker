// Tests for shared/line-total.ts — the minimum-cost-aware line math.
// Run: npx tsx test-line-total.ts
import { computeLineTotal, effectiveMinimumCost, parseMoney } from './shared/line-total';

let pass = 0, fail = 0;
function check(name: string, actual: any, expected: any) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${ok ? '' : ` -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

// ── parseMoney ───────────────────────────────────────────────────────────────
check('parseMoney plain string', parseMoney('48.75'), 48.75);
check('parseMoney strips commas', parseMoney('1,200.00'), 1200);
check('parseMoney strips currency', parseMoney('$9,750.50'), 9750.5);
check('parseMoney empty string -> null', parseMoney(''), null);
check('parseMoney whitespace -> null', parseMoney('   '), null);
check('parseMoney null -> null', parseMoney(null), null);
check('parseMoney undefined -> null', parseMoney(undefined), null);
check('parseMoney zero is a real value, not null', parseMoney('0'), 0);
check('parseMoney garbage -> null', parseMoney('n/a'), null);
check('parseMoney number passthrough', parseMoney(12.5), 12.5);

// ── effectiveMinimumCost ─────────────────────────────────────────────────────
check('minimum off when flag false',
  effectiveMinimumCost({ hasMinimumCost: false, minimumCost: '9750' }), null);
check('minimum off when flag missing',
  effectiveMinimumCost({ minimumCost: '9750' }), null);
check('minimum off when value empty (checked box, blank input)',
  effectiveMinimumCost({ hasMinimumCost: true, minimumCost: '' }), null);
check('minimum off when value zero',
  effectiveMinimumCost({ hasMinimumCost: true, minimumCost: '0' }), null);
check('minimum on when flag true and value positive',
  effectiveMinimumCost({ hasMinimumCost: true, minimumCost: '9750' }), 9750);
check('minimum handles null source', effectiveMinimumCost(null), null);

// ── computeLineTotal: no minimum ─────────────────────────────────────────────
check('plain qty x price',
  computeLineTotal({ quantity: 100, unitPrice: '48.75' }).total, 4875);
check('no item -> no minimum applied',
  computeLineTotal({ quantity: 100, unitPrice: '48.75' }).minimumApplied, false);
check('string quantity parses',
  computeLineTotal({ quantity: '100', unitPrice: '48.75' }).total, 4875);
check('missing price -> 0',
  computeLineTotal({ quantity: 100, unitPrice: null }).total, 0);
check('missing quantity -> 0',
  computeLineTotal({ quantity: null, unitPrice: '48.75' }).total, 0);

// ── computeLineTotal: minimum enforcement (the actual bug) ───────────────────
// Demising wall: $48.75/LF, 200 LF minimum => $9,750 floor.
const wall = { hasMinimumCost: true, minimumCost: '9750' };

const under = computeLineTotal({ quantity: 40, unitPrice: '48.75', item: wall });
check('BUG CASE: 40 LF below 200 LF minimum bills the floor', under.total, 9750);
check('BUG CASE: raw total preserved for display', under.rawTotal, 1950);
check('BUG CASE: minimumApplied flag set', under.minimumApplied, true);
check('BUG CASE: minimumCost surfaced', under.minimumCost, 9750);

const exact = computeLineTotal({ quantity: 200, unitPrice: '48.75', item: wall });
check('exactly at minimum bills normally', exact.total, 9750);
check('exactly at minimum does NOT flag', exact.minimumApplied, false);

const over = computeLineTotal({ quantity: 300, unitPrice: '48.75', item: wall });
check('above minimum bills actual', over.total, 14625);
check('above minimum does NOT flag', over.minimumApplied, false);

// ── tenant share ─────────────────────────────────────────────────────────────
check('share applies to plain line',
  computeLineTotal({ quantity: 100, unitPrice: '10', tenantShare: 50 }).total, 500);
check('share defaults to 100 when absent',
  computeLineTotal({ quantity: 100, unitPrice: '10' }).total, 1000);
check('share null -> 100',
  computeLineTotal({ quantity: 100, unitPrice: '10', tenantShare: null }).total, 1000);
check('share zero is honored, not coerced to 100',
  computeLineTotal({ quantity: 100, unitPrice: '10', tenantShare: 0 }).total, 0);

// ORDER OF OPERATIONS: minimum floors the GROSS, then share applies.
// Demising walls default to 50% share, so this is the common real case.
const shared = computeLineTotal({ quantity: 40, unitPrice: '48.75', tenantShare: 50, item: wall });
check('minimum floors gross BEFORE share (50% of 9750)', shared.total, 4875);
check('gross total reflects the floor', shared.grossTotal, 9750);
check('share does not suppress the flag', shared.minimumApplied, true);

// ── snapshot-shaped source (client path reads romSnapshot) ───────────────────
check('works off a romSnapshot-shaped object',
  computeLineTotal({
    quantity: 10, unitPrice: '48.75',
    item: { hasMinimumCost: true, minimumCost: '9,750.00' },
  }).total, 9750);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
