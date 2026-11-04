/**
 * Billing by line, pay app by pay app (Adolfo, 2026-11-04): one row per contract line, one column per pay
 * app (what was billed on it that period: work + change in stored), then billed to date against the
 * scheduled value — overbilled lines and negative periods flagged. A second sheet does the same for
 * retainage held, with 10% of billed beside it and the difference, to find where retainage doesn't tie.
 */
import * as XLSX from 'xlsx';
import type { ContractRow, ChangeOrderRow, SovLineRow, ApplicationRow } from './types';

const MONEY = '#,##0.00;[Red](#,##0.00)';
const r2 = (v: number) => Math.round(v * 100) / 100;

export function exportBillingHistoryXlsx(x: { projectName: string; contract: ContractRow; changeOrders: ChangeOrderRow[]; lines: SovLineRow[]; applications: ApplicationRow[] }) {
  const apps = [...x.applications].sort((a, b) => a.number - b.number);
  const rate = (Number(x.contract.retainagePct) || 0) / 100;
  const coOf = new Map(x.changeOrders.map((c) => [c.id, c]));
  const ordered = [...x.lines.filter((l) => l.changeOrderId == null), ...x.changeOrders.flatMap((c) => x.lines.filter((l) => l.changeOrderId === c.id))];
  const label = (a: ApplicationRow) => `${a.kind === 'invoice' ? 'Inv' : 'App'} ${String(a.docNumber).padStart(3, '0')}`;
  const group = (l: SovLineRow) => { const c = l.changeOrderId != null ? coOf.get(l.changeOrderId) : null; return c ? c.number : 'Base Contract'; };

  // Per line, per pay app: billed this period, and retainage held to date.
  const billed = new Map<number, number[]>(), held = new Map<number, number[]>();
  const prevStored = new Map<number, number>();
  apps.forEach((a, i) => {
    const by = new Map<number, { w: number; s: number; r: number }>();
    for (const ln of a.lines) { const c = by.get(ln.sovLineId) ?? { w: 0, s: 0, r: 0 }; c.w += Number(ln.workThisPeriod) || 0; c.s += Number(ln.storedToDate) || 0; c.r += Number(ln.retainageToDate) || 0; by.set(ln.sovLineId, c); }
    for (const l of ordered) {
      const c = by.get(l.id);
      const b = billed.get(l.id) ?? Array(apps.length).fill(0); const h = held.get(l.id) ?? Array(apps.length).fill(0);
      const stored = c ? c.s : (prevStored.get(l.id) ?? 0);
      b[i] = r2((c?.w ?? 0) + stored - (prevStored.get(l.id) ?? 0));
      h[i] = c ? r2(c.r) : (i ? h[i - 1] : 0);
      prevStored.set(l.id, stored);
      billed.set(l.id, b); held.set(l.id, h);
    }
  });

  const head = (title: string) => [[title], ['Project', x.projectName], ['Contractor', x.contract.counterparty], ['Retainage', `${(rate * 100).toFixed(2)}%`], []];
  const fmt = (ws: XLSX.WorkSheet, r0: number, rows: number, c0: number, c1: number) => {
    for (let r = r0; r < r0 + rows; r++) for (let c = c0; c <= c1; c++) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]?.t === 'n') ws[a].z = MONEY; }
  };

  // Sheet 1: billed per pay app.
  const h1 = head('Billing by Line — Pay App by Pay App');
  const cols1 = ['Group', 'Item', 'Description', 'Scheduled Value', ...apps.map(label), 'Billed to Date', '% Billed', 'Over (Under) Scheduled', 'Check'];
  const rows1 = ordered.map((l) => {
    const b = billed.get(l.id) ?? [];
    const td = r2(b.reduce((t, v) => t + v, 0));
    const over = r2(td - l.scheduledValue);
    const flags = [l.scheduledValue >= 0 ? (over > 0.005 ? 'OVERBILLED' : '') : (over < -0.005 ? 'Credit over-applied' : ''), b.some((v, i) => v < -0.005 && l.scheduledValue > 0) ? 'Negative period' : ''].filter(Boolean).join(' · ');
    return [group(l), l.itemNo ?? '', l.description, l.scheduledValue, ...b, td, l.scheduledValue ? td / l.scheduledValue : null, over, flags];
  });
  const tot = (col: number) => r2(rows1.reduce((t, r) => t + (Number(r[col]) || 0), 0));
  const n = cols1.length;
  const totals1 = ['Total', '', '', tot(3), ...apps.map((_, i) => tot(4 + i)), tot(4 + apps.length), null, tot(6 + apps.length), ''];
  const ws1 = XLSX.utils.aoa_to_sheet([...h1, cols1, ...rows1, [], totals1]);
  fmt(ws1, h1.length + 1, rows1.length + 2, 3, 4 + apps.length);
  fmt(ws1, h1.length + 1, rows1.length + 2, 6 + apps.length, 6 + apps.length);
  for (let r = h1.length + 1; r <= h1.length + rows1.length; r++) { const a = XLSX.utils.encode_cell({ r, c: 5 + apps.length }); if (ws1[a]?.t === 'n') ws1[a].z = '0.00%'; }
  ws1['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 38 }, { wch: 15 }, ...apps.map(() => ({ wch: 14 })), { wch: 15 }, { wch: 9 }, { wch: 15 }, { wch: 22 }];
  ws1['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: h1.length, c: 0 }, e: { r: h1.length + rows1.length, c: n - 1 } }) };
  ws1['!freeze'] = { xSplit: 3, ySplit: h1.length + 1 } as any;

  // Sheet 2: retainage held to date, per pay app, against the rate.
  const h2 = head('Retainage by Line — Held to Date at Each Pay App');
  const cols2 = ['Group', 'Item', 'Description', ...apps.map(label), `${(rate * 100).toFixed(0)}% of Billed to Date`, 'Held vs Rate', 'Check'];
  const rows2 = ordered.map((l) => {
    const h = held.get(l.id) ?? [];
    const td = (billed.get(l.id) ?? []).reduce((t, v) => t + v, 0);
    const exp = Math.floor(td * rate * 100 + 1e-6) / 100;
    const last = h.length ? h[h.length - 1] : 0;
    const diff = r2(last - exp);
    return [group(l), l.itemNo ?? '', l.description, ...h, exp, diff, Math.abs(diff) >= 0.05 ? (diff < 0 ? 'Less held than the rate' : 'More held than the rate') : ''];
  });
  const tot2 = (col: number) => r2(rows2.reduce((t, r) => t + (Number(r[col]) || 0), 0));
  const totals2 = ['Total', '', '', ...apps.map((_, i) => tot2(3 + i)), tot2(3 + apps.length), tot2(4 + apps.length), ''];
  const ws2 = XLSX.utils.aoa_to_sheet([...h2, cols2, ...rows2, [], totals2]);
  fmt(ws2, h2.length + 1, rows2.length + 2, 3, 4 + apps.length);
  ws2['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 38 }, ...apps.map(() => ({ wch: 14 })), { wch: 16 }, { wch: 14 }, { wch: 22 }];
  ws2['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: h2.length, c: 0 }, e: { r: h2.length + rows2.length, c: cols2.length - 1 } }) };
  ws2['!freeze'] = { xSplit: 3, ySplit: h2.length + 1 } as any;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'Billed by Pay App');
  XLSX.utils.book_append_sheet(wb, ws2, 'Retainage by Pay App');
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  XLSX.writeFile(wb, `KURV_Billing_by_Line_${slug(x.contract.counterparty)}_${new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })}.xlsx`);
}
