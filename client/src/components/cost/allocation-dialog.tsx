/**
 * Where one SOV line's money goes. Set once; every pay app follows it.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput, PercentInput } from './inputs';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Trash2, Plus } from 'lucide-react';
import type { BaselineLine } from '@shared/cost-tracking';
import { money, projectKey, type SovLineRow } from './types';

type Mode = 'direct' | 'spread' | 'unallocated';

export function AllocationDialog({ line, baseline, projectId, onClose }: {
  line: SovLineRow | null;
  baseline: BaselineLine[];
  projectId: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('direct');
  const [rows, setRows] = useState<{ baselineKey: string; pct: string }[]>([]);
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!line) return;
    setMode(line.allocationMode === 'unallocated' ? 'direct' : line.allocationMode);
    setRows(line.allocations.length
      ? line.allocations.map((a) => ({ baselineKey: a.baselineKey, pct: String(a.pct) }))
      : [{ baselineKey: '', pct: '100' }]);
    setDescription(line.description);
    setValue(String(line.scheduledValue));
  }, [line?.id]);

  const total = rows.reduce((s, r) => s + (parseFloat(r.pct) || 0), 0);
  const filled = rows.filter((r) => r.baselineKey && parseFloat(r.pct) > 0);

  const save = useMutation({
    mutationFn: () => apiRequest(`/api/cost-sov-lines/${line!.id}`, 'PATCH', {
      description, scheduledValue: value,
      allocationMode: mode === 'direct' && filled.length === 0 ? 'unallocated' : mode,
      allocations: mode === 'direct' ? filled.map((r) => ({ baselineKey: r.baselineKey, pct: parseFloat(r.pct) })) : [],
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] }); onClose(); },
    onError: (e: any) => toast({ title: 'Not saved', description: e?.message, variant: 'destructive' }),
  });
  const remove = useMutation({
    mutationFn: () => apiRequest(`/api/cost-sov-lines/${line!.id}`, 'DELETE'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] }); onClose(); },
    onError: (e: any) => toast({ title: 'Not deleted', description: e?.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={!!line} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="pm-scope sm:max-w-lg">
        <DialogHeader><DialogTitle>{line?.itemNo ? `${line.itemNo} · ` : ''}{line?.code || 'SOV line'}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2 space-y-1">
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Scheduled value</Label>
              <MoneyInput value={value} onValueChange={setValue} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Where this money goes</Label>
            <div className="flex flex-wrap gap-2">
              {([
                ['direct', 'To budget lines'],
                ['spread', 'Spread with the work'],
                ['unallocated', 'Not yet'],
              ] as [Mode, string][]).map(([m, label]) => (
                <Button key={m} type="button" size="sm" variant={mode === m ? 'default' : 'outline'} onClick={() => setMode(m)}>{label}</Button>
              ))}
            </div>
            {mode === 'spread' && (
              <p className="text-xs text-gray-600">
                For General Conditions, insurance and fee: spread in proportion to the other lines in the same group.
                A change order's fee follows that change order's work; base-contract markups follow the base contract.
              </p>
            )}
            {mode === 'unallocated' && (
              <p className="text-xs text-gray-600">Shows on the Unallocated row until you map it. Nothing is lost.</p>
            )}
            {mode === 'direct' && (
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <select value={r.baselineKey}
                            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, baselineKey: e.target.value } : x)))}
                            className="h-9 flex-1 min-w-0 rounded-md border border-input bg-background px-2 text-sm">
                      <option value="">Budget line…</option>
                      {baseline.map((b) => <option key={b.key} value={b.key}>{b.description}</option>)}
                    </select>
                    <div className="w-28">
                      <PercentInput value={String(r.pct)} className="h-9"
                                    onValueChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: v } : x)))} />
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9"
                            onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length === 1}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button type="button" variant="outline" size="sm"
                          onClick={() => setRows([...rows, { baselineKey: '', pct: String(Math.max(0, 100 - total)) }])}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Split
                  </Button>
                  <span className={`text-xs ${Math.abs(total - 100) < 0.01 ? 'text-gray-600' : 'text-amber-700'}`}>
                    {Math.abs(total - 100) < 0.01
                      ? '100% placed'
                      : total < 100
                        ? `${total.toFixed(2)}% placed — ${(100 - total).toFixed(2)}% (${money(((100 - total) / 100) * (parseFloat(value) || 0))}) stays Unallocated`
                        : `${total.toFixed(2)}% — over 100, will be scaled to 100`}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" className="text-red-700" disabled={remove.isPending}
                  onClick={() => remove.mutate()}>
            Delete line
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
