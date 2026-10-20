/**
 * The job cost ledger: every dollar out, in date order. Payments to the
 * contractors and architect come in on their own from the pay apps; card
 * charges and anything else with no contract are added here. Tick each one
 * off against the bank or card statement.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Printer, Plus, Trash2, Paperclip } from 'lucide-react';
import { openDocument } from './contract-card';
import { money, shortDate, todayIso, openReport, projectKey, PAY_METHODS, type ProjectBundle } from './types';

const METHOD = Object.fromEntries(PAY_METHODS);
const blank = () => ({ date: todayIso(), vendor: '', description: '', amount: '', method: 'card', reference: '', key: '' });

export function LedgerView({ bundle, projectId }: { bundle: ProjectBundle; projectId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
  const [show, setShow] = useState<'all' | 'open'>('all');
  const [form, setForm] = useState<ReturnType<typeof blank> | null>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const L = bundle.ledger;
  const baseline = bundle.project.baseline;
  const entries = useMemo(() => (show === 'open' ? L.entries.filter((e) => !e.reconciled) : L.entries), [L.entries, show]);
  const receiptsFor = (id: number) => bundle.documents.filter((d) => d.directCostId === id);
  const paymentDocs = (paymentId: number) => {
    const p = bundle.payments.find((x) => x.id === paymentId);
    return p?.applicationId ? bundle.documents.filter((d) => d.applicationId === p.applicationId) : [];
  };

  const fail = (title: string) => (e: any) => toast({ title, description: e?.message, variant: 'destructive' });
  const upload = async (file: File, directCostId: number) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('directCostId', String(directCostId));
    await apiRequest(`/api/cost-projects/${projectId}/documents`, 'POST', fd, 120_000);
  };
  const add = useMutation({
    mutationFn: async () => {
      const row: any = await apiRequest(`/api/cost-projects/${projectId}/direct-costs`, 'POST', { ...form, key: form!.key || null });
      if (receipt) await upload(receipt, row.id);
      return row;
    },
    onSuccess: () => { refresh(); setForm(null); setReceipt(null); toast({ title: 'Added to the ledger' }); },
    onError: (e: any) => { refresh(); fail('Not added')(e); },
  });
  const patchDirect = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: any }) => apiRequest(`/api/cost-direct-costs/${id}`, 'PATCH', patch),
    onSuccess: refresh, onError: fail('Not changed'),
  });
  const patchPayment = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: any }) => apiRequest(`/api/cost-payments/${id}`, 'PATCH', patch),
    onSuccess: refresh, onError: fail('Not changed'),
  });
  const removeDirect = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/cost-direct-costs/${id}`, 'DELETE'),
    onSuccess: refresh, onError: fail('Not removed'),
  });
  const attach = useMutation({
    mutationFn: ({ file, id }: { file: File; id: number }) => upload(file, id),
    onSuccess: () => { refresh(); toast({ title: 'Receipt saved' }); }, onError: fail('Receipt not saved'),
  });

  const print = async () => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (!(await openReport(`/api/reports/job-cost-ledger/${projectId}${q.toString() ? `?${q}` : ''}`))) toast({ title: 'Report failed', variant: 'destructive' });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Stat label="Total paid out" value={money(L.total)} sub={`${L.entries.length} entries`} />
        <Stat label="Not reconciled" value={money(L.unreconciled)} sub={`${L.unreconciledCount} entr${L.unreconciledCount === 1 ? 'y' : 'ies'}`}
              tone={L.unreconciledCount ? 'text-amber-700' : 'text-green-700'} />
        <Stat label="Direct costs" value={money(bundle.directCosts.reduce((s, d) => s + d.amount, 0))} sub={`${bundle.directCosts.length} with no contract`} />
        <Stat label="Contract payments" value={money(bundle.payments.reduce((s, p) => s + p.amount, 0))} sub={`${bundle.payments.length} against pay apps`} />
      </div>

      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-md p-1">
          {(['all', 'open'] as const).map((k) => (
            <button key={k} onClick={() => setShow(k)}
                    className={`text-sm px-3 py-1 rounded ${show === k ? 'bg-white shadow-sm font-medium' : 'text-gray-600'}`}>
              {k === 'all' ? 'All' : `Not reconciled (${L.unreconciledCount})`}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <div className="space-y-0.5"><div className="text-[11px] text-gray-500">From</div>
            <Input type="date" className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-0.5"><div className="text-[11px] text-gray-500">To</div>
            <Input type="date" className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button variant="outline" onClick={print}><Printer className="h-4 w-4 mr-1" /> Job Cost Ledger</Button>
          {!form && <Button onClick={() => setForm(blank())}><Plus className="h-4 w-4 mr-1" /> Charge</Button>}
        </div>
      </div>

      {form && (
        <div className="bg-white border rounded-lg p-3 space-y-2">
          <div className="text-sm font-medium text-gray-900">Add a charge with no contract — a permit fee, parking, reprographics</div>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
            <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Paid to" wide><Input value={form.vendor} placeholder="Miami-Dade RER" onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></Field>
            <Field label="For" wide><Input value={form.description} placeholder="Building permit fee" onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Amount"><Input inputMode="decimal" className="text-right tabular-nums" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="How">
              <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}
                      className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                {PAY_METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Card last 4 / check #"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
            <Field label="Budget line" wide>
              <select value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })}
                      className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                <option value="">— choose —</option>
                {baseline.map((b) => <option key={b.key} value={b.key}>{b.description}</option>)}
              </select>
            </Field>
            <Field label="Receipt" wide>
              <label className="h-10 flex items-center gap-2 text-sm text-blue-700 cursor-pointer border rounded-md px-2 truncate">
                <Paperclip className="h-4 w-4 flex-shrink-0" /> <span className="truncate">{receipt ? receipt.name : 'Attach'}</span>
                <input type="file" className="hidden" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
              </label>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setForm(null); setReceipt(null); }}>Cancel</Button>
            <Button disabled={!form.vendor.trim() || !form.amount || !form.date || add.isPending} onClick={() => add.mutate()}>
              {add.isPending ? 'Adding…' : 'Add to ledger'}
            </Button>
          </div>
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-gray-600 border-b text-left">
              <th className="px-3 py-2 w-10" title="Reconciled">✓</th>
              <th className="px-3 py-2">Date</th><th className="px-3 py-2">Paid to</th><th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">How</th><th className="px-3 py-2">Budget line</th>
              <th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">Running</th><th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-4 text-gray-500">
                {show === 'open' ? 'Everything is reconciled.' : 'Nothing paid yet. Payments recorded on pay apps show up here, and so does anything you add with “Charge”.'}
              </td></tr>
            )}
            {entries.map((e) => {
              const docs = e.kind === 'direct' ? receiptsFor(e.id) : paymentDocs(e.id);
              return (
                <tr key={`${e.kind}-${e.id}`} className={`border-b last:border-0 ${e.reconciled ? '' : 'bg-amber-50/40'}`}>
                  <td className="px-3 py-1.5">
                    <input type="checkbox" className="h-4 w-4 accent-green-600" checked={e.reconciled} title="Reconciled against the statement"
                           onChange={(ev) => (e.kind === 'direct'
                             ? patchDirect.mutate({ id: e.id, patch: { reconciled: ev.target.checked } })
                             : patchPayment.mutate({ id: e.id, patch: { reconciled: ev.target.checked } }))} />
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{shortDate(e.date)}</td>
                  <td className="px-3 py-1.5">{e.vendor}</td>
                  <td className="px-3 py-1.5 text-gray-700">{e.description}</td>
                  <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{(() => { const m = e.method ? METHOD[e.method] : ''; const ref = e.reference || ''; return (m && ref.toLowerCase().startsWith(m.toLowerCase()) ? ref : [m, ref].filter(Boolean).join(' ')) || '—'; })()}</td>
                  <td className="px-3 py-1.5">
                    {e.kind === 'direct' ? (
                      <select value={bundle.directCosts.find((d) => d.id === e.id)?.key ?? ''}
                              onChange={(ev) => patchDirect.mutate({ id: e.id, patch: { key: ev.target.value || null } })}
                              className={`h-8 w-full max-w-[200px] rounded-md border border-input bg-background px-1 text-xs ${e.budgetLine === 'Unallocated' ? 'text-amber-800' : ''}`}>
                        <option value="">Unallocated</option>
                        {baseline.map((b) => <option key={b.key} value={b.key}>{b.description}</option>)}
                      </select>
                    ) : <span className="text-xs text-gray-500">Per pay app</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium">{money(e.amount)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{money(e.running)}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {docs.map((d) => (
                      <button key={d.id} title={d.originalName} onClick={() => openDocument(d.id)} className="text-blue-700 mr-1 align-middle">
                        <Paperclip className="h-3.5 w-3.5 inline" />
                      </button>
                    ))}
                    {e.kind === 'direct' && (
                      <>
                        {docs.length === 0 && (
                          <label className="text-gray-400 hover:text-blue-700 cursor-pointer mr-1 align-middle" title="Attach the receipt">
                            <Paperclip className="h-3.5 w-3.5 inline" />
                            <input type="file" className="hidden" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) attach.mutate({ file: f, id: e.id }); ev.target.value = ''; }} />
                          </label>
                        )}
                        <button className="text-gray-400 hover:text-red-700 align-middle" title="Remove"
                                onClick={() => { if (window.confirm(`Remove ${money(e.amount)} to ${e.vendor} from the ledger?`)) removeDirect.mutate(e.id); }}>
                          <Trash2 className="h-3.5 w-3.5 inline" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {entries.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-800 font-semibold">
                <td colSpan={6} className="px-3 py-2">{show === 'open' ? 'Not reconciled' : 'Total'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(entries.reduce((s, e) => s + e.amount, 0))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Contract payments come from the pay apps — record them there, or under Payments on the Position tab. Direct costs count
        as committed and spent on their budget line in Budget vs Actual the day they're entered.
      </p>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <div className={`space-y-1 ${wide ? 'col-span-2' : ''}`}><div className="text-xs text-gray-600">{label}</div>{children}</div>;
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="bg-white border rounded-md px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone || 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 tabular-nums">{sub}</div>}
    </div>
  );
}
