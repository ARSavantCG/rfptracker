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
import { CO_REASONS, reasonLabel, type BudgetCO } from '@shared/cost-budget-approval';
import { fmtMoneyText, fmtPctText } from '@shared/format';
import { MoneyInput, PercentInput } from './inputs';
import { money, signedMoney, projectKey, shortDate, todayIso, openReport, type ProjectBundle } from './types';

const num = (s: string | number) => {
  const v = parseFloat(String(s ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(v) ? v : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const NO_CONTRACT = '__none__';

type FormLine = { key: string; description: string; amount: string; tenantPct: string };
type Form = {
  id: string | null; number: string; title: string; date: string; status: BudgetCO['status'];
  billable: boolean; cmFee: boolean; contractId: string; lines: FormLine[];
  credit: string; cmOnAbsorbed: boolean; linked: boolean; reason: string;
  /** New change orders: vendor change orders picked in the form, priced from them. */
  vendorLinks: { contractCoId: number; pct: string }[]; fallbackKey: string;
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
  const totals = (id: string) => a.changeOrderTotals.find((t) => t.id === id)
    ?? { work: 0, tenantWork: 0, ourWork: 0, cm: 0, cmAbsorbed: 0, credit: 0, tenant: 0, absorbed: 0, total: 0 };

  const nextNumber = () => `CO-${String(cos.length + 1).padStart(2, '0')}`;
  const blank = (): Form => ({
    id: null, number: nextNumber(), title: '', date: todayIso(), status: 'pending', billable: true, cmFee: rate > 0,
    contractId: bundle.contracts.find((c) => c.bucket === 'contractor') ? String(bundle.contracts.find((c) => c.bucket === 'contractor')!.id) : NO_CONTRACT,
    lines: [{ key: '', description: '', amount: '', tenantPct: '100.00' }], credit: '', cmOnAbsorbed: false, linked: false, reason: 'tenant', vendorLinks: [], fallbackKey: '',
  });
  const edit = (co: BudgetCO): Form => ({
    id: co.id, number: co.number, title: co.title, date: co.date ?? todayIso(), status: co.status, billable: co.billable,
    cmFee: co.cmFee, contractId: NO_CONTRACT,
    lines: co.lines.map((l) => ({ key: l.key, description: l.description, amount: fmtMoneyText(String(l.amount)), tenantPct: fmtPctText(String(l.tenantPct ?? 100)) })),
    credit: co.credit ? fmtMoneyText(String(co.credit)) : '', cmOnAbsorbed: co.cmOnAbsorbed, linked: co.links.length > 0, reason: co.reason, vendorLinks: [], fallbackKey: '',
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
  const [pctDraft, setPctDraft] = useState<Record<string, string>>({});
  const coLines = (ccoId: number) => r2(bundle.sovLines.filter((l) => l.changeOrderId === ccoId).reduce((s, l) => s + l.scheduledValue, 0));
  const linkedIds = new Set(cos.flatMap((c) => c.links.map((l) => l.contractCoId)));
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
    const free = bundle.changeOrders.filter((c) => !linkedIds.has(c.id) && c.status !== 'void');
    // What each linked vendor change order put on this one (as priced), and what it is now.
    const priced = (ccoId: number) => r2(co.lines.filter((l) => l.fromCoId === ccoId).reduce((s, l) => s + l.amount, 0));
    const drift = co.links.some((l) => Math.abs(coLines(l.contractCoId) - priced(l.contractCoId)) >= 0.005);
    const setPct = (ccoId: number, v: string) => {
      const pct = num(v);
      if (co.links.find((l) => l.contractCoId === ccoId)?.pct === pct) return;
      run(() => apiRequest(`/api/cost-projects/${projectId}/budget-cos/${co.id}`, 'PATCH', {
        links: co.links.map((l) => ({ contractCoId: l.contractCoId, pct: l.contractCoId === ccoId ? pct : l.pct })),
      }), `${co.number}: tenant share ${pct.toFixed(2)}%`);
    };
    return (
      <tr className={`border-b last:border-0 ${co.status === 'void' ? 'opacity-50' : ''}`}>
        <td />
        <td colSpan={9} className="px-3 pb-2 pt-0 text-xs space-y-1"
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) upload(co.id, e.dataTransfer.files); }}>
          {co.links.length > 0 && (
            <table className="text-xs">
              <tbody>
                {co.links.map((l) => {
                  const cco = bundle.changeOrders.find((c) => c.id === l.contractCoId);
                  const amt = priced(l.contractCoId);
                  const live = coLines(l.contractCoId);
                  return (
                    <tr key={l.contractCoId}>
                      <td className="pr-3 py-0.5 text-gray-800">{contractName(l.contractId)} {cco?.number ?? '(removed)'}{cco?.title ? <span className="text-gray-500"> — {cco.title}</span> : null}</td>
                      <td className="pr-3 py-0.5 text-right tabular-nums">{money(amt)}
                        {Math.abs(live - amt) >= 0.005 && <span className="text-amber-800" title="The vendor's change order has changed since it was priced in"> → now {money(live)}</span>}</td>
                      <td className="pr-1 py-0.5 text-gray-500">Tenant pays</td>
                      <td className="pr-3 py-0.5"><PercentInput className="h-6 text-xs w-28" aria-label="Tenant pays"
                        value={pctDraft[`${co.id}:${l.contractCoId}`] ?? fmtPctText(String(l.pct))}
                        onValueChange={(v) => setPctDraft((d) => ({ ...d, [`${co.id}:${l.contractCoId}`]: v }))}
                        onBlur={(e) => { setPct(l.contractCoId, e.target.value); setPctDraft((d) => { const n = { ...d }; delete n[`${co.id}:${l.contractCoId}`]; return n; }); }} /></td>
                      <td className="pr-3 py-0.5 tabular-nums text-green-800">{money((amt * l.pct) / 100)}</td>
                      <td className="pr-3 py-0.5 tabular-nums text-red-800">{l.pct < 100 ? `absorbed ${money(amt - (amt * l.pct) / 100)}` : ''}</td>
                      <td className="py-0.5">
                        <button className="text-gray-400 hover:text-red-700 inline-flex items-center" title="Unlink (the vendor's change order stays on its contract)"
                                onClick={() => run(() => apiRequest(`/api/cost-projects/${projectId}/budget-cos/${co.id}`, 'PATCH', { unlinkCoId: l.contractCoId }), `${co.number}: unlinked`)}>
                          <Unlink className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
            {co.estimate != null && co.links.length > 0 && Math.abs(co.estimate - work) >= 0.005 && (
              <span className="text-gray-600">Estimate was {money(co.estimate)} ({signedMoney(r2(work - co.estimate))} with vendor prices)</span>
            )}
            {drift && (
              <button className="text-amber-800 hover:underline" title="Update this change order to the vendors' current amounts"
                      onClick={() => run(() => apiRequest(`/api/cost-projects/${projectId}/budget-cos/${co.id}`, 'PATCH', { resync: true }), `${co.number} re-priced`)}>
                Use the vendors' current prices
              </button>
            )}
            {linking === co.id ? (
              <span className="inline-flex items-center gap-1.5">
                <div className="w-96">
                  <Select value={linkTo || undefined} onValueChange={setLinkTo}>
                    <SelectTrigger className="h-7 text-xs data-[placeholder]:text-gray-900"><SelectValue placeholder="— choose —" /></SelectTrigger>
                    <SelectContent className="pm-scope">
                      {free.map((c) => <SelectItem key={`l${c.id}`} value={`l:${c.id}`}>Link {contractName(c.contractId)} {c.number}{c.title ? ` — ${c.title}` : ''} ({money(coLines(c.id))})</SelectItem>)}
                      {co.links.length === 0 && bundle.contracts.map((c) => <SelectItem key={`w${c.id}`} value={`w:${c.id}`}>Write this estimate onto {c.counterparty}</SelectItem>)}
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
                <Link2 className="h-3.5 w-3.5" /> {co.links.length ? 'Link another vendor change order' : 'Link a vendor change order'}
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
            {totals(co.id).tenantWork > 0.005 && (
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

  const fromVendors = !!form && form.vendorLinks.length > 0;
  const formWork = !form ? 0 : fromVendors ? r2(form.vendorLinks.reduce((s, v) => s + coLines(v.contractCoId), 0)) : r2(form.lines.reduce((s, l) => s + num(l.amount), 0));
  const formTenantWork = !form ? 0 : fromVendors
    ? r2(form.vendorLinks.reduce((s, v) => s + (coLines(v.contractCoId) * num(v.pct)) / 100, 0))
    : r2(form.lines.reduce((s, l) => s + (num(l.amount) * num(l.tenantPct)) / 100, 0));
  const formRate = form?.id ? (cos.find((c) => c.id === form.id)?.cmFeePct ?? rate) : rate;
  const formCm = form?.cmFee ? r2((formTenantWork * formRate) / 100) : 0;
  const formCmOurs = form?.cmFee && form.cmOnAbsorbed ? r2(((formWork - formTenantWork) * formRate) / 100) : 0;
  const formCredit = form ? num(form.credit) : 0;
  const formTenant = r2(formTenantWork + formCm - formCredit);
  const formOurs = r2(formWork - formTenantWork + formCredit + formCmOurs);
  const formLinesOk = form ? form.linked || fromVendors || (form.lines.filter((l) => num(l.amount)).every((l) => l.key) && form.lines.some((l) => num(l.amount))) : false;

  const submit = async () => {
    if (!form) return;
    const body = {
      number: form.number, title: form.title, date: form.date, status: form.status, billable: form.billable, cmFee: form.cmFee,
      credit: formCredit, cmOnAbsorbed: form.cmOnAbsorbed, reason: form.reason,
      // Lines priced from linked vendors are re-priced from them, not typed.
      ...(form.linked ? {} : { lines: form.lines.filter((l) => num(l.amount)).map((l) => ({ key: l.key, description: l.description, amount: num(l.amount), tenantPct: num(l.tenantPct) })) }),
      ...(form.id ? {} : fromVendors
        ? { vendorLinks: form.vendorLinks.map((v) => ({ contractCoId: v.contractCoId, pct: num(v.pct) })), fallbackKey: form.fallbackKey || null, lines: [] }
        : { contractId: form.contractId === NO_CONTRACT ? null : Number(form.contractId) }),
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
            Every change to the budget after it was set: why it happened, the vendors' change orders behind it, and who pays —
            the tenant (CM fee at {rate.toFixed(2)}% on their share) or {bundle.funding?.label ?? 'Supplemental Funding'}.
          </p>
        </div>
        {!form && <Button size="sm" onClick={() => setForm(blank())}><Plus className="h-3.5 w-3.5 mr-1" /> Change order</Button>}
      </div>

      {cos.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                <th className="px-3 py-1.5">No.</th><th className="px-3 py-1.5">For</th><th className="px-3 py-1.5">Date</th>
                <th className="px-3 py-1.5 text-right">Cost of work</th><th className="px-3 py-1.5 text-right">CM fee</th>
                <th className="px-3 py-1.5 text-right" title="Budget increase">Total</th>
                <th className="px-3 py-1.5 text-right">Tenant pays</th><th className="px-3 py-1.5 text-right">Absorbed</th>
                <th className="px-3 py-1.5 w-36">Status</th><th className="w-16" />
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
                      <div>{co.title || '—'} <span className="ml-1 text-[11px] font-medium text-gray-700 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">{reasonLabel(co.reason)}</span></div>
                      <div className="text-[11px] text-gray-600">
                        {co.lines.map((l) => `${name.get(l.key) ?? 'Removed line'} ${money(l.amount)}${(l.tenantPct ?? 100) !== 100 ? ` (tenant ${Number(l.tenantPct).toFixed(2)}%)` : ''}`).join(' · ')}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">{shortDate(co.date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{signedMoney(t.work)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{t.cm + t.cmAbsorbed ? signedMoney(t.cm + t.cmAbsorbed) : '—'}<div className="text-[10px] text-gray-500">{co.cmFee ? `${co.cmFeePct.toFixed(2)}%${t.cmAbsorbed ? ' · ours to capital partner' : ''}` : ''}</div></td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{signedMoney(t.total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-800">{t.tenant ? signedMoney(t.tenant) : '—'}
                      {t.credit ? <div className="text-[10px] text-gray-500">after {money(t.credit)} credit</div> : null}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${t.absorbed ? 'text-red-800' : ''}`}>{t.absorbed ? signedMoney(t.absorbed) : '—'}</td>
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
                <td colSpan={10} className="px-3 py-2">
                  <span className="font-semibold">Approved {signedMoney(a.coSummary.approved)}</span>
                  <span className="text-gray-600"> — tenant-funded {signedMoney(a.coSummary.approvedBillable)} · absorbed {signedMoney(a.coSummary.approvedAbsorbed)}</span>
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
          <div className="grid grid-cols-2 lg:grid-cols-7 gap-2">
            <Field label="No."><Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></Field>
            <Field label="For" wide><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Status">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as BudgetCO['status'] })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent className="pm-scope"><SelectItem value="pending">Pending</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="void">Void</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="Why">
              <Select value={form.reason} onValueChange={(v) => setForm({ ...form, reason: v })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent className="pm-scope">{CO_REASONS.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Tenant">
              <Select value={form.billable ? 'yes' : 'no'} disabled={form.linked}
                      onValueChange={(v) => setForm({ ...form, billable: v === 'yes', lines: form.lines.map((l) => ({ ...l, tenantPct: v === 'yes' ? '100.00' : '0.00' })) })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent className="pm-scope"><SelectItem value="yes">Billable to tenant (100.00%)</SelectItem><SelectItem value="no">Not billable — we absorb it (0.00%)</SelectItem></SelectContent>
              </Select>
            </Field>
          </div>

          {!form.id && (
            <div className="bg-white border rounded-md p-2 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="font-medium text-gray-800">Vendor change orders behind it</span>
                <span className="text-xs text-gray-500">— pick the GC's (or any vendor's) change order and the amounts come from it; nothing to type.</span>
              </div>
              {(() => {
                const picked = new Set(form.vendorLinks.map((v) => v.contractCoId));
                const free = bundle.changeOrders.filter((c) => c.status !== 'void' && !linkedIds.has(c.id) && !picked.has(c.id));
                return free.length ? (
                  <div className="w-[28rem]">
                    <Select value="" onValueChange={(v) => setForm({ ...form, vendorLinks: [...form.vendorLinks, { contractCoId: Number(v), pct: form.billable ? '100.00' : '0.00' }] })}>
                      <SelectTrigger className="h-8 text-xs data-[placeholder]:text-gray-900"><SelectValue placeholder="+ Link a vendor change order" /></SelectTrigger>
                      <SelectContent className="pm-scope">
                        {free.map((c) => <SelectItem key={c.id} value={String(c.id)}>{contractName(c.contractId)} {c.number}{c.title ? ` — ${c.title}` : ''} · {money(coLines(c.id))}{c.status === 'approved' ? ' · approved' : ' · pending'}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="text-xs text-gray-500">{bundle.changeOrders.length ? 'Every vendor change order is already linked.' : 'No vendor change orders yet — add them on the contract (Contracts tab), or type the amounts below as an estimate.'}</div>
                );
              })()}
            </div>
          )}

          <div className="bg-white border rounded-md overflow-x-auto">
            {fromVendors && (
              <div className="px-2 py-1.5 text-xs bg-violet-50 border-b text-violet-900 flex items-center gap-2 flex-wrap">
                Priced from the vendor change orders. Any vendor line not yet mapped to a budget line goes on:
                <div className="w-64">
                  <Select value={form.fallbackKey || undefined} onValueChange={(v) => setForm({ ...form, fallbackKey: v })}>
                    <SelectTrigger className="h-7 text-xs bg-white data-[placeholder]:text-gray-900"><SelectValue placeholder="— choose —" /></SelectTrigger>
                    <SelectContent className="pm-scope">{baseline.map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {form.linked && (
              <div className="px-2 py-1.5 text-xs bg-violet-50 border-b text-violet-900">
                Priced from the linked vendor change orders. Set each vendor's tenant share in the row under this change order; amounts follow the vendors.
              </div>
            )}
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b bg-gray-50">
                  <th className="px-2 py-1.5 w-72">Budget line</th><th className="px-2 py-1.5">Description</th>
                  <th className="px-2 py-1.5 w-40 text-right">Cost</th><th className="px-2 py-1.5 w-28 text-right" title="Share of this cost the tenant pays">Tenant %</th>
                  <th className="px-2 py-1.5 w-36 text-right">Tenant pays</th><th className="w-9" />
                </tr>
              </thead>
              <tbody>
                {fromVendors && form.vendorLinks.map((v, i) => {
                  const cco = bundle.changeOrders.find((c) => c.id === v.contractCoId);
                  const amt = coLines(v.contractCoId);
                  return (
                    <tr key={`v${v.contractCoId}`} className="border-b">
                      <td className="px-2 py-1.5 text-gray-900">{contractName(cco?.contractId ?? null)} {cco?.number}</td>
                      <td className="px-2 py-1.5 text-gray-600">{cco?.title || ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(amt)}</td>
                      <td className="px-1 py-1"><PercentInput className="h-8" value={v.pct} aria-label="Tenant %"
                        onValueChange={(val) => setForm({ ...form, vendorLinks: form.vendorLinks.map((x, j) => (j === i ? { ...x, pct: val } : x)) })} /></td>
                      <td className="px-2 py-1 text-right tabular-nums text-green-800">{money(r2((amt * num(v.pct)) / 100))}</td>
                      <td className="px-1 text-center">
                        <button className="p-1 text-gray-400 hover:text-red-700" title="Remove" onClick={() => setForm({ ...form, vendorLinks: form.vendorLinks.filter((_, j) => j !== i) })}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!fromVendors && form.lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-1 py-1">
                      <Select value={l.key || undefined} onValueChange={(v) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, key: v } : x)) })}>
                        <SelectTrigger className={`h-8 text-xs data-[placeholder]:text-gray-900 ${!l.key && num(l.amount) ? 'border-red-400' : ''}`}><SelectValue placeholder="— choose —" /></SelectTrigger>
                        <SelectContent className="pm-scope">{baseline.map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-1 py-1"><Input className="h-8" value={l.description} aria-label="Description"
                                                     onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} /></td>
                    <td className="px-1 py-1"><MoneyInput className="h-8" value={l.amount} aria-label="Amount" disabled={form.linked}
                                                          onValueChange={(v) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} /></td>
                    <td className="px-1 py-1"><PercentInput className="h-8" value={l.tenantPct} aria-label="Tenant %" disabled={form.linked}
                                                            onValueChange={(v) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, tenantPct: v } : x)) })} /></td>
                    <td className="px-2 py-1 text-right tabular-nums text-green-800">{money(r2((num(l.amount) * num(l.tenantPct)) / 100))}</td>
                    <td className="px-1 text-center">
                      <button className="p-1 text-gray-400 hover:text-red-700 disabled:opacity-30" disabled={form.linked} title="Remove" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                <tr className="border-t"><td colSpan={2} className="px-2 py-1">Cost of work</td>
                  <td className="px-2 py-1 text-right tabular-nums">{signedMoney(formWork)}</td><td />
                  <td className="px-2 py-1 text-right tabular-nums text-green-800">{signedMoney(formTenantWork)}</td><td /></tr>
                <tr>
                  <td colSpan={2} className="px-2 py-1">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={form.cmFee} onChange={(e) => setForm({ ...form, cmFee: e.target.checked })} />
                      CM fee at {formRate.toFixed(2)}% on the tenant's share
                    </label>
                  </td>
                  <td colSpan={2} /><td className="px-2 py-1 text-right tabular-nums text-green-800">{signedMoney(formCm)}</td><td />
                </tr>
                {form.cmFee && formWork - formTenantWork > 0.005 && (
                  <tr>
                    <td colSpan={2} className="px-2 py-1">
                      <span className="inline-flex items-center gap-2">CM fee on our share
                        <Select value={form.cmOnAbsorbed ? 'cp' : 'none'} onValueChange={(v) => setForm({ ...form, cmOnAbsorbed: v === 'cp' })}>
                          <SelectTrigger className="h-7 w-56 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent className="pm-scope"><SelectItem value="none">Not charged</SelectItem><SelectItem value="cp">Charged to capital partner</SelectItem></SelectContent>
                        </Select>
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{formCmOurs ? signedMoney(formCmOurs) : '—'}</td><td colSpan={3} />
                  </tr>
                )}
                <tr>
                  <td colSpan={2} className="px-2 py-1">Credit to the tenant <span className="text-[11px] text-gray-500">a concession we absorb</span></td>
                  <td colSpan={2} />
                  <td className="px-1 py-1"><MoneyInput className="h-8" value={form.credit} aria-label="Credit to the tenant" onValueChange={(v) => setForm({ ...form, credit: v })} /></td><td />
                </tr>
                <tr className="border-t-2 border-gray-800 font-semibold">
                  <td colSpan={2} className="px-2 py-1.5">Budget increase <span className="font-normal text-gray-600">· tenant pays {money(formTenant)} · we absorb {money(formOurs)}</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{signedMoney(r2(formWork + formCm + formCmOurs))}</td><td />
                  <td className="px-2 py-1.5 text-right tabular-nums text-green-800">{signedMoney(formTenant)}</td><td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div className="flex items-end gap-3 flex-wrap">
              <Button size="sm" variant="outline" className="h-9" disabled={form.linked || fromVendors} onClick={() => setForm({ ...form, lines: [...form.lines, { key: '', description: '', amount: '', tenantPct: form.billable ? '100.00' : '0.00' }] })}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Line
              </Button>
              {!form.id && !fromVendors && bundle.contracts.length > 0 && (
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
