/**
 * "We started at $1.38M — why are we at $1.5M?" in one box.
 *
 * Sources of funds: the capital partner's approved budget, the tenant for
 * the change orders billed to them, and supplemental funding for what is
 * absorbed (approved absorbed change orders, plus any projected cost beyond
 * the revised budget). The sources add to the revised budget.
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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState<string | null>(null);
  if (!f) return null;

  const saveLabel = async () => {
    try {
      const data = await apiRequest(`/api/cost-projects/${projectId}/settings`, 'PUT', { supplementalLabel: label });
      queryClient.setQueryData([projectKey(projectId)], data);
      setLabel(null);
    } catch (e: any) { toast({ title: 'Not saved', description: e?.message, variant: 'destructive' }); }
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
            <Row name="Tenant-funded change orders" sub="Billable to the tenant, CM fee included" value={f.tenant} />
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
                  Absorbed change orders {money(f.absorbed)}
                  {f.projectedOverrun > 0.005 ? ` + projected beyond budget ${money(f.projectedOverrun)}` : ''}
                </div>
              </td>
              <td className={`py-1.5 text-right tabular-nums ${f.supplemental > 0.005 ? 'text-red-800 font-medium' : ''}`}>{signedMoney(f.supplemental)}</td>
            </tr>
            <Row name="Total funding" value={f.totalFunding} strong />
          </tbody>
        </table>
      </div>
      <div className="text-sm space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">Where the budget stands</div>
        <table className="w-full">
          <tbody>
            <tr className="border-b"><td className="py-1.5">Original budget</td><td className="py-1.5 text-right tabular-nums">{money(f.original)}</td></tr>
            <tr className="border-b"><td className="py-1.5 font-medium">Revised budget</td><td className="py-1.5 text-right tabular-nums font-medium">{money(f.revised)}</td></tr>
            <tr className="border-b"><td className="py-1.5">Projected cost <span className="text-[11px] text-gray-500">committed + pending change orders</span></td><td className="py-1.5 text-right tabular-nums">{money(f.projectedCost)}</td></tr>
            <tr><td className="py-1.5 font-medium">{over ? 'Projected over revised budget' : 'Projected under revised budget'}</td>
              <td className={`py-1.5 text-right tabular-nums font-semibold ${over ? 'text-red-700' : 'text-green-700'}`}>{money(Math.abs(f.projectedVariance))}</td></tr>
          </tbody>
        </table>
        <p className="text-xs text-gray-600">
          {money(f.original)} original
          {Math.abs(f.revisions) >= 0.005 ? ` ${f.revisions >= 0 ? '+' : '−'} ${money(Math.abs(f.revisions))} revisions` : ''}
          {f.tenant ? ` ${f.tenant >= 0 ? '+' : '−'} ${money(Math.abs(f.tenant))} tenant-approved change orders` : ''}
          {f.absorbed ? ` ${f.absorbed >= 0 ? '+' : '−'} ${money(Math.abs(f.absorbed))} absorbed` : ''}
          {' '}= {money(f.revised)} revised.
          {f.pendingChangeOrders ? ` ${money(f.pendingChangeOrders)} more in budget change orders is pending.` : ''}
        </p>
      </div>
    </div>
  );
}
