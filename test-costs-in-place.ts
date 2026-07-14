// Direct test of costs-in-place-report.ts pure helpers (imports the REAL module).
// Run: DATABASE_URL=postgres://stub npx tsx test-costs-in-place.ts
import { derivePropertyRentableSf, derivePropertyOfficeSf, buildImprovementRow } from './server/costs-in-place-report';

let pass = 0, fail = 0;
function check(name: string, actual: any, expected: any) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${ok ? '' : ` -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const property: any = {
  bayConfigurations: [
    { id: 'b1', bayName: 'Bay 1-2', squareFootage: 24000, rentableSquareFootage: 25000, hasSpeculativeOffice: true, officeSquareFootage: 1500 },
    { id: 'b2', bayName: 'Bay 3-4', squareFootage: 26094, hasSpeculativeOffice: true, officeSquareFootage: 2500 },
  ],
};
const rentableSf = derivePropertyRentableSf(property);
const officeSf = derivePropertyOfficeSf(property);
check('rentable SF sums rentable-or-raw per bay', rentableSf, 51094);
check('office SF sums bay officeSquareFootage', officeSf, 4000);
check('empty bays -> 0 office', derivePropertyOfficeSf({ bayConfigurations: [] } as any), 0);
check('null bays -> 0 office', derivePropertyOfficeSf({ bayConfigurations: null } as any), 0);

// lighting -> warehouse-net. 235,470 / 47,094 = 5.00
const lighting: any = { category: 'lighting', description: 'LED', totalCost: 23547000, allocationType: 'whole-property', isActive: true };
const r1 = buildImprovementRow(lighting, rentableSf, officeSf);
check('lighting nets out office: perSf', r1.perSf, '$5.00');
check('lighting basis = warehouse', r1.sfBasis, '47,094 sf (warehouse)');

// hvac -> warehouse-net. 94,188 / 47,094 = 2.00
const hvac: any = { category: 'hvac', description: 'RTUs', totalCost: 9418800, allocationType: 'whole-property', isActive: true };
check('hvac nets out office: perSf', buildImprovementRow(hvac, rentableSf, officeSf).perSf, '$2.00');

// fire-alarm -> whole. 255,470 / 51,094 = 5.00
const fire: any = { category: 'fire-alarm', description: 'FA', totalCost: 25547000, allocationType: 'whole-property', isActive: true };
const r3 = buildImprovementRow(fire, rentableSf, officeSf);
check('fire-alarm uses full rentable: perSf', r3.perSf, '$5.00');
check('fire-alarm basis = rentable', r3.sfBasis, '51,094 sf (rentable)');

// spec-office -> own-area. 120,000 / 2,400 = 50.00
const office: any = { category: 'spec-office', description: 'Office', totalCost: 12000000, allocationType: 'bay-specific', areaSf: 2400, isActive: true };
const r4 = buildImprovementRow(office, rentableSf, officeSf);
check('spec-office own areaSf: perSf', r4.perSf, '$50.00');
check('spec-office basis = entered', r4.sfBasis, '2,400 sf (entered)');

// demising -> dash
const wall: any = { category: 'demising-wall', description: 'Wall', totalCost: 8000000, allocationType: 'demising-wall', areaSf: 500, isActive: true };
const r5 = buildImprovementRow(wall, rentableSf, officeSf);
check('demising perSf dash', r5.perSf, '—');
check('demising cost still shown', r5.costDollars, 80000);

// override beats category default
const ov: any = { category: 'lighting', description: 'L', totalCost: 25547000, allocationType: 'whole-property', denominatorBasis: 'whole-property', isActive: true };
const r6 = buildImprovementRow(ov, rentableSf, officeSf);
check('override forces whole: perSf', r6.perSf, '$5.00');
check('override basis = rentable', r6.sfBasis, '51,094 sf (rentable)');

// warehouse-net with no office -> fallback flagged
const r7 = buildImprovementRow(lighting, rentableSf, 0);
check('warehouse-net w/o office falls back', r7.sfBasis, '51,094 sf (rentable*)');
check('fallback perSf uses rentable', r7.perSf, '$4.61');

// divide-by-zero guard
check('zero rentable -> dash', buildImprovementRow(fire, 0, 0).perSf, '—');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
