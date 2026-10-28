/**
 * Where every contract stands as of a date — today by default. Billed,
 * retainage, paid, owed, left to pay; and each pay app's due / paid / open.
 */
import { useMemo, useState } from 'react';
import { no3 } from '@shared/doc-number';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Printer, ChevronRight } from 'lucide-react';
import { positionAsOf, filterPositionInput } from '@shared/cost-position';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ThreeWayBadge } from './three-way';
import { threeWayCheck } from '@shared/cost-waivers';
import { money, signedMoney, shortDate, todayIso, openReport, checkBadge, type ProjectBundle, type ApplicationRow, type ContractRow } from './types';

export function PositionView({ bundle, projectId, onPay, onPackage }: {
  bundle: ProjectBundle;
  projectId: number;
  onPay: (t: { app: ApplicationRow; contract: ContractRow }) => void;
  onPackage?: (t: { app: ApplicationRow; contract: ContractRow }) => void;
}) {
  const { toast } = useToast();
  // Today, or the latest pay app's date when one is dated ahead (a period ending at month end,
  // entered before it) — otherwise a pay app just entered wouldn't show (Adolfo, 2026-10-23).
  const latest = bundle.positionInput.applications.reduce((m, a) => (String(a.date).slice(0, 10) > m ? String(a.date).slice(0, 10) : m), '');
  const defaultAsOf = latest > todayIso() ? latest : todayIso();
  const [asOf, setAsOf] = useState(defaultAsOf);
  // Each list rolls up to one line; remembered.
  const [appsOpen, toggleApps] = useRemembered('pm-payapps-open-apps', true);
  const [directOpen, toggleDirect] = useRemembered('pm-payapps-open-direct', true);
  /** All, one contract (its id), or "direct". The printout follows the same choice. */
  const [scope, setScope] = useState('all');
  const p = useMemo(() => positionAsOf(asOf || todayIso(), filterPositionInput(bundle.positionInput, scope)), [asOf, scope, bundle.positionInput]);
  const contractName = new Map(bundle.contracts.map((c) => [c.id, c.counterparty]));
  const lineName = new Map(bundle.project.baseline.map((b) => [b.key, b.description]));
  const METHOD: Record<string, string> = { card: 'Card', check: 'Check', ach: 'ACH', wire: 'Wire', other: 'Other' };
  const paidBy = (d: { method?: string | null; reference?: string | null }) => {
    const m = d.method ? METHOD[d.method] || d.method : '';
    const ref = d.reference || '';
    return m && ref.toLowerCase().startsWith(m.toLowerCase()) ? ref : [m, ref].filter(Boolean).join(' ');
  };
  const t = p.totals;

  const H = ({ children, left }: { children: React.ReactNode; left?: boolean }) =>
    <th className={`px-3 py-2 ${left ? 'text-left' : 'text-right'}`}>{children}</th>;
  const D = ({ v, tone }: { v: number; tone?: string }) =>
    <td className={`px-3 py-1.5 text-right tabular-nums ${tone || ''}`}>{signedMoney(v)}</td>;
  /** Owed / open: red when money is still owed, amber when more was paid than billed. */
  const owedTone = (v: number) => (v > 0.005 ? 'text-red-700 font-medium' : v < -0.005 ? 'text-amber-700 font-medium' : 'text-green-700');
  const overpaid = p.contracts.filter((c) => c.owed < -0.005);
  const undated = bundle.applications.filter((a) => !a.periodEnd);
  const after = bundle.positionInput.applications.filter((a) => String(a.date).slice(0, 10) > asOf);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div className="space-y-1">
          <label htmlFor="as-of" className="text-xs text-gray-600">As of</label>
          <div className="flex gap-2">
            <Input id="as-of" type="date" className="h-9 w-44" value={asOf} max={defaultAsOf} onChange={(e) => setAsOf(e.target.value)} />
            {asOf !== defaultAsOf && <Button variant="ghost" size="sm" onClick={() => setAsOf(defaultAsOf)}>{defaultAsOf === todayIso() ? 'Today' : 'Latest'}</Button>}
          </div>
        </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-600">Contract</label>
            <div className="w-72">
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent className="pm-scope">
                  <SelectItem value="all">All Contracts and Direct Costs</SelectItem>
                  {bundle.contracts.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.counterparty}</SelectItem>)}
                  {bundle.directCosts.length > 0 && <SelectItem value="direct">Direct Costs Only</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>
        <Button variant="outline" onClick={async () => {
          if (!(await openReport(`/api/reports/pay-app-status/${projectId}?asOf=${asOf}&contract=${scope}`))) toast({ title: 'Report Failed', variant: 'destructive' });
        }}>
          <Printer className="h-4 w-4 mr-1" /> Print Pay App Status
        </Button>
      </div>

      {after.length > 0 && (
        <div className="text-sm bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-3 flex items-center justify-between gap-3 flex-wrap">
          <span>{after.length} pay app{after.length === 1 ? ' is' : 's are'} dated after {shortDate(asOf)} and not counted here: {after.map((a) => `${a.kind === 'invoice' ? 'Invoice' : 'App'} ${String(a.docNumber ?? a.number).padStart(3, '0')} (${shortDate(String(a.date).slice(0, 10))})`).join(', ')}.</span>
          <Button size="sm" variant="outline" onClick={() => setAsOf(after.reduce((m, a) => (String(a.date).slice(0, 10) > m ? String(a.date).slice(0, 10) : m), asOf))}>Show Through {shortDate(after.reduce((m, a) => (String(a.date).slice(0, 10) > m ? String(a.date).slice(0, 10) : m), asOf))}</Button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Stat label="Billed to Date" value={money(t.billedToDate)} sub={`${t.pctComplete.toFixed(2)}% of ${money(t.contractSum)}`} />
        <Stat label="Paid" value={money(t.paid)} />
        <Stat label="Owed (Billed, Unpaid)" value={money(t.owed)} tone={t.owed > 0.005 ? 'text-red-700' : undefined} />
        <Stat label="Retainage Currently Held" value={money(t.retainageHeld)} sub={(t as any).retainageReleased > 0.005 ? `Withheld ${money((t as any).retainageWithheld)} · Released ${money((t as any).retainageReleased)}` : `Left to pay ${money(t.leftToPay)}`} />
      </div>

      {overpaid.length > 0 && (
        <div className="text-sm bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-2.5">
          More has been paid than billed on {overpaid.map((c) => contractName.get(c.contractId)).join(', ')} — amounts in parentheses under Owed.
          Check that each payment is recorded against the right pay app.
        </div>
      )}
      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-gray-600 border-b">
              <H left>Contract</H><H>Contract sum</H><H>Billed to date</H><H>%</H><H>Retainage Held</H>
              <H>Net billed</H><H>Paid</H><H>Owed</H><H>Left to pay</H>
            </tr>
          </thead>
          <tbody>
            {p.contracts.map((c) => (
              <tr key={c.contractId} className="border-b last:border-0">
                <td className="px-3 py-1.5">{contractName.get(c.contractId)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {signedMoney(c.contractSum)}
                  {c.pendingChanges ? <div className="text-[11px] text-amber-700" title="Change orders marked Pending are left out of the contract sum. Set them to Approved on the Contracts tab.">
                    + {money(c.pendingChanges)} pending CO</div> : null}
                </td>
                <D v={c.billedToDate} />
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{c.pctComplete.toFixed(2)}%</td>
                <D v={c.retainageHeld} /><D v={c.netBilled} /><D v={c.paid} />
                <D v={c.owed} tone={owedTone(c.owed)} /><D v={c.leftToPay} />
              </tr>
            ))}
            {p.direct.count > 0 && (
              <tr className="border-b last:border-0">
                <td className="px-3 py-1.5">Direct Costs <span className="text-xs text-gray-500">({p.direct.count}, listed below)</span></td>
                <D v={p.direct.total} /><D v={p.direct.total} />
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">100.00%</td>
                <D v={0} /><D v={p.direct.total} /><D v={p.direct.total} /><D v={0} tone="text-green-700" /><D v={0} />
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800 font-semibold">
              <td className="px-3 py-2">Total</td>
              <D v={t.contractSum} /><D v={t.billedToDate} />
              <td className="px-3 py-2 text-right tabular-nums">{t.pctComplete.toFixed(2)}%</td>
              <D v={t.retainageHeld} /><D v={t.netBilled} /><D v={t.paid} /><D v={t.owed} /><D v={t.leftToPay} />
            </tr>
          </tfoot>
        </table>
      </div>

      {p.contracts.some((c) => c.retainageWithheld > 0.005) && (
        <div className="bg-white border rounded-lg overflow-x-auto">
          <div className="px-3 py-2 border-b text-sm font-semibold text-gray-800">Retainage
            <span className="ml-2 font-normal text-xs text-gray-500">Withheld to date, less what's been released on pay apps, is what's held now.</span></div>
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-600 border-b">
                <H left>Contract</H><H>Withheld to Date</H><H>Released</H><H>Released &amp; Paid</H><H>Released, Not Yet Paid</H><H>Currently Held</H>
              </tr>
            </thead>
            <tbody>
              {p.contracts.filter((c) => c.retainageWithheld > 0.005).map((c) => (
                <tr key={c.contractId} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{contractName.get(c.contractId)}</td>
                  <D v={c.retainageWithheld} /><D v={c.retainageReleased} /><D v={c.retainagePaid} />
                  <D v={c.retainageReleasedUnpaid} tone={c.retainageReleasedUnpaid > 0.005 ? 'text-red-700' : undefined} />
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{money(c.retainageHeld)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-800 font-semibold">
                <td className="px-3 py-2">Total</td>
                <D v={(t as any).retainageWithheld} /><D v={(t as any).retainageReleased} /><D v={(t as any).retainagePaid} /><D v={(t as any).retainageReleasedUnpaid} /><D v={t.retainageHeld} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-x-auto">
        <RollHead k="payapps" open={appsOpen} onToggle={toggleApps} title="Pay Apps & Invoices"
                  summary={`${p.applications.length} · due ${money(p.applications.reduce((t, a) => t + a.due, 0))} · paid ${money(p.applications.reduce((t, a) => t + a.paid, 0))} · open ${money(p.applications.reduce((t, a) => t + a.open, 0))}`} />
        {appsOpen && <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-gray-600 border-b">
              <H left>Contract</H><H left>No.</H><H left>Dated</H><H>Payment Due</H><H>Paid</H><H>Open</H><th className="px-2 py-2 w-[120px]">Payments</th><th className="px-2 py-2 w-[110px]">Package</th>
            </tr>
          </thead>
          <tbody>
            {p.applications.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-3 text-gray-500">Nothing billed on or before {shortDate(asOf)}.</td></tr>
            )}
            {p.applications.map((a) => {
              const app = bundle.applications.find((x) => x.id === a.applicationId);
              const contract = bundle.contracts.find((c) => c.id === a.contractId);
              return (
                <tr key={a.applicationId} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{contractName.get(a.contractId)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{app?.kind === 'invoice' ? 'Inv' : 'App'} {no3(app?.docNumber ?? a.number)}
                    {app && <ThreeWayBadge app={app} waivers={bundle.waivers} contractName={contractName.get(a.contractId) ?? ''} />}</td>
                  <td className="px-3 py-1.5 text-gray-600">{app?.periodEnd ? shortDate(a.date) : <span className="text-amber-700" title="No period end entered — dated the day it was entered">{shortDate(a.date)}*</span>}</td>
                  {(() => {
                    const tw = app ? threeWayCheck(app as any, bundle.waivers, contractName.get(a.contractId) ?? '') : null;
                    return tw?.status === 'off'
                      ? <td className="px-3 py-1.5 text-right tabular-nums text-red-700 bg-red-50 font-medium" title={`Doesn't match. ${tw.summary}`}>⚠ {signedMoney(a.due)}</td>
                      : <D v={a.due} />;
                  })()}<D v={a.paid} /><D v={a.open} tone={owedTone(a.open)} />
                  <td className="px-2 py-1 text-center whitespace-nowrap">
                    {app && contract && <Button variant="outline" size="sm" className="h-7 w-[104px]" onClick={() => onPay({ app, contract })}>Payments</Button>}
                  </td>
                  <td className="px-2 py-1 text-center whitespace-nowrap">
                    {app && contract && onPackage && <Button variant="outline" size="sm" className="h-7 w-[94px]" onClick={() => onPackage({ app, contract })}>Package</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>}
      </div>
      {p.direct.rows.length > 0 && (
        <div className="bg-white border rounded-lg overflow-x-auto">
          <RollHead k="direct" open={directOpen} onToggle={toggleDirect} title="Direct Costs"
                    summary={`${p.direct.rows.length} · ${money(p.direct.total)}`} />
          {directOpen && <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-600 border-b">
                <H left>Date</H><H left>Paid To</H><H left>Description</H><H left>Budget Line</H><H left>Paid By</H><H>Amount</H>
              </tr>
            </thead>
            <tbody>
              {p.direct.rows.map((d, i) => (
                <tr key={d.id ?? i} className="border-b last:border-0">
                  <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{shortDate(d.date)}</td>
                  <td className="px-3 py-1.5">{d.vendor}</td>
                  <td className="px-3 py-1.5 text-gray-700">{d.description}</td>
                  <td className="px-3 py-1.5 text-gray-700">{d.key ? lineName.get(d.key) ?? 'Removed line' : <span className="text-amber-700">Unallocated</span>}</td>
                  <td className="px-3 py-1.5 text-gray-700">{paidBy(d)}</td>
                  <D v={d.amount} />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-800 font-semibold">
                <td className="px-3 py-2" colSpan={5}>Total Direct Costs</td><D v={p.direct.total} />
              </tr>
            </tfoot>
          </table>}
        </div>
      )}
      <p className="text-xs text-gray-500">
        A pay app counts from its period end date (and brings every earlier app on that contract with it); a payment from the day it was paid. Approved change orders only.
        {undated.length > 0 && ` * ${undated.length} pay app${undated.length === 1 ? ' has' : 's have'} no period end — dated the day entered. Add it in the pay app to place it correctly.`}
      </p>
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


function useRemembered(key: string, def: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem(key); return v == null ? def : v === '1'; } catch { return def; } });
  const toggle = () => setOpen((v) => { try { localStorage.setItem(key, v ? '0' : '1'); } catch { /* private window */ } return !v; });
  return [open, toggle];
}

function RollHead({ k, open, onToggle, title, summary }: { k: string; open: boolean; onToggle: () => void; title: string; summary?: string }) {
  return (
    <button type="button" data-roll={k} onClick={onToggle} aria-expanded={open} className={`w-full flex items-center gap-2 px-3 ${open ? 'pt-3' : 'py-3'} text-left`}>
      <ChevronRight className={`h-4 w-4 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`} />
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">{title}</span>
      {!open && summary && <span className="text-xs text-gray-600 tabular-nums ml-2">{summary}</span>}
    </button>
  );
}
