/**
 * Budget reconciliation — does the stored grand total equal the sum of its parts?
 *
 * WHY THIS EXISTS: RFP-2026-031 published a base of $735,340 when its own line
 * items summed to $792,540. A $57,200 gap, invisible on the document, found
 * only because someone happened to add the lines up by hand two months later.
 *
 * THE MECHANISM. A line item tagged into an assembly carries an assemblyId, and
 * both calculateCategoryTotal and calculateCategoryTotalWithRollups skip any
 * item that has one — on the assumption that the assembly's own head line item
 * carries the sum instead. Under the ORIGINAL assembly scheme there was no head
 * line item: assemblyId held the assembly NAME, and the assembly's total lived
 * in a separate `assemblies` map that was rendered in its own section and never
 * added to any category total. So the tagged items were subtracted from the
 * total and nothing replaced them. The money was on the page, in the assembly
 * block, outside the number at the bottom.
 *
 * This report recomputes every budget from its line items and shows the gap. It
 * reads only; it changes nothing. A figure that has already gone to a tenant is
 * not something software should quietly rewrite.
 */
import type { Express } from 'express';
import { db } from './db';
import { evaluationBudgets, rfpRequests, properties } from '@shared/schema';
import { eq, asc } from 'drizzle-orm';
import { requireAuthFlexible, checkPermission } from './middleware';
import { getBrandLogo as getBridgeLogo, BRAND_COLOR_PRIMARY, COMPANY_NAME } from './lib/branding';
import { parseIncludeArchived, applyArchiveFilter } from '@shared/rfp-archive';

