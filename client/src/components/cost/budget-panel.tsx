/**
 * The project's budget, in one table.
 *
 *   Priced      what each line was priced at (from the RFP, or typed in)
 *   Discount    the part of the deal discount put on the line
 *   COs         approved budget change orders on the line
 *   Budget      what the line is held to: priced − discount + change orders
 *
 * The LAF total sits above it; the gap to the priced total is the Deal
 * Discount, and whatever isn't put on a line shows on its own row so the
 * table always adds to the LAF. Confirm locks it as the original budget;
 * change orders and edits after that are revisions against it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useRolled } from '@/hooks/use-rolled';
import { CheckCircle2, Lock, Plus, Trash2, ChevronDown, ChevronRight, ArrowRightLeft } from 'lucide-react';
import { rollUp, transferNet, DEAL_DISCOUNT_KEY } from '@shared/cost-budget-approval';
import { fmtMoneyText, fmtPctText, parseAmount } from '@shared/format';
import { MoneyInput, PercentInput } from './inputs';
import { money, signedMoney, projectKey, shortDate, BUCKET_LABEL, type ProjectBundle } from './types';

const num = (s: string | number | null | undefined) => {
  const v = parseAmount(s);
  return Number.isFinite(v) ? v : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

type Row = { key: string; description: string; bucket: string; priced: string; discount: string; tenantSharePct: string; masterItemId?: number | null };

export function BudgetPanel({ bundle, projectId }: { bundle: ProjectBundle; projectId: number }) {
  const [rolled, toggleRolled] = useRolled(`pm-rolled-budget-${projectId}`);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const a = bundle.approval;
  const confirmed = a.status === 'confirmed';
  const baseline = bundle.project.baseline;

  const fromServer = (): Row[] => baseline.map((b: any) => ({
    key: b.key, description: b.description, bucket: b.bucket,
    priced: fmtMoneyText(String(b.budget)),
    discount: (() => { const x = a.allocations.find((al) => al.key === b.key); return x ? fmtMoneyText(String(x.amount)) : ''; })(),
    tenantSharePct: fmtPctText(String(b.tenantSharePct ?? 100)),
    masterItemId: b.masterItemId ?? null,
  }));
  const serverLaf = () => (a.lafTotal != null ? fmtMoneyText(String(a.lafTotal)) : '');
  const [rows, setRows] = useState<Row[]>(fromServer);
  const [laf, setLaf] = useState(serverLaf);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setRows(fromServer()); setLaf(serverLaf()); }, [JSON.stringify(baseline), JSON.stringify(a)]);

  // Approved change orders, by budget line (CM fee onto the CM line).
  const coByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const co of a.changeOrders.filter((c) => c.status === 'approved')) {
      for (const l of co.lines) m.set(l.key, (m.get(l.key) ?? 0) + l.amount);
      const t = a.changeOrderTotals.find((x) => x.id === co.id);
      // CM fees on change orders go to the Supplemental CM Fee row below, never onto the original CM line.
    }
    return m;
  }, [a]);
  const coOther = r2(a.coSummary.approved - Array.from(coByKey.values()).reduce((s, v) => s + v, 0));
  const hasCos = a.coSummary.approved !== 0;
  const xfer = useMemo(() => {
    const keys = new Set(baseline.map((b) => b.key));
    return transferNet(a.transfers.filter((t) => keys.has(t.fromKey) && keys.has(t.toKey)));
  }, [a.transfers, baseline]);
  const hasXfer = a.transfers.length > 0;
  // Additional funding (not change orders): by line, and the add form.
  const adds = (a as any).additions as Array<{ id: string; key: string; amount: number; label: string; source: string; date: string; note: string; by: string | null }> ?? [];
  const addByKey = useMemo(() => { const m = new Map<string, number>(); for (const x of adds) if (x.key && baseline.some((b: any) => b.key === x.key)) m.set(x.key, r2((m.get(x.key) ?? 0) + x.amount)); return m; }, [adds, baseline]);
  /** Additional funding not on a line yet: one pot, shown on its own row. */
  const addPool = r2(adds.filter((x) => !x.key || !baseline.some((b: any) => b.key === x.key)).reduce((t, x) => t + x.amount, 0));
  const assignFunding = async (id: string, key: string) => {
    try { const data = await apiRequest(`/api/cost-projects/${projectId}/budget-additions/${id}`, 'PATCH', { key: key === '__none__' ? '' : key }); queryClient.setQueryData([projectKey(projectId)], data); toast({ title: key === '__none__' ? 'Taken Off the Line' : `Put on ${lineName(key)}` }); }
    catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
  };
  const hasAdd = adds.length > 0;
  const addTotal = r2(adds.reduce((t, x) => t + x.amount, 0));
  const [fForm, setFForm] = useState<{ key: string; amount: string; label: string; source: string; date: string; note: string } | null>(null);
  const addFunding = async () => {
    if (!fForm) return;
    try {
      const data = await apiRequest(`/api/cost-projects/${projectId}/budget-additions`, 'POST', { ...fForm, key: fForm.key === '__none__' ? '' : fForm.key, amount: parseAmount(fForm.amount) });
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: 'Funding Added', description: `${fForm.label}${fForm.key && fForm.key !== '__none__' ? ` · ${lineName(fForm.key)}` : ' · not on a line yet'}` });
      setFForm(null);
    } catch (e: any) { toast({ title: 'Not Added', description: e?.message, variant: 'destructive' }); }
  };
  const removeFunding = async (id: string) => {
    try { const data = await apiRequest(`/api/cost-projects/${projectId}/budget-additions/${id}`, 'DELETE'); queryClient.setQueryData([projectKey(projectId)], data); toast({ title: 'Funding Removed' }); }
    catch (e: any) { toast({ title: 'Not Removed', description: e?.message, variant: 'destructive' }); }
  };
  const [xForm, setXForm] = useState<{ fromKey: string; toKey: string; amount: string; note: string } | null>(null);
  const lineName = (k: string) => baseline.find((b) => b.key === k)?.description ?? 'Removed line';
  const moveMoney = async () => {
    if (!xForm) return;
    try {
      const data = await apiRequest(`/api/cost-projects/${projectId}/budget-transfers`, 'POST', { ...xForm, amount: (Number.isFinite(parseAmount(xForm.amount)) ? String(parseAmount(xForm.amount)) : xForm.amount.replace(/,/g, '')) });
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: 'Money Moved', description: `${lineName(xForm.fromKey)} → ${lineName(xForm.toKey)}` });
      setXForm(null);
    } catch (e: any) { toast({ title: 'Not Moved', description: e?.message, variant: 'destructive' }); }
  };
  const undoTransfer = async (id: string) => {
    try {
      const data = await apiRequest(`/api/cost-projects/${projectId}/budget-transfers/${id}`, 'DELETE');
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: 'Transfer Undone' });
    } catch (e: any) { toast({ title: 'Not Undone', description: e?.message, variant: 'destructive' }); }
  };

  const priced = r2(rows.reduce((s, r) => s + num(r.priced), 0));
  const typedLaf = laf.trim() === '' ? null : num(laf);
  const discount = typedLaf == null ? 0 : r2(priced - typedLaf);
  const placed = r2(rows.reduce((s, r) => s + num(r.discount), 0));
  const unplaced = r2(discount - placed);
  const lafBudget = r2(priced - discount);
  const current = r2(lafBudget + a.coSummary.approved + addTotal);
  // A discount column only earns its place when there is a discount (or premium) to put on lines.
  const showDiscount = (typedLaf != null && (!confirmed || Math.abs(discount) >= 0.005)) || placed !== 0;
  // Once confirmed: the original per line, and anything edited since as a revision.
  const origBy = useMemo(() => new Map(bundle.breakdown.map((r) => [r.key, r.original])), [bundle.breakdown]);
  const lineBudget = (r: Row) => r2(num(r.priced) - num(r.discount) + (xfer.get(r.key) ?? 0) + (coByKey.get(r.key) ?? 0));
  const revisionOf = (r: Row) => confirmed ? r2(lineBudget(r) - (origBy.get(r.key) ?? 0) - (xfer.get(r.key) ?? 0) - (coByKey.get(r.key) ?? 0)) : 0;
  const hasRev = confirmed && rows.some((r) => Math.abs(revisionOf(r)) >= 0.005);

  const dirty = JSON.stringify(rows) !== JSON.stringify(fromServer()) || laf !== serverLaf();
  /** Put a budget line in a scope (Sitework, Tenant Improvements…): saved at once, in Funding by Scope. */
  const setScope = async (key: string, v: string) => {
    let scopes = (bundle.scopeSetup ?? []).map((sc) => ({ ...sc, lineKeys: sc.lineKeys.filter((k) => k !== key) }));
    if (v === '__new__') {
      const name = window.prompt('Name for the new scope (e.g. Sitework, Tenant Improvements):')?.trim();
      if (!name) return;
      scopes = [...scopes, { id: Math.random().toString(36).slice(2, 10), name, lineKeys: [key], overage: 'tenant', sources: [] }];
    } else if (v !== 'none') scopes = scopes.map((sc) => (sc.id === v ? { ...sc, lineKeys: [...sc.lineKeys, key] } : sc));
    try { const nb = await apiRequest(`/api/cost-projects/${projectId}/settings`, 'PUT', { fundingScopes: scopes }); queryClient.setQueryData([projectKey(projectId)], nb); }
    catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
  };
  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const mappedKeys = useMemo(() => new Set(bundle.sovLines.flatMap((l) => l.allocations.map((x) => x.baselineKey))), [bundle.sovLines]);
  const coKeys = useMemo(() => new Set(a.changeOrders.flatMap((c) => c.lines.map((l) => l.key))), [a]);

  const save = async () => {
    setSaving(true);
    try {
      await apiRequest(`/api/cost-projects/${projectId}`, 'PATCH', {
        baseline: rows.map((r) => ({
          key: r.key, description: r.description, bucket: r.bucket, budget: num(r.priced),
          tenantSharePct: num(r.tenantSharePct), masterItemId: r.masterItemId ?? null,
        })),
      });
      const data = await apiRequest(`/api/cost-projects/${projectId}/approval`, 'PUT', {
        lafTotal: typedLaf,
        allocations: rows.filter((r) => num(r.discount) !== 0).map((r) => ({ key: r.key, amount: num(r.discount) })),
        ...(confirmed ? { note: 'Budget revised' } : {}),
      });
      queryClient.setQueryData([projectKey(projectId)], data);
      queryClient.invalidateQueries({ queryKey: ['/api/cost-projects'] });
      toast({ title: confirmed ? 'Revision saved' : 'Budget saved' });
    } catch (e: any) {
      toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' });
      queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
    } finally { setSaving(false); }
  };
  const post = async (path: string, ok: string) => {
    try {
      const data = await apiRequest(`/api/cost-projects/${projectId}/approval/${path}`, 'POST', {});
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: ok });
    } catch (e: any) { toast({ title: 'Not Done', description: e?.message, variant: 'destructive' }); }
  };


  return (
    <div className="bg-white border rounded-lg">
      {/* Status and the three numbers that matter. */}
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5" onClick={toggleRolled} aria-expanded={!rolled} title={rolled ? 'Show the budget' : 'Roll up'}>
              {rolled ? <ChevronRight className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
              <h2 className="font-semibold text-gray-900">Budget</h2>
            </button>
            {confirmed
              ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-800 bg-green-100 rounded px-2 py-0.5"><Lock className="h-3 w-3" /> Confirmed {shortDate(a.confirmedAt)}</span>
              : <span className="text-xs font-semibold text-amber-800 bg-amber-100 rounded px-2 py-0.5">Draft</span>}
          </div>
          <p className="text-xs text-gray-600 mt-0.5">
            {confirmed
              ? `Original ${money(a.originalTotal)}. Edits and change orders from here are revisions.`
              : 'Enter the LAF total; put any deal discount on the lines it belongs to; then confirm.'}
            {rolled && <span className="ml-1 font-medium text-gray-800 tabular-nums">Current {money(a.currentTotal ?? a.approvedTotal)} · {baseline.length} lines</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {confirmed ? (
            <Button variant="ghost" size="sm" onClick={() => { if (window.confirm('Put this budget back to draft? The original budget snapshot is cleared and you confirm again.')) post('reopen', 'Budget back to draft'); }}>
              Reopen as Draft
            </Button>
          ) : (
            <Button size="sm" disabled={dirty || a.lafTotal == null} title={dirty ? 'Save first' : a.lafTotal == null ? 'Enter and save the LAF total first' : undefined}
                    onClick={() => { if (window.confirm(`Confirm ${money(a.approvedTotal)} as the original budget?`)) post('confirm', 'Budget confirmed'); }}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Confirm Budget
            </Button>
          )}
        </div>
      </div>

      <div className={`p-4 space-y-4 ${rolled ? 'hidden' : ''}`}>
        <div className={`grid grid-cols-2 ${hasCos ? 'lg:grid-cols-5' : 'lg:grid-cols-3'} gap-3`}>
          <Stat label="Priced" value={money(priced)} />
          <div>
            <label className="text-[11px] uppercase tracking-wide text-gray-500" htmlFor="laf-total">LAF Total</label>
            <MoneyInput id="laf-total" className="h-9 font-semibold" value={laf} onValueChange={setLaf} />
          </div>
          <Stat label={discount >= 0 ? 'Deal Discount' : 'Deal Premium'} value={typedLaf == null ? '—' : money(Math.abs(discount))} tone="text-indigo-800" />
          {hasCos && <Stat label="Approved COs" value={signedMoney(a.coSummary.approved)} />}
          {hasCos && <Stat label={confirmed ? 'Revised Budget' : 'Budget with COs'} value={money(current)} />}
        </div>

        <div className="overflow-x-auto border rounded-md">
          <table className={`w-full text-sm ${confirmed ? 'min-w-[1340px]' : 'min-w-[1060px]'}`}>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b bg-gray-50">
                <th className="px-2 py-1.5 min-w-[220px]">Budget Line</th>
                <th className="px-2 py-1.5 w-40">Contract</th>
                <th className="px-2 py-1.5 w-44">Scope</th>
                <th className="px-2 py-1.5 w-36 text-right">Priced</th>
                {showDiscount && <th className="px-2 py-1.5 w-36 text-right">Discount</th>}
                {confirmed && <th className="px-2 py-1.5 w-32 text-right" title="As confirmed">Original</th>}
                {hasRev && <th className="px-2 py-1.5 w-28 text-right" title="Lines edited after the budget was confirmed">Revisions</th>}
                {hasAdd && <th className="px-2 py-1.5 w-32 text-right" title="New money that isn't a change order">Additional Funding</th>}
                {hasXfer && <th className="px-2 py-1.5 w-32 text-right">Transfers</th>}
                {hasCos && <th className="px-2 py-1.5 w-32 text-right">Approved COs</th>}
                <th className="px-2 py-1.5 w-36 text-right">{confirmed ? 'Revised Budget' : 'Budget'}</th>
                <th className="px-2 py-1.5 w-28 text-right">Tenant Pays</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody>
              {(() => {
                const rowEl = (r: Row, i: number) => {
                const co = coByKey.get(r.key) ?? 0;
                const tx = xfer.get(r.key) ?? 0;
                const ad = addByKey.get(r.key) ?? 0;
                const budget = r2(num(r.priced) - num(r.discount) + tx + co + ad);
                return (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="px-1 py-1"><Input className="h-8" value={r.description} aria-label="Budget line" onChange={(e) => update(i, { description: e.target.value })} /></td>
                    <td className="px-1 py-1">
                      <Select value={r.bucket} onValueChange={(v) => update(i, { bucket: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="pm-scope">{Object.entries(BUCKET_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-1 py-1">
                      <Select value={(bundle.scopeSetup ?? []).find((sc) => sc.lineKeys.includes(r.key))?.id ?? 'none'}
                              disabled={!baseline.some((b: any) => b.key === r.key)} onValueChange={(v) => setScope(r.key, v)}>
                        <SelectTrigger className="h-8 text-xs" title={baseline.some((b: any) => b.key === r.key) ? 'Which part of the project this line belongs to (Funding by Scope)' : 'Save the budget first'}><SelectValue /></SelectTrigger>
                        <SelectContent className="pm-scope">
                          <SelectItem value="none">None</SelectItem>
                          {(bundle.scopeSetup ?? []).map((sc) => <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>)}
                          <SelectItem value="__new__">New Scope…</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-1 py-1"><MoneyInput className="h-8" value={r.priced} aria-label="Priced" onValueChange={(v) => update(i, { priced: v })} /></td>
                    {showDiscount && <td className="px-1 py-1"><MoneyInput className="h-8" value={r.discount} aria-label="Discount" onValueChange={(v) => update(i, { discount: v })} /></td>}
                    {confirmed && <td className="px-2 py-1 text-right tabular-nums text-gray-700">{signedMoney(origBy.get(r.key) ?? 0)}</td>}
                    {hasRev && <td className="px-2 py-1 text-right tabular-nums text-gray-700">{revisionOf(r) ? signedMoney(revisionOf(r)) : ''}</td>}
                    {hasAdd && <td className="px-2 py-1 text-right tabular-nums text-violet-800">{ad ? signedMoney(ad) : ''}</td>}
                    {hasXfer && <td className={`px-2 py-1 text-right tabular-nums ${tx < 0 ? 'text-red-700' : 'text-green-700'}`}>{tx ? signedMoney(tx) : ''}</td>}
                    {hasCos && <td className="px-2 py-1 text-right tabular-nums text-gray-700">{co ? signedMoney(co) : ''}</td>}
                    <td className="px-2 py-1 text-right tabular-nums font-medium">{signedMoney(budget)}</td>
                    <td className="px-1 py-1"><PercentInput className="h-8" value={r.tenantSharePct} aria-label="Tenant pays" onValueChange={(v) => update(i, { tenantSharePct: v })} /></td>
                    <td className="px-1 text-center">
                      <button className="p-1 text-gray-400 hover:text-red-700" title="Remove this budget line"
                              onClick={() => {
                                const why = [mappedKeys.has(r.key) && 'contract lines are mapped to it', coKeys.has(r.key) && 'a change order uses it'].filter(Boolean).join(' and ');
                                if (why && !window.confirm(`${r.description}: ${why}. Remove it anyway? That money will show as Unallocated until re-mapped.`)) return;
                                setRows(rows.filter((_, j) => j !== i));
                              }}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
                };
                const scopes = bundle.scopeSetup ?? [];
                if (!scopes.length) return rows.map(rowEl);
                // Grouped by scope (Sitework, Tenant Improvements…): a heading and subtotal each; lines in none at the end.
                const groupOf = (k: string) => scopes.findIndex((sc) => sc.lineKeys.includes(k));
                const lead = 3 + (showDiscount ? 1 : 0) + (confirmed ? 1 : 0) + (hasRev ? 1 : 0) + (hasAdd ? 1 : 0) + (hasXfer ? 1 : 0) + (hasCos ? 1 : 0);
                return [...scopes.map((sc, gi) => ({ name: sc.name, gi })), { name: 'Not in a Scope', gi: -1 }].flatMap(({ name, gi }) => {
                  const idx = rows.map((r, i) => ({ r, i })).filter(({ r }) => groupOf(r.key) === gi);
                  if (!idx.length) return [];
                  const sumPriced = r2(idx.reduce((t, { r }) => t + num(r.priced), 0));
                  const sumBudget = r2(idx.reduce((t, { r }) => t + num(r.priced) - num(r.discount) + (xfer.get(r.key) ?? 0) + (coByKey.get(r.key) ?? 0) + (addByKey.get(r.key) ?? 0), 0));
                  return [
                    <tr key={`h-${gi}`} className="bg-slate-50 border-b"><td colSpan={lead + 4} className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">{name}</td></tr>,
                    ...idx.map(({ r, i }) => rowEl(r, i)),
                    <tr key={`t-${gi}`} className="border-b bg-slate-50/60 font-semibold">
                      <td className="px-2 py-1" colSpan={3}>{name} Subtotal</td>
                      <td className="px-2 py-1 text-right tabular-nums">{money(sumPriced)}</td>
                      {Array.from({ length: lead - 3 }).map((_, k) => <td key={k} />)}
                      <td className="px-2 py-1 text-right tabular-nums">{money(sumBudget)}</td>
                      <td colSpan={2} />
                    </tr>,
                  ];
                });
              })()}
              {Math.abs(addPool) >= 0.005 && (
                <tr className="bg-violet-50/60 border-t">
                  <td className="px-2 py-1.5 text-violet-900" colSpan={4 + (showDiscount ? 1 : 0) + (confirmed ? 1 : 0) + (hasRev ? 1 : 0)}>Additional Funding <span className="text-[11px] text-violet-700">· not on a budget line yet; put it on a line below when you know where it goes</span></td>
                  {hasAdd && <td className="px-2 py-1.5 text-right tabular-nums text-violet-800">{signedMoney(addPool)}</td>}
                  {hasXfer && <td />}
                  {hasCos && <td />}
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{signedMoney(addPool)}</td>
                  <td colSpan={2} />
                </tr>
              )}
              {showDiscount && Math.abs(unplaced) >= 0.005 && (
                <tr className="bg-indigo-50/60 border-t">
                  <td className="px-2 py-1.5 italic text-indigo-900" colSpan={4}>{unplaced >= 0 ? 'Deal discount' : 'Deal premium'} — not on a line yet</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-indigo-900">{money(unplaced)}</td>
                  {confirmed && <td className="px-2 py-1.5 text-right tabular-nums text-indigo-900">{signedMoney(origBy.get(DEAL_DISCOUNT_KEY) ?? 0)}</td>}
                  {hasRev && <td />}
                  {hasAdd && <td />}
                  {hasXfer && <td />}
                  {hasCos && <td />}
                  <td className="px-2 py-1.5 text-right tabular-nums text-indigo-900">{signedMoney(-unplaced)}</td>
                  <td colSpan={2} />
                </tr>
              )}
              {Math.abs(coOther) >= 0.005 && (
                <tr className="border-t">
                  <td className="px-2 py-1.5 text-gray-700" colSpan={(showDiscount ? 5 : 4) + (hasAdd ? 1 : 0) + (hasXfer ? 1 : 0) + (confirmed ? 1 : 0) + (hasRev ? 1 : 0)}>Supplemental CM Fee <span className="text-[11px] text-gray-500">— CM fee on change orders, kept apart from the original CM fee</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{signedMoney(coOther)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{signedMoney(coOther)}</td>
                  <td colSpan={2} />
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-800 font-semibold">
                <td className="px-2 py-2" colSpan={3}>Total{typedLaf != null && !hasCos && !hasAdd ? ' (= LAF)' : ''}</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(priced)}</td>
                {showDiscount && <td className="px-2 py-2 text-right tabular-nums">{money(discount)}</td>}
                {confirmed && <td className="px-2 py-2 text-right tabular-nums">{money(a.originalTotal ?? 0)}</td>}
                {hasRev && <td className="px-2 py-2 text-right tabular-nums">{signedMoney(r2(rows.reduce((t, r) => t + revisionOf(r), 0)))}</td>}
                {hasAdd && <td className="px-2 py-2 text-right tabular-nums text-violet-800">{signedMoney(addTotal)}</td>}
                {hasXfer && <td className="px-2 py-2 text-right tabular-nums text-gray-500">{money(0)}</td>}
                {hasCos && <td className="px-2 py-2 text-right tabular-nums">{signedMoney(a.coSummary.approved)}</td>}
                <td className="px-2 py-2 text-right tabular-nums">{money(current)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex justify-between gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setRows([...rows, {
            key: `b-${Date.now().toString(36)}`, description: '', bucket: 'contractor', priced: '0.00', discount: '', tenantSharePct: '100.00',
          }])}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Budget Line
          </Button>
          {!fForm && baseline.length > 0 && (
            <Button variant="outline" size="sm" disabled={dirty} title={dirty ? 'Save the budget first' : 'New money that isn\'t a change order: an allowance the tenant exercised under the lease, say'}
                    onClick={() => setFForm({ key: '__none__', amount: '', label: 'Additional TI Allowance', source: 'amortized', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()), note: '' })}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Additional Funding
            </Button>
          )}
          {!xForm && baseline.length > 1 && (
            <Button variant="outline" size="sm" disabled={dirty} title={dirty ? 'Save the budget first' : 'Move money between lines; the total stays the same'}
                    onClick={() => setXForm({ fromKey: '', toKey: '', amount: '', note: '' })}>
              <ArrowRightLeft className="h-3.5 w-3.5 mr-1" /> Move Money
            </Button>
          )}
          <div className="flex gap-2">
            {dirty && <Button variant="ghost" size="sm" onClick={() => { setRows(fromServer()); setLaf(serverLaf()); }}>Discard</Button>}
            <Button size="sm" disabled={!dirty || saving || rows.some((r) => !r.description.trim())} onClick={save}>
              {saving ? 'Saving…' : confirmed ? 'Save Revision' : 'Save Budget'}
            </Button>
          </div>
        </div>

        {xForm && (
          <div className="border rounded-md bg-blue-50/40 p-3 space-y-2">
            <div className="text-sm font-medium text-gray-900">Move money between budget lines — the total stays the same</div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-end">
              <div className="lg:col-span-3 space-y-1"><div className="text-xs text-gray-600">From</div>
                <Select value={xForm.fromKey || undefined} onValueChange={(v) => setXForm({ ...xForm, fromKey: v })}>
                  <SelectTrigger className="h-9 data-[placeholder]:text-gray-900"><SelectValue placeholder="— choose —" /></SelectTrigger>
                  <SelectContent className="pm-scope">{baseline.map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="lg:col-span-3 space-y-1"><div className="text-xs text-gray-600">To</div>
                <Select value={xForm.toKey || undefined} onValueChange={(v) => setXForm({ ...xForm, toKey: v })}>
                  <SelectTrigger className="h-9 data-[placeholder]:text-gray-900"><SelectValue placeholder="— choose —" /></SelectTrigger>
                  <SelectContent className="pm-scope">{baseline.filter((b) => b.key !== xForm.fromKey).map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="lg:col-span-2 space-y-1"><div className="text-xs text-gray-600">Amount</div>
                <MoneyInput className="h-9" value={xForm.amount} onValueChange={(v) => setXForm({ ...xForm, amount: v })} />
              </div>
              <div className="lg:col-span-4 space-y-1"><div className="text-xs text-gray-600">Why</div>
                <Input className="h-9" value={xForm.note} onChange={(e) => setXForm({ ...xForm, note: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setXForm(null)}>Cancel</Button>
              <Button size="sm" disabled={!xForm.fromKey || !xForm.toKey || !(num(xForm.amount) > 0)} onClick={moveMoney}>Move Money</Button>
            </div>
          </div>
        )}

        {fForm && (
          <div className="border rounded-md p-3 space-y-2 bg-violet-50/40">
            <div className="text-sm font-semibold">Additional Funding <span className="text-xs font-normal text-gray-600">· raises the budget without a change order</span></div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
              <div className="lg:col-span-3 space-y-1"><div className="text-xs text-gray-600">What It Is</div>
                <Input className="h-9" value={fForm.label} onChange={(e) => setFForm({ ...fForm, label: e.target.value })} /></div>
              <div className="lg:col-span-3 space-y-1"><div className="text-xs text-gray-600">Paid By</div>
                <Select value={fForm.source} onValueChange={(v) => setFForm({ ...fForm, source: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="pm-scope">
                    <SelectItem value="amortized">Landlord, Repaid Through Rent</SelectItem>
                    <SelectItem value="tenant">Tenant</SelectItem>
                    <SelectItem value="partner">Capital Partner</SelectItem>
                  </SelectContent>
                </Select></div>
              <div className="lg:col-span-3 space-y-1"><div className="text-xs text-gray-600">Budget Line (Optional)</div>
                <Select value={fForm.key} onValueChange={(v) => setFForm({ ...fForm, key: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="pm-scope">
                    <SelectItem value="__none__">Not on a Line Yet</SelectItem>
                    {baseline.map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}
                  </SelectContent>
                </Select></div>
              <div className="lg:col-span-2 space-y-1"><div className="text-xs text-gray-600">Amount</div>
                <MoneyInput className="h-9" value={fForm.amount} onValueChange={(v) => setFForm({ ...fForm, amount: v })} /></div>
              <div className="lg:col-span-1 space-y-1"><div className="text-xs text-gray-600">Date</div>
                <Input type="date" className="h-9 px-1 text-xs" value={fForm.date} onChange={(e) => setFForm({ ...fForm, date: e.target.value })} /></div>
              <div className="lg:col-span-12 space-y-1"><div className="text-xs text-gray-600">Note</div>
                <Input className="h-9" value={fForm.note} onChange={(e) => setFForm({ ...fForm, note: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setFForm(null)}>Cancel</Button>
              <Button size="sm" disabled={!num(fForm.amount)} onClick={addFunding}>Add Funding</Button>
            </div>
          </div>
        )}

        {hasAdd && (
          <details className="text-xs text-gray-700" open>
            <summary className="cursor-pointer font-medium text-gray-700">Additional Funding ({adds.length}) · {money(addTotal)}</summary>
            <table className="w-full mt-1 text-xs">
              <tbody>
                {adds.slice().reverse().map((x) => (
                  <tr key={x.id} className="border-b last:border-0">
                    <td className="py-1 pr-2 whitespace-nowrap">{shortDate(x.date)}</td>
                    <td className="py-1 pr-2 tabular-nums whitespace-nowrap font-medium">{money(x.amount)}</td>
                    <td className="py-1 pr-2">{x.label} <span className="text-gray-500">· {x.source === 'amortized' ? 'landlord, repaid through rent' : x.source === 'tenant' ? 'tenant' : 'capital partner'}</span>{x.note ? <span className="text-gray-500"> · {x.note}</span> : null}</td>
                    <td className="py-1 pr-2 w-64">
                      <Select value={x.key && baseline.some((b: any) => b.key === x.key) ? x.key : '__none__'} onValueChange={(v) => assignFunding(x.id, v)}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="pm-scope">
                          <SelectItem value="__none__">Not on a Line Yet</SelectItem>
                          {baseline.map((b) => <SelectItem key={b.key} value={b.key}>On {b.description}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-1 pr-2 text-gray-500 whitespace-nowrap">{x.by || ''}</td>
                    <td className="py-1 text-right">
                      <button className="text-gray-400 hover:text-red-700" title="Remove this funding"
                              onClick={() => { if (window.confirm(`Remove ${x.label} (${money(x.amount)})?`)) removeFunding(x.id); }}>
                        <Trash2 className="h-3.5 w-3.5 inline" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}

        {hasXfer && (
          <details className="text-xs text-gray-700" open>
            <summary className="cursor-pointer font-medium text-gray-700">Transfers ({a.transfers.length})</summary>
            <table className="w-full mt-1 text-xs">
              <tbody>
                {a.transfers.slice().reverse().map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-1 pr-2 whitespace-nowrap">{shortDate(t.date)}</td>
                    <td className="py-1 pr-2 tabular-nums whitespace-nowrap font-medium">{money(t.amount)}</td>
                    <td className="py-1 pr-2">{lineName(t.fromKey)} → {lineName(t.toKey)}{t.note ? <span className="text-gray-500"> — {t.note}</span> : null}</td>
                    <td className="py-1 pr-2 text-gray-500 whitespace-nowrap">{t.by || ''}</td>
                    <td className="py-1 text-right">
                      <button className="text-gray-400 hover:text-red-700" title="Undo this transfer"
                              onClick={() => { if (window.confirm(`Undo moving ${money(t.amount)} from ${lineName(t.fromKey)} to ${lineName(t.toKey)}?`)) undoTransfer(t.id); }}>
                        <Trash2 className="h-3.5 w-3.5 inline" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}

        {confirmed && a.revisions.length > 0 && (
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer font-medium text-gray-700">Revisions ({a.revisions.length})</summary>
            <div className="mt-1 space-y-0.5">
              {a.revisions.slice().reverse().map((rv, i) => (
                <div key={i}>{shortDate(rv.at)} — {rv.note}: budget {money(rv.total)}{rv.by ? ` (${rv.by})` : ''}</div>
              ))}
            </div>
          </details>
        )}

      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone || 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

/** The roll-up the team sees: construction lines with the soft costs folded in. */
export function TeamRollUp({ baseline }: { baseline: ProjectBundle['project']['baseline'] }) {
  const [showRollUp, setShowRollUp] = useState(false);
  const rolled = useMemo(() => rollUp(baseline), [baseline]);
  return (
    <div className="bg-white border rounded-lg">
                  <button className="w-full flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-800" onClick={() => setShowRollUp(!showRollUp)}>
            {showRollUp ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Team Roll-Up
            <span className="ml-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600 bg-gray-100 border border-gray-300 rounded px-1.5 py-0.5">Reference only</span>
          </button>
          {showRollUp && (
            <div className="px-3 pb-3 overflow-x-auto">
              <div className="text-xs bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1.5 mb-2 text-gray-700">
                <span className="font-semibold">For reference only.</span> The construction lines with the soft costs ({money(rolled.soft)}) folded in pro rata, the
                way it's shown to the team. Nothing here is tracked, billed or printed — the budget table above is the budget.
              </div>
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                    <th className="py-1 pr-2">Line</th><th className="py-1 pr-2 text-right">Priced</th>
                    <th className="py-1 pr-2 text-right">Soft Costs</th><th className="py-1 text-right">Rolled Up</th>
                  </tr>
                </thead>
                <tbody>
                  {rolled.rows.map((x) => (
                    <tr key={x.key} className="border-b last:border-0">
                      <td className="py-1 pr-2">{x.description}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-gray-600">{money(x.priced)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-gray-600">{money(x.softShare)}</td>
                      <td className="py-1 text-right tabular-nums font-medium">{money(x.rolledUp)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-800 font-semibold">
                    <td className="py-1.5 pr-2" colSpan={3}>Total</td>
                    <td className="py-1.5 text-right tabular-nums">{money(rolled.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
  );
}
