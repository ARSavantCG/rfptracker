/**
 * "We started at $1.38M — why are we at $1.5M?" in one box.
 *
 * Sources of funds: the capital partner's approved budget, the tenant for
 * the change orders billed to them, and supplemental funding only for what
 * those can't cover. Absorbed change orders come out of the budget's surplus
 * first (Adolfo, 2026-10-21).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Pencil } from 'lucide-react';
import { money, signedMoney, projectKey, type ProjectBundle } from './types';

export function FundingSummary({ bundle, projectId }: { bundle: ProjectBundle; projectId: number }) {
  const f = bundle.funding;
  const st = bundle.story;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState<string | null>(null);
  if (!f) return null;

  const saveLabel = async () => {
    try {
      const data = await apiRequest(`/api/cost-projects/${projectId}/settings`, 'PUT', { supplementalLabel: label });
      queryClient.setQueryData([projectKey(projectId)], data);
      setLabel(null);
    } catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
  };

  const Row = ({ name, sub, value, strong, tone }: { name: React.ReactNode; sub?: string; value: number; strong?: boolean; tone?: string }) => (
    <tr className={strong ? 'border-t-2 border-gray-800 font-semibold' : 'border-b last:border-0'}>
      <td className="py-1.5 pr-3">{name}{sub ? <div className="text-[11px] text-gray-500 font-normal">{sub}</div> : null}</td>
      <td className={`py-1.5 text-right tabular-nums ${tone || ''}`}>{strong ? money(value) : signedMoney(value)}</td>
    </tr>
  );
  const over = f.projectedVariance < -0.005;

  return (
    <div className="bg-white border rounded-lg p-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">Sources of funds</div>
        <table className="w-full text-sm">
          <tbody>
            <Row name={f.confirmed ? 'Approved budget (capital partner)' : 'Budget (draft, not confirmed yet)'} value={f.original} />
            {Math.abs(f.revisions) >= 0.005 && <Row name="Budget revisions" sub="Lines edited after the budget was confirmed" value={f.revisions} />}
            {((f as any).additionList ?? []).map((x: any, i: number) => (
              <Row key={`add-${i}`} name={x.label} sub={x.source === 'amortized' ? 'Additional funding: landlord, repaid through rent' : x.source === 'tenant' ? 'Additional funding from the tenant' : 'Additional funding from the capital partner'} value={x.amount} />
            ))}
            <Row name="Tenant-funded change orders" sub="The change orders as the tenant approved them" value={(f as any).tenantCos ?? f.tenant} />
            <tr className="border-b">
              <td className="py-1.5 pr-3">
                {label === null ? (
                  <span className="inline-flex items-center gap-1.5">
                    {f.label}
                    <button className="text-gray-400 hover:text-gray-700" title="Rename (it prints on reports)" onClick={() => setLabel(f.label)}>
                      <Pencil className="h-3 w-3" />
                    </button>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Input className="h-7 w-52 text-sm" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus
                           onKeyDown={(e) => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') setLabel(null); }} />
                    <Button size="sm" className="h-7" onClick={saveLabel}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => setLabel(null)}>Cancel</Button>
                  </span>
                )}
                <div className="text-[11px] text-gray-500">
                  {f.supplemental > 0.005
                    ? "Needed beyond the budget and the tenant's share"
                    : f.absorbed > 0.005 ? `None needed — absorbed change orders ${money(f.absorbed)} are paid from the budget surplus` : 'None needed'}
                </div>
              </td>
              <td className={`py-1.5 text-right tabular-nums ${f.supplemental > 0.005 ? 'text-red-800 font-medium' : ''}`}>{signedMoney(f.supplemental)}</td>
            </tr>
            <Row name="Total funding" value={f.totalFunding} strong />
            {(f.cmReserved > 0.005 || f.cmCeiling > 0.005) && <Row name="CM fees — set aside" value={f.cmReserved}
                 sub={`Original CM fee ${money(f.cmOriginal)} (the rate on the cost to complete — the ${money(f.cmCeiling)} CM fee budget is a ceiling)${f.cmReserved - f.cmOriginal > 0.005 ? ` + capital partner's fees on change orders ${money(f.cmReserved - f.cmOriginal)}` : ''}`} />}
            <Row name="Projected cost to complete" sub="Lines with contracts at what's committed; lines not bought out yet at budget (contingency excluded); plus change order markups" value={f.projectCost} />
            <tr>
              <td className="py-1.5 pr-3 font-medium">{f.surplus > 0.005 ? 'Projected surplus' : 'Projected shortfall'}<div className="text-[11px] text-gray-500 font-normal">
                {f.surplus > 0.005 ? `You can spend ${money(f.spendable)} of it — the rest is the CM fee that spending earns` : `Covered by ${f.label}`}
                {f.contingency > 0.005 && <> · contingency unspent {money(f.contingency)}</>}
                {f.unmapped > 0.005 && <div className="text-amber-700">{money(f.unmapped)} of committed cost isn't mapped to budget lines yet — map it on the Contracts tab for a sharper projection.</div>}
              </div></td>
              <td className={`py-1.5 text-right tabular-nums font-semibold ${f.surplus > 0.005 ? 'text-green-700' : 'text-red-700'}`}>{money(f.surplus > 0.005 ? f.surplus : f.supplemental)}</td>
            </tr>
          </tbody>
        </table>
        {((f as any).tenantCm ?? 0) > 0.005 && (
          <div className="mt-3 border-t pt-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">The tenant's cost of change orders <span className="normal-case font-normal text-gray-500">— not project funding</span></div>
            <table className="w-full text-sm"><tbody>
              <tr className="border-b"><td className="py-1 pr-3">Change orders as approved</td><td className="py-1 text-right tabular-nums">{money((f as any).tenantCos)}</td></tr>
              <tr className="border-b"><td className="py-1 pr-3">Our CM fee on them<div className="text-[11px] text-gray-500">Fee income — tracked on the CM Fee Report</div></td><td className="py-1 text-right tabular-nums">{money((f as any).tenantCm)}</td></tr>
              <tr className="font-semibold"><td className="py-1 pr-3">Tenant pays in all</td><td className="py-1 text-right tabular-nums">{money(f.tenant)}</td></tr>
            </tbody></table>
          </div>
        )}
      </div>
      <div className="text-sm space-y-2">
        {f.overLines.length > 0 && (
          <div className="text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-2">
            Committed over budget: {f.overLines.map((l) => `${l.description} ${money(l.over)}`).join(' · ')}.
            {f.contingency > 0.005 ? ' Cover it with Move money from contingency' : ` Contingency is used up — the rest is ${f.label}`}.
          </div>
        )}
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">Why the budget changed</div>
        <table className="w-full">
          <tbody>
            <tr className="border-b font-medium"><td className="py-1.5">Original budget</td><td className="py-1.5 text-right tabular-nums">{money(st.original)}</td></tr>
            {((f as any).additionList ?? []).map((x: any, i: number) => (
              <tr key={`sa-${i}`} className="border-b"><td className="py-1.5 pr-3">{x.label}<div className="text-[11px] text-gray-500">Additional funding (not a change order)</div></td><td className="py-1.5 text-right tabular-nums">{signedMoney(x.amount)}</td></tr>
            ))}
            {st.groups.map((g) => (
              <tr key={g.key} className="border-b align-top">
                <td className="py-1.5 pl-3">
                  {g.label}
                  <div className="text-[11px] text-gray-500">
                    {g.cos.map((c) => c.number).join(', ')}
                    {g.tenant ? ` · tenant pays ${money(g.tenant)}` : ''}{g.absorbed ? ` · we absorb ${money(g.absorbed)}` : ''}{g.funded ? ` (${money(g.funded)} from budget lines)` : ''}
                  </div>
                </td>
                <td className="py-1.5 text-right tabular-nums">{signedMoney(g.total)}</td>
              </tr>
            ))}
            {Math.abs(st.revisions) >= 0.005 && (
              <tr className="border-b"><td className="py-1.5 pl-3">Revisions<div className="text-[11px] text-gray-500">Lines edited after the budget was confirmed</div></td>
                <td className="py-1.5 text-right tabular-nums">{signedMoney(st.revisions)}</td></tr>
            )}
            <tr className="border-t-2 border-gray-800 font-semibold"><td className="py-1.5">Revised budget</td><td className="py-1.5 text-right tabular-nums">{money(st.revised)}</td></tr>
            <tr className="border-b"><td className="py-1.5">Projected cost <span className="text-[11px] text-gray-500">committed + pending change orders</span></td><td className="py-1.5 text-right tabular-nums">{money(f.projectedCost)}</td></tr>
            <tr><td className="py-1.5 font-medium">{over ? 'Projected over revised budget' : 'Projected under revised budget'}</td>
              <td className={`py-1.5 text-right tabular-nums font-semibold ${over ? 'text-red-700' : 'text-green-700'}`}>{money(Math.abs(f.projectedVariance))}</td></tr>
          </tbody>
        </table>
        <p className="text-xs text-gray-600">
          {st.transferCount ? `${money(st.moved)} moved between lines (${st.transferCount} transfer${st.transferCount === 1 ? '' : 's'}); the total is unchanged. ` : ''}
          {f.pendingChangeOrders ? `${money(f.pendingChangeOrders)} more in change orders is pending and not in the budget.` : ''}
        </p>
      </div>
    </div>
  );
}
