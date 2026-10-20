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
import { Printer, Plus, Trash2, Paperclip, Upload, Pencil } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MoneyInput } from './inputs';
import { openDocument } from './contract-card';
import { money, shortDate, todayIso, openReport, projectKey, PAY_METHODS, type ProjectBundle } from './types';

const METHOD = Object.fromEntries(PAY_METHODS);
const blank = () => ({ date: todayIso(), vendor: '', description: '', amount: '', method: 'card', reference: '', key: '', notes: '' });
const NONE = '__none__';
/** Files dragged in — from the desktop, a folder, or an email attachment. */
const droppedFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.files ?? []);
const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

export function LedgerView({ bundle, projectId }: { bundle: ProjectBundle; projectId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
  const [show, setShow] = useState<'all' | 'open'>('all');
  const [form, setForm] = useState<ReturnType<typeof blank> | null>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [dragPanel, setDragPanel] = useState(false);
  const [noteEdit, setNoteEdit] = useState<{ id: number; text: string } | null>(null);

  const L = bundle.ledger;
  const baseline = bundle.project.baseline;
  const entries = useMemo(() => (show === 'open' ? L.entries.filter((e) => !e.reconciled) : L.entries), [L.entries, show]);
  const receiptsFor = (id: number) => bundle.documents.filter((d) => d.directCostId === id);
  const paymentDocs = (paymentId: number) => {
    const p = bundle.payments.find((x) => x.id === paymentId);
    return p?.applicationId ? bundle.documents.filter((d) => d.applicationId === p.applicationId) : [];
  };

  const fail = (title: string) => (e: any) => toast({ title, description: e?.message, variant: 'destructive' });
  type Target = { directCostId: number } | { applicationId: number; contractId: number };
  const upload = async (file: File, t: Target) => {
    const fd = new FormData();
    fd.append('file', file);
    Object.entries(t).forEach(([k, v]) => fd.append(k, String(v)));
    await apiRequest(`/api/cost-projects/${projectId}/documents`, 'POST', fd, 120_000);
  };
  /** Where a file dropped on a ledger row belongs: the charge, or the pay app the payment was for. */
  const targetFor = (kind: 'payment' | 'direct', id: number): Target | null => {
    if (kind === 'direct') return { directCostId: id };
    const p = bundle.payments.find((x) => x.id === id);
    return p?.applicationId ? { applicationId: p.applicationId, contractId: p.contractId } : null;
  };
  const add = useMutation({
    mutationFn: async () => {
      const row: any = await apiRequest(`/api/cost-projects/${projectId}/direct-costs`, 'POST', { ...form, amount: form!.amount.replace(/,/g, ''), key: form!.key || null });
      if (receipt) await upload(receipt, { directCostId: row.id });
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
  const removePayment = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/cost-payments/${id}`, 'DELETE'),
    onSuccess: () => { refresh(); toast({ title: 'Payment removed' }); }, onError: fail('Not removed'),
  });
  const removeDirect = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/cost-direct-costs/${id}`, 'DELETE'),
    onSuccess: refresh, onError: fail('Not removed'),
  });
  const attach = useMutation({
    mutationFn: async ({ files, target }: { files: File[]; target: Target }) => { for (const f of files) await upload(f, target); return files.length; },
    onSuccess: (n: number) => { refresh(); toast({ title: n === 1 ? 'Receipt saved' : `${n} files saved` }); }, onError: fail('Receipt not saved'),
  });

  const print = async () => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (!(await openReport(`/api/reports/job-cost-ledger/${projectId}${q.toString() ? `?${q}` : ''}`))) toast({ title: 'Report failed', variant: 'destructive' });
  };

  return (
    <div className={`space-y-4 rounded-lg ${dragPanel ? 'ring-2 ring-blue-400 ring-offset-4' : ''}`}
         onDragOver={(e) => { if (isFileDrag(e)) { e.preventDefault(); setDragPanel(true); } }}
         onDragLeave={(e) => { if (e.currentTarget === e.target) setDragPanel(false); }}
         onDrop={(e) => {
           // Dropped anywhere but on an entry: start a new charge with it as the receipt.
           if (!isFileDrag(e)) return;
           e.preventDefault(); setDragPanel(false); setDragRow(null);
           const f = droppedFiles(e)[0];
           if (!f) return;
           setForm((cur) => cur ?? blank());
           setReceipt(f);
         }}>
      <div className={`border-2 border-dashed rounded-md px-3 py-2 text-xs flex items-center gap-2 ${dragPanel ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-gray-300 text-gray-600'}`}>
        <Upload className="h-4 w-4 flex-shrink-0" />
        <span>Drag a receipt here — from your desktop or straight out of an email — to start a new charge with it attached.
        Drop it on a line below to attach it to that line instead.</span>
      </div>
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
            <Field label="Paid to" wide><Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></Field>
            <Field label="For" wide><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Amount"><MoneyInput value={form.amount} onValueChange={(v) => setForm({ ...form, amount: v })} /></Field>
            <Field label="How">
              <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}
                      className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                {PAY_METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Card last 4 / check #"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
            <Field label="Budget line" wide>
              <Select value={form.key || NONE} onValueChange={(v) => setForm({ ...form, key: v === NONE ? '' : v })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unallocated — choose later</SelectItem>
                  {baseline.map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Receipt" wide>
              <label className="h-10 flex items-center gap-2 text-sm text-blue-700 cursor-pointer border rounded-md px-2 truncate">
                <Paperclip className="h-4 w-4 flex-shrink-0" /> <span className="truncate">{receipt ? receipt.name : 'Attach or drop a file'}</span>
                <input type="file" className="hidden" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
              </label>
            </Field>
            <div className="col-span-2 lg:col-span-6 space-y-1">
              <div className="text-xs text-gray-600">Notes</div>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
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
                <tr key={`${e.kind}-${e.id}`}
                    className={`border-b last:border-0 ${dragRow === `${e.kind}-${e.id}` ? 'bg-blue-100 outline outline-2 outline-blue-400' : e.reconciled ? '' : 'bg-amber-50/40'}`}
                    onDragOver={(ev) => { if (isFileDrag(ev) && targetFor(e.kind, e.id)) { ev.preventDefault(); ev.stopPropagation(); setDragRow(`${e.kind}-${e.id}`); setDragPanel(false); } }}
                    onDragLeave={() => setDragRow((r) => (r === `${e.kind}-${e.id}` ? null : r))}
                    onDrop={(ev) => {
                      const t = targetFor(e.kind, e.id);
                      if (!isFileDrag(ev) || !t) return;
                      ev.preventDefault(); ev.stopPropagation(); setDragRow(null); setDragPanel(false);
                      const files = droppedFiles(ev);
                      if (files.length) attach.mutate({ files, target: t });
                    }}>
                  <td className="px-3 py-1.5">
                    <input type="checkbox" className="h-4 w-4 accent-green-600" checked={e.reconciled} title="Reconciled against the statement"
                           onChange={(ev) => (e.kind === 'direct'
                             ? patchDirect.mutate({ id: e.id, patch: { reconciled: ev.target.checked } })
                             : patchPayment.mutate({ id: e.id, patch: { reconciled: ev.target.checked } }))} />
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{shortDate(e.date)}</td>
                  <td className="px-3 py-1.5">{e.vendor}</td>
                  <td className="px-3 py-1.5 text-gray-700">
                    <div>{e.description}</div>
                    {e.kind === 'direct' && (noteEdit?.id === e.id ? (
                      <div className="flex gap-1 mt-1">
                        <Input autoFocus className="h-7 text-xs" value={noteEdit.text} aria-label="Note"
                               onChange={(ev) => setNoteEdit({ id: e.id, text: ev.target.value })}
                               onKeyDown={(ev) => {
                                 if (ev.key === 'Enter') { patchDirect.mutate({ id: e.id, patch: { notes: noteEdit.text } }); setNoteEdit(null); }
                                 if (ev.key === 'Escape') setNoteEdit(null);
                               }} />
                        <Button size="sm" className="h-7 px-2 text-xs" onClick={() => { patchDirect.mutate({ id: e.id, patch: { notes: noteEdit.text } }); setNoteEdit(null); }}>Save</Button>
                      </div>
                    ) : (() => {
                      const note = bundle.directCosts.find((d) => d.id === e.id)?.notes;
                      return (
                        <button className="mt-0.5 text-[11px] text-gray-600 hover:text-blue-700 inline-flex items-center gap-1 text-left"
                                onClick={() => setNoteEdit({ id: e.id, text: note || '' })}>
                          <Pencil className="h-3 w-3 flex-shrink-0" />{note ? <span className="italic">{note}</span> : 'Add note'}
                        </button>
                      );
                    })())}
                  </td>
                  <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{(() => { const m = e.method ? METHOD[e.method] : ''; const ref = e.reference || ''; return (m && ref.toLowerCase().startsWith(m.toLowerCase()) ? ref : [m, ref].filter(Boolean).join(' ')) || '—'; })()}</td>
                  <td className="px-3 py-1.5">
                    {e.kind === 'direct' ? (
                      <Select value={(() => { const k = bundle.directCosts.find((d) => d.id === e.id)?.key; return k && baseline.some((b) => b.key === k) ? k : NONE; })()}
                              onValueChange={(v) => patchDirect.mutate({ id: e.id, patch: { key: v === NONE ? null : v } }, {
                                onSuccess: () => toast({ title: 'Budget line saved', description: v === NONE ? 'Unallocated' : baseline.find((b) => b.key === v)?.description }),
                              })}>
                        <SelectTrigger className={`h-8 w-full max-w-[220px] text-xs ${e.budgetLine === 'Unallocated' ? 'text-amber-800' : ''}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Unallocated</SelectItem>
                          {baseline.map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}
                        </SelectContent>
                      </Select>
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
                            <input type="file" className="hidden" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) attach.mutate({ files: [f], target: { directCostId: e.id } }); ev.target.value = ''; }} />
                          </label>
                        )}
                        <button className="text-gray-400 hover:text-red-700 align-middle" title="Remove"
                                onClick={() => { if (window.confirm(`Remove ${money(e.amount)} to ${e.vendor} from the ledger?`)) removeDirect.mutate(e.id); }}>
                          <Trash2 className="h-3.5 w-3.5 inline" />
                        </button>
                      </>
                    )}
                    {e.kind === 'payment' && (
                      <button className="text-gray-400 hover:text-red-700 align-middle" title="Remove this payment"
                              onClick={() => { if (window.confirm(`Remove the ${money(e.amount)} payment to ${e.vendor} (${e.description})? The pay app stays; only the payment record goes.`)) removePayment.mutate(e.id); }}>
                        <Trash2 className="h-3.5 w-3.5 inline" />
                      </button>
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
