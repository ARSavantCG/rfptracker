/**
 * Click a number on Budget vs Actual to see what's in it (Adolfo, 2026-11-02): for one budget line,
 * the contract lines, change order lines and ledger charges behind its committed, pending or work
 * complete — each with the share that lands on this line — or, for the budget, the original and every
 * revision, transfer, addition and tenant change order that moved it. Adds up to the number clicked.
 */
import { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { lineProgress, lineShares, lineStatus, UNALLOCATED_KEY, type SovLine, type ChangeOrder } from '@shared/cost-tracking';
import { coTotals } from '@shared/cost-budget-approval';
import { money, signedMoney, type ProjectBundle } from './types';

export type DrillMetric = 'budget' | 'committed' | 'pending' | 'toDate';
const TITLE: Record<DrillMetric, string> = { budget: 'Revised Budget', committed: 'Committed', pending: 'Pending Change Orders', toDate: 'Work Complete' };
type Item = { group: string; who: string; what: string; base: number | null; share: number | null; amount: number };

export function DrillDialog({ b, rowKey, metric, onClose }: { b: ProjectBundle; rowKey: string | null; metric: DrillMetric; onClose: () => void }) {
  const row = b.summary.rows.find((r) => r.key === rowKey) as any;
  const items = useMemo<Item[]>(() => {
    if (!rowKey || !row) return [];
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const out: Item[] = [];
    if (metric === 'budget') {
      if (Math.abs(row.original ?? 0) >= 0.005) out.push({ group: 'Original', who: 'Approved budget', what: row.description, base: null, share: null, amount: row.original });
      if (Math.abs(row.revisions ?? 0) >= 0.005) out.push({ group: 'Revisions', who: 'Budget edits', what: 'Edited after confirmation', base: null, share: null, amount: row.revisions });
      for (const t of (b.approval as any).transfers ?? []) {
        const other = (k: string) => b.summary.rows.find((r) => r.key === k)?.description ?? 'another line';
        if (t.toKey === rowKey) out.push({ group: 'Transfers', who: `From ${other(t.fromKey)}`, what: [t.date, t.note].filter(Boolean).join(' · '), base: null, share: null, amount: Number(t.amount) || 0 });
        if (t.fromKey === rowKey) out.push({ group: 'Transfers', who: `To ${other(t.toKey)}`, what: [t.date, t.note].filter(Boolean).join(' · '), base: null, share: null, amount: -(Number(t.amount) || 0) });
      }
      for (const x of (b.approval as any).additions ?? []) {
        if (x.key === rowKey) out.push({ group: 'Additional Funding', who: x.label, what: [x.date, x.note].filter(Boolean).join(' · '), base: null, share: null, amount: Number(x.amount) || 0 });
      }
      for (const c of b.approval.changeOrders.filter((c) => c.status === 'approved')) {
        for (const l of c.lines) if (l.key === rowKey) out.push({ group: 'Tenant Change Orders', who: c.number, what: l.description || c.title, base: null, share: null, amount: l.amount });
        for (const m of coTotals(c).markupLines) if (m.key === rowKey && Math.abs(m.amount) >= 0.005) out.push({ group: 'Tenant Change Orders', who: c.number, what: `Markup: ${m.label}`, base: null, share: null, amount: m.amount });
      }
      const placed = r2(out.reduce((t, i) => t + i.amount, 0));
      const rest = r2((row.budget ?? 0) - placed);
      if (Math.abs(rest) >= 0.005) out.push({ group: 'Other', who: 'Deal discount, fees and other adjustments', what: '', base: null, share: null, amount: rest });
      return out;
    }
    const valid = new Set(b.summary.rows.map((r) => r.key).filter((k) => k !== UNALLOCATED_KEY));
    const cos = new Map<number, ChangeOrder>(b.changeOrders.map((c) => [c.id, { id: c.id, contractId: c.contractId, status: c.status } as any]));
    const all = b.sovLines as unknown as SovLine[];
    const live = all.filter((l) => lineStatus(l, cos) !== 'void');
    const prog = lineProgress(b.applications.map((a) => ({ id: a.id, contractId: a.contractId, number: a.number, lines: a.lines })) as any);
    const co = new Map(b.changeOrders.map((c) => [c.id, c]));
    const who = (id: number) => b.contracts.find((c) => c.id === id)?.counterparty ?? 'Contract';
    for (const l of live) {
      const st = lineStatus(l, cos);
      if (metric === 'committed' && st !== 'approved') continue;
      if (metric === 'pending' && st !== 'pending') continue;
      const base = metric === 'toDate' ? (prog.get(l.id)?.toDate ?? 0) : l.scheduledValue;
      if (Math.abs(base) < 0.005) continue;
      const share = lineShares(l, live, valid).get(rowKey) ?? 0;
      if (share < 1e-9) continue;
      const c = l.changeOrderId != null ? co.get(l.changeOrderId) : null;
      const full = b.sovLines.find((x) => x.id === l.id)!;
      out.push({ group: who(l.contractId), who: c ? `${c.number}${c.title ? ` — ${c.title}` : ''}` : 'Base Contract',
        what: `${full.itemNo ? `${full.itemNo} · ` : ''}${full.description}${full.allocationMode === 'spread' ? ' (spread)' : ''}`, base, share, amount: r2(base * share) });
    }
    if (metric !== 'pending') {
      for (const d of b.directCosts) {
        const k = d.key && valid.has(d.key) ? d.key : UNALLOCATED_KEY;
        if (k !== rowKey || Math.abs(d.amount) < 0.005) continue;
        out.push({ group: 'Ledger', who: d.vendor, what: `${d.date}${d.invoiceNumber ? ` · Inv ${d.invoiceNumber}` : ''}${d.description ? ` · ${d.description}` : ''}`, base: null, share: null, amount: d.amount });
      }
    }
    return out;
  }, [b, rowKey, metric, row]);

  const total = Math.round(items.reduce((t, i) => t + i.amount, 0) * 100) / 100;
  const shown = row ? (metric === 'budget' ? row.budget : metric === 'committed' ? row.committed : metric === 'pending' ? row.pending : row.toDate) : 0;
  const groups = Array.from(new Set(items.map((i) => i.group)));
  return (
    <Dialog open={!!rowKey} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="pm-scope w-[96vw] sm:max-w-4xl max-h-[88vh] overflow-y-auto grid-cols-[minmax(0,1fr)]">
        <DialogHeader><DialogTitle>{row?.description} — {TITLE[metric]}: {money(shown)}</DialogTitle></DialogHeader>
        {items.length === 0 ? <p className="text-sm text-gray-600">Nothing on this line.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b">
              <th className="text-left px-2 py-1.5">{metric === 'budget' ? 'Source' : 'Contract / Change Order'}</th><th className="text-left px-2 py-1.5">Line</th>
              {metric !== 'budget' && <><th className="text-right px-2 py-1.5">{metric === 'toDate' ? 'Line Billed' : 'Line Amount'}</th><th className="text-right px-2 py-1.5">Share Here</th></>}
              <th className="text-right px-2 py-1.5">On This Line</th>
            </tr></thead>
            <tbody>
              {groups.map((g) => {
                const gi = items.filter((i) => i.group === g);
                return [
                  <tr key={`h-${g}`} className="bg-gray-50 border-y"><td colSpan={metric === 'budget' ? 2 : 4} className="px-2 py-1 font-semibold text-gray-800">{g}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-semibold">{signedMoney(Math.round(gi.reduce((t, i) => t + i.amount, 0) * 100) / 100)}</td></tr>,
                  ...gi.map((i, n) => (
                    <tr key={`${g}-${n}`} className="border-b last:border-0">
                      <td className="px-2 py-1 text-gray-700">{i.who}</td><td className="px-2 py-1">{i.what}</td>
                      {metric !== 'budget' && <><td className="px-2 py-1 text-right tabular-nums text-gray-600">{i.base == null ? '' : money(i.base)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-gray-600">{i.share == null ? '' : `${(i.share * 100).toFixed(2)}%`}</td></>}
                      <td className="px-2 py-1 text-right tabular-nums">{signedMoney(i.amount)}</td>
                    </tr>
                  )),
                ];
              })}
              <tr className="border-t-2 border-gray-800 font-semibold"><td colSpan={metric === 'budget' ? 2 : 4} className="px-2 py-1.5">Total</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{signedMoney(total)}</td></tr>
            </tbody>
          </table>
        )}
        {Math.abs(total - shown) >= 0.02 && items.length > 0 && <p className="text-xs text-amber-800">Rounding: the line shows {money(shown)}; the pieces add to {money(total)}.</p>}
      </DialogContent>
    </Dialog>
  );
}
