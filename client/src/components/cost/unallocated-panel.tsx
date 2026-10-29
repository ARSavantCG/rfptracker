/**
 * Committed but not on a budget line (Adolfo, 2026-10-29): every contract line whose money
 * lands in Unallocated — not mapped, mapped to a budget line since removed, only partly
 * mapped, or "spread" in a group with nothing mapped to follow — and every ledger charge with
 * no budget line. Each with its amount and why, mapped right here one at a time or in bulk.
 * Adds up to the Unallocated committed on the reports.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { lineShares, UNALLOCATED_KEY, type SovLine } from '@shared/cost-tracking';
import { money, projectKey, type ProjectBundle } from './types';

type Row = { id: number; contract: string; group: string; item: string; description: string; amount: number; why: string };

export function UnallocatedPanel({ bundle: b, projectId, onGoLedger }: { bundle: ProjectBundle; projectId: number; onGoLedger?: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const baseline = b.project.baseline ?? [];
  const nameOf = new Map(baseline.map((x) => [x.key, x.description]));

  const { rows, charges } = useMemo(() => {
    const valid = new Set(b.summary.rows.map((r) => r.key).filter((k) => k !== UNALLOCATED_KEY));
    const cos = new Map(b.changeOrders.map((c) => [c.id, c]));
    const lines = b.sovLines as unknown as SovLine[];
    const out: Row[] = [];
    for (const l of b.sovLines) {
      const co = l.changeOrderId != null ? cos.get(l.changeOrderId) : null;
      if (co && co.status !== 'approved') continue; // pending/void aren't committed
      const share = lineShares(l as unknown as SovLine, lines.filter((x) => x.contractId === l.contractId), valid).get(UNALLOCATED_KEY) ?? 0;
      const amount = Math.round(l.scheduledValue * share * 100) / 100;
      if (Math.abs(amount) < 0.005) continue;
      const al = l.allocations ?? [];
      const why = l.allocationMode === 'unallocated' || (l.allocationMode === 'direct' && al.length === 0) ? 'Not mapped'
        : l.allocationMode === 'spread' ? 'Spread, but nothing in its group is mapped'
        : al.every((a) => !valid.has(a.baselineKey)) ? `Mapped to a removed line${al[0] && nameOf.get(al[0].baselineKey) ? '' : ''}`
        : `Partly mapped (${Math.round((1 - share) * 100)}% placed)`;
      out.push({
        id: l.id, contract: b.contracts.find((c) => c.id === l.contractId)?.counterparty ?? 'Contract',
        group: co ? `${co.number}${co.title ? ` — ${co.title}` : ''}` : 'Base Contract', item: l.itemNo ?? '', description: l.description, amount, why,
      });
    }
    out.sort((x, y) => x.contract.localeCompare(y.contract) || x.group.localeCompare(y.group) || Math.abs(y.amount) - Math.abs(x.amount));
    const charges = b.directCosts.filter((d) => !d.key || !valid.has(d.key));
    return { rows: out, charges };
  }, [b.sovLines, b.changeOrders, b.contracts, b.summary.rows, b.directCosts]);

  const totalLines = Math.round(rows.reduce((t, r) => t + r.amount, 0) * 100) / 100;
  const totalCharges = Math.round(charges.reduce((t, d) => t + d.amount, 0) * 100) / 100;
  if (!rows.length && !charges.length) return null;

  const mapTo = async (ids: number[], key: string) => {
    setBusy(true);
    try {
      for (const id of ids) {
        await apiRequest(`/api/cost-sov-lines/${id}`, 'PATCH', key === '__spread__'
          ? { allocationMode: 'spread', allocations: [] }
          : { allocationMode: 'direct', allocations: [{ baselineKey: key, pct: 100 }] });
      }
      await qc.invalidateQueries({ queryKey: [projectKey(projectId)] });
      setPicked(new Set());
      toast({ title: `${ids.length} line${ids.length === 1 ? '' : 's'} mapped`, description: key === '__spread__' ? 'Spread with the work' : nameOf.get(key) });
    } catch (e: any) { toast({ title: 'Not All Mapped', description: e?.message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const picker = (onPick: (k: string) => void, placeholder: string) => (
    <Select value="" disabled={busy} onValueChange={(v) => v && onPick(v)}>
      <SelectTrigger className="h-8 text-xs w-56"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent className="pm-scope">
        {baseline.map((x) => <SelectItem key={x.key} value={x.key}>{x.description}</SelectItem>)}
        <SelectItem value="__spread__">Spread with the Work</SelectItem>
      </SelectContent>
    </Select>
  );
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));

  return (
    <div className="border border-amber-300 bg-amber-50/60 rounded-lg">
      <button className="w-full flex items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="h-4 w-4 text-amber-800" /> : <ChevronRight className="h-4 w-4 text-amber-800" />}
        <AlertTriangle className="h-4 w-4 text-amber-700" />
        <span className="font-semibold text-amber-900">Not on a Budget Line: {money(totalLines + totalCharges)}</span>
        <span className="text-sm text-amber-900">· {rows.length} contract line{rows.length === 1 ? '' : 's'} ({money(totalLines)}){charges.length ? ` · ${charges.length} ledger charge${charges.length === 1 ? '' : 's'} (${money(totalCharges)})` : ''}</span>
        <span className="ml-auto text-xs text-amber-800">{open ? 'Hide' : 'Show and map them'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {rows.length > 0 && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-700">{picked.size ? `${picked.size} selected (${money(rows.filter((r) => picked.has(r.id)).reduce((t, r) => t + r.amount, 0))})` : 'Tick lines to map several at once'}</span>
                {picked.size > 0 && picker((k) => mapTo(Array.from(picked), k), 'Map selected to…')}
              </div>
              <div className="bg-white border rounded-md overflow-x-auto">
                <table className="w-full text-sm min-w-[860px]">
                  <thead><tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b">
                    <th className="px-2 py-1.5 w-8"><input type="checkbox" className="h-4 w-4" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                    <th className="px-2 py-1.5 text-left">Contract</th><th className="px-2 py-1.5 text-left">Base / Change Order</th>
                    <th className="px-2 py-1.5 text-left">Line</th><th className="px-2 py-1.5 text-right">Not on a Line</th>
                    <th className="px-2 py-1.5 text-left">Why</th><th className="px-2 py-1.5 text-left">Map To</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="px-2 py-1"><input type="checkbox" className="h-4 w-4" checked={picked.has(r.id)} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                        <td className="px-2 py-1">{r.contract}</td>
                        <td className="px-2 py-1 text-gray-700">{r.group}</td>
                        <td className="px-2 py-1">{r.item ? <span className="text-xs text-gray-500 mr-1">{r.item}</span> : null}{r.description}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-medium">{money(r.amount)}</td>
                        <td className="px-2 py-1 text-xs text-amber-800">{r.why}</td>
                        <td className="px-2 py-1">{picker((k) => mapTo([r.id], k), 'Pick a budget line…')}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 font-semibold"><td /><td className="px-2 py-1.5" colSpan={3}>Contract lines</td><td className="px-2 py-1.5 text-right tabular-nums">{money(totalLines)}</td><td colSpan={2} /></tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
          {charges.length > 0 && (
            <div className="text-sm text-amber-900">
              Ledger charges with no budget line: {charges.map((d) => `${d.vendor} ${money(d.amount)}`).join(' · ')}.{' '}
              {onGoLedger && <button className="underline font-medium" onClick={onGoLedger}>Set them on the Ledger tab</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
