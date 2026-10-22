/**
 * Dashboard pieces (admins): the CM fee and vendor billings as donuts whose
 * slices add up to the whole, and billing against the schedule per contract.
 * Figures come from shared/cost-dashboard.ts.
 */
import { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import type { FeeDonut, VendorDonut, ScheduleRow, ScheduleStatus } from '@shared/cost-dashboard';
import { money } from './types';

type Slice = { label: string; value: number; color: string; hint?: string };

export function Donut({ title, subtitle, slices, centerLabel, centerValue }: { title: string; subtitle?: string; slices: Slice[]; centerLabel: string; centerValue: number }) {
  const total = slices.reduce((t, s) => t + Math.max(0, s.value), 0);
  const data = slices.filter((s) => s.value > 0.005);
  return (
    <div className="bg-white border rounded-lg p-4">
      <div className="font-semibold text-gray-900">{title}</div>
      {subtitle && <div className="text-xs text-gray-600">{subtitle}</div>}
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        <div className="relative w-[184px] h-[184px] flex-shrink-0 mx-auto sm:mx-0">
            <PieChart width={184} height={184}>
              <Pie data={data.length ? data : [{ label: 'None', value: 1, color: '#e5e7eb' }]} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={66} outerRadius={88} startAngle={90} endAngle={-270} paddingAngle={data.length > 1 ? 1 : 0} stroke="none" isAnimationActive={false}>
                {(data.length ? data : [{ color: '#e5e7eb' }]).map((s: any, i) => <Cell key={i} fill={s.color} />)}
              </Pie>
              {data.length > 0 && <Tooltip formatter={(v: number, n: string) => [money(v), n]} />}
            </PieChart>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">{centerLabel}</div>
            <div className="text-sm font-semibold tabular-nums">{money(centerValue)}</div>
          </div>
        </div>
        <table className="text-sm flex-1 min-w-[220px]">
          <tbody>
            {slices.map((s) => (
              <tr key={s.label}>
                <td className="py-0.5 pr-2 w-3"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} /></td>
                <td className="py-0.5 pr-2 text-gray-700">{s.label}{s.hint && <div className="text-[10px] text-gray-500">{s.hint}</div>}</td>
                <td className="py-0.5 text-right tabular-nums">{money(s.value)}</td>
                <td className="py-0.5 pl-2 text-right tabular-nums text-xs text-gray-500 w-12">{total ? `${((s.value / total) * 100).toFixed(0)}%` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const FEE_COLORS = { paid: '#15803d', invoiced: '#2563eb', earnedPaid: '#d97706', earnedBilled: '#fcd34d', future: '#d1d5db' };
export function FeeDonutCard({ d, title = 'CM Fee', subtitle }: { d: FeeDonut; title?: string; subtitle?: string }) {
  return <Donut title={title} subtitle={subtitle ?? 'Anticipated at completion, by where it stands'} centerLabel="Anticipated" centerValue={d.anticipated}
    slices={[
      { label: 'Paid', value: d.paid, color: FEE_COLORS.paid, hint: 'Received on CM fee invoices' },
      { label: 'Invoiced, Not Paid', value: d.invoicedUnpaid, color: FEE_COLORS.invoiced },
      { label: 'Earned, Not Invoiced — Costs Paid', value: d.earnedNotInvoicedPaid, color: FEE_COLORS.earnedPaid, hint: 'Ready to invoice now' },
      { label: 'Earned, Not Invoiced — Costs Not Yet Paid', value: d.earnedNotInvoicedBilled, color: FEE_COLORS.earnedBilled, hint: 'On work billed; invoice once it’s paid' },
      { label: 'Not Yet Earned', value: d.notYetEarned, color: FEE_COLORS.future },
    ]} />;
}

export function VendorDonutCard({ d, title = 'Vendor Billings' }: { d: VendorDonut; title?: string }) {
  return <Donut title={title} subtitle={`Earned (approved pay apps) ${money(d.earned)} of ${money(d.contractSum)} committed`} centerLabel="Committed" centerValue={d.contractSum}
    slices={[
      { label: 'Paid', value: d.paid, color: '#15803d' },
      { label: 'Approved, Not Paid', value: d.owed, color: '#dc2626', hint: 'Owed on pay apps and invoices' },
      { label: 'Retainage Held', value: d.retainage, color: '#7c3aed' },
      { label: 'Not Yet Billed', value: d.notBilled, color: '#d1d5db' },
    ]} />;
}

const STATUS: Record<ScheduleStatus, { label: string; cls: string }> = {
  'late': { label: 'Past Completion', cls: 'bg-red-100 text-red-800' },
  'behind': { label: 'Behind', cls: 'bg-amber-100 text-amber-900' },
  'on-track': { label: 'On Track', cls: 'bg-green-100 text-green-800' },
  'done': { label: 'Fully Billed', cls: 'bg-gray-100 text-gray-700' },
  'no-dates': { label: 'No Dates', cls: 'bg-gray-50 text-gray-500 border' },
};

/** Billing against the calendar: the bar is % billed, the line is % of the time gone. */
export function ScheduleCard({ rows, title = 'Schedule — Billing vs Time', showProject }: { rows: Array<ScheduleRow & { project?: string }>; title?: string; showProject?: boolean }) {
  const order: ScheduleStatus[] = ['late', 'behind', 'on-track', 'done', 'no-dates'];
  const sorted = [...rows].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  const counts = order.map((s) => [s, rows.filter((r) => r.status === s).length] as const).filter(([, n]) => n);
  // Contracts with no dates can't be measured; fold them into one line so they don't bury the ones that can.
  const [showUndated, setShowUndated] = useState(false);
  const dated = sorted.filter((r) => r.status !== 'no-dates');
  const undated = sorted.filter((r) => r.status === 'no-dates');
  const shown = showUndated || !dated.length ? sorted : dated;
  return (
    <div className="bg-white border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold text-gray-900">{title}</div>
          <div className="text-xs text-gray-600">Bar = % of the contract billed. Line = % of the time from start to substantial completion gone by. Behind = billing trails time by more than 10 points.</div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {counts.map(([s, n]) => <span key={s} className={`text-xs rounded px-2 py-0.5 ${STATUS[s].cls}`}>{n} {STATUS[s].label}</span>)}
        </div>
      </div>
      {sorted.length === 0 ? <p className="text-sm text-gray-500">No contracts yet.</p> : (
        <div className="space-y-2">
          {shown.map((r) => (
            <div key={`${r.project ?? ''}${r.contractId}`} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-x-3 gap-y-1 text-sm">
              <div className="min-w-0">
                <div className="truncate text-gray-900">{r.name}</div>
                <div className="text-[11px] text-gray-500 truncate">
                  {showProject && r.project ? `${r.project} · ` : ''}{r.finish ? `Completion ${new Date(`${r.finish}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Add start and completion dates on the contract'}
                  {r.daysLeft != null && r.status !== 'done' ? (r.daysLeft >= 0 ? ` · ${r.daysLeft} Days Left` : ` · ${-r.daysLeft} Days Past`) : ''}
                </div>
              </div>
              <div className="relative h-3 bg-gray-100 rounded col-span-2 sm:col-span-1 order-last sm:order-none">
                <div className={`absolute inset-y-0 left-0 rounded ${r.status === 'late' ? 'bg-red-400' : r.status === 'behind' ? 'bg-amber-400' : r.status === 'done' ? 'bg-gray-400' : 'bg-green-500'}`} style={{ width: `${r.pctBilled}%` }} />
                {r.pctTime != null && <div className="absolute -top-1 -bottom-1 w-0.5 bg-gray-900" style={{ left: `calc(${r.pctTime}% - 1px)` }} title={`${r.pctTime.toFixed(0)}% of the time gone`} />}
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="tabular-nums text-xs text-gray-700 sm:w-36 text-right">{r.pctBilled.toFixed(0)}% Billed{r.pctTime != null ? ` · ${r.pctTime.toFixed(0)}% Time` : ''}</span>
                <span className={`text-[11px] rounded px-1.5 py-0.5 w-28 text-center ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
              </div>
            </div>
          ))}
          {dated.length > 0 && undated.length > 0 && (
            <button className="text-xs text-blue-700 hover:underline" onClick={() => setShowUndated((v) => !v)}>
              {showUndated ? 'Hide' : 'Show'} {undated.length} Contract{undated.length === 1 ? '' : 's'} with No Start or Completion Date
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-white border rounded-md px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone || 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  );
}
