/**
 * Type a schedule of values straight into the table — the base contract or
 * one change order — the way the RFP evaluation grid works: one row per
 * line, Tab across, Enter for a new row, and the budget line picked right
 * there. Paste from Excel or a G703 still works, into the same grid.
 *
 * Nothing is saved until Save, and Save sends only what changed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Plus, Trash2, ClipboardPaste } from 'lucide-react';
import type { BaselineLine } from '@shared/cost-tracking';
import { parseSovPaste } from '@shared/cost-tracking';
import { fmtMoneyText } from '@shared/format';
import { MoneyInput } from './inputs';
import { money, projectKey, type SovLineRow } from './types';

const UNMAPPED = '__unmapped__';
const SPREAD = '__spread__';
const SPLIT = '__split__';

type Row = {
  rid: string;
  id: number | null;            // null = new
  itemNo: string;
  code: string;
  description: string;
  value: string;                // formatted money text
  map: string;                  // a baseline key, UNMAPPED, SPREAD, or SPLIT (keep the existing split)
  split?: { baselineKey: string; pct: number }[];
};

const num = (s: string) => {
  const v = parseFloat(String(s ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(v) ? v : 0;
};
let seq = 0;
const rid = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

function toRow(l: SovLineRow): Row {
  const map = l.allocationMode === 'spread' ? SPREAD
    : l.allocationMode === 'direct' && l.allocations.length === 1 && l.allocations[0].pct === 100 ? l.allocations[0].baselineKey
    : l.allocationMode === 'direct' && l.allocations.length > 0 ? SPLIT
    : UNMAPPED;
  return {
    rid: rid(), id: l.id, itemNo: l.itemNo ?? '', code: l.code ?? '', description: l.description,
    value: fmtMoneyText(String(l.scheduledValue)), map, split: map === SPLIT ? l.allocations : undefined,
  };
}
const blankRow = (map = UNMAPPED): Row => ({ rid: rid(), id: null, itemNo: '', code: '', description: '', value: '', map });

/** What the API wants for a row's mapping. */
function allocationOf(r: Row) {
  if (r.map === SPREAD) return { allocationMode: 'spread', allocations: [] };
  if (r.map === SPLIT) return { allocationMode: 'direct', allocations: r.split ?? [] };
  if (r.map === UNMAPPED) return { allocationMode: 'unallocated', allocations: [] };
  return { allocationMode: 'direct', allocations: [{ baselineKey: r.map, pct: 100 }] };
}
const same = (a: Row, b: Row) => a.itemNo === b.itemNo && a.code === b.code && a.description.trim() === b.description.trim()
  && Math.abs(num(a.value) - num(b.value)) < 0.005 && a.map === b.map;

