/**
 * The budget audit, on its own.
 *
 * It lived inside the report route, which imports ./db — and ./db opens a
 * connection the moment it is imported. That made the one piece of this
 * feature worth testing the one piece that could not be tested without a
 * live database, so it never was, and it shipped with a sum that
 * double-counted assembly heads. Pure arithmetic belongs in a module that
 * needs nothing to run.
 */
import { lineAmount, headIds, sumBudgetLines } from '@shared/budget-totals';

interface LineItem {
  id?: string;
  description?: string;
  totalPrice?: string | number | null;
  tenantShare?: number | null;
  assemblyId?: string | null;
}

/*
 * lineAmount, headIds and sumBudgetLines come from shared/budget-totals, which
 * is THE rule for what a budget adds up to.
 *
 * This file used to carry its own copy of lineAmount and then add the lines up
 * with a plain reduce. That reduce counted an assembly HEAD and its CHILDREN
 * both, so any budget built with a head line was reported as short by exactly
 * the value of that assembly's components — and short in a way the orphan
 * check could not explain, because the head does exist, so none of them are
 * orphans. Five 2025 projects were sitting in the results as "not explained by
 * assemblies" for that reason and no other.
 *
 * An audit that reimplements the thing it audits can only agree with itself.
 */

export interface BudgetAudit {
  rfpId: number;
  rfpNumber: string | null;
  projectName: string | null;
  tenantName: string | null;
  propertyRef: string | null;
  status: string | null;
  updatedAt: Date | null;

  /** What was saved, and shown on the published document. */
  storedTotal: number;
  /** Every line item, with nothing skipped. */
  sumOfAllLines: number;
  /** What the app's own rule produces: items tagged into an assembly skipped. */
  sumExcludingAssemblyItems: number;

  /** Items tagged into an assembly whose head line item does NOT exist. */
  orphanedAssemblyTotal: number;
  orphanedAssemblyCount: number;
  /** The assembly names involved, for the explanation. */
  orphanedAssemblyNames: string[];

  /** storedTotal − sumOfAllLines. Negative means the total is UNDERSTATED. */
  gap: number;
  verdict: 'reconciled' | 'understated' | 'overstated' | 'no-lines';
  /** Whether the gap is explained by orphaned assembly items. */
  explainedByAssemblies: boolean;
}

export function auditBudget(row: any, rfp: any): BudgetAudit {
  const ti: LineItem[] = (row.tenantImprovements || []) as LineItem[];
  const dsc: LineItem[] = (row.designSoftCosts || []) as LineItem[];
  const ei: LineItem[] = (row.existingImprovements || []) as LineItem[];

  // Existing improvements only count when the budget says to include them,
  // which is the same condition calculateGrandTotal applies.
  const includeExisting = !!row.hasExistingImprovements && !!row.includeExistingInTotal;
  const counted: LineItem[] = [...ti, ...dsc, ...(includeExisting ? ei : [])];

  // The same rule the evaluation screen, the save gate and the publish block
  // all use: a head is worth its children, a child under a head counts once
  // through that head, and an orphan counts for itself.
  // Heads resolve against EVERY line, not only the counted ones: a head can
  // sit in a category that is excluded from the total while its children are
  // counted, and reading only the counted set would mistake those for orphans.
  const everyLine = [...ti, ...dsc, ...ei] as any;
  const heads = headIds(everyLine, (row.customAssemblies || []) as any);
  const sumOfAllLines = sumBudgetLines(counted as any, everyLine, (row.customAssemblies || []) as any);
  const sumExcludingAssemblyItems = counted
    .filter((i) => !i?.assemblyId)
    .reduce((s, i) => s + lineAmount(i as any), 0);

  // An assembly item is ORPHANED when its assemblyId does not name a line item
  // that exists — i.e. there is no head carrying its value. Those are the ones
  // that vanish from the total with nothing replacing them.
  const orphans = counted.filter(
    (i) => i?.assemblyId && !heads.has(String(i.assemblyId)));
  const orphanedAssemblyTotal = orphans.reduce((s, i) => s + lineAmount(i as any), 0);
  const orphanedAssemblyNames = Array.from(
    new Set(orphans.map((i) => String(i.assemblyId))));

  const storedTotal = parseFloat(String(row.grandTotal ?? '')) || 0;
  const gap = storedTotal - sumOfAllLines;

  let verdict: BudgetAudit['verdict'];
  if (counted.length === 0) verdict = 'no-lines';
  // A dollar of rounding is not a discrepancy; $57,200 is.
  else if (Math.abs(gap) < 1) verdict = 'reconciled';
  else if (gap < 0) verdict = 'understated';
  else verdict = 'overstated';

  return {
    rfpId: row.rfpId,
    rfpNumber: rfp?.rfpNumber ?? null,
    projectName: rfp?.projectName ?? null,
    tenantName: rfp?.tenantName ?? null,
    propertyRef: rfp?.property ?? null,
    status: rfp?.status ?? null,
    updatedAt: row.updatedAt ?? null,
    storedTotal,
    sumOfAllLines,
    sumExcludingAssemblyItems,
    orphanedAssemblyTotal,
    orphanedAssemblyCount: orphans.length,
    orphanedAssemblyNames,
    gap,
    verdict,
    // Within a dollar: the gap IS the orphaned assembly money, not a coincidence.
    explainedByAssemblies:
      orphanedAssemblyTotal > 0 && Math.abs(Math.abs(gap) - orphanedAssemblyTotal) < 1,
  };
}
