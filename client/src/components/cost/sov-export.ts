/**
 * A contract's schedule of values to Excel (Adolfo, 2026-11-02): one row per line — base contract and
 * every change order — with billed to date, balance, retainage (withheld / released / held) and the
 * budget line(s) it's mapped to, split shown as each budget line's share in dollars too. No subtotals
 * inside the data (a Group column instead), one totals row beneath, so it filters and pivots.
 */
import * as XLSX from 'xlsx';
import { lineProgress, retainageLedger, type BaselineLine } from '@shared/cost-tracking';
import { notesSheet } from './excel-io';
import type { ContractRow, ChangeOrderRow, SovLineRow, ApplicationRow } from './types';

const MONEY = '#,##0.00;(#,##0.00)';

export function exportSovXlsx(x: { projectName: string; contract: ContractRow; changeOrders: ChangeOrderRow[]; lines: SovLineRow[]; applications: ApplicationRow[]; baseline: BaselineLine[] }) {
  const apps = x.applications.map((a) => ({ id: a.id, contractId: a.contractId, number: a.number, lines: a.lines, retainageAdj: a.retainageAdj ?? 0 }));
  const prog = lineProgress(apps as any);
  const led = retainageLedger(apps as any);
  const names = new Map(x.baseline.map((b) => [b.key, b.description]));
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const last = [...x.applications].sort((a, b) => a.number - b.number).pop();
  const rate = (Number(x.contract.retainagePct) || 0) / 100;
  const coOf = new Map(x.changeOrders.map((c) => [c.id, c]));
  const ordered = [
    ...x.lines.filter((l) => l.changeOrderId == null),
    ...x.changeOrders.flatMap((c) => x.lines.filter((l) => l.changeOrderId === c.id)),
  ];
  const mapping = (l: SovLineRow) => l.allocationMode === 'spread' ? 'Spread with the work'
    : l.allocationMode === 'direct' && l.allocations.length
      ? l.allocations.map((a) => `${names.get(a.baselineKey) ?? 'Removed line'}${l.allocations.length > 1 || a.pct !== 100 ? ` ${Number(a.pct).toFixed(2)}% (${r2((l.scheduledValue * a.pct) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })})` : ''}`).join(' · ')
      : 'Not mapped';
  const cols = ['Line ID', 'Group', 'Status', 'Item', 'Cost Code', 'Section', 'Description', 'Scheduled Value', 'Billed to Date', '% Complete', 'Balance to Finish',
    'Retainage Withheld', 'Retainage Released', 'Retainage Held', `Held vs ${(rate * 100).toFixed(0)}%`, 'Budget Line'] as const;
  const data = ordered.map((l) => {
    const co = l.changeOrderId != null ? coOf.get(l.changeOrderId) : null;
    const p = prog.get(l.id);
    const d = p?.toDate ?? 0;
    const m = led.lines.get(l.id) ?? { withheld: 0, released: 0, held: 0 };
    const held = p?.retainage ?? 0;
    const diff = r2(held - Math.floor(d * rate * 100 + 1e-6) / 100);
    return {
      'Line ID': l.id,
      'Group': co ? `${co.number}${co.title ? ` — ${co.title}` : ''}` : 'Base Contract',
      'Status': co ? co.status.charAt(0).toUpperCase() + co.status.slice(1) : 'Contract',
      'Item': l.itemNo ?? '', 'Cost Code': l.code ?? '', 'Section': l.section ?? '', 'Description': l.description,
      'Scheduled Value': l.scheduledValue, 'Billed to Date': d, '% Complete': l.scheduledValue ? d / l.scheduledValue : undefined,
      'Balance to Finish': r2(l.scheduledValue - d),
      'Retainage Withheld': m.withheld || undefined, 'Retainage Released': m.released || undefined, 'Retainage Held': held || undefined,
      [`Held vs ${(rate * 100).toFixed(0)}%`]: rate > 0 && Math.abs(diff) >= 0.05 ? diff : undefined,
      'Budget Line': mapping(l),
    };
  });

  const longD = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
  const head: any[][] = [
    ['Contract Schedule of Values'],
    ['Project', x.projectName],
    ['Contractor', x.contract.counterparty],
    ...(x.contract.contractNumber ? [['Contract #', x.contract.contractNumber]] : []),
    ['Retainage', rate],
    ['Billed Through', last ? `${last.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${String(last.docNumber).padStart(3, '0')}${last.periodEnd ? ` (Period To ${longD(last.periodEnd)})` : ''}` : 'No pay apps yet'],
    ...(Math.abs(led.adjustment) >= 0.005 ? [['Rounding Adjustment', led.adjustment]] : []),
    [],
  ];
  const ws = XLSX.utils.aoa_to_sheet(head);
  const start = head.length;
  XLSX.utils.sheet_add_json(ws, data, { origin: { r: start, c: 0 }, header: [...cols] });
  // Totals: the contract sum is approved change orders only; pending lines are listed, not added.
  const inSum = ordered.filter((l) => l.changeOrderId == null || coOf.get(l.changeOrderId)?.status === 'approved');
  const S = (f: (l: SovLineRow) => number) => r2(inSum.reduce((t, l) => t + f(l), 0));
  const sv = S((l) => l.scheduledValue), bd = S((l) => prog.get(l.id)?.toDate ?? 0);
  XLSX.utils.sheet_add_aoa(ws, [['', 'Contract Total (approved)', '', '', '', '', '', sv, bd, sv ? bd / sv : 0, r2(sv - bd),
    S((l) => led.lines.get(l.id)?.withheld ?? 0), S((l) => led.lines.get(l.id)?.released ?? 0), S((l) => prog.get(l.id)?.retainage ?? 0), '', '']], { origin: { r: start + data.length + 1, c: 0 } });
  for (let i = 1; i <= data.length + 1; i++) {
    for (const c of [7, 8, 10, 11, 12, 13, 14]) { const a = XLSX.utils.encode_cell({ r: start + i, c }); if (ws[a]?.t === 'n') ws[a].z = MONEY; }
    const a = XLSX.utils.encode_cell({ r: start + i, c: 9 }); if (ws[a]?.t === 'n') ws[a].z = '0.00%';
  }
  const ra = XLSX.utils.encode_cell({ r: 4, c: 1 }); if (ws[ra]) ws[ra].z = '0.00%';
  const adjRow = head.findIndex((r) => r[0] === 'Rounding Adjustment'); if (adjRow >= 0) { const a = XLSX.utils.encode_cell({ r: adjRow, c: 1 }); if (ws[a]) ws[a].z = MONEY; }
  ws['!cols'] = [{ wch: 9 }, { wch: 34 }, { wch: 10 }, { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 36 }, ...Array(8).fill({ wch: 15 }), { wch: 60 }];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: start, c: 0 }, e: { r: start + data.length, c: cols.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Schedule of Values');
  XLSX.utils.book_append_sheet(wb, notesSheet([
    'This file is also the import template for this contract (Import on the contract).',
    'Edit a line: its Item, Cost Code, Section, Description, Scheduled Value or Budget Line. Keep the Line ID as is.',
    'Add a line: a new row with the Line ID blank and the Group set to "Base Contract" or the change order (e.g. "PCCO #004"). Add a new change order in the app first.',
    'Budget Line: a budget line\'s name; "Spread with the work"; "Not mapped"; or a split like "New Office Area 70% · Office Expansion 30%".',
    'Billed, retainage and the other columns are for reference — the import ignores them.',
    'Lines deleted from the sheet are kept — delete them in the app. Import shows every change before saving.',
  ]), 'How To');
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  XLSX.writeFile(wb, `KURV_SOV_${slug(x.contract.counterparty)}_${new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })}.xlsx`);
}
