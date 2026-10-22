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
import { Plus, Trash2, Pencil, Paperclip, Link2, Printer, Unlink, ChevronDown, ChevronRight } from 'lucide-react';
import { useRolled } from '@/hooks/use-rolled';
import { openDocument } from './contract-card';
import { CO_REASONS, CO_UNASSIGNED_KEY, reasonLabel, defaultMarkups, type BudgetCO } from '@shared/cost-budget-approval';
import { fmtMoneyText, fmtPctText } from '@shared/format';
import { MoneyInput, PercentInput, SharePercentInput } from './inputs';
import { money, signedMoney, projectKey, shortDate, todayIso, openReport, type ProjectBundle, type SovLineRow } from './types';

const num = (s: string | number) => {
  const v = parseFloat(String(s ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(v) ? v : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const NO_CONTRACT = '__none__';

type FormLine = { key: string; description: string; amount: string; tenantPct: string; fromCoId?: number | null };
type Form = {
  id: string | null; number: string; title: string; date: string; status: BudgetCO['status'];
  billable: boolean; cmFee: boolean; contractId: string; lines: FormLine[];
  credit: string; cmOnAbsorbed: boolean; linked: boolean; reason: string;
  /** New change orders: vendor change orders picked in the form, priced from them. */
  vendorLinks: { contractCoId: number; pct: string }[]; fallbackKey: string;
  /** The tenant's markups (the LAF's % lines), on their share of the cost. */
  markups: { key: string; label: string; pct: string; amount: string }[];
  /** Rates on this change order (default: the project's), and the tenant fee typed as an amount. */
  tenantRate: string; partnerRate: string; cmFeeAmount: string;
  /** CM fee to the capital partner: on all the work, only the tenant's share, or none. */
  partnerFee: boolean;
  partnerFeeBasis: 'all' | 'tenant' | 'absorbed';
  /** Where the part we absorb is paid from inside the budget; the rest is new (supplemental) money. */
  fundedFrom: { key: string; amount: string }[];
};

export function BudgetChangeOrders({ bundle, projectId }: { bundle: ProjectBundle; projectId: number }) {
  const [rolled, toggleRolled] = useRolled(`pm-rolled-budget-cos-${projectId}`);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const a = bundle.approval;
  const cos = a.changeOrders;
  const baseline = bundle.project.baseline;
  /** The capital partner's CM fee rate, and the tenant's (they can differ). */
  const rate = bundle.cmSettings.pct;
  const tenantRate = bundle.cmSettings.tenantPct ?? rate;
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const name = useMemo(() => new Map([...baseline.map((b) => [b.key, b.description] as [string, string]), [CO_UNASSIGNED_KEY, 'Unassigned'] as [string, string]]), [baseline]);
  const totals = (id: string) => a.changeOrderTotals.find((t) => t.id === id)
    ?? { id, work: 0, tenantWork: 0, ourWork: 0, markups: 0, markupLines: [], cm: 0, cmAbsorbed: 0, partnerFee: 0, credit: 0, tenant: 0, absorbed: 0, total: 0, funded: 0, budgetIncrease: 0 };

  const nextNumber = () => `CO-${String(cos.length + 1).padStart(2, '0')}`;
  const blank = (): Form => ({
    id: null, number: nextNumber(), title: '', date: todayIso(), status: 'pending', billable: true, cmFee: rate > 0,
    contractId: bundle.contracts.find((c) => c.bucket === 'contractor') ? String(bundle.contracts.find((c) => c.bucket === 'contractor')!.id) : NO_CONTRACT,
    lines: [{ key: '', description: '', amount: '', tenantPct: '100.00' }], credit: '', cmOnAbsorbed: false, linked: false, reason: 'tenant', vendorLinks: [], fallbackKey: '',
    markups: defaultMarkups(baseline, bundle.cmSettings.key).map((m) => ({ ...m, pct: fmtPctText(String(m.pct)), amount: '' })), partnerFee: true, partnerFeeBasis: 'absorbed', fundedFrom: [],
    tenantRate: fmtPctText(String(tenantRate)), partnerRate: fmtPctText(String(rate)), cmFeeAmount: '',
  });
  const edit = (co: BudgetCO): Form => ({
    id: co.id, number: co.number, title: co.title, date: co.date ?? todayIso(), status: co.status, billable: co.billable,
    cmFee: co.cmFee, contractId: NO_CONTRACT,
    lines: co.lines.map((l) => ({ key: l.key, description: l.description, amount: fmtMoneyText(String(l.amount)), tenantPct: String(l.tenantPct ?? 100), fromCoId: l.fromCoId ?? null })),
    credit: co.credit ? fmtMoneyText(String(co.credit)) : '', cmOnAbsorbed: co.cmOnAbsorbed, linked: co.links.length > 0, reason: co.reason, vendorLinks: [], fallbackKey: '',
    markups: (co.markups || []).map((m) => ({ ...m, pct: fmtPctText(String(m.pct)), amount: m.amount != null ? fmtMoneyText(String(m.amount)) : '' })), partnerFee: co.partnerFee, partnerFeeBasis: co.partnerFeeBasis ?? 'all',
    fundedFrom: (co.fundedFrom || []).map((f) => ({ key: f.key, amount: fmtMoneyText(String(f.amount)) })),
    tenantRate: fmtPctText(String(co.cmFeePct)), partnerRate: fmtPctText(String(co.partnerFeePct)), cmFeeAmount: co.cmFeeAmount != null ? fmtMoneyText(String(co.cmFeeAmount)) : '',
  });

  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try {
      const data = await fn();
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: ok });
      return true;
    } catch (e: any) {
      toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' });
      return false;
    } finally { setBusy(false); }
  };

  // ---- the contractor's side and the backup, under each change order
  const [linking, setLinking] = useState<string | null>(null);
  const [linkTo, setLinkTo] = useState('');
  const [pctDraft, setPctDraft] = useState<Record<string, string>>({});
  const [mapOpen, setMapOpen] = useState<Record<string, boolean>>({});
  // Assign a vendor's change order line to a budget line. Saved on the vendor's line itself, so its
  // cost lands on the same budget line the change order raises; then this change order is re-priced.
  const assignLine = (co: BudgetCO, sovLineId: number, key: string) => {
    if (key === '__split__' || key === '__spread__') return;
    const label = key === CO_UNASSIGNED_KEY ? 'unassigned' : `on ${name.get(key) ?? 'the budget line'}`;
    run(async () => {
      await apiRequest(`/api/cost-sov-lines/${sovLineId}`, 'PATCH', key === CO_UNASSIGNED_KEY
        ? { allocationMode: 'unallocated', allocations: [] }
        : { allocationMode: 'direct', allocations: [{ baselineKey: key, pct: 100 }] });
      return apiRequest(`/api/cost-projects/${projectId}/budget-cos/${co.id}`, 'PATCH', { resync: true });
    }, `${co.number}: line ${label}`);
  };
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
    catch (e: any) { toast({ title: 'Not Removed', description: e?.message, variant: 'destructive' }); }
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
                  const vls = bundle.sovLines.filter((x) => x.changeOrderId === l.contractCoId);
                  const keyOf = (x: SovLineRow) => (x.allocationMode === 'direct' && x.allocations.length === 1 ? x.allocations[0].baselineKey
                    : x.allocationMode === 'direct' && x.allocations.length > 1 ? '__split__' : x.allocationMode === 'spread' ? '__spread__' : CO_UNASSIGNED_KEY);
                  const unassigned = vls.filter((x) => keyOf(x) === CO_UNASSIGNED_KEY).length;
                  const mapKey = `${co.id}:${l.contractCoId}`;
                  return (
                    <Fragment key={l.contractCoId}>
                    <tr>
                      <td className="pr-3 py-0.5 text-gray-800">{contractName(l.contractId)} {cco?.number ?? '(removed)'}{cco?.title ? <span className="text-gray-500"> — {cco.title}</span> : null}</td>
                      <td className="pr-3 py-0.5 text-right tabular-nums">{money(amt)}
                        {Math.abs(live - amt) >= 0.005 && <span className="text-amber-800" title="The vendor's change order has changed since it was priced in"> → now {money(live)}</span>}</td>
                      <td className="pr-1 py-0.5 text-gray-500">Tenant pays</td>
                      <td className="pr-3 py-0.5" title="Type any precision (e.g. 56.929894) — shown to two decimals"><SharePercentInput className="h-6 text-xs w-28" aria-label="Tenant pays"
                        value={pctDraft[`${co.id}:${l.contractCoId}`] ?? String(l.pct)}
                        onValueChange={(v) => setPctDraft((d) => ({ ...d, [`${co.id}:${l.contractCoId}`]: v }))}
                        onBlur={(e) => { setPct(l.contractCoId, e.target.value); setPctDraft((d) => { const n = { ...d }; delete n[`${co.id}:${l.contractCoId}`]; return n; }); }} /></td>
                      {/* Or type the dollars the tenant pays; the share is worked out exactly from it. */}
                      <td className="pr-3 py-0.5" title="Type what the tenant pays — the % is worked out exactly"><MoneyInput className="h-6 text-xs w-32 text-green-800" aria-label="Tenant pays (dollars)"
                        value={pctDraft[`$${co.id}:${l.contractCoId}`] ?? fmtMoneyText(String(r2((amt * l.pct) / 100)))}
                        onValueChange={(v) => setPctDraft((d) => ({ ...d, [`$${co.id}:${l.contractCoId}`]: v }))}
                        onBlur={(e) => {
                          const dollars = num(e.target.value);
                          if (amt > 0 && Math.abs(dollars - r2((amt * l.pct) / 100)) >= 0.005) setPct(l.contractCoId, String(Math.max(0, Math.min(100, (dollars / amt) * 100))));
                          setPctDraft((d) => { const n = { ...d }; delete n[`$${co.id}:${l.contractCoId}`]; return n; });
                        }} /></td>
                      <td className="pr-3 py-0.5 tabular-nums text-red-800">{l.pct < 100 ? `absorbed ${money(amt - (amt * l.pct) / 100)}` : ''}</td>
                      <td className="py-0.5">
                        <button className="text-gray-400 hover:text-red-700 inline-flex items-center" title="Unlink (the vendor's change order stays on its contract)"
                                onClick={() => run(() => apiRequest(`/api/cost-projects/${projectId}/budget-cos/${co.id}`, 'PATCH', { unlinkCoId: l.contractCoId }), `${co.number}: unlinked`)}>
                          <Unlink className="h-3.5 w-3.5" />
                        </button>
                      </td>
                      <td className="pl-3 py-0.5">
                        {vls.length > 0 && (
                          <button className={`hover:underline whitespace-nowrap ${unassigned ? 'text-amber-800' : 'text-blue-700'}`}
                                  onClick={() => setMapOpen((m) => ({ ...m, [mapKey]: !m[mapKey] }))}>
                            {mapOpen[mapKey] ? 'Hide Budget Lines' : unassigned ? `Assign Budget Lines (${unassigned} unassigned)` : 'Budget Lines'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {mapOpen[mapKey] && vls.map((x) => (
                      <tr key={`m${x.id}`} className="text-gray-700">
                        <td className="pr-3 py-0.5 pl-4">{x.itemNo ? `${x.itemNo} · ` : ''}{x.description}</td>
                        <td className="pr-3 py-0.5 text-right tabular-nums">{money(x.scheduledValue)}</td>
                        <td className="pr-1 py-0.5 text-gray-500">Budget line</td>
                        <td colSpan={4} className="pr-3 py-0.5">
                          <div className="w-72">
                            <Select value={keyOf(x)} onValueChange={(v) => assignLine(co, x.id, v)}>
                              <SelectTrigger className={`h-6 text-xs ${keyOf(x) === CO_UNASSIGNED_KEY ? 'border-amber-400 bg-amber-50' : ''}`}><SelectValue /></SelectTrigger>
                              <SelectContent className="pm-scope">
                                <SelectItem value={CO_UNASSIGNED_KEY}>Unassigned for Now</SelectItem>
                                {keyOf(x) === '__split__' && <SelectItem value="__split__" disabled>Split Over Several Lines (Contracts Tab)</SelectItem>}
                                {keyOf(x) === '__spread__' && <SelectItem value="__spread__" disabled>Spread with the Contract (Contracts Tab)</SelectItem>}
                                {baseline.map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </td>
                      </tr>
                    ))}
                    </Fragment>
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
                Use the Vendors' Current Prices
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
                <Link2 className="h-3.5 w-3.5" /> {co.links.length ? 'Link Another Vendor Change Order' : 'Link a Vendor Change Order'}
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
                      onClick={async () => { if (!(await openReport(`/api/reports/tenant-co/${projectId}?co=${encodeURIComponent(co.id)}`))) toast({ title: 'Report Failed', variant: 'destructive' }); }}>
                <Printer className="h-3.5 w-3.5" /> Tenant Change Order
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
  // Rates are fixed on the change order once written: the tenant's and the capital partner's.
  const formRate = form ? num(form.tenantRate) : tenantRate;
  const formPartnerRate = form ? num(form.partnerRate) : rate;
  const formMarkups = form ? form.markups.map((m) => ({ ...m, fixed: m.amount.trim() !== '', value: m.amount.trim() !== '' ? num(m.amount) : r2((formTenantWork * num(m.pct)) / 100) })) : [];
  const formMarkupTotal = r2(formMarkups.reduce((s, m) => s + m.value, 0));
  // No CM fee on a discount: the tenant's fee is on their cost + markups less the credit, unless typed.
  const formCmFigured = form?.cmFee ? r2((Math.max(0, formTenantWork + formMarkupTotal - num(form.credit)) * formRate) / 100) : 0;
  const formCmTyped = !!form && form.cmFeeAmount.trim() !== '';
  const formCm = form?.cmFee ? (formCmTyped ? num(form.cmFeeAmount) : formCmFigured) : 0;
  const formCmOurs = form?.partnerFee ? r2(((form.partnerFeeBasis === 'tenant' ? formTenantWork : form.partnerFeeBasis === 'absorbed' ? formWork - formTenantWork : formWork) * formPartnerRate) / 100) : 0;
  const formCredit = form ? num(form.credit) : 0;
  const formBudget = r2(formWork + formMarkupTotal + formCmOurs);
  const formTenant = r2(formTenantWork + formMarkupTotal + formCm - formCredit);
  const formOurs = r2(formBudget - formTenant);
  const formFunded = form ? r2(Math.min(Math.max(0, formOurs), form.fundedFrom.reduce((s, f) => s + num(f.amount), 0))) : 0;
  const formNewMoney = r2(Math.max(0, formOurs) - formFunded);
  // Budget lines money can come from (not the change order's own markup lines' increases — any line is allowed).
  const contingencyLine = baseline.find((b) => /contingenc/i.test(b.description));
  const lineLeft = (key: string) => bundle.breakdown?.find((r) => r.key === key)?.revised ?? 0;
  const formLinesOk = form ? form.linked || fromVendors || (form.lines.filter((l) => num(l.amount)).every((l) => l.key) && form.lines.some((l) => num(l.amount))) : false;

  const submit = async () => {
    if (!form) return;
    const body = {
      number: form.number, title: form.title, date: form.date, status: form.status, billable: form.billable, cmFee: form.cmFee,
      credit: formCredit, cmOnAbsorbed: form.cmOnAbsorbed, reason: form.reason, partnerFee: form.partnerFee, partnerFeeBasis: form.partnerFeeBasis,
      fundedFrom: form.fundedFrom.filter((f) => f.key && num(f.amount) > 0).map((f) => ({ key: f.key, amount: num(f.amount) })),
      markups: form.markups.filter((m) => num(m.pct) > 0 || m.amount.trim() !== '').map((m) => ({ key: m.key, label: m.label, pct: num(m.pct), amount: m.amount.trim() !== '' ? num(m.amount) : null })),
      cmFeePct: num(form.tenantRate), partnerFeePct: num(form.partnerRate), cmFeeAmount: form.cmFeeAmount.trim() !== '' ? num(form.cmFeeAmount) : null,
      // Lines priced from linked vendors are re-priced from them, not typed.
      // Linked: amounts come from the vendors; the tenant shares typed here are saved on the links.
      ...(form.linked ? (() => {
        const cur = bundle.approval.changeOrders.find((c) => c.id === form.id);
        if (!cur) return {};
        return { links: cur.links.map((lk) => {
          const fl = form.lines.find((x) => x.fromCoId === lk.contractCoId);
          return { contractCoId: lk.contractCoId, pct: fl ? num(fl.tenantPct) : lk.pct };
        }) };
      })() : { lines: form.lines.filter((l) => num(l.amount)).map((l) => ({ key: l.key, description: l.description, amount: num(l.amount), tenantPct: num(l.tenantPct) })) }),
      ...(form.id ? {} : fromVendors
        ? { vendorLinks: form.vendorLinks.map((v) => ({ contractCoId: v.contractCoId, pct: num(v.pct) })), fallbackKey: form.fallbackKey || null, lines: [] }
        : { contractId: form.contractId === NO_CONTRACT ? null : Number(form.contractId) }),
    };
    const ok = await run(
      () => (form.id
        ? apiRequest(`/api/cost-projects/${projectId}/budget-cos/${form.id}`, 'PATCH', body)
        : apiRequest(`/api/cost-projects/${projectId}/budget-cos`, 'POST', body)),
      form.id ? `${form.number} saved` : `${form.number} added${!fromVendors && form.contractId !== NO_CONTRACT ? ' — and to the contract' : ''}`,
    );
    if (ok) setForm(null);
  };

  return (
    <div className="bg-white border rounded-lg">
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3 flex-wrap">
        <div>
          <button className="flex items-center gap-1.5" onClick={toggleRolled} aria-expanded={!rolled} title={rolled ? 'Show the change orders' : 'Roll up'}>
            {rolled ? <ChevronRight className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
            <h2 className="font-semibold text-gray-900">Budget Change Orders</h2>
            {rolled && (
              <span className="text-xs text-gray-700 font-normal tabular-nums ml-1">
                {cos.length} · approved {money(bundle.approval.coSummary.approved)}
                {bundle.approval.coSummary.pending > 0.005 && <span className="text-amber-700"> · pending {money(bundle.approval.coSummary.pending)}</span>}
              </span>
            )}
          </button>
          <p className="text-xs text-gray-600 mt-0.5">
            Every change to the budget after it was set: why it happened, the vendors' change orders behind it, and who pays —
            the tenant (their share, markups and CM fee at {tenantRate.toFixed(2)}%) or {bundle.funding?.label ?? 'Supplemental Funding'}. The capital partner's {rate.toFixed(2)}% (by default on the difference we absorb) goes on the Supplemental CM Fee line.
          </p>
        </div>
        {!form && <Button size="sm" onClick={() => { if (rolled) toggleRolled(); setForm(blank()); }}><Plus className="h-3.5 w-3.5 mr-1" /> Change Order</Button>}
      </div>
      {/* Kept mounted when rolled up, so a half-filled form isn't lost. */}
      <div className={rolled ? 'hidden' : ''}>

      {cos.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                <th className="px-3 py-1.5">No.</th><th className="px-3 py-1.5">For</th><th className="px-3 py-1.5">Date</th>
                <th className="px-3 py-1.5 text-right">Cost of Work</th><th className="px-3 py-1.5 text-right" title="Markups on the tenant's share, and the capital partner's CM fee">Markups · Partner Fee</th>
                <th className="px-3 py-1.5 text-right" title="Budget increase: cost + markups + partner fee">Budget +</th>
                <th className="px-3 py-1.5 text-right">Tenant Pays</th><th className="px-3 py-1.5 text-right">Absorbed</th>
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
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                      {t.markups ? <div>{signedMoney(t.markups)} <span className="text-[10px] text-gray-500">markups</span></div> : null}
                      {t.cmAbsorbed ? <div>{signedMoney(t.cmAbsorbed)} <span className="text-[10px] text-gray-500">partner {co.partnerFeePct.toFixed(2)}%{co.partnerFeeBasis === 'tenant' ? ' · tenant share' : co.partnerFeeBasis === 'absorbed' ? ' · difference only' : ''}</span></div> : null}
                      {!t.markups && !t.cmAbsorbed ? '—' : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{signedMoney(t.budgetIncrease ?? t.total)}
                      {t.funded ? <div className="text-[10px] font-normal text-gray-500">{(co.fundedFrom || []).map((f) => `${money(f.amount)} from ${name.get(f.key) ?? 'a line'}`).join(' · ')}</div> : null}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-800">{t.tenant ? signedMoney(t.tenant) : '—'}
                      {t.cm ? <div className="text-[10px] text-gray-500">incl. {money(t.cm)} CM fee ({co.cmFeePct.toFixed(2)}%)</div> : null}
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
                <SelectContent className="pm-scope"><SelectItem value="yes">Billable to Tenant (100.00%)</SelectItem><SelectItem value="no">Not Billable — We Absorb It (0.00%)</SelectItem></SelectContent>
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
                        {free.map((c) => <SelectItem key={c.id} value={String(c.id)}>{contractName(c.contractId)} {c.number}{c.title ? ` — ${c.title}` : ''} · {money(coLines(c.id))}{c.status === 'approved' ? ' · Approved' : ' · Pending'}</SelectItem>)}
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
                  <Select value={form.fallbackKey || CO_UNASSIGNED_KEY} onValueChange={(v) => setForm({ ...form, fallbackKey: v === CO_UNASSIGNED_KEY ? '' : v })}>
                    <SelectTrigger className="h-7 text-xs bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent className="pm-scope">
                      <SelectItem value={CO_UNASSIGNED_KEY}>Unassigned for Now — Map It Later</SelectItem>
                      {baseline.map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {form.linked && (
              <div className="px-2 py-1.5 text-xs bg-violet-50 border-b text-violet-900">
                Priced from the linked vendor change orders — amounts follow the vendors. Set the tenant's share here (any precision), or type what the tenant pays.
              </div>
            )}
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b bg-gray-50">
                  <th className="px-2 py-1.5 w-72">Budget Line</th><th className="px-2 py-1.5">Description</th>
                  <th className="px-2 py-1.5 w-40 text-right">Cost</th><th className="px-2 py-1.5 w-28 text-right" title="Share of this cost the tenant pays">Tenant %</th>
                  <th className="px-2 py-1.5 w-36 text-right">Tenant Pays</th><th className="w-9" />
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
                      <td className="px-1 py-1" title="Type any precision — shown to two decimals"><SharePercentInput className="h-8" value={v.pct} aria-label="Tenant %"
                        onValueChange={(val) => setForm({ ...form, vendorLinks: form.vendorLinks.map((x, j) => (j === i ? { ...x, pct: val } : x)) })} /></td>
                      <td className="px-1 py-1" title="Or type what the tenant pays — the % is worked out exactly"><MoneyInput className="h-8 text-green-800" aria-label="Tenant pays (dollars)"
                        value={pctDraft[`f$${v.contractCoId}`] ?? fmtMoneyText(String(r2((amt * num(v.pct)) / 100)))}
                        onValueChange={(val) => setPctDraft((d) => ({ ...d, [`f$${v.contractCoId}`]: val }))}
                        onBlur={(e) => {
                          const dollars = num(e.target.value);
                          if (amt > 0 && Math.abs(dollars - r2((amt * num(v.pct)) / 100)) >= 0.005) setForm({ ...form, vendorLinks: form.vendorLinks.map((x, j) => (j === i ? { ...x, pct: String(Math.max(0, Math.min(100, (dollars / amt) * 100))) } : x)) });
                          setPctDraft((d) => { const n = { ...d }; delete n[`f$${v.contractCoId}`]; return n; });
                        }} /></td>
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
                        <SelectContent className="pm-scope">
                          <SelectItem value={CO_UNASSIGNED_KEY}>Unassigned for Now</SelectItem>
                          {baseline.map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-1 py-1"><Input className="h-8" value={l.description} aria-label="Description"
                                                     onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} /></td>
                    <td className="px-1 py-1"><MoneyInput className="h-8" value={l.amount} aria-label="Amount" disabled={form.linked}
                                                          onValueChange={(v) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} /></td>
                    {/* A linked vendor's share applies to all its lines; it is saved on the link. */}
                    <td className="px-1 py-1"><SharePercentInput className="h-8" value={l.tenantPct} aria-label="Tenant %" disabled={form.linked && !l.fromCoId}
                                                            onValueChange={(v) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i || (form.linked && l.fromCoId && x.fromCoId === l.fromCoId) ? { ...x, tenantPct: v } : x)) })} /></td>
                    <td className="px-1 py-1">{form.linked && l.fromCoId ? (
                      <MoneyInput className="h-8 text-green-800" aria-label="Tenant pays (dollars)"
                        value={pctDraft[`e$${i}`] ?? fmtMoneyText(String(r2((num(l.amount) * num(l.tenantPct)) / 100)))}
                        onValueChange={(v) => setPctDraft((d) => ({ ...d, [`e$${i}`]: v }))}
                        onBlur={(e) => {
                          const amt = num(l.amount), dollars = num(e.target.value);
                          if (amt > 0 && Math.abs(dollars - r2((amt * num(l.tenantPct)) / 100)) >= 0.005) {
                            const pct = String(Math.max(0, Math.min(100, (dollars / amt) * 100)));
                            setForm({ ...form, lines: form.lines.map((x) => (x.fromCoId === l.fromCoId ? { ...x, tenantPct: pct } : x)) });
                          }
                          setPctDraft((d) => { const n = { ...d }; delete n[`e$${i}`]; return n; });
                        }} />
                    ) : <div className="px-1 text-right tabular-nums text-green-800">{money(r2((num(l.amount) * num(l.tenantPct)) / 100))}</div>}</td>
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
                {formMarkups.map((m, i) => (
                  <tr key={`m${m.key}`}>
                    <td colSpan={2} className="px-2 py-1">{m.label} <span className="text-[11px] text-gray-500">{m.fixed ? 'fixed amount' : "markup on the tenant's share — or type a fixed amount"}</span></td>
                    <td className="px-1 py-1"><MoneyInput className={`h-8 ${m.fixed ? 'border-amber-400 bg-amber-50' : ''}`} value={form.markups[i].amount} aria-label={`${m.label} amount`}
                      onValueChange={(v) => setForm({ ...form, markups: form.markups.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} /></td>
                    <td className="px-1 py-1"><PercentInput className="h-8" value={form.markups[i].pct} aria-label={`${m.label} %`} disabled={m.fixed}
                      onValueChange={(v) => setForm({ ...form, markups: form.markups.map((x, j) => (j === i ? { ...x, pct: v } : x)) })} /></td>
                    <td className="px-2 py-1 text-right tabular-nums text-green-800">{signedMoney(m.value)}</td>
                    <td className="px-1 text-center">
                      <button className="p-1 text-gray-400 hover:text-red-700" title="Remove this markup" onClick={() => setForm({ ...form, markups: form.markups.filter((_, j) => j !== i) })}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {(() => {
                  const avail = defaultMarkups(baseline, bundle.cmSettings.key).filter((d) => !form.markups.some((m) => m.key === d.key));
                  const others = baseline.filter((b) => b.bucket !== 'cm' && !form.markups.some((m) => m.key === b.key) && !avail.some((d) => d.key === b.key));
                  return (avail.length || others.length) ? (
                    <tr>
                      <td colSpan={2} className="px-2 py-1">
                        <div className="w-72">
                          <Select value="" onValueChange={(v) => {
                            const d = avail.find((x) => x.key === v);
                            const b = baseline.find((x) => x.key === v)!;
                            setForm({ ...form, markups: [...form.markups, { key: v, label: d?.label ?? b.description, pct: fmtPctText(String(d?.pct ?? 0)), amount: '' }] });
                          }}>
                            <SelectTrigger className="h-7 text-xs data-[placeholder]:text-gray-900"><SelectValue placeholder="+ Add a markup" /></SelectTrigger>
                            <SelectContent className="pm-scope">
                              {avail.map((d) => <SelectItem key={d.key} value={d.key}>{d.label} ({d.pct.toFixed(2)}%)</SelectItem>)}
                              {others.map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </td>
                      <td colSpan={4} />
                    </tr>
                  ) : null;
                })()}
                <tr>
                  <td colSpan={2} className="px-2 py-1">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={form.cmFee} onChange={(e) => setForm({ ...form, cmFee: e.target.checked })} />
                      CM Fee to the Tenant <span className="text-[11px] text-gray-500">on their cost + markups, less any credit{formCmTyped ? ` · figured ${money(formCmFigured)}` : ' — or type the amount'}</span>
                      {formCmTyped && <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 rounded px-1">Edited</span>}
                    </label>
                  </td>
                  <td className="px-1 py-1"><MoneyInput className={`h-8 ${formCmTyped ? 'border-amber-400 bg-amber-50' : ''}`} value={form.cmFeeAmount} aria-label="Tenant CM fee amount" disabled={!form.cmFee}
                    onValueChange={(v) => setForm({ ...form, cmFeeAmount: v })} /></td>
                  <td className="px-1 py-1"><PercentInput className="h-8" value={form.tenantRate} aria-label="Tenant CM fee rate" disabled={!form.cmFee || formCmTyped}
                    onValueChange={(v) => setForm({ ...form, tenantRate: v })} /></td>
                  <td className="px-2 py-1 text-right tabular-nums text-green-800">{signedMoney(formCm)}</td><td />
                </tr>
                <tr>
                  <td colSpan={2} className="px-2 py-1">
                    <span className="inline-flex items-center gap-2 flex-wrap">
                      CM fee to the capital partner
                      <Select value={!form.partnerFee ? 'none' : form.partnerFeeBasis}
                              onValueChange={(v) => setForm({ ...form, partnerFee: v !== 'none', partnerFeeBasis: v === 'tenant' ? 'tenant' : v === 'absorbed' ? 'absorbed' : 'all' })}>
                        <SelectTrigger className="h-7 w-96 max-w-full text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="pm-scope">
                          <SelectItem value="absorbed">Only on the difference — what we absorb (the tenant pays the rest)</SelectItem>
                          <SelectItem value="all">On all the work (the tenant's share too)</SelectItem>
                          <SelectItem value="tenant">Only on the Tenant's Share</SelectItem>
                          <SelectItem value="none">None on This Change Order</SelectItem>
                        </SelectContent>
                      </Select>
                      <span className="text-[11px] text-gray-500">Supplemental CM Fee</span>
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{signedMoney(formCmOurs)}</td>
                  <td className="px-1 py-1"><PercentInput className="h-8" value={form.partnerRate} aria-label="Capital partner CM fee rate" disabled={!form.partnerFee}
                    onValueChange={(v) => setForm({ ...form, partnerRate: v })} /></td><td colSpan={2} />
                </tr>
                <tr>
                  <td colSpan={2} className="px-2 py-1">Credit to the tenant <span className="text-[11px] text-gray-500">a discount we absorb — no CM fee on it</span></td>
                  <td colSpan={2} />
                  <td className="px-1 py-1"><MoneyInput className="h-8" value={form.credit} aria-label="Credit to the tenant" onValueChange={(v) => setForm({ ...form, credit: v })} /></td><td />
                </tr>
                {formOurs > 0.005 && (
                  <>
                    <tr className="border-t bg-gray-50/60">
                      <td colSpan={6} className="px-2 pt-2 pb-1 text-xs">
                        <span className="font-semibold text-gray-800">Paid for by</span>
                        <span className="text-gray-600"> — the {money(formOurs)} we absorb: from a line in the budget (contingency, another line), and the rest is new money ({bundle.funding?.label ?? 'Supplemental Funding'}).</span>
                      </td>
                    </tr>
                    {form.fundedFrom.map((f, i) => (
                      <tr key={`f${i}`} className="bg-gray-50/60">
                        <td colSpan={2} className="px-2 py-1">
                          <div className="w-80 max-w-full">
                            <Select value={f.key || undefined} onValueChange={(v) => setForm({ ...form, fundedFrom: form.fundedFrom.map((x, j) => (j === i ? { ...x, key: v } : x)) })}>
                              <SelectTrigger className="h-8 text-xs data-[placeholder]:text-gray-900"><SelectValue placeholder="— from which line —" /></SelectTrigger>
                              <SelectContent className="pm-scope">{baseline.map((b) => <SelectItem key={b.key} value={b.key}>{b.description} · {money(lineLeft(b.key))}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        </td>
                        <td className="px-1 py-1"><MoneyInput className="h-8" value={f.amount} aria-label="Amount from this line"
                          onValueChange={(v) => setForm({ ...form, fundedFrom: form.fundedFrom.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} /></td>
                        <td colSpan={2} className="px-2 text-xs text-gray-500">moved off that line</td>
                        <td className="px-1 text-center">
                          <button className="p-1 text-gray-400 hover:text-red-700" title="Remove" onClick={() => setForm({ ...form, fundedFrom: form.fundedFrom.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50/60">
                      <td colSpan={2} className="px-2 py-1">
                        <span className="inline-flex gap-3 flex-wrap text-xs">
                          <button className="text-blue-700 hover:underline" onClick={() => setForm({ ...form, fundedFrom: [...form.fundedFrom, { key: '', amount: fmtMoneyText(String(formNewMoney)) }] })}>+ Pay from a Budget Line</button>
                          {contingencyLine && formNewMoney > 0.005 && !form.fundedFrom.some((f) => f.key === contingencyLine.key) && (
                            <button className="text-blue-700 hover:underline" onClick={() => setForm({ ...form, fundedFrom: [...form.fundedFrom, { key: contingencyLine.key, amount: fmtMoneyText(String(r2(Math.min(formNewMoney, Math.max(0, lineLeft(contingencyLine.key)))))) }] })}>
                              Pay From {contingencyLine.description}
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-xs">{formFunded ? `− ${money(formFunded)}` : ''}</td>
                      <td colSpan={3} className="px-2 py-1 text-xs text-gray-700">New money ({bundle.funding?.label ?? 'Supplemental Funding'}): <span className={`tabular-nums font-medium ${formNewMoney > 0.005 ? 'text-red-800' : 'text-green-800'}`}>{money(formNewMoney)}</span></td>
                    </tr>
                  </>
                )}
                <tr className="border-t-2 border-gray-800 font-semibold">
                  <td colSpan={2} className="px-2 py-1.5">Budget increase <span className="font-normal text-gray-600">(cost + markups + partner fee{formFunded ? ', less what comes from other lines' : ''}) · tenant pays {money(formTenant)} · {formOurs >= 0 ? `we absorb ${money(formOurs)}` : `tenant covers ${money(-formOurs)} more than the budget rises`}</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{signedMoney(r2(formBudget - formFunded))}</td><td />
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
                      <SelectItem value={NO_CONTRACT}>No — Budget Only</SelectItem>
                      {bundle.contracts.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.counterparty}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
              <Button size="sm" disabled={busy || !formLinesOk || !form.number.trim()} onClick={submit}>{busy ? 'Saving…' : form.id ? 'Save Change Order' : 'Add Change Order'}</Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <div className={`space-y-1 ${wide ? 'col-span-2' : ''}`}><div className="text-xs text-gray-600">{label}</div>{children}</div>;
}
