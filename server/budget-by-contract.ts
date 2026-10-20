/**
 * Budget by Contract Counterparty — the model and the page.
 *
 * Groups a project's budget by who holds the contract: the contractor, the
 * designer, construction management, and everything else. Split from the
 * route so the arithmetic can be tested without a database.
 *
 * Two faults fixed in the move (2026-10-20):
 *
 *   1. It read totalPrice straight off each line, ignoring tenant share. A
 *      demising wall the tenant pays half of printed at its full $114,400,
 *      and the report totalled to a figure that matched nothing on the
 *      evaluation screen. Lines now carry the TENANT'S share, and whatever
 *      the tenant is not paying is listed under Outstanding Share — money
 *      spent on the improvement that cannot be billed back.
 *
 *   2. It listed every line, so an assembly head and its components were
 *      both counted. Same fault, same fix, as the reconciliation report:
 *      shared/budget-totals decides what a line is worth.
 *
 * The Tenant Share subtotal is what the evaluation's grand total adds up to,
 * and the page says so if the two ever disagree.
 */
import {
  headIds, lineSplitWithHeads, isCoveredByHead, type BudgetLine,
} from '@shared/budget-totals';
import {
  REPORT_SHELL_CSS, reportHeaderHtml, reportFooterHtml, rfpInfoRows,
  escapeHtml, money2, type ReportInfoRow,
} from './lib/report-shell';

export type Bucket = 'contractor' | 'design' | 'cm' | 'misc';
export const BUCKETS: Bucket[] = ['contractor', 'design', 'cm', 'misc'];
export const BUCKET_LABELS: Record<Bucket, string> = {
  contractor: 'Contractor (Construction)',
  design: 'Design',
  cm: 'CM Fees',
  // Was "Balance / Miscellaneous". "Balance" read as an amount owing.
  misc: 'Miscellaneous',
};

/**
 * Which contract a line belongs to. An explicit catalog bucket wins;
 * otherwise inferred from the name. The catalog still stores 'balance' for
 * the last bucket, so that is accepted as a synonym.
 */
export function resolveContractBucket(itemName: string, cat: any): Bucket {
  const explicit = String(cat?.contractBucket || '').toLowerCase();
  if (explicit === 'balance' || explicit === 'misc') return 'misc';
  if ((BUCKETS as string[]).includes(explicit)) return explicit as Bucket;
  const name = `${cat?.name || ''} ${itemName || ''}`.toLowerCase();
  if (/contingency|permit|testing|inspection|bond/.test(name)) return 'misc';
  if (/construction management|cm fee|\bcm\b/.test(name)) return 'cm';
  if (/design|architect|engineer/.test(name)) return 'design';
  const category = String(cat?.category || '').toLowerCase();
  if (category.includes('soft') || category.includes('design')) return 'misc';
  return 'contractor';
}

export interface ReportLine {
  description: string;
  /** What the tenant is billed for this line. */
  amount: number;
  /** The tenant's share, when it is not the whole line. */
  sharePct: number | null;
}

export interface OutstandingLine {
  description: string;
  /** The part of the line the tenant is NOT paying. */
  amount: number;
  /** The tenant's share, for context: "tenant pays 50%". */
  tenantSharePct: number;
}

export interface BudgetByContractModel {
  isRom: boolean;
  buckets: { key: Bucket; label: string; total: number; items: ReportLine[] }[];
  /** Existing improvements counted in the total, when the budget says so. */
  existing: { included: boolean; total: number; items: ReportLine[] } | null;
  /** Sum of every tenant amount: what the evaluation's grand total should be. */
  tenantTotal: number;
  outstanding: OutstandingLine[];
  outstandingTotal: number;
  /** What the work costs, all in. */
  projectTotal: number;
  /** The saved grand total, for the cross-check. Null on the ROM path. */
  savedGrandTotal: number | null;
  rom: { romNumber: string; cmRemovedBy: string | null; cmRemovedAt: Date | string | null } | null;
}

