// Direct test of costs-in-place-report.ts pure helpers (imports the REAL module).
// Run: DATABASE_URL=postgres://stub npx tsx test-costs-in-place.ts
import { derivePropertyRentableSf, buildImprovementRow } from './server/costs-in-place-report';

let pass = 0, fail = 0;
function check(name: string, actual: any, expected: any) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

// Property with 2 bays: 25,000 rentable + 26,094 raw (no rentable field) = 51,094
const property: any = {
  bayConfigurations: [
    { id: 'b1', bayName: 'Bay 1-2', squareFootage: 24000, rentableSquareFootage: 25000, standardDockDoors: 2, oversizedDockDoors: 0 },
    { id: 'b2', bayName: 'Bay 3-4', squareFootage: 26094, standardDockDoors: 2, oversizedDockDoors: 0 },
  ],
};
const rentableSf = derivePropertyRentableSf(property);
check('derived rentable SF sums rentable-or-raw per bay', rentableSf, 51094);
check('empty bayConfigurations yields 0', derivePropertyRentableSf({ bayConfigurations: [] } as any), 0);
check('null bayConfigurations yields 0', derivePropertyRentableSf({ bayConfigurations: null } as any), 0);

// Case 1: office with entered areaSf — $120,000.00 (12,000,000 cents) / 2,400 sf = $50.00/sf
const office: any = { category: 'spec-office', description: 'Office buildout', totalCost: 12000000, allocationType: 'bay-specific', areaSf: 2400, isActive: true };
const r1 = buildImprovementRow(office, rentableSf);
check('entered areaSf: perSf', r1.perSf, '$50.00');
check('entered areaSf: basis', r1.sfBasis, '2,400 sf (entered)');
check('entered areaSf: cents->dollars', r1.costDollars, 120000);

// Case 2: whole-property lighting, no areaSf — $255,470.00 / 51,094 sf = $5.00/sf
const lighting: any = { category: 'lighting', description: 'LED upgrade', totalCost: 25547000, allocationType: 'whole-property', areaSf: null, isActive: true };
const r2 = buildImprovementRow(lighting, rentableSf);
check('property fallback: perSf', r2.perSf, '$5.00');
check('property fallback: basis', r2.sfBasis, '51,094 sf (property)');

// Case 3: demising wall — always dash, even with areaSf present
const wall: any = { category: 'demising-wall', description: 'Wall on line 10', totalCost: 8000000, allocationType: 'demising-wall', areaSf: 500, isActive: true };
const r3 = buildImprovementRow(wall, rentableSf);
check('demising wall: perSf dash', r3.perSf, '—');
check('demising wall: basis dash', r3.sfBasis, '—');
check('demising wall: cost still shown', r3.costDollars, 80000);

// Case 4: no areaSf AND property SF is 0 — dash, never Infinity/NaN
const orphan: any = { category: 'fire-alarm', description: 'Fire alarm', totalCost: 5000000, allocationType: 'whole-property', areaSf: null, isActive: true };
const r4 = buildImprovementRow(orphan, 0);
check('zero property SF: perSf dash (no divide-by-zero)', r4.perSf, '—');

// Case 5: areaSf of 0 must NOT be treated as entered — falls back to property SF
const zeroArea: any = { category: 'hvac', description: 'RTUs', totalCost: 10218800, allocationType: 'whole-property', areaSf: 0, isActive: true };
const r5 = buildImprovementRow(zeroArea, rentableSf);
check('areaSf=0 falls back to property SF', r5.sfBasis, '51,094 sf (property)');
check('areaSf=0 perSf uses property SF', r5.perSf, '$2.00');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
