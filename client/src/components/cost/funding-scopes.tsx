/**
 * Funding by Scope (Budget tab): which budget lines each pot of money pays for, drawn
 * in order, and who covers what's left over (Adolfo, 2026-10-27, PepsiCo: interior TI
 * on the tenant's allowances with overages to the tenant; site improvements ours, with
 * overages to Supplemental).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { SOURCE_KINDS, OVERAGE_RULES, scopeTemplate, type FundingScope, type FundingSource } from '@shared/funding-scopes';
import { parseAmount } from '@shared/format';
import { MoneyInput } from './inputs';
import { money, projectKey, type ProjectBundle } from './types';

const newId = () => Math.random().toString(36).slice(2, 10);

export function FundingScopes({ bundle, projectId }: { bundle: ProjectBundle; projectId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<FundingScope[] | null>(null);
  const setup = bundle.scopeSetup ?? [];
  const R = bundle.scopes;
  const save = async (scopes: FundingScope[]) => {
    try { const nb = await apiRequest(`/api/cost-projects/${projectId}/settings`, 'PUT', { fundingScopes: scopes }); qc.setQueryData([projectKey(projectId)], nb); setEdit(null); toast({ title: 'Funding Saved' }); }
    catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
  };

  return (
    <div className="bg-white border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">Funding by Scope</div>
          <p className="text-xs text-gray-600 mt-0.5">For projects paid in pieces: allowances, tenant funds and our own budget, each paying for its own budget lines, with its own rule for overages.</p>
        </div>
        <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => setEdit(setup.length ? JSON.parse(JSON.stringify(setup)) : scopeTemplate())}>
          <Pencil className="h-3.5 w-3.5 mr-1" /> {setup.length ? 'Edit' : 'Set Up'}
        </Button>
      </div>
      {!setup.length ? <p className="text-sm text-gray-500">Not set up. The project is funded the usual way: the approved budget, tenant-billed change orders and supplemental funding.</p> : (
        <div className="space-y-4">
          {R.scopes.map((s) => (
            <div key={s.id} className="border rounded-md">
              <div className="px-3 py-2 bg-gray-50 border-b flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-semibold text-sm">{s.name} <span className="text-xs font-normal text-gray-500">· {s.lines.length} budget line{s.lines.length === 1 ? '' : 's'} · overage: {OVERAGE_RULES.find((o) => o.key === s.overage)!.label}</span></div>
                <div className="text-xs text-gray-600 tabular-nums">Projected {money(s.projected)} · Work Complete {money(s.toDate)}</div>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b">
                  <th className="text-left font-medium px-3 py-1">Source (Drawn in This Order)</th><th className="text-right font-medium px-3 py-1">Amount</th>
                  <th className="text-right font-medium px-3 py-1">Used at Projected</th><th className="text-right font-medium px-3 py-1">Left</th><th className="text-right font-medium px-3 py-1">Used to Date</th>
                </tr></thead>
                <tbody>
                  {s.absorbed > 0.005 && (
                    <tr className="border-b text-gray-700">
                      <td className="px-3 py-1">Absorbed by Us <span className="text-[11px] text-gray-500">change order work not billed to the tenant; doesn't use their allowances</span></td>
                      <td className="px-3 py-1 text-right tabular-nums">—</td><td className="px-3 py-1 text-right tabular-nums">{money(s.absorbed)}</td><td /><td />
                    </tr>
                  )}
                  {s.sources.map((x) => (
                    <tr key={x.id} className="border-b">
                      <td className="px-3 py-1">{x.label}{x.kind === 'amortized' && <span className="ml-1 text-[11px] text-violet-700">repaid through rent</span>}{x.kind === 'tenant' && <span className="ml-1 text-[11px] text-gray-500">{money(x.leftToDate)} on hand</span>}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{money(x.amount)}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{money(x.projected)}</td>
                      <td className="px-3 py-1 text-right tabular-nums text-gray-600">{money(x.leftProjected)}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{money(x.toDate)}</td>
                    </tr>
                  ))}
                  <tr className={`font-semibold ${s.overageProjected > 0.005 ? (s.overage === 'tenant' ? 'text-violet-800' : 'text-red-800') : 'text-green-800'}`}>
                    <td className="px-3 py-1.5">{s.overageProjected > 0.005 ? (s.overage === 'tenant' ? 'Over the allowances: tenant pays' : 'Over our budget: Supplemental needed') : 'Within the funding'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(s.funding)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.overageProjected > 0.005 ? money(s.overageProjected) : money(0)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.unused > 0.005 ? money(s.unused) : ''}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.overageToDate > 0.005 ? money(s.overageToDate) : ''}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          {R.unassigned.lines.length > 0 && <p className="text-xs text-amber-800">Not in any scope: {R.unassigned.lines.join(', ')} ({money(R.unassigned.projected)} projected). Add them to a scope so every dollar has a source.</p>}
        </div>
      )}
      {edit && <ScopeEditor initial={edit} lines={bundle.summary.rows.map((r) => ({ key: r.key, description: r.description, budget: r.budget }))} onCancel={() => setEdit(null)} onSave={save} />}
    </div>
  );
}

function ScopeEditor({ initial, lines, onCancel, onSave }: { initial: FundingScope[]; lines: Array<{ key: string; description: string; budget: number }>; onCancel: () => void; onSave: (s: FundingScope[]) => void }) {
  const [scopes, setScopes] = useState<FundingScope[]>(initial);
  const upd = (i: number, f: (s: FundingScope) => FundingScope) => setScopes((all) => all.map((s, j) => (j === i ? f(s) : s)));
  const updSrc = (i: number, k: number, f: (x: FundingSource) => FundingSource) => upd(i, (s) => ({ ...s, sources: s.sources.map((x, j) => (j === k ? f(x) : x)) }));
  const moveSrc = (i: number, k: number, d: -1 | 1) => upd(i, (s) => { const a = [...s.sources]; const t = a[k + d]; if (!t) return s; a[k + d] = a[k]; a[k] = t; return { ...s, sources: a }; });
  const owner = (key: string) => scopes.findIndex((s) => s.lineKeys.includes(key));
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="pm-scope max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Funding by Scope</DialogTitle></DialogHeader>
        <div className="space-y-5">
          {scopes.map((s, i) => (
            <div key={s.id} className="border rounded-lg p-3 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1"><span className="text-xs text-gray-600 block">Scope</span>
                  <Input className="h-9 w-64" value={s.name} onChange={(e) => upd(i, (x) => ({ ...x, name: e.target.value }))} /></label>
                <label className="space-y-1"><span className="text-xs text-gray-600 block">Anything Beyond the Sources</span>
                  <div className="w-72"><Select value={s.overage} onValueChange={(v) => upd(i, (x) => ({ ...x, overage: v as any }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent className="pm-scope">{OVERAGE_RULES.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
                  </Select></div></label>
                <Button variant="ghost" size="sm" className="h-9 text-red-700 ml-auto" onClick={() => setScopes((all) => all.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 mr-1" /> Remove Scope</Button>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-700 mb-1">Sources, Drawn in This Order</div>
                <table className="w-full text-sm">
                  <thead><tr className="text-[11px] uppercase tracking-wide text-gray-500"><th className="w-16" /><th className="text-left font-medium">Kind</th><th className="text-left font-medium">Label</th><th className="text-right font-medium">$/SF</th><th className="text-right font-medium">SF</th><th className="text-right font-medium">Amount</th><th className="w-10" /></tr></thead>
                  <tbody>
                    {s.sources.map((x, k) => (
                      <tr key={x.id}>
                        <td className="py-1"><div className="flex">
                          <button className="p-1 text-gray-500 disabled:opacity-30" disabled={!k} onClick={() => moveSrc(i, k, -1)} title="Draw earlier"><ArrowUp className="h-3.5 w-3.5" /></button>
                          <button className="p-1 text-gray-500 disabled:opacity-30" disabled={k === s.sources.length - 1} onClick={() => moveSrc(i, k, 1)} title="Draw later"><ArrowDown className="h-3.5 w-3.5" /></button></div></td>
                        <td className="py-1 pr-2 w-60"><Select value={x.kind} onValueChange={(v) => updSrc(i, k, (y) => ({ ...y, kind: v as any }))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent className="pm-scope">{SOURCE_KINDS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
                        </Select></td>
                        <td className="py-1 pr-2"><Input className="h-8" value={x.label} onChange={(e) => updSrc(i, k, (y) => ({ ...y, label: e.target.value }))} /></td>
                        <td className="py-1 pr-2 w-24"><MoneyInput className="h-8" value={x.perSf != null ? String(x.perSf) : ''} onValueChange={(v) => updSrc(i, k, (y) => { const perSf = v === '' ? null : parseAmount(v); return { ...y, perSf, amount: perSf != null && y.sf ? Math.round(perSf * y.sf * 100) / 100 : y.amount }; })} /></td>
                        <td className="py-1 pr-2 w-24"><Input className="h-8 text-right tabular-nums" inputMode="numeric" value={x.sf != null ? String(x.sf) : ''} onChange={(e) => updSrc(i, k, (y) => { const sf = e.target.value === '' ? null : Number(e.target.value.replace(/[^\d.]/g, '')); return { ...y, sf, amount: sf != null && y.perSf != null ? Math.round(y.perSf * sf * 100) / 100 : y.amount }; })} /></td>
                        <td className="py-1 pr-2 w-36"><MoneyInput className="h-8" value={x.amount ? String(x.amount) : ''} onValueChange={(v) => updSrc(i, k, (y) => ({ ...y, amount: parseAmount(v) || 0, perSf: null, sf: null }))} /></td>
                        <td className="py-1"><button className="p-1 text-gray-400 hover:text-red-700" onClick={() => upd(i, (y) => ({ ...y, sources: y.sources.filter((_, j) => j !== k) }))}><Trash2 className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Button variant="ghost" size="sm" className="h-7 mt-1" onClick={() => upd(i, (y) => ({ ...y, sources: [...y.sources, { id: newId(), kind: 'allowance', label: 'TI Allowance', amount: 0 }] }))}><Plus className="h-3.5 w-3.5 mr-1" /> Source</Button>
                <p className="text-[11px] text-gray-500">For an allowance by the square foot, type $/SF and SF and the amount follows. Total: {money(s.sources.reduce((t, x) => t + x.amount, 0))}.</p>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-700 mb-1">Budget Lines This Pays For</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 max-h-56 overflow-y-auto border rounded p-2">
                  {lines.map((l) => {
                    const o = owner(l.key);
                    const mine = o === i;
                    return (
                      <label key={l.key} className={`flex items-center gap-2 text-sm py-0.5 ${o >= 0 && !mine ? 'text-gray-400' : ''}`}>
                        <input type="checkbox" className="h-4 w-4" checked={mine} onChange={(e) => setScopes((all) => all.map((sc, j) => ({ ...sc, lineKeys: j === i ? (e.target.checked ? [...sc.lineKeys, l.key] : sc.lineKeys.filter((k) => k !== l.key)) : sc.lineKeys.filter((k) => !(e.target.checked && k === l.key)) })))} />
                        <span className="flex-1 truncate">{l.description}</span>
                        <span className="text-[11px] tabular-nums text-gray-500">{money(l.budget)}{o >= 0 && !mine ? ` · ${scopes[o].name}` : ''}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setScopes((all) => [...all, { id: newId(), name: 'New Scope', lineKeys: [], overage: 'tenant', sources: [] }])}><Plus className="h-4 w-4 mr-1" /> Scope</Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onCancel}>Cancel</Button>
              <Button onClick={() => onSave(scopes)}>Save</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
