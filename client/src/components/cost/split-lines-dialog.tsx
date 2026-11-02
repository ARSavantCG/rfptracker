/**
 * Apply one split to many contract lines at once (Adolfo, 2026-11-02): e.g. demolition, drywall,
 * HVAC… 20% Office Expansion / 80% New Office Area. Pick the budget lines and their percentages
 * (must total 100%), tick the contract lines, Apply. Lines on one budget line, or spread, are
 * replaced with the split.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Trash2 } from 'lucide-react';
import type { BaselineLine } from '@shared/cost-tracking';
import { money, projectKey, type SovLineRow } from './types';
import { BudgetLineItem } from './co-funds';

export function SplitLinesDialog({ open, onClose, label, lines, baseline, projectId, after }: {
  open: boolean; onClose: () => void; label: string; lines: SovLineRow[]; baseline: BaselineLine[]; projectId: number;
  /** Run once the lines are saved (e.g. re-price a linked tenant change order). */
  after?: () => Promise<unknown>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const names = useMemo(() => new Map(baseline.map((b) => [b.key, b.description])), [baseline]);
  const [rows, setRows] = useState<Array<{ key: string; pct: string }>>([{ key: '', pct: '' }, { key: '', pct: '' }]);
  // Ticked to start: lines spread or not mapped — the ones a split is usually for.
  const [picked, setPicked] = useState<Set<number>>(() => new Set(lines.filter((l) => l.allocationMode !== 'direct' || !l.allocations.length).map((l) => l.id)));
  const [busy, setBusy] = useState(false);
  const total = Math.round(rows.reduce((t, r) => t + (Number(r.pct) || 0), 0) * 10000) / 10000;
  const used = rows.filter((r) => r.key && Number(r.pct) > 0);
  const dupe = new Set(used.map((r) => r.key)).size !== used.length;
  const ok = used.length > 0 && Math.abs(total - 100) < 0.0001 && !dupe && picked.size > 0;
  const amount = lines.filter((l) => picked.has(l.id)).reduce((t, l) => t + l.scheduledValue, 0);
  const now = (l: SovLineRow) => l.allocationMode === 'spread' ? 'Spread' : l.allocationMode === 'direct' && l.allocations.length
    ? l.allocations.map((a) => `${names.get(a.baselineKey) ?? 'Removed line'}${l.allocations.length > 1 ? ` ${Number(a.pct).toFixed(0)}%` : ''}`).join(' · ') : 'Not mapped';

  const apply = async () => {
    setBusy(true);
    try {
      const allocations = used.map((r) => ({ baselineKey: r.key, pct: Number(r.pct) }));
      for (const id of Array.from(picked)) await apiRequest(`/api/cost-sov-lines/${id}`, 'PATCH', { allocationMode: 'direct', allocations });
      if (after) await after();
      await qc.invalidateQueries({ queryKey: [projectKey(projectId)] });
      toast({ title: `${picked.size} line${picked.size === 1 ? '' : 's'} split`, description: used.map((r) => `${Number(r.pct)}% ${names.get(r.key)}`).join(' · ') });
      onClose();
    } catch (e: any) { toast({ title: 'Not All Split', description: e?.message, variant: 'destructive' }); await qc.invalidateQueries({ queryKey: [projectKey(projectId)] }); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl pm-scope">
        <DialogHeader><DialogTitle>Split Lines — {label}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">The split</div>
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2 mb-1.5">
                <div className="flex-1">
                  <Select value={r.key || undefined} onValueChange={(v) => setRows((x) => x.map((y, j) => (j === i ? { ...y, key: v } : y)))}>
                    <SelectTrigger className="h-8 text-sm data-[placeholder]:text-gray-500"><SelectValue placeholder="Budget line…" /></SelectTrigger>
                    <SelectContent className="pm-scope">{baseline.map((b) => <BudgetLineItem key={b.key} k={b.key} description={b.description} />)}</SelectContent>
                  </Select>
                </div>
                <Input className="h-8 w-24 text-right" inputMode="decimal" placeholder="0" value={r.pct}
                       onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, pct: e.target.value } : y)))} />
                <span className="text-gray-600">%</span>
                <button className="text-gray-400 hover:text-red-700" disabled={rows.length <= 1} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <div className="flex items-center gap-3 text-xs">
              <button className="text-blue-700 hover:underline" onClick={() => setRows((x) => [...x, { key: '', pct: '' }])}>+ Add a budget line</button>
              {used.length >= 1 && Math.abs(total - 100) >= 0.0001 && (
                <button className="text-blue-700 hover:underline" onClick={() => {
                  // The last line with a budget line takes whatever is left.
                  const idx = rows.map((r, i) => (r.key ? i : -1)).filter((i) => i >= 0).pop()!;
                  const rest = Math.round((100 - rows.reduce((t, r, j) => t + (j === idx ? 0 : Number(r.pct) || 0), 0)) * 10000) / 10000;
                  setRows((x) => x.map((y, j) => (j === idx ? { ...y, pct: String(rest) } : y)));
                }}>Last line takes the rest</button>
              )}
              <span className={`ml-auto font-medium ${Math.abs(total - 100) < 0.0001 ? 'text-green-700' : 'text-amber-800'}`}>Total {total}%{Math.abs(total - 100) < 0.0001 ? ' ✓' : ' — must be 100%'}</span>
              {dupe && <span className="text-red-700">A budget line is listed twice.</span>}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-3 text-xs mb-1">
              <span className="font-semibold uppercase tracking-wide text-gray-600">Lines to split</span>
              <button className="text-blue-700 hover:underline" onClick={() => setPicked(new Set(lines.map((l) => l.id)))}>All</button>
              <button className="text-blue-700 hover:underline" onClick={() => setPicked(new Set())}>None</button>
              <span className="ml-auto text-gray-600">{picked.size} ticked · {money(amount)}</span>
            </div>
            <div className="border rounded-md max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="px-2 py-1 w-8"><input type="checkbox" className="h-4 w-4" checked={picked.has(l.id)}
                        onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} /></td>
                      <td className="px-2 py-1 text-xs text-gray-500 w-10">{l.itemNo ?? ''}</td>
                      <td className="px-2 py-1">{l.description}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{money(l.scheduledValue)}</td>
                      <td className="px-2 py-1 text-xs text-gray-600 max-w-[220px] truncate" title={now(l)}>Now: {now(l)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={!ok || busy} onClick={apply}>{busy ? 'Applying…' : `Apply to ${picked.size} Line${picked.size === 1 ? '' : 's'}`}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
