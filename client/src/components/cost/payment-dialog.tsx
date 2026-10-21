/**
 * Payments against one pay app or invoice: what went out, when, how, and the
 * check or wire number. Partial payments are fine — the app stays open for
 * the rest. Any payment can be opened and corrected.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MoneyInput } from './inputs';
import { fmtMoneyText } from '@shared/format';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Pencil, Trash2 } from 'lucide-react';
import { money, projectKey, shortDate, todayIso, PAY_METHODS, type ApplicationRow, type PaymentRow, type ContractRow } from './types';

const methodName = (m: string | null) => PAY_METHODS.find(([k]) => k === m)?.[1] ?? '';
const refLabel = (m: string) => m === 'check' ? 'Check #' : m === 'wire' ? 'Wire / confirmation #' : m === 'ach' ? 'ACH trace #' : m === 'card' ? 'Card / last 4' : 'Reference #';
const blank = (method = 'check') => ({ amount: '', paidDate: todayIso(), reference: '', method, notes: '' });

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

  const [form, setForm] = useState(blank());
  const [editing, setEditing] = useState<number | null>(null);
  useEffect(() => {
    if (app) { setEditing(null); setForm({ ...blank(), amount: open > 0 ? fmtMoneyText(String(open)) : '' }); }
  }, [app?.id]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
  const saveP = useMutation({
    mutationFn: () => editing
      ? apiRequest(`/api/cost-payments/${editing}`, 'PATCH', form)
      : apiRequest(`/api/cost-applications/${app!.id}/payments`, 'POST', form),
    onSuccess: () => {
      refresh();
      toast({ title: editing ? 'Payment updated' : 'Payment recorded' });
      setEditing(null);
      setForm(blank(form.method));
    },
    onError: (e: any) => toast({ title: 'Not saved', description: e?.message, variant: 'destructive' }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/cost-payments/${id}`, 'DELETE'),
    onSuccess: refresh,
    onError: (e: any) => toast({ title: 'Not removed', description: e?.message, variant: 'destructive' }),
  });

  const startEdit = (p: PaymentRow) => {
    setEditing(p.id);
    setForm({ amount: fmtMoneyText(String(p.amount)), paidDate: String(p.paidDate).slice(0, 10), reference: p.reference ?? '', method: p.method ?? 'check', notes: p.notes ?? '' });
  };
  // While editing, the payment being edited does not count against what is open.
  const openExcluding = editing ? Math.round((open + (mine.find((p) => p.id === editing)?.amount ?? 0)) * 100) / 100 : open;

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="pm-scope sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Payments — {target?.contract.counterparty}, {app?.kind === 'invoice' ? 'Invoice' : 'Pay App'} {app?.docNumber}{app?.invoiceNumber ? ` (#${app.invoiceNumber})` : ''}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div><div className="text-[11px] uppercase text-gray-500">Payment due</div><div className="font-semibold tabular-nums">{money(due)}</div></div>
          <div><div className="text-[11px] uppercase text-gray-500">Paid</div><div className="font-semibold tabular-nums">{money(paid)}</div></div>
          <div><div className="text-[11px] uppercase text-gray-500">Open</div>
            <div className={`font-semibold tabular-nums ${open > 0.005 ? 'text-red-700' : 'text-green-700'}`}>{open > 0.005 ? money(open) : open < -0.005 ? `${money(open)} (overpaid)` : 'Paid in full'}</div></div>
        </div>

        {mine.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-gray-500 border-b">
                <th className="py-1 font-medium">Paid on</th><th className="py-1 font-medium">How</th><th className="py-1 font-medium">Ref #</th>
                <th className="py-1 font-medium text-right">Amount</th><th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {mine.map((p) => (
                <tr key={p.id} className={`border-b last:border-0 align-top ${editing === p.id ? 'bg-amber-50' : ''}`}>
                  <td className="py-1.5">{shortDate(p.paidDate)}</td>
                  <td className="py-1.5 text-gray-700">{methodName(p.method)}</td>
                  <td className="py-1.5 text-gray-700">{p.reference || ''}
                    {p.notes ? <div className="text-xs text-gray-500 whitespace-pre-wrap">{p.notes}</div> : null}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(p.amount)}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit this payment" onClick={() => startEdit(p)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
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

        <div className="border-t pt-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">{editing ? 'Edit payment' : 'Record a payment'}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
            <div className="space-y-1">
              <div className="text-xs text-gray-600">Amount</div>
              <MoneyInput value={form.amount} onValueChange={(v) => setForm({ ...form, amount: v })} />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">{form.method === 'check' ? 'Check date' : 'Paid on'}</div>
              <Input type="date" value={form.paidDate} onChange={(e) => setForm({ ...form, paidDate: e.target.value })} />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">How</div>
              <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent className="pm-scope">{PAY_METHODS.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">{refLabel(form.method)}</div>
              <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-600">Notes</div>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {!editing && open > 0.005 && (
            <button type="button" className="text-xs text-blue-700 hover:underline"
                    onClick={() => setForm({ ...form, amount: fmtMoneyText(String(open)) })}>
              Pay the full {money(open)} open
            </button>
          )}
        </div>
        <div className="flex justify-end gap-2">
          {editing
            ? <Button variant="outline" onClick={() => { setEditing(null); setForm(blank(form.method)); }}>Cancel edit</Button>
            : <Button variant="outline" onClick={onClose}>Done</Button>}
          <Button disabled={!form.amount || !form.paidDate || saveP.isPending} onClick={() => {
            const amt = parseFloat(form.amount.replace(/[$,\s]/g, '')) || 0;
            if (amt > openExcluding + 0.005 && !window.confirm(`That is ${money(amt - openExcluding)} more than is open on this pay app. Save it anyway?`)) return;
            saveP.mutate();
          }}>
            {saveP.isPending ? 'Saving…' : editing ? 'Save changes' : 'Record payment'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
