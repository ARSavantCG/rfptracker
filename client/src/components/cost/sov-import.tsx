/**
 * Import a contract's schedule of values from its Excel export (Adolfo, 2026-11-03): lines matched by
 * Line ID are updated (item, cost code, section, description, value, budget line); rows with no Line ID
 * are added to their group (Base Contract or an existing change order). Shown before anything saves.
 */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Upload } from 'lucide-react';
import type { BaselineLine } from '@shared/cost-tracking';
import { money, projectKey, type ContractRow, type ChangeOrderRow, type SovLineRow } from './types';
import { readTemplate, text, amount } from './excel-io';
import { ImportPreview, type Change } from './import-preview';

type Alloc = { mode: 'direct' | 'spread' | 'unallocated'; allocations: Array<{ baselineKey: string; pct: number }> };

/** "Spread with the work", "Not mapped", "New Office Area", "A 70% · B 30%" (any amounts in brackets ignored). */
export function parseBudgetLine(v: string, baseline: readonly BaselineLine[]): Alloc | string {
  const s = v.trim();
  if (!s || /^not mapped/i.test(s)) return { mode: 'unallocated', allocations: [] };
  if (/^spread/i.test(s)) return { mode: 'spread', allocations: [] };
  const byName = new Map(baseline.map((b) => [b.description.trim().toLowerCase(), b.key]));
  const whole = byName.get(s.toLowerCase());
  if (whole) return { mode: 'direct', allocations: [{ baselineKey: whole, pct: 100 }] };
  const parts = s.split(/\s*[·;|]\s*/).filter(Boolean);
  const out: Alloc['allocations'] = [];
  for (const p of parts) {
    const m = /^(.*?)\s+(\d+(?:\.\d+)?)\s*%(?:\s*\(.*\))?$/.exec(p.trim());
    const name = (m ? m[1] : p).trim();
    const key = byName.get(name.toLowerCase());
    if (!key) return `Budget line "${name}" isn't in this budget.`;
    out.push({ baselineKey: key, pct: m ? Number(m[2]) : 100 });
  }
  const tot = out.reduce((t, a) => t + a.pct, 0);
  if (Math.abs(tot - 100) > 0.01) return `The split adds to ${tot}%, not 100%.`;
  return { mode: 'direct', allocations: out };
}
const sameAlloc = (l: SovLineRow, a: Alloc) => (l.allocationMode === a.mode || (l.allocationMode === 'direct' && !l.allocations.length && a.mode === 'unallocated'))
  && JSON.stringify([...l.allocations].map((x) => [x.baselineKey, Math.round(Number(x.pct) * 100)]).sort()) === JSON.stringify([...a.allocations].map((x) => [x.baselineKey, Math.round(x.pct * 100)]).sort());

