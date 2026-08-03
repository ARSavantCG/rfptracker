// Tests for shared/fee-bases.ts — the three fee-base decisions (Adolfo 2026-08-03).
// Run: npx tsx test-fee-bases.ts
import {
  classifyFeeRow, resolveFeeBase, feePassIndex, FEE_PASSES, type FeeBaseTotals,
} from './shared/fee-bases';

let pass = 0, fail = 0;
function check(name: string, actual: any, expected: any) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${ok ? '' : ` -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

// ── classification ───────────────────────────────────────────────────────────
check('permit fees', classifyFeeRow('Permit Fees (1.5%)'), 'permit');
check("builder's risk", classifyFeeRow("Builder's Risk Insurance (1%)"), 'builders-risk');
check('construction management', classifyFeeRow('Construction Management (2.75%)'), 'cm');
check('cm fee shorthand', classifyFeeRow('CM Fee (3%)'), 'cm');
check('contingency', classifyFeeRow('Contingency (5%)'), 'contingency');
check('design', classifyFeeRow('Architectural Design'), 'design');
// Ordering guard: "construction contingency" must NOT classify as CM.
check('construction contingency is contingency, not CM',
  classifyFeeRow('Construction Contingency (5%)'), 'contingency');
check('unknown -> other', classifyFeeRow('Dock Seal Kit'), 'other');
check('empty -> other', classifyFeeRow(''), 'other');
check('null -> other', classifyFeeRow(null), 'other');

// ── pass ordering (Q3) ───────────────────────────────────────────────────────
check('permit is pass 0', feePassIndex('permit'), 0);
check('builders risk is pass 0', feePassIndex('builders-risk'), 0);
check('CM is pass 1', feePassIndex('cm'), 1);
check('contingency is pass 2', feePassIndex('contingency'), 2);
check('Q3: CM strictly before contingency',
  feePassIndex('cm') < feePassIndex('contingency'), true);
check('three passes defined', FEE_PASSES.length, 3);

// ── the bases ────────────────────────────────────────────────────────────────
// Worked example: TI 500,000 | non-fee soft costs (design) 40,000
// permit 1.5% | builder's risk 1% | CM 2.75% | contingency 5%
const t: FeeBaseTotals = {
  tiTotal: 500000,
  nonFeeSoftCosts: 40000,
  pass1FeeTotal: 0,
  cmFeeTotal: 0,
};

// Q1: permit assessed on TI HARD COSTS ONLY — soft costs excluded.
check('Q1: permit base is TI only', resolveFeeBase('permit', t), 500000);
check('Q1: permit base EXCLUDES soft costs',
  resolveFeeBase('permit', t) === t.tiTotal + t.nonFeeSoftCosts, false);
check("Q1: builder's risk base is TI only", resolveFeeBase('builders-risk', t), 500000);
check('Q1: pct-construction-total means TI only',
  resolveFeeBase('other', t, 'pct-construction-total'), 500000);

const permitFee = 500000 * 0.015;      // 7,500
const brFee = 500000 * 0.01;           // 5,000
const t2: FeeBaseTotals = { ...t, pass1FeeTotal: permitFee + brFee }; // 12,500

// Q3: CM base includes everything above it but NOT contingency.
check('Q3: CM base = TI + soft + pass1 fees',
  resolveFeeBase('cm', t2), 500000 + 40000 + 12500);
const cmFee = resolveFeeBase('cm', t2) * 0.0275; // 552,500 * 2.75% = 15,193.75
check('CM fee value', Number(cmFee.toFixed(2)), 15193.75);

const t3: FeeBaseTotals = { ...t2, cmFeeTotal: cmFee };

// Q2: contingency carries ALL costs above it, INCLUDING the CM fee.
check('Q2: contingency base includes CM',
  Number(resolveFeeBase('contingency', t3).toFixed(2)), Number((500000 + 40000 + 12500 + cmFee).toFixed(2)));
check('Q2: contingency base is strictly greater than CM base',
  resolveFeeBase('contingency', t3) > resolveFeeBase('cm', t2), true);
check('Q2: contingency base excludes only itself — CM is in',
  Number((resolveFeeBase('contingency', t3) - resolveFeeBase('cm', t2)).toFixed(2)),
  Number(cmFee.toFixed(2)));

const contingency = resolveFeeBase('contingency', t3) * 0.05;
check('contingency value', Number(contingency.toFixed(2)), 28384.69);

// Q3 non-circularity: CM must NOT earn on contingency.
check('Q3: CM base does not include contingency',
  resolveFeeBase('cm', { ...t3 }), 552500);

// Grand total sanity
const grand = 500000 + 40000 + permitFee + brFee + cmFee + contingency;
check('grand total', Number(grand.toFixed(2)), 596078.44);

// ── explicit basis overrides ─────────────────────────────────────────────────
check('pct-ti-total override', resolveFeeBase('cm', t3, 'pct-ti-total'), 500000);
check('pct-rentable-sf override uses rentable', resolveFeeBase('cm', t3, 'pct-rentable-sf', 32025), 32025);
check('empty basis falls through to family default',
  resolveFeeBase('permit', t3, ''), 500000);
check('null basis falls through to family default',
  resolveFeeBase('permit', t3, null), 500000);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
