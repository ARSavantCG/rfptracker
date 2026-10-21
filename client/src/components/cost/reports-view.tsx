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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SummaryTable } from './summary-table';
import { FundingSummary } from './funding-summary';
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
  const [scope, setScope] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const nextInv = `CM-${String(b.cmInvoices.length + 1).padStart(2, '0')}`;
  const [invNo, setInvNo] = useState(nextInv);
  const [invDate, setInvDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [billTo, setBillTo] = useState(b.cmInvoiceDraft.billTo);
  const saveSetting = async (patch: Record<string, string>, ok: string) => {
    try {
      const data = await apiRequest(`/api/cost-projects/${projectId}/settings`, 'PUT', patch);
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: ok });
    } catch (e: any) { toast({ title: 'Not saved', description: e?.message, variant: 'destructive' }); }
  };

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
            <Labeled label="Contract">
              <div className="w-60">
                <Select value={scope} onValueChange={setScope}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="pm-scope">
                    <SelectItem value="all">All</SelectItem>
                    {b.contracts.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.counterparty}</SelectItem>)}
                    {b.directCosts.length > 0 && <SelectItem value="direct">Direct costs only</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            </Labeled>
            <Button variant="outline" className="h-9" onClick={() => open(`/api/reports/pay-app-status/${projectId}?asOf=${asOf}&contract=${scope}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>
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

      <Card title="Lien Waiver Log" what="Every conditional waiver by contract and pay app, and whether its unconditional has come in with the next one. Outstanding ones shaded."
            action={<Button variant="outline" className="h-9" onClick={() => open(`/api/reports/lien-waivers/${projectId}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
        <p className="text-sm text-gray-700">
          {(() => {
            const cond = b.waivers.filter((w) => w.kind === 'conditional').length;
            return cond ? `${cond} conditional waiver${cond === 1 ? '' : 's'} recorded. Open a pay app's Package to add or check off waivers.` : 'No waivers recorded yet — add them from each pay app\'s Package (Contracts or Pay Apps tab).';
          })()}
        </p>
      </Card>

      <Card title={d.type === 'reimbursable' ? 'Reimbursement & CM Fee Invoice' : 'CM Fee Invoice'}
            what={d.type === 'reimbursable'
              ? `For accounting to send ${d.billTo || 'the tenant'}: the billable costs ${d.basis} to date plus the CM fee at ${d.pct.toFixed(2)}%, less what's been invoiced. Every pay app, invoice and charge itemized.`
              : `For accounting to send ${d.billTo || 'the tenant'}: the CM fee at ${d.pct.toFixed(2)}% on billable costs ${d.basis} to date, less what's been invoiced. Every pay app, invoice and charge itemized as backup.`}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 pb-2 border-b">
          <Labeled label="Invoice type">
            <Select value={d.type} onValueChange={(v) => saveSetting({ invoiceType: v }, 'Invoice type saved')}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent className="pm-scope">
                <SelectItem value="fee">CM fee only — e.g. to the capital partner</SelectItem>
                <SelectItem value="reimbursable">Costs + CM fee — reimbursed by the tenant</SelectItem>
              </SelectContent>
            </Select>
          </Labeled>
          <Labeled label="Costs counted">
            <Select value={d.basis} onValueChange={(v) => saveSetting({ invoiceBasis: v }, 'Saved')}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent className="pm-scope">
                <SelectItem value="paid">What we've paid</SelectItem>
                <SelectItem value="billed">What's been billed (completed & stored)</SelectItem>
              </SelectContent>
            </Select>
          </Labeled>
          <Labeled label="Bill to">
            <div className="flex gap-2">
              <Input className="h-9" value={billTo} onChange={(e) => setBillTo(e.target.value)} />
              {billTo !== d.billTo && <Button className="h-9" variant="outline" onClick={() => saveSetting({ billTo }, 'Bill to saved')}>Save</Button>}
            </div>
          </Labeled>
        </div>
        <div className={`grid grid-cols-2 ${['lg:grid-cols-4', 'lg:grid-cols-5', 'lg:grid-cols-6'][(d.type === 'reimbursable' ? 1 : 0) + (d.suppFee || d.cpFee ? 1 : 0)]} gap-3 text-sm`}>
          <Fig label={`Billable costs ${d.basis}`} value={money(d.base)} />
          <Fig label={`CM fee (${d.pct.toFixed(2)}%)${d.suppFee || d.cpFee ? ' — original' : ''}`} value={money(d.earned)} />
          {(d.suppFee || d.cpFee) ? <Fig label={`Supplemental CM fee${d.cpFee ? ' (incl. owner share)' : ''}`} value={money(d.suppFee + d.cpFee)} /> : null}
          {d.type === 'reimbursable' && <Fig label="Costs + fee to date" value={money(d.toDate)} />}
          <Fig label="Previously invoiced" value={money(d.previous)} />
          <Fig label="Due now" value={money(d.due)} strong />
        </div>
        <p className="text-xs text-gray-600">{d.items.length} item{d.items.length === 1 ? '' : 's'} behind it{d.items.some((i) => i.thisInvoice) ? `, ${d.items.filter((i) => i.thisInvoice).length} new since the last invoice` : ''}.</p>
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

      <Card title="Budget Log" what="Why the budget is what it is: the confirmation, then every transfer, change order and edit since, oldest first, with the budget after each."
            action={<Button variant="outline" className="h-9" onClick={() => open(`/api/reports/budget-log/${projectId}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
        <p className="text-sm text-gray-700">
          {b.approval.status === 'confirmed'
            ? `Original ${money(b.approval.originalTotal)} · current ${money(b.approval.currentTotal)} · ${b.approval.revisions.length} change${b.approval.revisions.length === 1 ? '' : 's'} logged · ${b.approval.transfers.length} transfer${b.approval.transfers.length === 1 ? '' : 's'}.`
            : 'The log starts once the budget is confirmed on the Budget tab.'}
        </p>
      </Card>

      <Card title="Budget vs Actual" what="Sources of funds, then each budget line from original to revised (transfers, change orders), against committed, spent and variance."
            action={<Button variant="outline" className="h-9" onClick={() => open(`/api/reports/budget-vs-actual/${projectId}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
        {b.contracts.length === 0 && b.directCosts.length === 0 ? (
          <p className="text-sm text-gray-600">Nothing committed yet — add the contracts first.</p>
        ) : (
          <SummaryTable summary={b.summary} cmFee={b.cmFee} onShowUnallocated={onShowUnallocated}
            budgetNote={b.approval.status === 'confirmed' ? <FundingSummary bundle={b} projectId={projectId} /> : (
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