function escapeHtml(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

interface LineItem {
  id?: string;
  description?: string;
  totalPrice?: string | number | null;
  tenantShare?: number | null;
  assemblyId?: string | null;
}

/** One line's contribution: price times the tenant's share. */
function lineAmount(item: LineItem): number {
  const price = typeof item?.totalPrice === 'number'
    ? item.totalPrice
    : parseFloat(String(item?.totalPrice ?? '')) || 0;
  const share = (item?.tenantShare ?? 100) / 100;
  return price * share;
}

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

  const allIds = new Set([...ti, ...dsc, ...ei].map((i) => String(i?.id ?? '')));

  const sumOfAllLines = counted.reduce((s, i) => s + lineAmount(i), 0);
  const sumExcludingAssemblyItems = counted
    .filter((i) => !i?.assemblyId)
    .reduce((s, i) => s + lineAmount(i), 0);

  // An assembly item is ORPHANED when its assemblyId does not name a line item
  // that exists — i.e. there is no head carrying its value. Those are the ones
  // that vanish from the total with nothing replacing them.
  const orphans = counted.filter(
    (i) => i?.assemblyId && !allIds.has(String(i.assemblyId)));
  const orphanedAssemblyTotal = orphans.reduce((s, i) => s + lineAmount(i), 0);
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

export function registerBudgetReconciliationReport(app: Express): void {
  app.get('/api/reports/budget-reconciliation', requireAuthFlexible, checkPermission('admin.access'),
    async (req, res) => {
      try {
        const budgets = await db.select().from(evaluationBudgets).orderBy(asc(evaluationBudgets.rfpId));
        const rfps = await db
          .select({
            id: rfpRequests.id,
            rfpNumber: rfpRequests.rfpNumber,
            projectName: rfpRequests.projectName,
            tenantName: rfpRequests.tenantName,
            property: rfpRequests.property,
            status: rfpRequests.status,
          })
          .from(rfpRequests);
        const rfpById = new Map(rfps.map((r) => [r.id, r]));

        const propRows = await db
          .select({ id: properties.id, propertyName: properties.propertyName, building: properties.building })
          .from(properties);
        const propById = new Map(propRows.map((p) => [String(p.id), p]));
        const propLabel = (ref: string | null) => {
          const p = ref ? propById.get(String(ref)) : undefined;
          if (!p) return '—';
          return p.building ? `${p.propertyName} - Bldg. ${p.building}` : p.propertyName;
        };

        // ARCHIVED RFPs DROP OUT unless asked for. A settled project from the
        // app's first weeks would otherwise sit in these results forever with
        // nothing anyone intends to do about it, and a report full of rows
        // nobody will action is a report nobody reads.
        const includeArchived = parseIncludeArchived(req.query);
        const archiveFilter = applyArchiveFilter(
          budgets.map((b) => ({ ...b, status: rfpById.get(b.rfpId)?.status ?? null })),
          includeArchived,
        );
        const audits = archiveFilter.rows.map((b) => auditBudget(b, rfpById.get(b.rfpId)));
        const problems = audits.filter((a) => a.verdict === 'understated' || a.verdict === 'overstated');
        const understated = problems.filter((a) => a.verdict === 'understated');
        const totalUnderstated = understated.reduce((s, a) => s + Math.abs(a.gap), 0);
        const assemblyCaused = problems.filter((a) => a.explainedByAssemblies);

        if (req.query.format === 'json') {
          return res.json({
            summary: {
              budgets: audits.length,
              archivedExcluded: archiveFilter.excludedCount,
              reconciled: audits.filter((a) => a.verdict === 'reconciled').length,
              understated: understated.length,
              overstated: problems.length - understated.length,
              explainedByAssemblies: assemblyCaused.length,
              totalUnderstatedDollars: totalUnderstated,
            },
            problems,
          });
        }

        const row = (a: BudgetAudit) => `
          <tr class="${a.verdict}">
            <td>${escapeHtml(a.rfpNumber || a.rfpId)}</td>
            <td>${escapeHtml(a.projectName || a.tenantName || '')}</td>
            <td>${escapeHtml(propLabel(a.propertyRef))}</td>
            <td class="num">${money(a.storedTotal)}</td>
            <td class="num">${money(a.sumOfAllLines)}</td>
            <td class="num ${a.gap < 0 ? 'bad' : 'warn'}">${a.gap < 0 ? '−' : '+'}${money(Math.abs(a.gap))}</td>
            <td>${a.explainedByAssemblies
              ? `<span class="cause">Assembly items excluded</span><div class="detail">${
                  a.orphanedAssemblyCount} item${a.orphanedAssemblyCount === 1 ? '' : 's'} in ${
                  escapeHtml(a.orphanedAssemblyNames.join(', '))}</div>`
              : a.orphanedAssemblyTotal > 0
                ? `<span class="cause">Partly assembly items (${money(a.orphanedAssemblyTotal)})</span>`
                : '<span class="muted">Not explained by assemblies — needs a look</span>'}</td>
          </tr>`;

        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Budget Reconciliation</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; margin: 24px; color: #222; font-size: 12px; }
  .document-title { font-size: 22px; font-weight: bold; background: ${BRAND_COLOR_PRIMARY}; color: #fff; padding: 10px; border-radius: 5px; text-align: center; }
  .report-subtitle { text-align: center; color: #666; font-size: 12px; margin-top: 4px; }
  .cards { display: flex; gap: 10px; margin: 14px 0; flex-wrap: wrap; }
  .card { flex: 1; min-width: 120px; border: 1px solid #ddd; border-radius: 5px; padding: 8px 10px; }
  .card .label { font-size: 10px; color: #666; text-transform: uppercase; }
  .card .value { font-size: 20px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { background: #eef2f9; text-align: left; padding: 6px; border: 1px solid #ccc; font-size: 11px; }
  td { padding: 6px; border: 1px solid #ddd; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; }
  .bad { color: #991b1b; font-weight: 700; }
  .warn { color: #92400e; font-weight: 700; }
  .muted { color: #888; }
  .cause { font-weight: 600; }
  .detail { font-size: 10px; color: #666; }
  tr.understated td { background: #fef2f2; }
  tr.overstated td { background: #fffbeb; }
  .ok { padding: 20px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 5px; }
  .explain { margin-top: 18px; padding: 10px 12px; background: #f1f5f9; border-radius: 4px; font-size: 11px; color: #334155; line-height: 1.5; }
  tr { page-break-inside: avoid; }
</style></head><body>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
    <img src="${getBridgeLogo()}" alt="${COMPANY_NAME}" style="height:30px;width:auto;" />
    <div style="font-size:12px;color:#999;">Generated ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'long', day: 'numeric' })}</div>
  </div>
  <div class="document-title">Budget Reconciliation</div>
  <div class="report-subtitle">Saved grand total vs. the sum of its own line items</div>
  ${archiveFilter.note
    ? `<div class="report-subtitle">${escapeHtml(archiveFilter.note)}${
        archiveFilter.included ? '' : ' Add ?includeArchived=true to see them.'}</div>`
    : ''}

  <div class="cards">
    <div class="card"><div class="label">Budgets checked</div><div class="value">${audits.length}</div></div>
    <div class="card"><div class="label">Reconciled</div><div class="value" style="color:#065f46">${audits.filter((a) => a.verdict === 'reconciled').length}</div></div>
    <div class="card"><div class="label">Understated</div><div class="value" style="color:${understated.length ? '#991b1b' : 'inherit'}">${understated.length}</div></div>
    <div class="card"><div class="label">Overstated</div><div class="value">${problems.length - understated.length}</div></div>
    <div class="card"><div class="label">Total understated</div><div class="value" style="color:${totalUnderstated ? '#991b1b' : 'inherit'}">${money(totalUnderstated)}</div></div>
  </div>

  ${problems.length === 0
    ? `<div class="ok"><strong>Every budget reconciles.</strong> Each saved grand total equals the sum of its own line items.</div>`
    : `<table>
         <thead><tr>
           <th style="width:10%">RFP</th>
           <th style="width:20%">Project</th>
           <th style="width:16%">Property</th>
           <th style="width:12%">Saved total</th>
           <th style="width:12%">Sum of lines</th>
           <th style="width:10%">Gap</th>
           <th style="width:20%">Cause</th>
         </tr></thead>
         <tbody>${problems.map(row).join('')}</tbody>
       </table>`}

  <div class="explain">
    <strong>What &ldquo;understated&rdquo; means.</strong> The saved total is LESS than the line
    items beneath it add up to — the published figure left money out.
    <br><br>
    <strong>The cause, where it says so.</strong> A line item tagged into an assembly is left out
    of the category total, on the assumption that the assembly's own header line carries its value
    instead. Under the original assembly scheme there was no header line: the assembly's total was
    shown in its own block and never added to anything. Those items were therefore subtracted from
    the total with nothing putting them back. The scope was priced, visible and correct — only the
    number at the bottom was wrong.
    <br><br>
    This report reads only and changes nothing. A figure that has already gone to a tenant is not
    something to rewrite silently.
  </div>
</body></html>`;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      } catch (error) {
        console.error('[budget-reconciliation] failed:', error);
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ message: `Failed to generate reconciliation report: ${message}` });
      }
    });
}
