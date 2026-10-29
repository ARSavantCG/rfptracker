/**
 * Job Cost Ledger to Excel (Adolfo, 2026-10-29): one row per entry, nothing merged, no
 * subtotals inside the data, one totals row beneath, so the range stays pivotable. The
 * report header above it. Dates are dates and amounts are numbers (formatted, not strings).
 */
import * as XLSX from 'xlsx';
import { apiRequest } from '@/lib/queryClient';

type Row = { n: number; date: string; paidTo: string; description: string; ref: string; how: string; budgetLine: string; whoPays: string; amount: number; tenant: number | null; landlord: number | null; reconciled: string };

const COLS = ['#', 'Date Paid', 'Paid To', 'Description', 'Invoice / Ref', 'How Paid', 'Budget Line', 'Who Pays', 'Amount', 'Tenant Share', 'Landlord Share', 'Reconciled'] as const;
const MONEY = '#,##0.00;(#,##0.00)';

export async function exportLedgerXlsx(projectId: number, query: URLSearchParams) {
  const q = new URLSearchParams(query); q.set('format', 'json');
  const d: any = await apiRequest(`/api/reports/job-cost-ledger/${projectId}?${q}`, 'GET');
  const rows: Row[] = d.rows ?? [];
  const toDate = (iso: string) => { const [y, m, dd] = iso.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, dd); };
  const longD = (iso: string) => toDate(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Header block: report name, the shared report header, then the period and counts.
  const dates = rows.map((r) => r.date).sort();
  const head: any[][] = [['Job Cost Ledger'], ...((d.header ?? []) as Array<{ label: string; value: string }>).map((h) => [h.label, h.value])];
  if (dates.length) head.push(['Period Covered', `${longD(dates[0])} through ${longD(dates[dates.length - 1])}`]);
  if (d.payee) head.push(['Paid To', d.payee]);
  head.push(['Entries in Report', rows.length]);
  head.push(['Posted', d.total]);
  head.push(['Unreconciled', `${d.unreconciledCount} ${d.unreconciledCount === 1 ? 'entry' : 'entries'}`, d.unreconciled]);
  head.push(['Report Printed', longD(d.printed)]);
  head.push([]);
  const ws = XLSX.utils.aoa_to_sheet(head);
  const start = head.length; // 0-based row of the column headers

  const data = rows.map((r) => ({
    '#': r.n, 'Date Paid': toDate(r.date), 'Paid To': r.paidTo, 'Description': r.description, 'Invoice / Ref': r.ref,
    'How Paid': r.how, 'Budget Line': r.budgetLine, 'Who Pays': r.whoPays, 'Amount': r.amount,
    'Tenant Share': r.tenant ?? undefined, 'Landlord Share': r.landlord ?? undefined, 'Reconciled': r.reconciled,
  }));
  XLSX.utils.sheet_add_json(ws, data, { origin: { r: start, c: 0 }, header: [...COLS], cellDates: true, dateNF: 'mm/dd/yyyy' } as any);
  const sum = (k: 'amount' | 'tenant' | 'landlord') => Math.round(rows.reduce((t, r) => t + (Number(r[k]) || 0), 0) * 100) / 100;
  XLSX.utils.sheet_add_aoa(ws, [['', '', '', '', '', '', '', 'Total', sum('amount'), sum('tenant'), sum('landlord'), '']], { origin: { r: start + rows.length + 1, c: 0 } });

  // Formats: dates as dates, money as numbers with commas and cents.
  const fmt = (r: number, c: number, z: string) => { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a] && ws[a].t !== 's') ws[a].z = z; };
  for (let i = 1; i <= rows.length + 1; i++) {
    fmt(start + i, 1, 'mm/dd/yyyy');
    for (const c of [8, 9, 10]) fmt(start + i, c, MONEY);
  }
  for (let i = 0; i < head.length; i++) for (const c of [1, 2]) { const a = XLSX.utils.encode_cell({ r: i, c }); if (ws[a]?.t === 'n' && i > 0 && head[i][0] !== 'Entries in Report') ws[a].z = MONEY; }
  ws['!cols'] = [{ wch: 5 }, { wch: 11 }, { wch: 30 }, { wch: 36 }, { wch: 16 }, { wch: 16 }, { wch: 26 }, { wch: 13 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 11 }];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: start, c: 0 }, e: { r: start + rows.length, c: COLS.length - 1 } }) };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Job Cost Ledger');
  const slug = String(d.shortName || 'Project').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  XLSX.writeFile(wb, `KURV_Job_Cost_Ledger_${slug}_${d.printed}.xlsx`);
  return rows.length;
}
