/**
 * Budget vs Actual, by the budget's own lines.
 *
 * Every row is a line Adolfo wrote the budget in — Office Area, Warehouse
 * LED, Design — with the contractor's trades already translated into it.
 */
import type React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { BudgetVsActual } from '@shared/cost-tracking';
import { UNALLOCATED_KEY } from '@shared/cost-tracking';
import { DEAL_DISCOUNT_KEY } from '@shared/cost-budget-approval';
import { money, signedMoney, pct, BUCKET_LABEL, type CmFee } from './types';

type Row = BudgetVsActual['rows'][number] & { original?: number; revisions?: number; transfers?: number; changeOrders?: number };

export function SummaryTable({ summary, onShowUnallocated, cmFee, budgetNote }: {
  summary: BudgetVsActual & { rows: Row[] };
  onShowUnallocated?: () => void;
  cmFee?: CmFee | null;
  /** "Draft" or "Confirmed against the LAF …", shown above the table. */
  budgetNote?: React.ReactNode;
}) {
  const totals = summary.totals;
  const rows = summary.rows as Row[];
  const hasPending = Math.abs(totals.pending) >= 0.005;
  // Original → revised columns, shown once anything has moved a line.
  const sumOf = (k: 'original' | 'revisions' | 'transfers' | 'changeOrders') => Math.round(rows.reduce((t, r) => t + (r[k] ?? 0), 0) * 100) / 100;
  const any = (k: 'revisions' | 'transfers' | 'changeOrders') => rows.some((r) => Math.abs(r[k] ?? 0) >= 0.005);
  const showRev = any('revisions'), showTx = any('transfers'), showCo = any('changeOrders');
  const showOrig = showRev || showTx || showCo;
  const mv = (v: number | undefined) => (v && Math.abs(v) >= 0.005 ? signedMoney(v) : '');
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

      {budgetNote}
      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className={`w-full text-sm ${showOrig ? 'min-w-[1080px]' : 'min-w-[720px]'}`}>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-600 border-b">
              <th className="px-3 py-2">Budget line</th>
              {showOrig && <th className="px-3 py-2 text-right">Original</th>}
              {showRev && <th className="px-3 py-2 text-right">Revisions</th>}
              {showTx && <th className="px-3 py-2 text-right">Transfers</th>}
              {showCo && <th className="px-3 py-2 text-right">Approved COs</th>}
              <th className="px-3 py-2 text-right">{showOrig ? 'Revised budget' : 'Budget'}</th>
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
              const isDeal = r.key === DEAL_DISCOUNT_KEY;
              return (
                <tr key={r.key} className={`border-b last:border-0 ${isUnallocated ? 'bg-amber-50' : isDeal ? 'bg-indigo-50/60' : ''}`}>
                  <td className="px-3 py-1.5">
                    <div className={isUnallocated ? 'text-amber-900 font-medium' : 'text-gray-900'}>{r.description}</div>
                    {isDeal && <div className="text-[11px] text-indigo-700">Not yet put on a budget line — Budget tab</div>}
                    {!isUnallocated && !isDeal && (
                      <div className="text-[11px] text-gray-500">
                        {BUCKET_LABEL[r.bucket] || r.bucket}
                        {r.tenantSharePct < 100 && ` · tenant pays ${Number(r.tenantSharePct).toFixed(2)}%`}
                      </div>
                    )}
                  </td>
                  {showOrig && <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{isUnallocated ? '—' : signedMoney(r.original ?? 0)}</td>}
                  {showRev && <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{mv(r.revisions)}</td>}
                  {showTx && <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{mv(r.transfers)}</td>}
                  {showCo && <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{mv(r.changeOrders)}</td>}
                  <td className={`px-3 py-1.5 text-right tabular-nums ${showOrig ? 'font-medium' : ''}`}>{isUnallocated ? '—' : signedMoney(r.budget)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(r.committed)}</td>
                  {hasPending && <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{r.pending ? money(r.pending) : ''}</td>}
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(r.toDate)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{pct(r.toDate, r.committed)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${isDeal ? 'text-indigo-800' : r.variance < 0 ? 'text-red-700 font-medium' : ''}`}>
                    {isUnallocated ? '—' : signedMoney(r.variance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800 font-semibold">
              <td className="px-3 py-2">Total</td>
              {showOrig && <td className="px-3 py-2 text-right tabular-nums">{money(sumOf('original'))}</td>}
              {showRev && <td className="px-3 py-2 text-right tabular-nums">{signedMoney(sumOf('revisions'))}</td>}
              {showTx && <td className="px-3 py-2 text-right tabular-nums">{signedMoney(sumOf('transfers'))}</td>}
              {showCo && <td className="px-3 py-2 text-right tabular-nums">{signedMoney(sumOf('changeOrders'))}</td>}
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
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${cmFee?.supplemental ? 'lg:grid-cols-5' : cmFee ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-2`}>
        <Stat label="Retainage held" value={money(totals.retainageHeld)} />
        <Stat label="Tenant share of committed" value={money(totals.committedTenant)} />
        <Stat label="Outstanding share (absorbed)" value={money(totals.committedOutstanding)}
              tone={totals.committedOutstanding > 0 ? 'text-red-800' : undefined} />
        {cmFee && (
          <Stat label={`${cmFee.supplemental ? 'Original ' : ''}CM fee earned (${cmFee.pct.toFixed(2)}%)`} value={money(cmFee.earned)}
                sub={`of ${money(cmFee.budget)} · ${money(cmFee.earnedOnPaid)} on payments made`} />
        )}
        {cmFee?.supplemental && (
          <Stat label="Supplemental CM fee earned" value={money(cmFee.supplemental.earned + cmFee.supplemental.earnedCp)}
                sub={`of ${money(cmFee.supplemental.budget)} · on ${money(cmFee.supplemental.work)} change order work${cmFee.supplemental.earnedCp ? ` · ${money(cmFee.supplemental.earnedCp)} from the owner` : ''}`} />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="bg-white border rounded-md px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone || 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 tabular-nums">{sub}</div>}
    </div>
  );
}