export function SovImport({ contract, changeOrders, lines, baseline, projectId }: {
  contract: ContractRow; changeOrders: ChangeOrderRow[]; lines: SovLineRow[]; baseline: BaselineLine[]; projectId: number;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<{ changes: Change[]; ops: Array<() => Promise<unknown>> } | null>(null);

  const read = async (f: File) => {
    try {
      const rows = await readTemplate(f, 'Description', 'Schedule of Values');
      const changes: Change[] = [];
      const ops: Array<() => Promise<unknown>> = [];
      const adds = new Map<number | null, any[]>();
      for (const r of rows) {
        const group = text(r['Group']);
        if (/^contract total|^total/i.test(group)) continue;
        const desc = text(r['Description']);
        if (!desc) continue;
        const id = Number(text(r['Line ID'])) || null;
        const alloc = parseBudgetLine(text(r['Budget Line']), baseline);
        if (typeof alloc === 'string') { changes.push({ kind: 'skip', label: `Row ${r.__row}: ${desc}`, detail: alloc }); continue; }
        const value = amount(r['Scheduled Value']);
        const fields = { itemNo: text(r['Item']) || null, code: text(r['Cost Code']) || null, section: text(r['Section']) || null, description: desc };
        if (id) {
          const cur = lines.find((l) => l.id === id);
          if (!cur) { changes.push({ kind: 'skip', label: `Row ${r.__row}: ${desc}`, detail: `Line ID ${id} isn't on this contract. Clear it to add the row as a new line.` }); continue; }
          const diffs: string[] = [];
          if ((cur.itemNo ?? '') !== (fields.itemNo ?? '')) diffs.push(`item ${cur.itemNo || '—'} → ${fields.itemNo || '—'}`);
          if ((cur.code ?? '') !== (fields.code ?? '')) diffs.push(`cost code → ${fields.code || '—'}`);
          if ((cur.section ?? '') !== (fields.section ?? '')) diffs.push(`section → ${fields.section || '—'}`);
          if (cur.description !== desc) diffs.push(`"${cur.description}" → "${desc}"`);
          if (value != null && Math.abs(value - cur.scheduledValue) >= 0.005) diffs.push(`value ${money(cur.scheduledValue)} → ${money(value)}`);
          const remap = !sameAlloc(cur, alloc);
          if (remap) diffs.push(`budget line → ${text(r['Budget Line']) || 'Not mapped'}`);
          changes.push({ kind: diffs.length ? 'update' : 'same', label: `${cur.itemNo ? `${cur.itemNo} · ` : ''}${desc}`, detail: diffs.join(' · ') || undefined });
          if (diffs.length) ops.push(() => apiRequest(`/api/cost-sov-lines/${id}`, 'PATCH', {
            ...fields, ...(value != null ? { scheduledValue: value } : {}), ...(remap ? { allocationMode: alloc.mode, allocations: alloc.allocations } : {}),
          }));
          continue;
        }
        // New line: into its group.
        let coId: number | null = null;
        if (group && !/^base contract/i.test(group)) {
          const no = group.split(' — ')[0].trim().toLowerCase();
          const co = changeOrders.find((c) => c.number.trim().toLowerCase() === no);
          if (!co) { changes.push({ kind: 'skip', label: `Row ${r.__row}: ${desc}`, detail: `Change order "${group}" isn't on this contract — add it in the app first.` }); continue; }
          coId = co.id;
        }
        if (value == null) { changes.push({ kind: 'skip', label: `Row ${r.__row}: ${desc}`, detail: 'No scheduled value.' }); continue; }
        adds.set(coId, [...(adds.get(coId) ?? []), { ...fields, scheduledValue: value, allocationMode: alloc.mode, allocations: alloc.allocations }]);
        changes.push({ kind: 'add', label: desc, detail: `${coId ? changeOrders.find((c) => c.id === coId)!.number : 'Base Contract'} · ${money(value)} · ${text(r['Budget Line']) || 'Not mapped'}` });
      }
      adds.forEach((ls, coId) => ops.push(() => apiRequest(`/api/cost-contracts/${contract.id}/sov-lines`, 'POST', { changeOrderId: coId, lines: ls })));
      setPlan({ changes, ops });
    } catch (e: any) { toast({ title: 'Not Read', description: e?.message, variant: 'destructive' }); }
  };

  const apply = async () => {
    let done = 0;
    try {
      for (const op of plan!.ops) { await op(); done++; }
      toast({ title: `${contract.counterparty}: imported` });
      setPlan(null);
    } catch (e: any) { toast({ title: `Stopped after ${done} of ${plan!.ops.length}`, description: e?.message, variant: 'destructive' }); }
    finally { qc.invalidateQueries({ queryKey: [projectKey(projectId)] }); }
  };

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" title="Import this contract's lines from its Excel export — shows every change first" onClick={() => ref.current?.click()}>
        <Upload className="h-3.5 w-3.5 mr-1" /> Import
      </Button>
      <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f); }} />
      <ImportPreview title={`Import Schedule of Values — ${contract.counterparty}`} changes={plan?.changes ?? null} onApply={apply} onClose={() => setPlan(null)}
        note="Lines are matched by Line ID; rows without one are added to their group. Billed and retainage columns are ignored. Nothing is saved until you apply." />
    </>
  );
}