const sharePctOf = (line: any): number => {
  const n = Number(line?.tenantShare);
  return Number.isFinite(n) ? n : 100;
};

/** From an evaluation budget. */
export function buildFromEvaluation(budget: any, catalogById: Map<number, any>): BudgetByContractModel {
  const ti: BudgetLine[] = budget?.tenantImprovements || [];
  const dsc: BudgetLine[] = budget?.designSoftCosts || [];
  const ei: BudgetLine[] = budget?.existingImprovements || [];
  const all = [...ti, ...dsc, ...ei];
  const heads = headIds(all, budget?.customAssemblies || []);

  const buckets = BUCKETS.map((key) => ({ key, label: BUCKET_LABELS[key], total: 0, items: [] as ReportLine[] }));
  const outstanding: OutstandingLine[] = [];
  let tenantTotal = 0;
  let projectTotal = 0;

  const take = (line: any, onLine: (row: ReportLine) => void) => {
    // A component is shown through its head, never on its own as well.
    if (isCoveredByHead(line, heads)) return;
    const split = lineSplitWithHeads(line, all, heads);
    if (Math.abs(split.full) < 0.005) return; // nothing to say about a $0 line
    const pct = heads.has(String(line?.id ?? '')) ? null : sharePctOf(line);
    const shared = pct !== null && pct < 100;
    onLine({ description: String(line?.description ?? ''), amount: split.tenant, sharePct: shared ? pct : null });
    tenantTotal += split.tenant;
    projectTotal += split.full;
    if (split.outstanding > 0.005) {
      outstanding.push({
        description: String(line?.description ?? ''),
        amount: split.outstanding,
        tenantSharePct: pct ?? 100,
      });
    }
  };

  for (const line of [...ti, ...dsc]) {
    const cat = (line as any)?.masterItemId != null ? catalogById.get((line as any).masterItemId) : undefined;
    const key = resolveContractBucket(String((line as any)?.description ?? ''), cat);
    const bucket = buckets.find((b) => b.key === key)!;
    take(line, (row) => { bucket.items.push(row); bucket.total += row.amount; });
  }

  let existing: BudgetByContractModel['existing'] = null;
  if (budget?.hasExistingImprovements) {
    const included = !!budget?.includeExistingInTotal;
    const items: ReportLine[] = [];
    let total = 0;
    if (included) {
      // Counted, because the evaluation counts them. Leaving them out would
      // put this report's total and the evaluation's at odds.
      for (const line of ei) take(line, (row) => { items.push(row); total += row.amount; });
    } else {
      for (const line of ei) {
        if (isCoveredByHead(line, heads)) continue;
        const split = lineSplitWithHeads(line, all, heads);
        total += split.tenant;
      }
    }
    existing = { included, total, items };
  }

  const outstandingTotal = outstanding.reduce((s, o) => s + o.amount, 0);
  const saved = parseFloat(String(budget?.grandTotal ?? ''));
  return {
    isRom: false,
    buckets,
    existing,
    tenantTotal,
    outstanding,
    outstandingTotal,
    projectTotal,
    savedGrandTotal: Number.isFinite(saved) ? saved : null,
    rom: null,
  };
}

/** From a ROM pilot. ROM lines carry no tenant share: the allowance is the tenant's. */
export function buildFromRom(pilot: any, items: any[], catalogById: Map<number, any>): BudgetByContractModel {
  const buckets = BUCKETS.map((key) => ({ key, label: BUCKET_LABELS[key], total: 0, items: [] as ReportLine[] }));
  let total = 0;
  for (const it of items || []) {
    const cat = catalogById.get(it.scopeItemId);
    const amount = parseFloat(it.totalPrice) || 0;
    if (Math.abs(amount) < 0.005) continue;
    const bucket = buckets.find((b) => b.key === resolveContractBucket(cat?.name || '', cat))!;
    bucket.items.push({ description: cat?.name || `Item #${it.scopeItemId}`, amount, sharePct: null });
    bucket.total += amount;
    total += amount;
  }
  return {
    isRom: true,
    buckets,
    existing: null,
    tenantTotal: total,
    outstanding: [],
    outstandingTotal: 0,
    projectTotal: total,
    savedGrandTotal: null,
    rom: {
      romNumber: String(pilot?.romNumber ?? ''),
      cmRemovedBy: pilot?.cmFeeRemovedBy ?? null,
      cmRemovedAt: pilot?.cmFeeRemovedAt ?? null,
    },
  };
}

