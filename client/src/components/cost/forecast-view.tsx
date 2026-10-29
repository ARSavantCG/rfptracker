/**
 * Forecast tab — Estimate to Complete (Adolfo, 2026-10-29). By budget line: budget,
 * committed, billed to date, what's left on the commitments (assumed spent unless adjusted),
 * pending change orders, and forecast items the PM adds (a permit fee no contract covers, an
 * expected change, a commitment that won't be fully used). ETC and EAC worked out from those;
 * variance against the budget. Prints as the Estimate to Complete report.
 */
import { Fragment, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { ChevronDown, ChevronRight, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { FORECAST_KINDS, type ForecastItem, type ForecastKind, type ForecastRow } from '@shared/forecast';
import { parseAmount } from '@shared/format';
import { MoneyInput } from './inputs';
import { money, openReport, projectKey, shortDate, type ProjectBundle } from './types';

const KIND_SHORT: Record<ForecastKind, string> = { cost: 'Anticipated Cost', change: 'Anticipated Change', adjust: 'Commitment Adjustment' };
type Draft = { id?: string; key: string; kind: ForecastKind; description: string; amount: string; note: string; atLine?: boolean };

const signed = (v: number) => (v < -0.005 ? `(${money(-v)})` : money(v));

export function ForecastView({ bundle: b, projectId }: { bundle: ProjectBundle; projectId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const F = b.forecast;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // Grouped like the budget: by scope (Site Work, Tenant Improvements) when set up.
  const groups = useMemo(() => {
    const scopes = b.scopeSetup ?? [];
    const used = new Set<string>();
    const out: Array<{ name: string; rows: ForecastRow[] }> = [];
    for (const sc of scopes) {
      const rows = F.rows.filter((r) => sc.lineKeys.includes(r.key) && !used.has(r.key));
      rows.forEach((r) => used.add(r.key));
      if (rows.length) out.push({ name: sc.name, rows });
    }
    const rest = F.rows.filter((r) => !used.has(r.key));
    if (rest.length) out.push({ name: scopes.length ? 'Other' : '', rows: rest });
    return out;
  }, [F.rows, b.scopeSetup]);

  const apply = (data: any, title: string) => { qc.setQueryData([projectKey(projectId)], data); toast({ title }); };
  const save = async () => {
    if (!draft) return;
    const amount = parseAmount(draft.amount);
    if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) { toast({ title: 'Enter the amount', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      const body = { key: draft.key, kind: draft.kind, description: draft.description, amount, note: draft.note };
      const data = draft.id
        ? await apiRequest(`/api/cost-projects/${projectId}/forecast/items/${draft.id}`, 'PATCH', body)
        : await apiRequest(`/api/cost-projects/${projectId}/forecast/items`, 'POST', body);
      apply(data, draft.id ? 'Forecast Updated' : 'Added to the Forecast');
      setOpen((s) => new Set(s).add(draft.key));
      setDraft(null);
    } catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const remove = async (it: ForecastItem) => {
    if (!window.confirm(`Remove "${it.description}" (${money(it.amount)}) from the forecast?`)) return;
    try { apply(await apiRequest(`/api/cost-projects/${projectId}/forecast/items/${it.id}`, 'DELETE'), 'Removed'); }
    catch (e: any) { toast({ title: 'Not Removed', description: e?.message, variant: 'destructive' }); }
  };
  const setPending = async (v: boolean) => {
    try { apply(await apiRequest(`/api/cost-projects/${projectId}/forecast/options`, 'PUT', { includePending: v }), 'Saved'); }
    catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
  };
  const print = () => { openReport(`/api/reports/forecast/${projectId}`).then((ok) => { if (!ok) toast({ title: 'Report Failed', variant: 'destructive' }); }); };

  const T = F.totals;
  // Pending change orders get a column only when there are any to count.
  const showPend = F.includePending && Math.abs(T.pending) >= 0.005;
  const cols = showPend ? 11 : 10;
  const tile = (label: string, value: string, sub?: string, tone?: string) => (
    <div className="bg-white border rounded-lg px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );

  const form = (d: Draft) => (
    <div className="grid grid-cols-2 lg:grid-cols-12 gap-2 items-end">
      <div className="col-span-2 lg:col-span-3 space-y-1">
        <div className="text-xs text-gray-600">Budget Line</div>
        <Select value={d.key || undefined} onValueChange={(v) => setDraft({ ...d, key: v })}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Pick the Budget Line" /></SelectTrigger>
          <SelectContent className="pm-scope">{F.rows.map((r) => <SelectItem key={r.key} value={r.key}>{r.description}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="col-span-2 lg:col-span-3 space-y-1">
        <div className="text-xs text-gray-600">Type</div>
        <Select value={d.kind} onValueChange={(v) => setDraft({ ...d, kind: v as ForecastKind })}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent className="pm-scope">{FORECAST_KINDS.map((k) => <SelectItem key={k.key} value={k.key}>{k.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="col-span-2 lg:col-span-3 space-y-1">
        <div className="text-xs text-gray-600">Description</div>
        <Input className="h-9" value={d.description} onChange={(e) => setDraft({ ...d, description: e.target.value })} />
      </div>
      <div className="space-y-1 lg:col-span-2">
        <div className="text-xs text-gray-600">Amount{d.kind === 'adjust' ? ' (− if Savings)' : ''}</div>
        <MoneyInput className="h-9" value={d.amount} onValueChange={(v) => setDraft({ ...d, amount: v })} />
      </div>
      <div className="col-span-2 lg:col-span-10 space-y-1">
        <div className="text-xs text-gray-600">Note</div>
        <Input className="h-9" value={d.note} onChange={(e) => setDraft({ ...d, note: e.target.value })} />
      </div>
      <div className="col-span-2 flex gap-2 justify-end">
        <Button variant="ghost" className="h-9" onClick={() => setDraft(null)}>Cancel</Button>
        <Button className="h-9" disabled={busy || !d.key || !d.description.trim() || !d.amount} onClick={save}>{d.id ? 'Save' : 'Add'}</Button>
      </div>
    </div>
  );

  const num = (v: number, cls = '') => <td className={`px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap ${cls}`}>{Math.abs(v) >= 0.005 ? signed(v) : <span className="text-gray-300">—</span>}</td>;
  const sumRows = (rows: ForecastRow[], k: keyof ForecastRow) => rows.reduce((t, r) => t + (r[k] as number), 0);

  return (
    <div className="space-y-3">
      <div className="bg-white border rounded-lg p-4 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-gray-900">Estimate to Complete</h2>
            <p className="text-sm text-gray-600 max-w-3xl">What's left on each commitment is assumed spent (a $1,000,000 contract billed $800,000 has $200,000 to go). Add forecast items for costs no contract covers, changes you expect, or a commitment that won't be fully used. Budget that isn't committed or forecast isn't counted.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="h-9" onClick={() => setDraft({ key: '', kind: 'cost', description: '', amount: '', note: '' })}><Plus className="h-4 w-4 mr-1" /> Forecast Item</Button>
            <Button variant="outline" className="h-9" onClick={print}><Printer className="h-4 w-4 mr-1" /> Print</Button>
          </div>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="h-4 w-4" checked={F.includePending} onChange={(e) => setPending(e.target.checked)} />
          Count pending change orders in the forecast ({money(T.pending)})
        </label>
        {draft && !draft.id && !draft.atLine && <div className="border-t pt-3">{form(draft)}</div>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
        {tile('Current Budget', money(T.budget))}
        {tile('Billed to Date', money(T.toDate), `of ${money(T.committed)} committed`)}
        {tile('Left on Commitments', money(T.remaining))}
        {tile('Forecast Items', signed(T.forecast), F.includePending && T.pending ? `+ ${money(T.pending)} pending COs` : undefined)}
        {tile('Estimate at Completion', money(T.eac), `to complete ${money(T.etc)}`)}
        {tile(T.variance < -0.005 ? 'Projected Over Budget' : 'Projected Under Budget', money(Math.abs(T.variance)), undefined, T.variance < -0.005 ? 'text-red-700' : 'text-green-700')}
      </div>

      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[1040px] table-fixed">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide text-gray-600 border-b leading-tight align-bottom">
              <th className="px-2 py-2 text-left">Budget Line</th>
              <th className="px-1.5 py-2 text-right whitespace-normal w-[96px]">Budget</th>
              <th className="px-1.5 py-2 text-right whitespace-normal w-[96px]">Committed</th>
              <th className="px-1.5 py-2 text-right whitespace-normal w-[96px]">Billed to Date</th>
              <th className="px-1.5 py-2 text-right whitespace-normal w-[96px]">Left on Commitments</th>
              {showPend && <th className="px-1.5 py-2 text-right whitespace-normal w-[96px]">Pending COs</th>}
              <th className="px-1.5 py-2 text-right whitespace-normal w-[96px]">Forecast Items</th>
              <th className="px-1.5 py-2 text-right whitespace-normal w-[96px]">Est. to Complete</th>
              <th className="px-1.5 py-2 text-right whitespace-normal w-[96px]">Est. at Completion</th>
              <th className="px-1.5 py-2 text-right whitespace-normal w-[96px]">Variance</th>
              <th className="w-7" />
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.name || 'all'}>
              {g.name && <tr className="bg-slate-50 border-b"><td colSpan={cols} className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">{g.name}</td></tr>}
              {g.rows.map((r) => {
                const isOpen = open.has(r.key);
                return (
                  <Fragment key={r.key}>
                    <tr className={`border-b ${r.variance < -0.005 ? 'bg-red-50/40' : ''}`}>
                      <td className="px-2 py-1.5">
                        <button className="inline-flex items-center gap-1 text-left hover:text-blue-800" onClick={() => toggle(r.key)} title="Show its forecast items">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />}
                          <span>{r.description}</span>
                          {r.items.length > 0 && <span className="text-[11px] text-violet-700">· {r.items.length}</span>}
                        </button>
                      </td>
                      {num(r.budget)}{num(r.committed)}{num(r.toDate)}{num(r.remaining)}
                      {showPend && num(r.pending, 'text-amber-800')}
                      {num(r.forecast, 'text-violet-800')}
                      {num(r.etc, 'font-medium')}{num(r.eac, 'font-semibold')}
                      {num(r.variance, r.variance < -0.005 ? 'text-red-700 font-semibold' : 'text-green-700')}
                      <td className="px-1 text-center">
                        <button className="text-gray-400 hover:text-blue-700" title="Add a forecast item to this line"
                                onClick={() => { setOpen((s) => new Set(s).add(r.key)); setDraft({ key: r.key, kind: 'cost', description: '', amount: '', note: '', atLine: true }); }}>
                          <Plus className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b bg-violet-50/30">
                        <td colSpan={cols} className="px-8 py-2 space-y-2">
                          {r.items.length === 0 && !(draft && draft.atLine && draft.key === r.key && !draft.id) && (
                            <div className="text-xs text-gray-500">No forecast items. Left on commitments ({money(r.remaining)}) is what's assumed to come{r.uncommitted > 0.005 ? `; ${money(r.uncommitted)} of its budget isn't committed or forecast` : ''}.</div>
                          )}
                          {r.items.map((it) => draft?.id === it.id ? <div key={it.id}>{form(draft)}</div> : (
                            <div key={it.id} className="flex items-center gap-3 text-sm">
                              <span className="text-[11px] font-medium text-violet-800 w-40 flex-shrink-0">{KIND_SHORT[it.kind]}</span>
                              <span className="flex-1">{it.description}{it.note ? <span className="text-xs text-gray-500 italic"> · {it.note}</span> : null}</span>
                              <span className="text-xs text-gray-500 whitespace-nowrap">{it.date ? shortDate(it.date) : ''}{it.by ? ` · ${it.by}` : ''}</span>
                              <span className="tabular-nums w-28 text-right">{signed(it.amount)}</span>
                              <button className="text-gray-400 hover:text-blue-700" title="Edit" onClick={() => setDraft({ id: it.id, key: it.key, kind: it.kind, description: it.description, amount: it.amount.toFixed(2), note: it.note ?? '' })}><Pencil className="h-3.5 w-3.5" /></button>
                              <button className="text-gray-400 hover:text-red-700" title="Remove" onClick={() => remove(it)}><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          ))}
                          {draft && draft.atLine && draft.key === r.key && !draft.id && <div className="pt-1">{form(draft)}</div>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {g.name && (
                <tr className="border-b bg-slate-50/70 font-semibold">
                  <td className="px-2 py-1.5">{g.name} Subtotal</td>
                  {(['budget', 'committed', 'toDate', 'remaining'] as const).map((k) => <Fragment key={k}>{num(sumRows(g.rows, k))}</Fragment>)}
                  {showPend && num(sumRows(g.rows, 'pending'))}
                  {(['forecast', 'etc', 'eac', 'variance'] as const).map((k) => <Fragment key={k}>{num(sumRows(g.rows, k), k === 'variance' && sumRows(g.rows, k) < -0.005 ? 'text-red-700' : '')}</Fragment>)}
                  <td />
                </tr>
              )}
            </tbody>
          ))}
          <tfoot>
            <tr className="border-t-2 border-gray-800 font-semibold">
              <td className="px-2 py-2">Total</td>
              {num(T.budget)}{num(T.committed)}{num(T.toDate)}{num(T.remaining)}{showPend && num(T.pending)}
              {num(T.forecast)}{num(T.etc)}{num(T.eac)}{num(T.variance, T.variance < -0.005 ? 'text-red-700' : 'text-green-700')}<td />
            </tr>
          </tfoot>
        </table>
      </div>
      {F.orphans.length > 0 && (
        <div className="text-sm bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-2.5">
          {F.orphans.length} forecast item{F.orphans.length === 1 ? ' is' : 's are'} on a budget line that's been removed ({money(F.orphans.reduce((t, i) => t + i.amount, 0))}): {F.orphans.map((i) => i.description).join(', ')}. They still count in the totals.
        </div>
      )}
    </div>
  );
}
