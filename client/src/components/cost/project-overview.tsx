/** One project at a glance (admins): totals, CM fee, vendor billings, schedule. Starts simple. */
import { money, type ProjectBundle } from './types';
import { FeeDonutCard, VendorDonutCard, ScheduleCard, Tile } from './dashboard-widgets';

export function ProjectOverview({ bundle: b }: { bundle: ProjectBundle }) {
  const d = b.dashboard;
  if (!d) return null;
  const f = b.funding;
  const spentPct = d.committed ? (d.spent / d.committed) * 100 : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <Tile label="Revised budget" value={money(d.budget)} sub={f?.original != null ? `original ${money(f.original)}` : undefined} />
        <Tile label="Committed" value={money(d.committed)} />
        <Tile label="Spent to date" value={money(d.spent)} sub={`${spentPct.toFixed(0)}% of committed`} />
        <Tile label="Vendor owed" value={money(d.vendor.owed)} tone={d.vendor.owed > 0.005 ? 'text-red-700' : undefined} sub={`retainage held ${money(d.vendor.retainage)}`} />
        <Tile label={f && f.supplemental > 0.005 ? 'Projected shortfall' : 'Projected surplus'} value={money(f ? (f.supplemental > 0.005 ? f.supplemental : f.surplus) : 0)}
              tone={f && f.supplemental > 0.005 ? 'text-red-700' : 'text-green-700'} sub={f && f.surplus > 0.005 ? `spendable ${money(f.spendable)}` : undefined} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <FeeDonutCard d={d.fee} subtitle={`Capital partner ${money(d.feeByParty.capital.anticipated)} · tenant ${money(d.feeByParty.tenant.anticipated)} anticipated`} />
        <VendorDonutCard d={d.vendor} />
      </div>
      <ScheduleCard rows={d.schedule} />
    </div>
  );
}