const pct = (part: number, whole: number) =>
  whole ? `${((part / whole) * 100).toFixed(1)}%` : '—';

export const REPORT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111827;
    margin: 0; padding: 28px 32px; font-size: 12px; }
  @media print { body { padding: 0; } }
  ${REPORT_SHELL_CSS}
  table.bbc { width: 100%; border-collapse: collapse; }
  table.bbc th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
    color: #374151; border-bottom: 2px solid #9ca3af; padding: 5px 8px; }
  table.bbc td { padding: 4px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  table.bbc .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.bbc .pc { width: 72px; }
  table.bbc .amt { width: 130px; }
  tr.bucket td { font-weight: 700; background: #f3f4f6; border-top: 1px solid #d1d5db;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  tr.item td.desc { padding-left: 24px; color: #374151; }
  .share { color: #6b7280; font-size: 10.5px; margin-left: 6px; white-space: nowrap; }
  tr.subtotal td { font-weight: 700; border-top: 1px solid #6b7280; }
  tr.outstanding td { font-weight: 700; color: #991b1b; background: #fef2f2; border-top: 1px solid #fca5a5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  tr.outstanding-item td { color: #991b1b; }
  tr.outstanding-item td.desc { padding-left: 24px; }
  tr.grand td { font-weight: 800; font-size: 13px; border-top: 3px double #111827; border-bottom: none; }
  tr.section-gap td { border: none; padding: 6px 0 0; }
  tr.info td { color: #6b7280; font-style: italic; }
  .mismatch { margin: 10px 0 0; padding: 8px 10px; border: 1px solid #f59e0b; background: #fffbeb;
    color: #92400e; border-radius: 4px; font-size: 11.5px; }
  .allowance { margin-top: 14px; }
`;

export function renderBudgetByContractHtml(opts: {
  model: BudgetByContractModel;
  rfp: any;
  property: any | null;
  generatedBy?: string | null;
  generatedAt?: Date;
}): string {
  const { model: m, rfp, property } = opts;
  const total = m.projectTotal;

  const lineRow = (it: ReportLine) => `
    <tr class="item"><td class="desc">${escapeHtml(it.description)}${
      it.sharePct !== null ? `<span class="share">${it.sharePct}% tenant share</span>` : ''
    }</td><td class="num amt">${money2(it.amount)}</td><td class="num pc"></td></tr>`;

  const bucketRows = m.buckets
    // An empty contract is noise on a one-page report.
    .filter((b) => b.items.length > 0)
    .map((b) => `
    <tr class="bucket"><td>${escapeHtml(b.label)}</td><td class="num amt">${money2(b.total)}</td><td class="num pc">${pct(b.total, total)}</td></tr>
    ${b.items.map(lineRow).join('')}`)
    .join('');

  const existingRows = m.existing?.included && m.existing.items.length
    ? `
    <tr class="bucket"><td>Existing Improvements</td><td class="num amt">${money2(m.existing.total)}</td><td class="num pc">${pct(m.existing.total, total)}</td></tr>
    ${m.existing.items.map(lineRow).join('')}`
    : '';

  // Only worth a subtotal when there is something after it to separate.
  const hasOutstanding = m.outstanding.length > 0;
  const outstandingRows = hasOutstanding
    ? `
    <tr class="subtotal"><td>Tenant Share</td><td class="num amt">${money2(m.tenantTotal)}</td><td class="num pc">${pct(m.tenantTotal, total)}</td></tr>
    <tr class="section-gap"><td colspan="3"></td></tr>
    <tr class="outstanding"><td>Outstanding Share</td><td class="num amt">${money2(m.outstandingTotal)}</td><td class="num pc">${pct(m.outstandingTotal, total)}</td></tr>
    ${m.outstanding.map((o) => `
    <tr class="outstanding-item"><td class="desc">${escapeHtml(o.description)}<span class="share">tenant pays ${o.tenantSharePct}%</span></td><td class="num amt">${money2(o.amount)}</td><td class="num pc"></td></tr>`).join('')}`
    : '';

  const grandLabel = hasOutstanding ? 'Total Project Cost' : 'Total';

  const existingInfo = m.existing && !m.existing.included && Math.abs(m.existing.total) >= 0.005
    ? `<tr class="info"><td>Existing improvements (costs in place — informational, not in the total)</td><td class="num amt">${money2(m.existing.total)}</td><td class="num pc"></td></tr>`
    : '';

  // The cross-check. Tenant share IS the evaluation's grand total; if they
  // part ways, the reader is told on the page rather than left to find it.
  const mismatch = m.savedGrandTotal !== null && Math.abs(m.savedGrandTotal - m.tenantTotal) >= 1
    ? `<div class="mismatch">The evaluation's saved grand total is ${money2(m.savedGrandTotal)}; the lines on this page add up to ${money2(m.tenantTotal)} for the tenant. Open the evaluation and save it again to bring them back into line, or run the Budget Reconciliation report.</div>`
    : '';

  const allowance = m.isRom
    ? (() => {
        const cm = m.buckets.find((b) => b.key === 'cm')?.total || 0;
        const removed = m.rom?.cmRemovedBy
          ? `<tr class="info"><td colspan="3" style="color:#b45309;font-style:normal">CM fee line was removed by ${escapeHtml(m.rom.cmRemovedBy)}${m.rom.cmRemovedAt ? ` on ${escapeHtml(new Date(m.rom.cmRemovedAt).toLocaleDateString('en-US'))}` : ''} — confirm the lease language mirrors this.</td></tr>`
          : '';
        // The quoted allowance INCLUDES the CM fee: the tenant's real buying
        // power for improvements is the gross less CM (Adolfo).
        return `
  <table class="bbc allowance">
    <tr><th>Allowance Summary</th><th class="num amt">Amount</th><th class="num pc"></th></tr>
    <tr><td>Gross allowance (CM fee included)</td><td class="num amt">${money2(m.tenantTotal)}</td><td class="num pc"></td></tr>
    <tr><td>Less: CM fee</td><td class="num amt">(${money2(cm)})</td><td class="num pc"></td></tr>
    <tr class="grand"><td>Net available for tenant improvements</td><td class="num amt">${money2(m.tenantTotal - cm)}</td><td class="num pc"></td></tr>
    ${removed}
  </table>`;
      })()
    : '';

  const info: ReportInfoRow[] = rfpInfoRows(rfp, property);
  if (m.isRom && m.rom?.romNumber) {
    info.push({ label: 'Basis', value: `ROM Pilot ${m.rom.romNumber} — allowance` });
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Budget by Contract — ${escapeHtml(rfp?.rfpNumber ?? '')}</title>
<style>${REPORT_CSS}</style></head><body>
  ${reportHeaderHtml({
    eyebrow: m.isRom ? 'ROM Pilot Report' : 'Evaluation Report',
    title: 'Budget by Contract Counterparty',
    info,
  })}
  <table class="bbc">
    <thead><tr><th>Description</th><th class="num amt">Amount</th><th class="num pc">% of Total</th></tr></thead>
    <tbody>
    ${bucketRows}
    ${existingRows}
    ${outstandingRows}
    <tr class="grand"><td>${grandLabel}</td><td class="num amt">${money2(total)}</td><td class="num pc">100%</td></tr>
    ${existingInfo}
    </tbody>
  </table>
  ${mismatch}
  ${allowance}
  ${reportFooterHtml({ generatedBy: opts.generatedBy, generatedAt: opts.generatedAt })}
</body></html>`;
}
