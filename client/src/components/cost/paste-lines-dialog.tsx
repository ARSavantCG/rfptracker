/**
 * Add SOV lines by pasting them — from Excel, or copied off a G703.
 * Shows what it read before anything is saved, and what it skipped.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { parseSovPaste } from '@shared/cost-tracking';
import { money, projectKey } from './types';

export function PasteLinesDialog({ target, projectId, onClose }: {
  /** Which contract, and which change order (null = base contract). */
  target: { contractId: number; changeOrderId: number | null; label: string } | null;
  projectId: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseSovPaste(text), [text]);
  const total = parsed.lines.reduce((s, l) => s + l.scheduledValue, 0);

  const save = useMutation({
    mutationFn: () => apiRequest(`/api/cost-contracts/${target!.contractId}/sov-lines`, 'POST', {
      changeOrderId: target!.changeOrderId,
      lines: parsed.lines,
    }),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
      toast({ title: `${r?.lines?.length ?? 0} lines added`, description: 'Map them to budget lines next.' });
      setText('');
      onClose();
    },
    onError: (e: any) => toast({ title: 'Not added', description: e?.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Add lines — {target?.label}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-gray-600">
            Paste rows from Excel or copy them off the G703. Each row needs a description and an amount; an item
            number and cost code are picked up when they're there. Header and subtotal rows are skipped. One line
            is fine too: <span className="font-mono">Fee&nbsp;&nbsp;1,483.00</span>
          </p>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={7}
                    className="font-mono text-xs" />
          {parsed.lines.length > 0 && (
            <div className="border rounded-md max-h-64 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-2 py-1">Item</th><th className="px-2 py-1">Code</th>
                    <th className="px-2 py-1">Description</th><th className="px-2 py-1 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.lines.map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1">{l.itemNo || ''}</td>
                      <td className="px-2 py-1 font-mono">{l.code || ''}</td>
                      <td className="px-2 py-1">{l.description}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{money(l.scheduledValue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold">
                    <td colSpan={3} className="px-2 py-1">{parsed.lines.length} lines</td>
                    <td className="px-2 py-1 text-right tabular-nums">{money(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {parsed.skipped.length > 0 && (
            <p className="text-xs text-gray-500">
              Skipped {parsed.skipped.length} row{parsed.skipped.length === 1 ? '' : 's'} with no amount, or a total:{' '}
              <span className="italic">{parsed.skipped.slice(0, 3).map((s) => s.slice(0, 40)).join(' · ')}{parsed.skipped.length > 3 ? ' …' : ''}</span>
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={parsed.lines.length === 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Adding…' : `Add ${parsed.lines.length || ''} line${parsed.lines.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
