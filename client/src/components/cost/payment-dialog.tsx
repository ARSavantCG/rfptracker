/**
 * Payments against one pay app or invoice: what went out, when, and the
 * check or wire number. Partial payments are fine — the app stays open for
 * the rest.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from './inputs';
import { fmtMoneyText } from '@shared/format';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Trash2 } from 'lucide-react';
import { money, projectKey, shortDate, todayIso, PAY_METHODS, type ApplicationRow, type PaymentRow, type ContractRow } from './types';

export function PaymentDialog({ target, payments, projectId, onClose }: {
  target: { app: ApplicationRow; contract: ContractRow } | null;
  payments: PaymentRow[];
  projectId: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const app = target?.app;
  const mine = app ? payments.filter((p) => p.applicationId === app.id) : [];
  const due = app?.g702.currentPaymentDue ?? 0;
  const paid = Math.round(mine.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  const open = Math.round((due - paid) * 100) / 100;

  const [form, setForm] = useState({ amount: '', paidDate: todayIso(), reference: '', method: 'wire' });
  useEffect(() => {
    if (app) setForm({ amount: open > 0 ? fmtMoneyText(String(open)) : '', paidDate: todayIso(), reference: '', method: 'wire' });
  }, [app?.id]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
  const add = useMutation({
    mutationFn: () => apiRequest(`/api/cost-applications/${app!.id}/payments`, 'POST', form),
    onSuccess: () => { refresh(); toast({ title: 'Payment recorded' }); setForm({ amount: '', paidDate: todayIso(), reference: '', method: form.method }); },
    onError: (e: any) => toast({ title: 'Not recorded', description: e?.message, variant: 'destructive' }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/cost-payments/${id}`, 'DELETE'),
    onSuccess: refresh,
    onError: (e: any) => toast({ title: 'Not removed', description: e?.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="pm-scope sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Payments — {target?.contract.counterparty}, {app?.kind === 'invoice' ? 'Invoice' : 'App'} {app?.number}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div><div className="text-[11px] uppercase text-gray-500">Payment due</div><div className="font-semibold tabular-nums">{money(due)}</div></div>
          <div><div className="text-[11px] uppercase text-gray-500">Paid</div><div className="font-semibold tabular-nums">{money(paid)}</div></div>
          <div><div className="text-[11px] uppercase text-gray-500">Open</div>
            <div className={`font-semibold tabular-nums ${open > 0.005 ? 'text-red-700' : 'text-green-700'}`}>{money(open)}</div></div>
        </div>

        {mine.length > 0 && (
          <table className="w-full text-sm">
            <tbody>
              {mine.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="py-1.5">{shortDate(p.paidDate)}</td>
                  <td className="py-1.5 text-gray-600">{p.reference || ''}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(p.amount)}</td>
                  <td className="py-1.5 w-8 text-right">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Remove this payment"
                            onClick={() => { if (window.confirm(`Remove the ${money(p.amount)} payment of ${shortDate(p.paidDate)}?`)) remove.mutate(p.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end border-t pt-3">
          <div className="space-y-1">
            <div className="text-xs text-gray-600">Amount</div>
            <MoneyInput value={form.amount} onValueChange={(v) => setForm({ ...form, amount: v })} />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-600">Paid on</div>
            <Input type="date" value={form.paidDate} onChange={(e) => setForm({ ...form, paidDate: e.target.value })} />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-600">How</div>
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
              {PAY_METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-600">Check / wire #</div>
            <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Done</Button>
          <Button disabled={!form.amount || !form.paidDate || add.isPending} onClick={() => {
            const amt = parseFloat(form.amount.replace(/[$,\s]/g, '')) || 0;
            if (amt > open + 0.005 && !window.confirm(`That is ${money(amt - open)} more than is open on this pay app. Record it anyway?`)) return;
            add.mutate();
          }}>
            {add.isPending ? 'Recording…' : 'Record payment'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
