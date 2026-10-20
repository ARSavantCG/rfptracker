/**
 * Where every contract stands as of a date — today by default. Billed,
 * retainage, paid, owed, left to pay; and each pay app's due / paid / open.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Printer } from 'lucide-react';
import { positionAsOf } from '@shared/cost-position';
import { money, signedMoney, shortDate, todayIso, openReport, type ProjectBundle, type ApplicationRow, type ContractRow } from './types';

export function PositionView({ bundle, projectId, onPay }: {
  bundle: ProjectBundle;
  projectId: number;
  onPay: (t: { app: ApplicationRow; contract: ContractRow }) => void;
}) {
  const { toast } = useToast();
  const [asOf, setAsOf] = useState(todayIso());
  const p = useMemo(() => positionAsOf(asOf || todayIso(), bundle.positionInput), [asOf, bundle.positionInput]);
  const contractName = new Map(bundle.contracts.map((c) => [c.id, c.counterparty]));
  const t = p.totals;

  const H = ({ children, left }: { children: React.ReactNode; left?: boolean }) =>
    <th className={`px-3 py-2 ${left ? 'text-left' : 'text-right'}`}>{children}</th>;
  const D = ({ v, tone }: { v: number; tone?: string }) =>
    <td className={`px-3 py-1.5 text-right tabular-nums ${tone || ''}`}>{signedMoney(v)}</td>;
  /** Owed / open: red when money is still owed, amber when more was paid than billed. */
  const owedTone = (v: number) => (v > 0.005 ? 'text-red-700 font-medium' : v < -0.005 ? 'text-amber-700 font-medium' : 'text-green-700');
  const overpaid = p.contracts.filter((c) => c.owed < -0.005);
  const undated = bundle.applications.filter((a) => !a.periodEnd);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div className="space-y-1">
          <label htmlFor="as-of" className="text-xs text-gray-600">As of</label>
          <div className="flex gap-2">
            <Input id="as-of" type="date" className="h-9 w-44" value={asOf} max={todayIso()} onChange={(e) => setAsOf(e.target.value)} />
            {asOf !== todayIso() && <Button variant="ghost" size="sm" onClick={() => setAsOf(todayIso())}>Today</Button>}
          </div>
        </div>
        <Button variant="outline" onClick={async () => {
          if (!(await openReport(`/api/reports/cost-position/${projectId}?asOf=${asOf}`))) toast({ title: 'Report failed', variant: 'destructive' });
        }}>
          <Printer className="h-4 w-4 mr-1" /> Cost Position
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Stat label="Billed to date" value={money(t.billedToDate)} sub={`${t.pctComplete.toFixed(2)}% of ${money(t.contractSum)}`} />
        <Stat label="Paid" value={money(t.paid)} />
        <Stat label="Owed (billed, unpaid)" value={money(t.owed)} tone={t.owed > 0.005 ? 'text-red-700' : undefined} />
        <Stat label="Retainage held" value={money(t.retainageHeld)} sub={`Left to pay ${money(t.leftToPay)}`} />
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
              <H left>Contract</H><H>Contract sum</H><H>Billed to date</H><H>%</H><H>Retainage</H>
              <H>Net billed</H><H>Paid</H><H>Owed</H><H>Left to pay</H>
            </tr>
          </thead>
          <tbody>
            {p.contracts.map((c) => (
              <tr key={c.contractId} className="border-b last:border-0">
                <td className="px-3 py-1.5">{contractName.get(c.contractId)}</td>
                <D v={c.contractSum} /><D v={c.billedToDate} />
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{c.pctComplete.toFixed(2)}%</td>
                <D v={c.retainageHeld} /><D v={c.netBilled} /><D v={c.paid} />
                <D v={c.owed} tone={owedTone(c.owed)} /><D v={c.leftToPay} />
              </tr>
            ))}
            {p.direct.count > 0 && (
              <tr className="border-b last:border-0">
                <td className="px-3 py-1.5">Direct costs <span className="text-xs text-gray-500">({p.direct.count} on the ledger)</span></td>
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

      <div className="bg-white border rounded-lg overflow-x-auto">
        <div className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Pay apps &amp; invoices</div>
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-gray-600 border-b">
              <H left>Contract</H><H left>No.</H><H left>Dated</H><H>Payment due</H><H>Paid</H><H>Open</H><th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {p.applications.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-3 text-gray-500">Nothing billed on or before {shortDate(asOf)}.</td></tr>
            )}
            {p.applications.map((a) => {
              const app = bundle.applications.find((x) => x.id === a.applicationId);
              const contract = bundle.contracts.find((c) => c.id === a.contractId);
              return (
                <tr key={a.applicationId} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{contractName.get(a.contractId)}</td>
                  <td className="px-3 py-1.5">{app?.kind === 'invoice' ? 'Inv' : 'App'} {a.number}</td>
                  <td className="px-3 py-1.5 text-gray-600">{app?.periodEnd ? shortDate(a.date) : <span className="text-amber-700" title="No period end entered — dated the day it was entered">{shortDate(a.date)}*</span>}</td>
                  <D v={a.due} /><D v={a.paid} /><D v={a.open} tone={owedTone(a.open)} />
                  <td className="px-2 text-right">
                    {app && contract && <Button variant="outline" size="sm" className="h-7" onClick={() => onPay({ app, contract })}>Payments</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
