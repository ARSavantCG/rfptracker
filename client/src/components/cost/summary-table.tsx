/**
 * Budget vs Actual, by the budget's own lines.
 *
 * Every row is a line Adolfo wrote the budget in — Office Area, Warehouse
 * LED, Design — with the contractor's trades already translated into it.
 */
import { AlertTriangle } from 'lucide-react';
import type { BudgetVsActual } from '@shared/cost-tracking';
import { UNALLOCATED_KEY } from '@shared/cost-tracking';
import { money, signedMoney, pct, BUCKET_LABEL } from './types';

export function SummaryTable({ summary, onShowUnallocated }: {
  summary: BudgetVsActual;
  onShowUnallocated?: () => void;
}) {
  const { rows, totals } = summary;
  const hasPending = Math.abs(totals.pending) >= 0.005;
  const unallocated = rows.find((r) => r.key === UNALLOCATED_KEY);

  return (
    <div className="space-y-3">
      {!summary.reconciles && (
        <div className="flex gap-2 items-start text-sm bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            These rows add up to {money(totals.committed)} committed, but the contracts total {money(summary.contractCommitted)}.
            That should never happen — please flag it.
          </span>
        </div>
      )}
      {unallocated && (
        <div className="flex gap-2 items-start text-sm bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            {money(unallocated.committed)} of contract value isn't mapped to a budget line yet, so it shows as
            Unallocated below.{' '}
            {onShowUnallocated && (
              <button className="underline font-medium" onClick={onShowUnallocated}>Map those lines</button>
            )}
          </span>
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-600 border-b">
              <th className="px-3 py-2">Budget line</th>
              <th className="px-3 py-2 text-right">Budget</th>
              <th className="px-3 py-2 text-right">Committed</th>
              {hasPending && <th className="px-3 py-2 text-right" title="Change orders not yet approved">Pending COs</th>}
              <th className="px-3 py-2 text-right">Spent to date</th>
              <th className="px-3 py-2 text-right">% spent</th>
              <th className="px-3 py-2 text-right" title="Budget less committed. In parentheses when over.">Variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isUnallocated = r.key === UNALLOCATED_KEY;
              return (
                <tr key={r.key} className={`border-b last:border-0 ${isUnallocated ? 'bg-amber-50' : ''}`}>
                  <td className="px-3 py-1.5">
                    <div className={isUnallocated ? 'text-amber-900 font-medium' : 'text-gray-900'}>{r.description}</div>
                    {!isUnallocated && (
                      <div className="text-[11px] text-gray-500">
                        {BUCKET_LABEL[r.bucket] || r.bucket}
                        {r.tenantSharePct < 100 && ` · tenant pays ${r.tenantSharePct}%`}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{isUnallocated ? '—' : money(r.budget)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(r.committed)}</td>
                  {hasPending && <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{r.pending ? money(r.pending) : ''}</td>}
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(r.toDate)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{pct(r.toDate, r.committed)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${r.variance < 0 ? 'text-red-700 font-medium' : ''}`}>
                    {isUnallocated ? '—' : signedMoney(r.variance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800 font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(totals.budget)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(totals.committed)}</td>
              {hasPending && <td className="px-3 py-2 text-right tabular-nums">{money(totals.pending)}</td>}
              <td className="px-3 py-2 text-right tabular-nums">{money(totals.toDate)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{pct(totals.toDate, totals.committed)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${totals.variance < 0 ? 'text-red-700' : ''}`}>{signedMoney(totals.variance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Who pays. Committed cost split the way each budget line is split. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Stat label="Retainage held" value={money(totals.retainageHeld)} />
        <Stat label="Tenant share of committed" value={money(totals.committedTenant)} />
        <Stat label="Outstanding share (absorbed)" value={money(totals.committedOutstanding)}
              tone={totals.committedOutstanding > 0 ? 'text-red-800' : undefined} />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-white border rounded-md px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone || 'text-gray-900'}`}>{value}</div>
    </div>
  );
}
