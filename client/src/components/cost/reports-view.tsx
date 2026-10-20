/**
 * Every printable report for the project in one place: Budget vs Actual,
 * Pay App Status (as of a date — for the lender or a refinance), the Job
 * Cost Ledger, and the CM fee invoice for accounting to send the tenant.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Printer, FileText, Trash2 } from 'lucide-react';
import { SummaryTable } from './summary-table';
import { money, shortDate, todayIso, openReport, projectKey, type ProjectBundle } from './types';

export function ReportsView({ bundle: b, projectId, onShowUnallocated, onShowBudget }: {
  bundle: ProjectBundle;
  projectId: number;
  onShowUnallocated: () => void;
  onShowBudget: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [asOf, setAsOf] = useState(todayIso());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const nextInv = `CM-${String(b.cmInvoices.length + 1).padStart(2, '0')}`;
  const [invNo, setInvNo] = useState(nextInv);
  const [invDate, setInvDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);

  const open = async (url: string) => { if (!(await openReport(url))) toast({ title: 'Report failed', variant: 'destructive' }); };
  const d = b.cmInvoiceDraft;

  const issue = async () => {
    if (!window.confirm(`Issue ${invNo} for ${money(d.due)}? The figures are fixed once issued.`)) return;
    setBusy(true);
    try {
      const data: any = await apiRequest(`/api/cost-projects/${projectId}/cm-invoices`, 'POST', { number: invNo, date: invDate });
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: `${invNo} issued` });
      open(`/api/reports/cm-invoice/${projectId}?invoice=${encodeURIComponent(invNo)}`);
      setInvNo(`CM-${String(data.cmInvoices.length + 1).padStart(2, '0')}`);
    } catch (e: any) { toast({ title: 'Not issued', description: e?.message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const withdraw = async (n: string) => {
    if (!window.confirm(`Withdraw ${n}? Only do this if it was never sent.`)) return;
    try {
      const data = await apiRequest(`/api/cost-projects/${projectId}/cm-invoices/${encodeURIComponent(n)}`, 'DELETE');
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: `${n} withdrawn` });
    } catch (e: any) { toast({ title: 'Not withdrawn', description: e?.message, variant: 'destructive' }); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card title="Pay App Status" what="Billed, retainage, paid and owed on every contract, and each pay app's due, paid and open — as of a date. The one for the lender or a refinance.">
          <div className="flex items-end gap-2 flex-wrap">
            <Labeled label="As of"><Input type="date" className="h-9 w-44" value={asOf} max={todayIso()} onChange={(e) => setAsOf(e.target.value)} /></Labeled>
            <Button variant="outline" className="h-9" onClick={() => open(`/api/reports/pay-app-status/${projectId}?asOf=${asOf}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>
          </div>
        </Card>
        <Card title="Job Cost Ledger" what="Every dollar out in date order — contractor payments and direct charges — with a running total and totals by payee.">
          <div className="flex items-end gap-2 flex-wrap">
            <Labeled label="From"><Input type="date" className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></Labeled>
            <Labeled label="To"><Input type="date" className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} /></Labeled>
            <Button variant="outline" className="h-9" onClick={() => {
              const q = new URLSearchParams(); if (from) q.set('from', from); if (to) q.set('to', to);
              open(`/api/reports/job-cost-ledger/${projectId}${q.toString() ? `?${q}` : ''}`);
            }}><Printer className="h-4 w-4 mr-1" /> Print</Button>
          </div>
        </Card>
      </div>

      <Card title="CM Fee Invoice" what={`For accounting to send the tenant: ${d.pct.toFixed(2)}% on billable work completed to date, less what's been invoiced, with the budget lines and pay apps behind it.`}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <Fig label="Billable work to date" value={money(d.base)} />
          <Fig label={`Fee earned (${d.pct.toFixed(2)}%)`} value={money(d.earned)} />
          <Fig label="Previously invoiced" value={money(d.previous)} />
          <Fig label="Due now" value={money(d.due)} strong />
        </div>
        <div className="flex items-end gap-2 flex-wrap mt-3">
          <Labeled label="Invoice no."><Input className="h-9 w-32" value={invNo} onChange={(e) => setInvNo(e.target.value)} /></Labeled>
          <Labeled label="Date"><Input type="date" className="h-9 w-44" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></Labeled>
          <Button variant="outline" className="h-9" onClick={() => open(`/api/reports/cm-invoice/${projectId}`)}><FileText className="h-4 w-4 mr-1" /> Preview</Button>
          <Button className="h-9" disabled={busy || Math.abs(d.due) < 0.005 || !invNo.trim()} onClick={issue}><Printer className="h-4 w-4 mr-1" /> Issue invoice</Button>
        </div>
        {b.cmInvoices.length > 0 && (
          <table className="w-full text-sm mt-3">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
              <th className="py-1">Invoice</th><th className="py-1">Date</th><th className="py-1 text-right">Amount</th><th className="py-1">Issued by</th><th className="w-28" />
            </tr></thead>
            <tbody>
              {b.cmInvoices.map((inv, i) => (
                <tr key={inv.number} className="border-b last:border-0">
                  <td className="py-1.5 font-medium">{inv.number}</td>
                  <td className="py-1.5">{shortDate(inv.date)}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(inv.due)}</td>
                  <td className="py-1.5 text-gray-600">{inv.issuedBy || ''}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <button className="text-blue-700 hover:underline text-xs mr-2" onClick={() => open(`/api/reports/cm-invoice/${projectId}?invoice=${encodeURIComponent(inv.number)}`)}>Reprint</button>
                    {i === b.cmInvoices.length - 1 && (
                      <button className="text-gray-400 hover:text-red-700 align-middle" title="Withdraw (only if never sent)" onClick={() => withdraw(inv.number)}><Trash2 className="h-3.5 w-3.5 inline" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Budget vs Actual" what="Each budget line: budget, committed, pending change orders, spent, variance — and the tenant and outstanding share."
            action={<Button variant="outline" className="h-9" onClick={() => open(`/api/reports/budget-vs-actual/${projectId}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
        {b.contracts.length === 0 && b.directCosts.length === 0 ? (
          <p className="text-sm text-gray-600">Nothing committed yet — add the contracts first.</p>
        ) : (
          <SummaryTable summary={b.summary} cmFee={b.cmFee} onShowUnallocated={onShowUnallocated}
            budgetNote={b.approval.status === 'confirmed' ? null : (
              <div className="text-sm bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-2.5">
                Draft budget — {b.approval.lafTotal == null ? 'not yet checked against the LAF.' : `LAF entered (${money(b.approval.lafTotal)}), not yet confirmed.`}{' '}
                <button className="underline font-medium" onClick={onShowBudget}>Confirm it on the Budget tab</button>
              </div>
            )} />
        )}
      </Card>
    </div>
  );
}

function Card({ title, what, action, children }: { title: string; what: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-600 mt-0.5">{what}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><div className="text-xs text-gray-600">{label}</div>{children}</div>;
}
function Fig({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div><div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div><div className={`tabular-nums ${strong ? 'text-lg font-bold text-gray-900' : 'font-semibold text-gray-800'}`}>{value}</div></div>;
}
