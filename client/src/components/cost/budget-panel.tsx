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
import { fmtMoneyText, fmtPctText } from '@shared/format';
import { MoneyInput, PercentInput } from './inputs';
import { money, signedMoney, projectKey, shortDate, BUCKET_LABEL, type ProjectBundle } from './types';

const num = (s: string | number | null | undefined) => {
  const v = parseFloat(String(s ?? '').replace(/[$,\s]/g, ''));
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
  const [xForm, setXForm] = useState<{ fromKey: string; toKey: string; amount: string; note: string } | null>(null);
  const lineName = (k: string) => baseline.find((b) => b.key === k)?.description ?? 'Removed line';
  const moveMoney = async () => {
    if (!xForm) return;
    try {
      const data = await apiRequest(`/api/cost-projects/${projectId}/budget-transfers`, 'POST', { ...xForm, amount: xForm.amount.replace(/,/g, '') });
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: 'Money moved', description: `${lineName(xForm.fromKey)} → ${lineName(xForm.toKey)}` });
      setXForm(null);
    } catch (e: any) { toast({ title: 'Not moved', description: e?.message, variant: 'destructive' }); }
  };
  const undoTransfer = async (id: string) => {
    try {
      const data = await apiRequest(`/api/cost-projects/${projectId}/budget-transfers/${id}`, 'DELETE');
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: 'Transfer undone' });
    } catch (e: any) { toast({ title: 'Not undone', description: e?.message, variant: 'destructive' }); }
  };

  const priced = r2(rows.reduce((s, r) => s + num(r.priced), 0));
  const typedLaf = laf.trim() === '' ? null : num(laf);
  const discount = typedLaf == null ? 0 : r2(priced - typedLaf);
  const placed = r2(rows.reduce((s, r) => s + num(r.discount), 0));
  const unplaced = r2(discount - placed);
  const lafBudget = r2(priced - discount);
  const current = r2(lafBudget + a.coSummary.approved);
  // A discount column only earns its place when there is a discount (or premium) to put on lines.
  const showDiscount = (typedLaf != null && (!confirmed || Math.abs(discount) >= 0.005)) || placed !== 0;
  // Once confirmed: the original per line, and anything edited since as a revision.
  const origBy = useMemo(() => new Map(bundle.breakdown.map((r) => [r.key, r.original])), [bundle.breakdown]);
  const lineBudget = (r: Row) => r2(num(r.priced) - num(r.discount) + (xfer.get(r.key) ?? 0) + (coByKey.get(r.key) ?? 0));
  const revisionOf = (r: Row) => confirmed ? r2(lineBudget(r) - (origBy.get(r.key) ?? 0) - (xfer.get(r.key) ?? 0) - (coByKey.get(r.key) ?? 0)) : 0;
  const hasRev = confirmed && rows.some((r) => Math.abs(revisionOf(r)) >= 0.005);

  const dirty = JSON.stringify(rows) !== JSON.stringify(fromServer()) || laf !== serverLaf();
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
      toast({ title: 'Not saved', description: e?.message, variant: 'destructive' });
      queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
    } finally { setSaving(false); }
  };
  const post = async (path: string, ok: string) => {
    try {
      const data = await apiRequest(`/api/cost-projects/${projectId}/approval/${path}`, 'POST', {});
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: ok });
    } catch (e: any) { toast({ title: 'Not done', description: e?.message, variant: 'destructive' }); }
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
              Reopen as draft
            </Button>
          ) : (
            <Button size="sm" disabled={dirty || a.lafTotal == null} title={dirty ? 'Save first' : a.lafTotal == null ? 'Enter and save the LAF total first' : undefined}
                    onClick={() => { if (window.confirm(`Confirm ${money(a.approvedTotal)} as the original budget?`)) post('confirm', 'Budget confirmed'); }}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Confirm budget
            </Button>
          )}
        </div>
      </div>

      <div className={`p-4 space-y-4 ${rolled ? 'hidden' : ''}`}>
        <div className={`grid grid-cols-2 ${hasCos ? 'lg:grid-cols-5' : 'lg:grid-cols-3'} gap-3`}>
          <Stat label="Priced" value={money(priced)} />
          <div>
            <label className="text-[11px] uppercase tracking-wide text-gray-500" htmlFor="laf-total">LAF total</label>
            <MoneyInput id="laf-total" className="h-9 font-semibold" value={laf} onValueChange={setLaf} />
          </div>
          <Stat label={discount >= 0 ? 'Deal discount' : 'Deal premium'} value={typedLaf == null ? '—' : money(Math.abs(discount))} tone="text-indigo-800" />
          {hasCos && <Stat label="Approved COs" value={signedMoney(a.coSummary.approved)} />}
          {hasCos && <Stat label={confirmed ? 'Revised budget' : 'Budget with COs'} value={money(current)} />}
        </div>

        <div className="overflow-x-auto border rounded-md">
          <table className={`w-full text-sm ${confirmed ? 'min-w-[1180px]' : 'min-w-[900px]'}`}>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b bg-gray-50">
                <th className="px-2 py-1.5 min-w-[220px]">Budget line</th>
                <th className="px-2 py-1.5 w-40">Contract</th>
                <th className="px-2 py-1.5 w-36 text-right">Priced</th>
                {showDiscount && <th className="px-2 py-1.5 w-36 text-right">Discount</th>}
                {confirmed && <th className="px-2 py-1.5 w-32 text-right" title="As confirmed">Original</th>}
                {hasRev && <th className="px-2 py-1.5 w-28 text-right" title="Lines edited after the budget was confirmed">Revisions</th>}
                {hasXfer && <th className="px-2 py-1.5 w-32 text-right">Transfers</th>}
                {hasCos && <th className="px-2 py-1.5 w-32 text-right">Approved COs</th>}
                <th className="px-2 py-1.5 w-36 text-right">{confirmed ? 'Revised budget' : 'Budget'}</th>
                <th className="px-2 py-1.5 w-28 text-right">Tenant pays</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const co = coByKey.get(r.key) ?? 0;
                const tx = xfer.get(r.key) ?? 0;
                const budget = r2(num(r.priced) - num(r.discount) + tx + co);
                return (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="px-1 py-1"><Input className="h-8" value={r.description} aria-label="Budget line" onChange={(e) => update(i, { description: e.target.value })} /></td>
                    <td className="px-1 py-1">
                      <Select value={r.bucket} onValueChange={(v) => update(i, { bucket: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="pm-scope">{Object.entries(BUCKET_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-1 py-1"><MoneyInput className="h-8" value={r.priced} aria-label="Priced" onValueChange={(v) => update(i, { priced: v })} /></td>
                    {showDiscount && <td className="px-1 py-1"><MoneyInput className="h-8" value={r.discount} aria-label="Discount" onValueChange={(v) => update(i, { discount: v })} /></td>}
                    {confirmed && <td className="px-2 py-1 text-right tabular-nums text-gray-700">{signedMoney(origBy.get(r.key) ?? 0)}</td>}
                    {hasRev && <td className="px-2 py-1 text-right tabular-nums text-gray-700">{revisionOf(r) ? signedMoney(revisionOf(r)) : ''}</td>}
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
              })}
              {showDiscount && Math.abs(unplaced) >= 0.005 && (
                <tr className="bg-indigo-50/60 border-t">
                  <td className="px-2 py-1.5 italic text-indigo-900" colSpan={3}>{unplaced >= 0 ? 'Deal discount' : 'Deal premium'} — not on a line yet</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-indigo-900">{money(unplaced)}</td>
                  {confirmed && <td className="px-2 py-1.5 text-right tabular-nums text-indigo-900">{signedMoney(origBy.get(DEAL_DISCOUNT_KEY) ?? 0)}</td>}
                  {hasRev && <td />}
                  {hasXfer && <td />}
                  {hasCos && <td />}
                  <td className="px-2 py-1.5 text-right tabular-nums text-indigo-900">{signedMoney(-unplaced)}</td>
                  <td colSpan={2} />
                </tr>
              )}
              {Math.abs(coOther) >= 0.005 && (
                <tr className="border-t">
                  <td className="px-2 py-1.5 text-gray-700" colSpan={(showDiscount ? 4 : 3) + (hasXfer ? 1 : 0) + (confirmed ? 1 : 0) + (hasRev ? 1 : 0)}>Supplemental CM Fee <span className="text-[11px] text-gray-500">— CM fee on change orders, kept apart from the original CM fee</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{signedMoney(coOther)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{signedMoney(coOther)}</td>
                  <td colSpan={2} />
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-800 font-semibold">
                <td className="px-2 py-2" colSpan={2}>Total{typedLaf != null && !hasCos ? ' (= LAF)' : ''}</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(priced)}</td>
                {showDiscount && <td className="px-2 py-2 text-right tabular-nums">{money(discount)}</td>}
                {confirmed && <td className="px-2 py-2 text-right tabular-nums">{money(a.originalTotal ?? 0)}</td>}
                {hasRev && <td className="px-2 py-2 text-right tabular-nums">{signedMoney(r2(rows.reduce((t, r) => t + revisionOf(r), 0)))}</td>}
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
            <Plus className="h-3.5 w-3.5 mr-1" /> Budget line
          </Button>
          {!xForm && baseline.length > 1 && (
            <Button variant="outline" size="sm" disabled={dirty} title={dirty ? 'Save the budget first' : 'Move money between lines; the total stays the same'}
                    onClick={() => setXForm({ fromKey: '', toKey: '', amount: '', note: '' })}>
              <ArrowRightLeft className="h-3.5 w-3.5 mr-1" /> Move money
            </Button>
          )}
          <div className="flex gap-2">
            {dirty && <Button variant="ghost" size="sm" onClick={() => { setRows(fromServer()); setLaf(serverLaf()); }}>Discard</Button>}
            <Button size="sm" disabled={!dirty || saving || rows.some((r) => !r.description.trim())} onClick={save}>
              {saving ? 'Saving…' : confirmed ? 'Save revision' : 'Save budget'}
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
              <Button size="sm" disabled={!xForm.fromKey || !xForm.toKey || !(num(xForm.amount) > 0)} onClick={moveMoney}>Move money</Button>
            </div>
          </div>
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
            {showRollUp ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Team roll-up
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
                    <th className="py-1 pr-2 text-right">Soft costs</th><th className="py-1 text-right">Rolled up</th>
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
