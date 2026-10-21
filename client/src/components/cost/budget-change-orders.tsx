/**
 * Change orders to the budget — written once the budget is set, for scope
 * the tenant adds (billable, with the CM fee on top) or scope we have to
 * absorb (not billable). Approved ones raise the budget; pending ones are
 * shown as exposure. Optionally writes the matching change order on a
 * contract, so the contractor side and the budget side start in step.
 */
import { Fragment, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Plus, Trash2, Pencil, Paperclip, Link2, Printer, Unlink } from 'lucide-react';
import { openDocument } from './contract-card';
import type { BudgetCO } from '@shared/cost-budget-approval';
import { fmtMoneyText } from '@shared/format';
import { MoneyInput } from './inputs';
import { money, signedMoney, projectKey, shortDate, todayIso, openReport, type ProjectBundle } from './types';

const num = (s: string | number) => {
  const v = parseFloat(String(s ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(v) ? v : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const NO_CONTRACT = '__none__';

type FormLine = { key: string; description: string; amount: string };
type Form = {
  id: string | null; number: string; title: string; date: string; status: BudgetCO['status'];
  billable: boolean; cmFee: boolean; contractId: string; lines: FormLine[];
};

export function BudgetChangeOrders({ bundle, projectId }: { bundle: ProjectBundle; projectId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const a = bundle.approval;
  const cos = a.changeOrders;
  const baseline = bundle.project.baseline;
  const rate = bundle.cmSettings.pct;
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const name = useMemo(() => new Map(baseline.map((b) => [b.key, b.description])), [baseline]);
  const totals = (id: string) => a.changeOrderTotals.find((t) => t.id === id) ?? { work: 0, cm: 0, total: 0 };

  const nextNumber = () => `CO-${String(cos.length + 1).padStart(2, '0')}`;
  const blank = (): Form => ({
    id: null, number: nextNumber(), title: '', date: todayIso(), status: 'pending', billable: true, cmFee: rate > 0,
    contractId: bundle.contracts.find((c) => c.bucket === 'contractor') ? String(bundle.contracts.find((c) => c.bucket === 'contractor')!.id) : NO_CONTRACT,
    lines: [{ key: '', description: '', amount: '' }],
  });
  const edit = (co: BudgetCO): Form => ({
    id: co.id, number: co.number, title: co.title, date: co.date ?? todayIso(), status: co.status, billable: co.billable,
    cmFee: co.cmFee, contractId: NO_CONTRACT, lines: co.lines.map((l) => ({ key: l.key, description: l.description, amount: fmtMoneyText(String(l.amount)) })),
  });

  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try {
      const data = await fn();
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: ok });
      return true;
    } catch (e: any) {
      toast({ title: 'Not saved', description: e?.message, variant: 'destructive' });
      return false;
    } finally { setBusy(false); }
  };

  // ---- the contractor's side and the backup, under each change order
  const [linking, setLinking] = useState<string | null>(null);
  const [linkTo, setLinkTo] = useState('');
  const coLines = (ccoId: number) => r2(bundle.sovLines.filter((l) => l.changeOrderId === ccoId).reduce((s, l) => s + l.scheduledValue, 0));
  const linkedIds = new Set(cos.map((c) => c.contractCoId).filter(Boolean) as number[]);
  const contractName = (id: number | null) => bundle.contracts.find((c) => c.id === id)?.counterparty ?? 'a contract';
  const upload = async (coId: string, files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('budgetCoId', coId);
      try { await apiRequest(`/api/cost-projects/${projectId}/documents`, 'POST', fd, 120_000); }
      catch (e: any) { toast({ title: `${f.name} not attached`, description: e?.message, variant: 'destructive' }); }
    }
    queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
  };
  const removeDoc = async (id: number, name: string) => {
    if (!window.confirm(`Remove ${name} from this change order?`)) return;
    try { await apiRequest(`/api/cost-documents/${id}`, 'DELETE'); queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] }); }
    catch (e: any) { toast({ title: 'Not removed', description: e?.message, variant: 'destructive' }); }
  };
  // Called as a function, not a component, so the row keeps its state across re-renders.
  const coExtras = (co: BudgetCO, work: number) => {
    const docs = bundle.documents.filter((d) => d.budgetCoId === co.id);
    const pco = co.contractCoId ? bundle.changeOrders.find((c) => c.id === co.contractCoId) : null;
    const pcoAmt = co.contractCoId ? coLines(co.contractCoId) : 0;
    const diff = r2(pcoAmt - work);
    const free = bundle.changeOrders.filter((c) => !linkedIds.has(c.id) && c.status !== 'void');
    return (
      <tr className={`border-b last:border-0 ${co.status === 'void' ? 'opacity-50' : ''}`}>
        <td />
        <td colSpan={8} className="px-3 pb-2 pt-0 text-xs">
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap"
               onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) upload(co.id, e.dataTransfer.files); }}>
            <span className="text-gray-500">Contractor:</span>
            {co.contractCoId ? (
              <span className="inline-flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-gray-800">{contractName(co.contractId)} {pco?.number ?? ''}</span>
                <span className="tabular-nums">{money(pcoAmt)}</span>
                {Math.abs(diff) >= 0.005 && (
                  <span className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5" title="The budget change order is your estimate; edit its lines to match the contractor's price if you want the budget to follow.">
                    Estimate {money(work)} → contractor {money(pcoAmt)} ({signedMoney(diff)})
                  </span>
                )}
                <button className="text-gray-400 hover:text-red-700 inline-flex items-center" title="Unlink (the contractor's change order stays on the contract)"
                        onClick={() => run(() => apiRequest(`/api/cost-projects/${projectId}/budget-cos/${co.id}`, 'PATCH', { unlink: true }), `${co.number} unlinked`)}>
                  <Unlink className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : linking === co.id ? (
              <span className="inline-flex items-center gap-1.5">
                <div className="w-80">
                  <Select value={linkTo || undefined} onValueChange={setLinkTo}>
                    <SelectTrigger className="h-7 text-xs data-[placeholder]:text-gray-900"><SelectValue placeholder="— choose —" /></SelectTrigger>
                    <SelectContent className="pm-scope">
                      {bundle.contracts.map((c) => <SelectItem key={`w${c.id}`} value={`w:${c.id}`}>Write it onto {c.counterparty} (same amounts)</SelectItem>)}
                      {free.map((c) => <SelectItem key={`l${c.id}`} value={`l:${c.id}`}>Link {contractName(c.contractId)} {c.number}{c.title ? ` — ${c.title}` : ''} ({money(coLines(c.id))})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" className="h-7" disabled={!linkTo} onClick={async () => {
                  const [k, v] = linkTo.split(':');
                  const ok = await run(() => apiRequest(`/api/cost-projects/${projectId}/budget-cos/${co.id}`, 'PATCH', k === 'w' ? { writeContractId: Number(v) } : { linkContractCoId: Number(v) }), `${co.number} linked`);
                  if (ok) { setLinking(null); setLinkTo(''); }
                }}>Link</Button>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => { setLinking(null); setLinkTo(''); }}>Cancel</Button>
              </span>
            ) : (
              <button className="text-blue-700 hover:underline inline-flex items-center gap-1" onClick={() => { setLinking(co.id); setLinkTo(''); }}>
                <Link2 className="h-3.5 w-3.5" /> {bundle.contracts.length ? 'Add the contractor\'s price' : 'Not on a contract yet'}
              </button>
            )}
            <span className="text-gray-500">Backup:</span>
            {docs.map((d) => (
              <span key={d.id} className="inline-flex items-center gap-1">
                <button className="text-blue-700 hover:underline" onClick={() => openDocument(d.id)}>{d.originalName}</button>
                <button className="text-gray-400 hover:text-red-700" title="Remove" onClick={() => removeDoc(d.id, d.originalName)}><Trash2 className="h-3 w-3" /></button>
              </span>
            ))}
            <label className="inline-flex items-center gap-1 text-blue-700 hover:underline cursor-pointer" title="Attach the PCO, a quote or an email — or drop files on this row">
              <Paperclip className="h-3.5 w-3.5" /> Attach
              <input type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) upload(co.id, e.target.files); e.target.value = ''; }} />
            </label>
            {co.billable && (
              <button className="text-blue-700 hover:underline inline-flex items-center gap-1 ml-auto"
                      onClick={async () => { if (!(await openReport(`/api/reports/tenant-co/${projectId}?co=${encodeURIComponent(co.id)}`))) toast({ title: 'Report failed', variant: 'destructive' }); }}>
                <Printer className="h-3.5 w-3.5" /> Tenant change order
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  const formWork = form ? r2(form.lines.reduce((s, l) => s + num(l.amount), 0)) : 0;
  const formRate = form?.id ? (cos.find((c) => c.id === form.id)?.cmFeePct ?? rate) : rate;
  const formCm = form?.cmFee ? r2((formWork * formRate) / 100) : 0;
  const formLinesOk = form ? form.lines.filter((l) => num(l.amount)).every((l) => l.key) && form.lines.some((l) => num(l.amount)) : false;

  const submit = async () => {
    if (!form) return;
    const body = {
      number: form.number, title: form.title, date: form.date, status: form.status, billable: form.billable, cmFee: form.cmFee,
      lines: form.lines.filter((l) => num(l.amount)).map((l) => ({ key: l.key, description: l.description, amount: num(l.amount) })),
      ...(form.id ? {} : { contractId: form.contractId === NO_CONTRACT ? null : Number(form.contractId) }),
    };
    const ok = await run(
      () => (form.id
        ? apiRequest(`/api/cost-projects/${projectId}/budget-cos/${form.id}`, 'PATCH', body)
        : apiRequest(`/api/cost-projects/${projectId}/budget-cos`, 'POST', body)),
      form.id ? `${form.number} saved` : `${form.number} added${form.contractId !== NO_CONTRACT ? ' — and to the contract' : ''}`,
    );
    if (ok) setForm(null);
  };

  return (
    <div className="bg-white border rounded-lg">
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-gray-900">Budget change orders</h2>
          <p className="text-xs text-gray-600 mt-0.5">
            Scope added after the budget is set. Billable ones are what you send the tenant (CM fee at {rate.toFixed(2)}% on top);
            ones the tenant can't be billed for still raise the budget, as outstanding share.
          </p>
        </div>
        {!form && <Button size="sm" onClick={() => setForm(blank())}><Plus className="h-3.5 w-3.5 mr-1" /> Change order</Button>}
      </div>

      {cos.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                <th className="px-3 py-1.5">No.</th><th className="px-3 py-1.5">For</th><th className="px-3 py-1.5">Date</th>
                <th className="px-3 py-1.5">Tenant</th><th className="px-3 py-1.5 text-right">Work</th><th className="px-3 py-1.5 text-right">CM fee</th>
                <th className="px-3 py-1.5 text-right">Total</th><th className="px-3 py-1.5 w-36">Status</th><th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {cos.map((co) => {
                const t = totals(co.id);
                return (
                  <Fragment key={co.id}>
                  <tr className={`align-top ${co.status === 'void' ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{co.number}</td>
                    <td className="px-3 py-2">
                      <div>{co.title || '—'}</div>
                      <div className="text-[11px] text-gray-600">
                        {co.lines.map((l) => `${name.get(l.key) ?? 'Removed line'} ${money(l.amount)}`).join(' · ')}
                        {co.contractCoId ? ` · on ${bundle.contracts.find((c) => c.id === co.contractId)?.counterparty ?? 'a contract'}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">{shortDate(co.date)}</td>
                    <td className="px-3 py-2">
                      {co.billable
                        ? <span className="text-xs font-medium text-green-800 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">Billable</span>
                        : <span className="text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">Not billable</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{signedMoney(t.work)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{t.cm ? `${signedMoney(t.cm)}` : '—'}<div className="text-[10px] text-gray-500">{co.cmFee ? `${co.cmFeePct.toFixed(2)}%` : ''}</div></td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{signedMoney(t.total)}</td>
                    <td className="px-3 py-2">
                      <Select value={co.status} onValueChange={(v) => run(() => apiRequest(`/api/cost-projects/${projectId}/budget-cos/${co.id}`, 'PATCH', { status: v }), `${co.number} ${v}`)}>
                        <SelectTrigger className={`h-8 text-xs ${co.status === 'approved' ? 'text-green-800' : co.status === 'pending' ? 'text-amber-800' : 'text-gray-500'}`}><SelectValue /></SelectTrigger>
                        <SelectContent className="pm-scope">
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="void">Void</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <button className="p-1 text-gray-400 hover:text-blue-700" title="Edit" onClick={() => setForm(edit(co))}><Pencil className="h-4 w-4" /></button>
                      <button className="p-1 text-gray-400 hover:text-red-700" title="Delete"
                              onClick={() => {
                                if (!window.confirm(`Delete ${co.number}?${co.contractCoId ? ' The change order written on the contract stays — delete it there if it should go too.' : ''}`)) return;
                                run(() => apiRequest(`/api/cost-projects/${projectId}/budget-cos/${co.id}`, 'DELETE'), `${co.number} deleted`);
                              }}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                  {coExtras(co, t.work)}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-800 text-sm">
                <td colSpan={9} className="px-3 py-2">
                  <span className="font-semibold">Approved {signedMoney(a.coSummary.approved)}</span>
                  <span className="text-gray-600"> — billable {signedMoney(a.coSummary.approvedBillable)} · not billable {signedMoney(a.coSummary.approvedAbsorbed)}</span>
                  {a.coSummary.pending !== 0 && <span className="text-amber-800"> · pending {signedMoney(a.coSummary.pending)}</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {cos.length === 0 && !form && <p className="px-4 py-3 text-sm text-gray-600">None yet.</p>}

      {form && (
        <div className="p-4 space-y-3 bg-blue-50/30 border-t">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
            <Field label="No."><Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></Field>
            <Field label="For" wide><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Status">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as BudgetCO['status'] })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent className="pm-scope"><SelectItem value="pending">Pending</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="void">Void</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="Tenant">
              <Select value={form.billable ? 'yes' : 'no'} onValueChange={(v) => setForm({ ...form, billable: v === 'yes' })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent className="pm-scope"><SelectItem value="yes">Billable to tenant</SelectItem><SelectItem value="no">Not billable — we absorb it</SelectItem></SelectContent>
              </Select>
            </Field>
          </div>

          <div className="bg-white border rounded-md overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b bg-gray-50">
                  <th className="px-2 py-1.5 w-72">Budget line</th><th className="px-2 py-1.5">Description</th>
                  <th className="px-2 py-1.5 w-40 text-right">Amount</th><th className="w-9" />
                </tr>
              </thead>
              <tbody>
                {form.lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-1 py-1">
                      <Select value={l.key || undefined} onValueChange={(v) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, key: v } : x)) })}>
                        <SelectTrigger className={`h-8 text-xs data-[placeholder]:text-gray-900 ${!l.key && num(l.amount) ? 'border-red-400' : ''}`}><SelectValue placeholder="— choose —" /></SelectTrigger>
                        <SelectContent className="pm-scope">{baseline.map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-1 py-1"><Input className="h-8" value={l.description} aria-label="Description"
                                                     onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} /></td>
                    <td className="px-1 py-1"><MoneyInput className="h-8" value={l.amount} aria-label="Amount"
                                                          onValueChange={(v) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} /></td>
                    <td className="px-1 text-center">
                      <button className="p-1 text-gray-400 hover:text-red-700" title="Remove" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                <tr className="border-t"><td colSpan={2} className="px-2 py-1">Cost of work</td><td className="px-2 py-1 text-right tabular-nums">{signedMoney(formWork)}</td><td /></tr>
                <tr>
                  <td colSpan={2} className="px-2 py-1">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={form.cmFee} onChange={(e) => setForm({ ...form, cmFee: e.target.checked })} />
                      CM fee at {formRate.toFixed(2)}%
                    </label>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{signedMoney(formCm)}</td><td />
                </tr>
                <tr className="border-t-2 border-gray-800 font-semibold">
                  <td colSpan={2} className="px-2 py-1.5">Change order total {form.billable ? '(to the tenant)' : '(absorbed)'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{signedMoney(r2(formWork + formCm))}</td><td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div className="flex items-end gap-3 flex-wrap">
              <Button size="sm" variant="outline" className="h-9" onClick={() => setForm({ ...form, lines: [...form.lines, { key: '', description: '', amount: '' }] })}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Line
              </Button>
              {!form.id && bundle.contracts.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-gray-600">Also write it on a contract (cost of work only — the CM fee is ours)</div>
                  <Select value={form.contractId} onValueChange={(v) => setForm({ ...form, contractId: v })}>
                    <SelectTrigger className="h-9 w-72"><SelectValue /></SelectTrigger>
                    <SelectContent className="pm-scope">
                      <SelectItem value={NO_CONTRACT}>No — budget only</SelectItem>
                      {bundle.contracts.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.counterparty}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
              <Button size="sm" disabled={busy || !formLinesOk || !form.number.trim()} onClick={submit}>{busy ? 'Saving…' : form.id ? 'Save change order' : 'Add change order'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <div className={`space-y-1 ${wide ? 'col-span-2' : ''}`}><div className="text-xs text-gray-600">{label}</div>{children}</div>;
}
