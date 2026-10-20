/**
 * The budget a project is measured against. Frozen from the RFP when the
 * project opened; editable here — a blank project starts empty, and a
 * re-forecast is a real thing that happens.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Plus, Trash2 } from 'lucide-react';
import type { BaselineLine } from '@shared/cost-tracking';
import { money, projectKey, BUCKET_LABEL, type SovLineRow } from './types';

type Row = { key: string; description: string; bucket: string; budget: string; tenantSharePct: string; masterItemId?: number | null };

export function BaselineEditor({ projectId, baseline, sovLines, rfpLinked }: {
  projectId: number;
  baseline: BaselineLine[];
  sovLines: SovLineRow[];
  rfpLinked: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const toRows = (b: BaselineLine[]): Row[] => b.map((x: any) => ({
    key: x.key, description: x.description, bucket: x.bucket,
    budget: String(x.budget), tenantSharePct: String(x.tenantSharePct ?? 100), masterItemId: x.masterItemId ?? null,
  }));
  const [rows, setRows] = useState<Row[]>(toRows(baseline));
  useEffect(() => { setRows(toRows(baseline)); }, [JSON.stringify(baseline)]);

  // Which budget lines SOV lines point at — removing one of those moves money
  // to Unallocated, which is allowed but should not be a surprise.
  const mappedKeys = useMemo(() => new Set(sovLines.flatMap((l) => l.allocations.map((a) => a.baselineKey))), [sovLines]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(toRows(baseline));
  const total = rows.reduce((s, r) => s + (parseFloat(r.budget.replace(/[$,]/g, '')) || 0), 0);

  const save = useMutation({
    mutationFn: () => apiRequest(`/api/cost-projects/${projectId}`, 'PATCH', {
      baseline: rows.map((r) => ({
        key: r.key, description: r.description, bucket: r.bucket,
        budget: r.budget, tenantSharePct: parseFloat(r.tenantSharePct), masterItemId: r.masterItemId ?? null,
      })),
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] }); toast({ title: 'Budget saved' }); },
    onError: (e: any) => toast({ title: 'Not saved', description: e?.message, variant: 'destructive' }),
  });

  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">
        {rfpLinked
          ? 'Frozen from the RFP\'s evaluation budget when the project opened, at full cost. Changes here do not touch the RFP.'
          : 'The lines this project is measured against, at full cost.'}
        {' '}Tenant share decides how committed cost splits between what the tenant pays and what is absorbed.
      </p>
      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
              <th className="px-2 py-1.5">Budget line</th>
              <th className="px-2 py-1.5 w-40">Contract</th>
              <th className="px-2 py-1.5 w-40 text-right">Budget</th>
              <th className="px-2 py-1.5 w-28 text-right">Tenant pays</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-b last:border-0">
                <td className="px-2 py-1"><Input className="h-8" value={r.description} onChange={(e) => update(i, { description: e.target.value })} /></td>
                <td className="px-2 py-1">
                  <select value={r.bucket} onChange={(e) => update(i, { bucket: e.target.value })}
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm">
                    {Object.entries(BUCKET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1"><Input className="h-8 text-right tabular-nums" inputMode="decimal" value={r.budget} onChange={(e) => update(i, { budget: e.target.value })} /></td>
                <td className="px-2 py-1">
                  <div className="relative">
                    <Input className="h-8 text-right pr-6 tabular-nums" inputMode="decimal" value={r.tenantSharePct} onChange={(e) => update(i, { tenantSharePct: e.target.value })} />
                    <span className="absolute right-2 top-1.5 text-xs text-gray-500">%</span>
                  </div>
                </td>
                <td className="px-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8"
                          title={mappedKeys.has(r.key) ? 'Contract lines are mapped here; removing it moves them to Unallocated' : 'Remove'}
                          onClick={() => {
                            if (mappedKeys.has(r.key) && !window.confirm(`Contract lines are mapped to "${r.description}". Remove it anyway? Their money will show as Unallocated until you re-map it.`)) return;
                            setRows(rows.filter((_, j) => j !== i));
                          }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800 font-semibold">
              <td className="px-2 py-2" colSpan={2}>Total budget</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(total)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex gap-2 justify-between flex-wrap">
        <Button variant="outline" size="sm" onClick={() => setRows([...rows, {
          key: `b-${Date.now().toString(36)}`, description: '', bucket: 'contractor', budget: '0', tenantSharePct: '100',
        }])}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Budget line
        </Button>
        <div className="flex gap-2">
          {dirty && <Button variant="ghost" size="sm" onClick={() => setRows(toRows(baseline))}>Discard</Button>}
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save budget'}</Button>
        </div>
      </div>
    </div>
  );
}
