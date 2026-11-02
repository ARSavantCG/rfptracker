/**
 * Budget vs Actual to Excel (Adolfo, 2026-11-02): the same rows as the report, one per budget line,
 * numbers as numbers (formatted), a totals row beneath, the report header on top; a second sheet
 * with the sources of funds. Built from what's on screen, so it matches the app to the cent.
 */
import * as XLSX from 'xlsx';
import { UNALLOCATED_KEY } from '@shared/cost-tracking';
import { DEAL_DISCOUNT_KEY } from '@shared/cost-budget-approval';
import { BUCKET_LABEL, type ProjectBundle } from './types';

const MONEY = '#,##0.00;(#,##0.00)';
const PCT = '0.00%';

export function exportBvaXlsx(b: ProjectBundle) {
  const p: any = b.project;
  const h = (p.settings?.reportHeader ?? {}) as Record<string, string>;
  const t = (v: unknown) => String(v ?? '').trim();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const longD = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
  const head: any[][] = [
    ['Budget vs Actual'],
    ['Project', t(h.projectName) || t(p.name)],
    ['Project No.', t(h.projectNo) || t(p.projectNumber)],
    ...(t(h.address) ? [['Address', t(h.address)]] : []),
    ...(t(h.owner) ? [['Owner', t(h.owner)]] : []),
    ['Budget', b.approval.status === 'confirmed' ? 'Confirmed' : 'Draft — not yet confirmed'],
    ['As Of', longD(today)],
    [],
  ];

  // Same columns as the report.
  const rows = (b.summary.rows as any[]).filter((r) => r.key !== UNALLOCATED_KEY || Math.abs(r.committed) + Math.abs(r.pending || 0) + Math.abs(r.toDate) >= 0.005);
  const cols = ['Budget Line', 'Category', 'Tenant Share', 'Original', 'Revisions', 'Transfers', 'Additional Funding', 'Approved COs', 'Revised Budget',
    'Committed', 'Pending COs', 'Work Complete', 'Retainage Held', '% Spent', 'Variance'] as const;
  const data = rows.map((r) => {
    const un = r.key === UNALLOCATED_KEY;
    return {
      'Budget Line': r.description,
      'Category': un ? '' : r.key === DEAL_DISCOUNT_KEY ? 'Deal Discount' : (BUCKET_LABEL[r.bucket] || r.bucket || ''),
      'Tenant Share': un ? undefined : (Number(r.tenantSharePct) || 0) / 100,
      'Original': un ? undefined : r.original ?? 0,
      'Revisions': r.revisions || undefined,
      'Transfers': r.transfers || undefined,
      'Additional Funding': r.additions || undefined,
      'Approved COs': r.changeOrders || undefined,
      'Revised Budget': un ? undefined : r.budget,
      'Committed': r.committed,
      'Pending COs': r.pending || undefined,
      'Work Complete': r.toDate,
      'Retainage Held': r.retainageHeld || undefined,
      '% Spent': r.committed ? r.toDate / r.committed : undefined,
      'Variance': un ? undefined : r.variance,
    };
  });
  const ws = XLSX.utils.aoa_to_sheet(head);
  const start = head.length;
  XLSX.utils.sheet_add_json(ws, data, { origin: { r: start, c: 0 }, header: [...cols] });
  const sum = (k: string) => Math.round(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0) * 100) / 100;
  const T = b.summary.totals as any;
  XLSX.utils.sheet_add_aoa(ws, [['Total', '', '', sum('original'), sum('revisions'), sum('transfers'), sum('additions'), sum('changeOrders'), T.budget,
    T.committed, T.pending, T.toDate, T.retainageHeld, T.committed ? T.toDate / T.committed : 0, T.variance]], { origin: { r: start + rows.length + 1, c: 0 } });
  for (let i = 1; i <= rows.length + 1; i++) {
    for (let c = 3; c <= 14; c++) {
      const a = XLSX.utils.encode_cell({ r: start + i, c });
      if (ws[a] && ws[a].t === 'n') ws[a].z = c === 13 ? PCT : MONEY;
    }
    const a2 = XLSX.utils.encode_cell({ r: start + i, c: 2 });
    if (ws[a2] && ws[a2].t === 'n') ws[a2].z = PCT;
  }
  ws['!cols'] = [{ wch: 44 }, { wch: 14 }, { wch: 10 }, ...Array(12).fill({ wch: 15 })];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: start, c: 0 }, e: { r: start + rows.length, c: cols.length - 1 } }) };

  // Sources of funds, as on the report.
  const f: any = b.funding;
  const src: any[][] = [['Sources of Funds', 'Amount'],
    [f.confirmed ? 'Approved budget (capital partner)' : 'Budget (draft)', f.original],
    ...(Math.abs(f.revisions) >= 0.005 ? [['Budget revisions', f.revisions]] : []),
    ...((f.additionList ?? []) as any[]).map((x) => [x.label, x.amount]),
    ['Tenant-funded change orders', f.tenantCos ?? f.tenant],
    [f.label || 'Supplemental Funding', f.supplemental],
    ['Total funding', f.totalFunding],
    ...(f.cmReserved > 0.005 ? [['Less: CM fees — set aside', -f.cmReserved], ['Available for project costs', f.availableForCost ?? f.totalFunding - f.cmReserved]] : []),
    ['Projected cost to complete', f.projectCost],
    [f.surplus > 0.005 ? 'Projected surplus' : 'Projected shortfall', f.surplus > 0.005 ? f.surplus : f.supplemental],
    ...((f.tenantCm ?? 0) > 0.005 ? [[], ["The tenant's cost of change orders (not project funding)"], ['Change orders as approved', f.tenantCos], ['Our CM fee on them', f.tenantCm], ['Tenant pays in all', f.tenant]] : []),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(src);
  for (let i = 1; i < src.length; i++) { const a = XLSX.utils.encode_cell({ r: i, c: 1 }); if (ws2[a]?.t === 'n') ws2[a].z = MONEY; }
  ws2['!cols'] = [{ wch: 48 }, { wch: 18 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Budget vs Actual');
  XLSX.utils.book_append_sheet(wb, ws2, 'Sources of Funds');
  const slug = (t(h.shortName) || t(p.name) || 'Project').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  XLSX.writeFile(wb, `KURV_Budget_vs_Actual_${slug}_${today}.xlsx`);
}