export function SovGridEditor({ contractId, changeOrderId, label, lines, baseline, billedIds, projectId, onDone }: {
  contractId: number;
  changeOrderId: number | null;
  label: string;
  lines: SovLineRow[];
  baseline: BaselineLine[];
  /** Lines with billing against them — they can be edited, not deleted. */
  billedIds: Set<number>;
  projectId: number;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const original = useMemo(() => lines.map(toRow), [lines]);
  const [rows, setRows] = useState<Row[]>(() => (original.length ? original.map((r) => ({ ...r })) : [blankRow(), blankRow(), blankRow()]));
  const [paste, setPaste] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const descRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const baselineName = new Map(baseline.map((b) => [b.key, b.description]));

  const [focusRid, setFocusRid] = useState<string | null>(null);
  // Focus once the row is on screen, so the first keystroke lands in it.
  useEffect(() => {
    if (focusRid && descRefs.current[focusRid]) { descRefs.current[focusRid]!.focus(); setFocusRid(null); }
  }, [focusRid, rows]);
  const update = (r: string, patch: Partial<Row>) => setRows((rs) => rs.map((x) => (x.rid === r ? { ...x, ...patch } : x)));
  const isBlank = (x: Row) => x.id == null && !x.description.trim() && !num(x.value);
  const addRow = (after?: string) => {
    // Enter on a line moves to the empty line under it if there is one; otherwise adds one.
    if (after) {
      const i = rows.findIndex((x) => x.rid === after);
      const next = rows[i + 1];
      if (next && isBlank(next)) { descRefs.current[next.rid]?.focus(); return; }
    }
    const nr = blankRow();
    setRows((rs) => {
      if (!after) return [...rs, nr];
      const i = rs.findIndex((x) => x.rid === after);
      return [...rs.slice(0, i + 1), nr, ...rs.slice(i + 1)];
    });
    setFocusRid(nr.rid);
  };
  const removeRow = (r: Row) => {
    if (r.id && billedIds.has(r.id)) {
      toast({ title: 'Billed on a pay app', description: 'This line has billing against it, so it stays. Set its value to zero instead.' });
      return;
    }
    setRows((rs) => rs.filter((x) => x.rid !== r.rid));
  };

  const live = rows.filter((r) => r.description.trim() || num(r.value));
  const total = live.reduce((s, r) => s + num(r.value), 0);
  const missingDesc = live.filter((r) => !r.description.trim());
  const removed = original.filter((o) => !rows.some((r) => r.id === o.id));
  const changed = rows.filter((r) => r.id != null && !same(r, original.find((o) => o.id === r.id)!));
  const added = live.filter((r) => r.id == null);
  const dirty = removed.length + changed.length + added.length > 0;

  const readPaste = () => {
    const parsed = parseSovPaste(paste ?? '');
    if (!parsed.lines.length) { toast({ title: 'Nothing read', description: 'Each row needs a description and an amount.' }); return; }
    const incoming = parsed.lines.map((l) => ({ ...blankRow(), itemNo: l.itemNo ?? '', code: l.code ?? '', description: l.description, value: fmtMoneyText(String(l.scheduledValue)) }));
    // Fill the empty rows first, then append.
    setRows((rs) => [...rs.filter((r) => r.id != null || r.description.trim() || num(r.value)), ...incoming]);
    setPaste(null);
    toast({ title: `${incoming.length} line${incoming.length === 1 ? '' : 's'} added to the grid`, description: parsed.skipped.length ? `${parsed.skipped.length} header or total row${parsed.skipped.length === 1 ? '' : 's'} skipped. Review, then Save.` : 'Review, then Save.' });
  };

  const save = async () => {
    if (missingDesc.length) { toast({ title: 'Every line needs a description', variant: 'destructive' }); return; }
    setSaving(true);
    const problems: string[] = [];
    try {
      if (added.length) {
        await apiRequest(`/api/cost-contracts/${contractId}/sov-lines`, 'POST', {
          changeOrderId,
          lines: added.map((r) => ({ itemNo: r.itemNo, code: r.code, description: r.description.trim(), scheduledValue: num(r.value), ...allocationOf(r) })),
        });
      }
      for (const r of changed) {
        await apiRequest(`/api/cost-sov-lines/${r.id}`, 'PATCH', {
          itemNo: r.itemNo, code: r.code, description: r.description.trim(), scheduledValue: num(r.value), ...allocationOf(r),
        });
      }
      for (const o of removed) {
        try { await apiRequest(`/api/cost-sov-lines/${o.id}`, 'DELETE'); } catch (e: any) { problems.push(`${o.description}: ${e?.message}`); }
      }
      toast(problems.length
        ? { title: 'Saved, with exceptions', description: problems.join(' · '), variant: 'destructive', duration: 10000 }
        : { title: `${label} saved`, description: `${added.length} added · ${changed.length} changed · ${removed.length} removed` });
      onDone();
    } catch (e: any) {
      toast({ title: 'Not saved', description: e?.message, variant: 'destructive', duration: 10000 });
    } finally {
      setSaving(false);
      queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
    }
  };

  return (
    <tr>
      <td colSpan={6} className="p-0">
        <div className="bg-blue-50/40 border-y border-blue-200 px-3 py-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-semibold text-gray-900">Editing {label}</div>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setPaste(paste == null ? '' : null)}>
              <ClipboardPaste className="h-3.5 w-3.5 mr-1" /> Paste from Excel or a G703
            </Button>
          </div>
          {paste != null && (
            <div className="bg-white border rounded-md p-2 space-y-2">
              <p className="text-xs text-gray-600">
                Paste rows copied from Excel or off the G703 — item number, cost code, description and amount. Header and
                subtotal rows are skipped. The rows land in the grid below for you to check before saving.
              </p>
              <Textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} className="font-mono text-xs" aria-label="Rows to paste" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPaste(null)}>Cancel</Button>
                <Button size="sm" disabled={!paste.trim()} onClick={readPaste}>Add to grid</Button>
              </div>
            </div>
          )}

          <div className="bg-white border rounded-md overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b bg-gray-50">
                  <th className="px-2 py-1.5 w-20">Item</th>
                  <th className="px-2 py-1.5 w-36">Cost code</th>
                  <th className="px-2 py-1.5">Description</th>
                  <th className="px-2 py-1.5 w-40 text-right">Scheduled value</th>
                  <th className="px-2 py-1.5 w-64">Budget line</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const billed = r.id != null && billedIds.has(r.id);
                  const bad = !r.description.trim() && !!num(r.value);
                  return (
                    <tr key={r.rid} className="border-b last:border-0">
                      <td className="px-1 py-1"><Input className="h-8 text-xs" value={r.itemNo} aria-label="Item" onChange={(e) => update(r.rid, { itemNo: e.target.value })} /></td>
                      <td className="px-1 py-1"><Input className="h-8 text-xs font-mono" value={r.code} aria-label="Cost code" onChange={(e) => update(r.rid, { code: e.target.value })} /></td>
                      <td className="px-1 py-1">
                        <Input ref={(el) => { descRefs.current[r.rid] = el; }} className={`h-8 ${bad ? 'border-red-400' : ''}`} value={r.description} aria-label="Description"
                               onChange={(e) => update(r.rid, { description: e.target.value })} />
                      </td>
                      <td className="px-1 py-1">
                        <MoneyInput className="h-8" value={r.value} aria-label="Scheduled value" onValueChange={(v) => update(r.rid, { value: v })}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(r.rid); } }} />
                      </td>
                      <td className="px-1 py-1">
                        <Select value={r.map} onValueChange={(v) => update(r.rid, { map: v })}>
                          <SelectTrigger className={`h-8 text-xs ${r.map === UNMAPPED ? 'text-amber-800 border-amber-300' : ''}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNMAPPED}>Not mapped yet</SelectItem>
                            {baseline.map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}
                            <SelectItem value={SPREAD}>Spread with the work (GCs, insurance, fee)</SelectItem>
                            {r.split && (
                              <SelectItem value={SPLIT}>
                                Split: {r.split.map((a) => `${baselineName.get(a.baselineKey) ?? 'Removed line'} ${Number(a.pct).toFixed(2)}%`).join(' · ')}
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-1 py-1 text-center">
                        <button className={`p-1 ${billed ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-700'}`}
                                title={billed ? 'Billed on a pay app — set it to zero instead' : 'Remove this line'} onClick={() => removeRow(r)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-800 font-semibold">
                  <td colSpan={3} className="px-2 py-2">{label} total <span className="font-normal text-gray-500 text-xs">({live.length} line{live.length === 1 ? '' : 's'})</span></td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-2 items-center">
              <Button size="sm" variant="outline" className="h-8" onClick={() => addRow()}><Plus className="h-3.5 w-3.5 mr-1" /> Line</Button>
              <span className="text-xs text-gray-600">Tab moves across; Enter in a value adds the next line. To split a line between budget lines, save, then click the line.</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => {
                if (!dirty || window.confirm('Discard the changes to these lines?')) onDone();
              }}>Cancel</Button>
              <Button size="sm" disabled={!dirty || saving || missingDesc.length > 0} onClick={save}>
                {saving ? 'Saving…' : 'Save lines'}
              </Button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
