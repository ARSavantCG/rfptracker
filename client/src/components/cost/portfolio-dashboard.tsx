/** All active projects at a glance (admins): totals, CM fee, vendor billings, schedule. Starts simple. */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { feeDonut, type ProjectDashboard, type FeeDonut, type VendorDonut } from '@shared/cost-dashboard';
import { money } from './types';
import { FeeDonutCard, VendorDonutCard, ScheduleCard, Tile } from './dashboard-widgets';

type Row = { id: number; name: string; projectNumber?: string | null; status?: string | null; dashboard?: ProjectDashboard };

const addFee = (a: FeeDonut, b: FeeDonut): FeeDonut =>
  Object.fromEntries((Object.keys(a) as Array<keyof FeeDonut>).map((k) => [k, (a[k] ?? 0) + (b[k] ?? 0)])) as FeeDonut;
const addVendor = (a: VendorDonut, b: VendorDonut): VendorDonut => ({
  contractSum: a.contractSum + b.contractSum, earned: a.earned + b.earned, paid: a.paid + b.paid, owed: a.owed + b.owed, retainage: a.retainage + b.retainage, notBilled: a.notBilled + b.notBilled,
});
const zeroFee: FeeDonut = feeDonut([]);
const zeroVendor: VendorDonut = { contractSum: 0, earned: 0, paid: 0, owed: 0, retainage: 0, notBilled: 0 };

export function PortfolioDashboard({ projects }: { projects: Row[] }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('pm-portfolio-open') !== '0'; } catch { return true; } });
  const toggle = () => setOpen((v) => { try { localStorage.setItem('pm-portfolio-open', v ? '0' : '1'); } catch { /* private */ } return !v; });
  const live = projects.filter((p) => p.status !== 'closed' && p.dashboard);
  if (!live.length) return null;
  const fee = live.reduce((t, p) => addFee(t, p.dashboard!.fee), zeroFee);
  const vendor = live.reduce((t, p) => addVendor(t, p.dashboard!.vendor), zeroVendor);
  const sum = (f: (d: ProjectDashboard) => number) => live.reduce((t, p) => t + f(p.dashboard!), 0);
  const schedule = live.flatMap((p) => p.dashboard!.schedule.map((r) => ({ ...r, project: p.name })));
  const behind = schedule.filter((r) => r.status === 'late' || r.status === 'behind').length;
  return (
    <div className="space-y-3">
      <button className="flex items-center gap-1.5" onClick={toggle} aria-expanded={open}>
        {open ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Portfolio — {live.length} Active Project{live.length === 1 ? '' : 's'}</span>
        {!open && <span className="text-xs text-gray-600 ml-2 tabular-nums">Earned, Not Invoiced {money(fee.earnedNotInvoiced)} · Vendors Owed {money(vendor.owed)}{behind ? ` · ${behind} Behind Schedule` : ''}</span>}
      </button>
      {open && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
            <Tile label="Revised Budget" value={money(sum((d) => d.budget))} />
            <Tile label="Committed" value={money(sum((d) => d.committed))} />
            <Tile label="Spent to Date" value={money(sum((d) => d.spent))} />
            <Tile label="Vendors Owed" value={money(vendor.owed)} tone={vendor.owed > 0.005 ? 'text-red-700' : undefined} sub={`Retainage Held ${money(vendor.retainage)}`} />
            <Tile label="Earned, Not Invoiced" value={money(fee.earnedNotInvoiced)} tone="text-amber-700" sub={`Costs Paid ${money(fee.earnedNotInvoicedPaid)} · Invoiced, Not Paid ${money(fee.invoicedUnpaid)}`} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <FeeDonutCard d={fee} subtitle="All active projects, capital partner and tenant" />
            <VendorDonutCard d={vendor} title="Vendor Billings — All Projects" />
          </div>
          <ScheduleCard rows={schedule} showProject title="Schedule — All Contracts" />
        </>
      )}
    </div>
  );
}
