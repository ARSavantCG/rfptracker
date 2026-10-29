/**
 * Every printable report for the project in one place, each rolled up to a
 * line: open one to set its filters and print. Cost reports first, then CM
 * fees and billing (the capital partner's and the tenant's invoices).
 */
import { useMemo, useState } from 'react';
import { MoneyInput } from './inputs';
import { parseAmount } from '@shared/format';
import { CO_STAGES } from '@shared/co-routing';
import { STAGE_STYLE } from './co-routing';
import { waiversByPayApp, paidOfFrom, payAppLog, gcPaymentDue, threeWayCheck, owedByVendor } from '@shared/cost-waivers';
import { coLog } from '@shared/co-log';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Printer, FileText, Trash2, ChevronRight, Download } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SummaryTable } from './summary-table';
import { FundingSummary } from './funding-summary';
import { money, shortDate, todayIso, openReport, projectKey, type ProjectBundle, type CmInvoiceDraft, type CmInvoiceRow } from './types';

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
  const saveSetting = async (patch: Record<string, string>, ok: string) => {
    try {
      const data = await apiRequest(`/api/cost-projects/${projectId}/settings`, 'PUT', patch);
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: ok });
    } catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
  };

  const open = async (url: string) => { if (!(await openReport(url))) toast({ title: 'Report Failed', variant: 'destructive' }); };
  const cap = b.cmInvoiceDrafts.capital, ten = b.cmInvoiceDrafts.tenant;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Cost Reports</h3>
      <FinancialSummaryCard b={b} projectId={projectId} open={open} />
      <Card id="bva" title="Budget vs Actual" what="Sources of funds, then each budget line from original to revised (transfers, change orders), against committed, spent and variance."
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
      <Card id="pay-app-status" title="Pay App Status" what="Billed, retainage, paid and owed on every contract, and each pay app's due, paid and open — as of a date. The one for the lender or a refinance.">
        <div className="flex items-end gap-2 flex-wrap">
          <Labeled label="As of"><Input type="date" className="h-9 w-44" value={asOf} max={todayIso()} onChange={(e) => setAsOf(e.target.value)} /></Labeled>
          <Labeled label="Contract">
            <div className="w-60">
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent className="pm-scope">
                  <SelectItem value="all">All</SelectItem>
                  {b.contracts.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.counterparty}</SelectItem>)}
                  {b.directCosts.length > 0 && <SelectItem value="direct">Direct Costs Only</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </Labeled>
          <Button variant="outline" className="h-9" onClick={() => open(`/api/reports/pay-app-status/${projectId}?asOf=${asOf}&contract=${scope}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>
        </div>
      </Card>
      <Card id="ledger" title="Job Cost Ledger" what="Every dollar out in date order — contractor payments and direct charges — with a running total and totals by payee.">
        <div className="flex items-end gap-2 flex-wrap">
          <Labeled label="From"><Input type="date" className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></Labeled>
          <Labeled label="To"><Input type="date" className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} /></Labeled>
          <Button variant="outline" className="h-9" onClick={() => {
            const q = new URLSearchParams(); if (from) q.set('from', from); if (to) q.set('to', to);
            open(`/api/reports/job-cost-ledger/${projectId}${q.toString() ? `?${q}` : ''}`);
          }}><Printer className="h-4 w-4 mr-1" /> Print</Button>
        </div>
      </Card>
      <Card id="budget-log" title="Budget Log" what="Why the budget is what it is: the confirmation, then every transfer, change order and edit since, oldest first, with the budget after each."
            action={<Button variant="outline" className="h-9" onClick={() => open(`/api/reports/budget-log/${projectId}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
        <p className="text-sm text-gray-700">
          {b.approval.status === 'confirmed'
            ? `Original ${money(b.approval.originalTotal)} · current ${money(b.approval.currentTotal)} · ${b.approval.revisions.length} change${b.approval.revisions.length === 1 ? '' : 's'} logged · ${b.approval.transfers.length} transfer${b.approval.transfers.length === 1 ? '' : 's'}.`
            : 'The log starts once the budget is confirmed on the Budget tab.'}
        </p>
      </Card>
      <WaiverLogCard b={b} projectId={projectId} open={open} />
      <PayAppLogCard b={b} projectId={projectId} open={open} />
      <G702CompareCard b={b} projectId={projectId} open={open} />
      <SovCard b={b} projectId={projectId} open={open} />
      <Card id="rollforward" title="Billing Roll-Forward" what="What's been billed through the end of each pay app, by pay app and line by line. Each pay app's total to date should be the next one's Previous; flags where the contractor's doesn't carry forward."
            action={<Button variant="outline" className="h-9" onClick={() => open(`/api/reports/rollforward/${projectId}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
        <p className="text-sm text-gray-700">Prints landscape: one table by pay app (previous, this period, total to date, their line 4 and whether it rolls forward), then every line's total to date at the end of each pay app.</p>
      </Card>
      <AgingCard b={b} projectId={projectId} open={open} />
      <PayoffCard b={b} projectId={projectId} />
      <OwedByVendorCard b={b} projectId={projectId} open={open} />
      <CoLogCard b={b} projectId={projectId} open={open} />
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">CM fees &amp; billing</h3>
      <Card id="cm-fees" title="CM Fee Report" what="Every CM fee on the project — capital partner and tenant: rates, earned to date, projected at completion, each change order's fees, invoices issued, and the CM fee budget. For the team."
            summary={`Anticipated ${money(cap.projected.fee + ten.projected.fee)} · earned ${money(cap.earned + cap.suppFee + ten.earned + ten.suppFee)}`}
            action={<Button variant="outline" className="h-9" onClick={() => open(`/api/reports/cm-fees/${projectId}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
        {(() => {
          const earned = (d: CmInvoiceDraft) => d.earned + d.suppFee;
          const rows = [['Capital Partner', cap], ['Tenant', ten]] as const;
          const sum = (f: (d: CmInvoiceDraft) => number) => money(f(cap) + f(ten));
          const pend = (v: number) => (v > 0.005 ? <div className="text-[11px] text-amber-700">+ {money(v)} pending</div> : null);
          const th = 'py-1 pl-3 text-right align-bottom';
          const td = 'py-1.5 pl-3 text-right';
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1000px]">
                <thead><tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b">
                  <th className="py-1 text-left align-bottom">Party</th><th className={th}>Rate</th>
                  <th className={th} title="The original budget (before change orders) with the CM fee backed out at this rate — what the fee is figured on">Original Budget</th>
                  <th className={th}>Original Fee</th>
                  <th className={th} title="Approved change order amounts the fee is figured on">Approved COs<div className="normal-case font-normal">subject to fee</div></th>
                  <th className={th}>CO Fees</th><th className={th}>Total Anticipated</th>
                  <th className={th}>Earned to Date</th><th className={th}>Invoiced</th><th className={th}>Billable</th><th className={th}>Remaining to Bill</th>
                </tr></thead>
                <tbody className="tabular-nums">
                  {rows.map(([label, d]) => (
                    <tr key={label} className="border-b">
                      <td className="py-1.5">{label}{d.billTo ? <div className="text-[11px] text-gray-500">{d.billTo}</div> : null}</td>
                      <td className={td}>{d.pct.toFixed(2)}%</td>
                      <td className={td}>{money(d.projected.base)}</td>
                      <td className={td}>{money(d.projected.original)}</td>
                      <td className={td}>{money(d.projected.coBase)}{pend(d.projected.pendingBase)}</td>
                      <td className={td}>{money(d.projected.changeOrders)}{pend(d.projected.pending)}</td>
                      <td className={`${td} font-semibold`}>{money(d.projected.fee)}</td>
                      <td className={td}>{money(earned(d))}</td>
                      <td className={td}>{money(d.feeInvoiced)}</td>
                      <td className={`${td} font-semibold`}>{money(earned(d) - d.feeInvoiced)}</td>
                      <td className={td}>{money(d.projected.fee - d.feeInvoiced)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-1.5">Total CM fees</td><td /><td />
                    <td className={td}>{sum((d) => d.projected.original)}</td><td />
                    <td className={td}>{sum((d) => d.projected.changeOrders)}</td>
                    <td className={td}>{sum((d) => d.projected.fee)}</td>
                    <td className={td}>{sum(earned)}</td>
                    <td className={td}>{sum((d) => d.feeInvoiced)}</td>
                    <td className={td}>{sum((d) => earned(d) - d.feeInvoiced)}</td>
                    <td className={td}>{sum((d) => d.projected.fee - d.feeInvoiced)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })()}
      </Card>
      <Card id="billing" title="Billable to Capital Partner vs Tenant" what="What each party owes to date, side by side. Prints on the Budget vs Actual report."
            summary={`Not yet invoiced: capital ${money(cap.due)} · tenant ${money(ten.due)}`}>
        <p className="text-sm text-gray-700">Project costs incurred to date <strong className="tabular-nums">{money(cap.incurred)}</strong> · paid <strong className="tabular-nums">{money(cap.paidToDate)}</strong> <span className="text-xs text-gray-500">(excluding the CM fee line)</span></p>
        <table className="w-full max-w-2xl text-sm">
          <thead><tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b">
            <th className="py-1 text-left" /><th className="py-1 text-right">Capital Partner{cap.billTo ? <div className="normal-case font-normal">{cap.billTo}</div> : null}</th>
            <th className="py-1 text-right">Tenant{ten.billTo ? <div className="normal-case font-normal">{ten.billTo}</div> : null}</th>
          </tr></thead>
          <tbody className="tabular-nums">
            <SumRow label="Billable Costs" a="—" b={money(ten.base)} />
            <SumRow label="CM Fee — Original Scope" a={money(cap.earned)} b={money(ten.earned)} subA={`${cap.pct.toFixed(2)}% on costs ${cap.basis}`} subB={`${ten.pct.toFixed(2)}%`} />
            {(cap.suppFee || ten.suppFee) ? <SumRow label="Supplemental CM Fee — Change Orders" a={money(cap.suppFee)} b={money(ten.suppFee)} /> : null}
            <SumRow label="Billable to Date" a={money(cap.toDate)} b={money(ten.toDate)} strong />
            <SumRow label="Invoiced to Date" a={money(cap.invoicedToDate)} b={money(ten.invoicedToDate)} subA={`${cap.invoices} invoice${cap.invoices === 1 ? '' : 's'}`} subB={`${ten.invoices} invoice${ten.invoices === 1 ? '' : 's'}`} />
            <SumRow label="Not Yet Invoiced" a={money(cap.due)} b={money(ten.due)} strong />
            <SumRow label="Projected at Completion" a={money(cap.projected.fee)} b={money(ten.projected.total ?? ten.projected.fee)}
                    subA={cap.projected.pending > 0.005 ? `+ ${money(cap.projected.pending)} pending` : 'CM fee'}
                    subB={(ten.projected.pendingTotal ?? 0) > 0.005 ? `+ ${money(ten.projected.pendingTotal ?? 0)} pending` : 'approved change orders'} />
          </tbody>
        </table>
      </Card>
        <InvoiceCard key={`cap-${b.cmInvoices.length}`} d={cap} bundle={b} projectId={projectId} open={open} saveSetting={saveSetting} />
        <InvoiceCard key={`ten-${b.cmInvoices.length}`} d={ten} bundle={b} projectId={projectId} open={open} saveSetting={saveSetting} />
      </div>
    </div>
  );
}

/** One party's invoice: the capital partner's (CM fee only) or the tenant's (costs + CM fee). Own numbers, own "previously invoiced". */
function InvoiceCard({ d, bundle: b, projectId, open, saveSetting }: {
  d: CmInvoiceDraft; bundle: ProjectBundle; projectId: number;
  open: (url: string) => void; saveSetting: (patch: Record<string, string>, ok: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tenant = d.stream === 'tenant';
  const mine = b.cmInvoices.filter((i) => (i.type === 'reimbursable') === tenant);
  const nextNo = (n: number) => `${tenant ? 'TEN' : 'CAP'}-${String(n + 1).padStart(3, '0')}`;
  const [invNo, setInvNo] = useState(nextNo(mine.length));
  const [invDate, setInvDate] = useState(todayIso());
  const [billTo, setBillTo] = useState(d.billTo);
  const [busy, setBusy] = useState(false);
  const who = tenant ? 'the tenant' : 'the capital partner';
  const issue = async () => {
    if (!window.confirm(`Issue ${invNo} to ${d.billTo || who} for ${money(d.due)}? The figures are fixed once issued.`)) return;
    setBusy(true);
    try {
      const data: any = await apiRequest(`/api/cost-projects/${projectId}/cm-invoices`, 'POST', { number: invNo, date: invDate, stream: d.stream });
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: `${invNo} issued` });
      open(`/api/reports/cm-invoice/${projectId}?invoice=${encodeURIComponent(invNo)}`);
    } catch (e: any) { toast({ title: 'Not Issued', description: e?.message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const withdraw = async (n: string) => {
    if (!window.confirm(`Withdraw ${n}? Only do this if it was never sent.`)) return;
    try {
      const data = await apiRequest(`/api/cost-projects/${projectId}/cm-invoices/${encodeURIComponent(n)}`, 'DELETE');
      queryClient.setQueryData([projectKey(projectId)], data);
      toast({ title: `${n} withdrawn` });
    } catch (e: any) { toast({ title: 'Not Withdrawn', description: e?.message, variant: 'destructive' }); }
  };
  const basisKey = tenant ? 'invoiceBasisTenant' : 'invoiceBasisCapital';
  const full = tenant && d.mode === 'full';
  const billKey = tenant ? 'billToTenant' : 'billToCapital';
  return (
    <Card id={`invoice-${d.stream}`} title={tenant ? (full ? 'Tenant Invoice — Change Orders in Full' : 'Tenant Invoice — Costs + CM Fee') : 'Capital Partner Invoice — CM Fee'}
          summary={`Due now ${money(d.due)}${mine.length ? ` · ${mine.length} issued` : ''}`}
          what={tenant && full
            ? `Each approved change order in full when it's approved: the tenant's share of the work, markups and their CM fee, less credits and what's been invoiced.`
            : tenant
            ? `${d.tenantCosOnly ? 'Their change orders as the work is done' : "The tenant's share of costs"} (${d.basis} to date), markups and their CM fee at ${d.pct.toFixed(2)}%, less credits and what's been invoiced. Every pay app, invoice and charge itemized.`
            : `The CM fee at ${d.pct.toFixed(2)}% on costs ${d.basis} to date, less what's been invoiced. Costs incurred and paid listed as backup.`}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 pb-2 border-b">
        {tenant && (
          <Labeled label="Billing Method">
            <Select value={full ? 'full' : 'incurred'} onValueChange={(v) => saveSetting({ tenantBillMode: v }, 'Saved')}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent className="pm-scope">
                <SelectItem value="full">Change Orders in Full When Approved</SelectItem>
                <SelectItem value="incurred">As Costs Are Incurred</SelectItem>
              </SelectContent>
            </Select>
          </Labeled>
        )}
        {!full && <Labeled label={tenant ? 'Costs Counted' : 'Fee Figured On'}>
          <Select value={d.basis} onValueChange={(v) => saveSetting({ [basisKey]: v }, 'Saved')}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent className="pm-scope">
              <SelectItem value="paid">What We've Paid</SelectItem>
              <SelectItem value="billed">What's Been Billed (Completed & Stored)</SelectItem>
            </SelectContent>
          </Select>
        </Labeled>}
        {!tenant && (
          <Labeled label="Partner's Fee On">
            <Select value={(b.project as any).settings?.partnerFeeOn === 'landlord' ? 'landlord' : 'all'} onValueChange={(v) => saveSetting({ partnerFeeOn: v }, 'Saved')}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent className="pm-scope">
                <SelectItem value="all">All Original Work</SelectItem>
                <SelectItem value="landlord">Landlord Work Only — the tenant's share carries the tenant's fee</SelectItem>
              </SelectContent>
            </Select>
          </Labeled>
        )}
        {tenant && !full && (
          <Labeled label="Tenant Pays For">
            <Select value={d.tenantCosOnly ? 'cos' : 'all'} disabled={(b.project as any).settings?.partnerFeeOn === 'landlord'} onValueChange={(v) => saveSetting({ tenantBills: v }, 'Saved')}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent className="pm-scope">
                <SelectItem value="cos">Change orders only — the original scope is in the budget</SelectItem>
                <SelectItem value="all">Change orders and their share of the original scope</SelectItem>
              </SelectContent>
            </Select>
          </Labeled>
        )}
        <Labeled label="Bill To">
          <div className="flex gap-2">
            <Input className="h-9" value={billTo} onChange={(e) => setBillTo(e.target.value)} />
            {billTo !== d.billTo && <Button className="h-9" variant="outline" onClick={() => saveSetting({ [billKey]: billTo }, 'Bill to saved')}>Save</Button>}
          </div>
        </Labeled>
      </div>
      {full ? <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
        <Fig label="Approved Change Orders" value={String(d.items.length)} />
        <Fig label="Work, Markups, Less Credits" value={money(d.base)} />
        <Fig label="CM Fee" value={money(d.suppFee)} />
        <Fig label="Total Change Orders" value={money(d.toDate)} />
        <Fig label="Previously Invoiced" value={money(d.previous)} />
        <Fig label="Due Now" value={money(d.due)} strong />
      </div> : <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
        {tenant ? <Fig label={`Billable Costs ${d.basis}`} value={money(d.base)} /> : <Fig label="Costs Incurred · Paid" value={`${money(d.incurred)} · ${money(d.paidToDate)}`} />}
        <Fig label={`CM Fee (${d.pct.toFixed(2)}%)${d.suppFee ? ' — Original' : ''}`} value={money(d.earned)} />
        {d.suppFee ? <Fig label="Supplemental CM Fee" value={money(d.suppFee)} /> : null}
        <Fig label={tenant ? 'Costs + Fee to Date' : 'CM Fees to Date'} value={money(d.toDate)} />
        <Fig label="Previously Invoiced" value={money(d.previous)} />
        <Fig label="Due Now" value={money(d.due)} strong />
      </div>}
      <p className="text-xs text-gray-600">{full ? `${d.items.length} change order${d.items.length === 1 ? '' : 's'}` : `${d.items.length} item${d.items.length === 1 ? '' : 's'}`} behind it{d.items.some((i) => i.thisInvoice) ? `, ${d.items.filter((i) => i.thisInvoice).length} new since the last invoice` : ''}.</p>
      <div className="flex items-end gap-2 flex-wrap">
        <Labeled label="Invoice No."><Input className="h-9 w-32" value={invNo} onChange={(e) => setInvNo(e.target.value)} /></Labeled>
        <Labeled label="Date"><Input type="date" className="h-9 w-44" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></Labeled>
        <Button variant="outline" className="h-9" onClick={() => open(`/api/reports/cm-invoice/${projectId}?stream=${d.stream}`)}><FileText className="h-4 w-4 mr-1" /> Preview</Button>
        <Button className="h-9" disabled={busy || Math.abs(d.due) < 0.005 || !invNo.trim()} onClick={issue}><Printer className="h-4 w-4 mr-1" /> Issue</Button>
      </div>
      {mine.length > 0 && (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
            <th className="py-1">Invoice</th><th className="py-1">Date</th><th className="py-1 text-right">Amount</th><th className="py-1 pl-4">Issued By</th><th className="py-1 pl-4">Paid</th><th className="w-28" />
          </tr></thead>
          <tbody>
            {mine.map((inv, i) => (
              <tr key={inv.number} className="border-b last:border-0">
                <td className="py-1.5 font-medium">{inv.number}</td>
                <td className="py-1.5">{shortDate(inv.date)}</td>
                <td className="py-1.5 text-right tabular-nums">{money(inv.due)}</td>
                <td className="py-1.5 pl-4 text-gray-600">{inv.issuedBy || ''}</td>
                <td className="py-1.5 pl-4"><PaidCell inv={inv} projectId={projectId} /></td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  <button className="text-blue-700 hover:underline text-xs mr-2" onClick={() => open(`/api/reports/cm-invoice/${projectId}?invoice=${encodeURIComponent(inv.number)}`)}>Reprint</button>
                  {i === mine.length - 1 && (
                    <button className="text-gray-400 hover:text-red-700 align-middle" title="Withdraw (only if never sent)" onClick={() => withdraw(inv.number)}><Trash2 className="h-3.5 w-3.5 inline" /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
/** When the invoice was paid and how much came in — feeds "fee paid" on the dashboards. */
function PaidCell({ inv, projectId }: { inv: CmInvoiceRow; projectId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(inv.paidDate || todayIso());
  const [amount, setAmount] = useState(inv.paidAmount != null ? inv.paidAmount.toFixed(2) : inv.due.toFixed(2));
  const save = async (clear?: boolean) => {
    try {
      const data = await apiRequest(`/api/cost-projects/${projectId}/cm-invoices/${encodeURIComponent(inv.number)}/payment`, 'PATCH',
        clear ? { amount: null } : { date, amount: parseAmount(amount) });
      queryClient.setQueryData([projectKey(projectId)], data);
      setEditing(false);
      toast({ title: clear ? `${inv.number} marked unpaid` : `Payment recorded on ${inv.number}` });
    } catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
  };
  if (editing) return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Input type="date" className="h-8 w-36" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date paid" />
      <div className="w-32"><MoneyInput className="h-8" value={amount} onValueChange={setAmount} aria-label="Amount received" /></div>
      <Button size="sm" className="h-8" onClick={() => save()}>Save</Button>
      {inv.paidDate && <Button size="sm" variant="ghost" className="h-8 text-red-700" onClick={() => save(true)}>Clear</Button>}
      <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>Cancel</Button>
    </div>
  );
  return inv.paidDate
    ? <button className="text-left text-xs hover:underline" onClick={() => setEditing(true)} title="Edit the payment">
        <span className="text-green-700 font-medium tabular-nums">{money(inv.paidAmount ?? 0)}</span> <span className="text-gray-600">on {shortDate(inv.paidDate)}</span>
        {inv.paidAmount != null && inv.paidAmount + 0.005 < inv.due && <span className="text-amber-700"> · short {money(inv.due - inv.paidAmount)}</span>}
      </button>
    : <button className="text-blue-700 hover:underline text-xs" onClick={() => setEditing(true)}>Record Payment</button>;
}
function SumRow({ label, a, b, subA, subB, strong }: { label: string; a: string; b: string; subA?: string; subB?: string; strong?: boolean }) {
  return (
    <tr className={`border-b last:border-0 ${strong ? 'font-semibold' : ''}`}>
      <td className="py-1.5 text-gray-700">{label}</td>
      <td className="py-1.5 text-right">{a}{subA && <div className="text-[11px] text-gray-500 font-normal">{subA}</div>}</td>
      <td className="py-1.5 text-right">{b}{subB && <div className="text-[11px] text-gray-500 font-normal">{subB}</div>}</td>
    </tr>
  );
}

/** The Lien Waiver Log: all pay apps, or the ones ticked; outstanding only if wanted. */
function WaiverLogCard({ b, projectId, open }: { b: ProjectBundle; projectId: number; open: (url: string) => void }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [outOnly, setOutOnly] = useState(false);
  const groups = useMemo(() => waiversByPayApp(
    b.applications.map((a) => ({ id: a.id, contractId: a.contractId, number: a.number, docNumber: a.docNumber })),
    b.waivers, (cid) => b.contracts.find((c) => c.id === cid)?.counterparty ?? '',
    paidOfFrom(b.payments, (aid) => (() => { const a = b.applications.find((x) => x.id === aid); return a ? gcPaymentDue(a as any, b.waivers, b.contracts.find((c) => c.id === a.contractId)?.counterparty ?? '').due : null; })())), [b.applications, b.waivers, b.contracts, b.payments]);
  const contracts = Array.from(new Set(groups.map((g) => g.contractId)));
  const nn = (n: number) => String(n).padStart(3, '0');
  const ok = groups.filter((g) => g.compliant).length;
  const flip = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const url = () => {
    const q = new URLSearchParams();
    // Every one ticked is the same as all — the report shouldn't say "only".
    if (picked.size && picked.size < groups.length) q.set('apps', Array.from(picked).join(','));
    if (outOnly) q.set('outstanding', '1');
    const s = q.toString();
    return `/api/reports/lien-waivers/${projectId}${s ? `?${s}` : ''}`;
  };
  return (
    <Card id="waivers" title="Lien Waiver Log" what="By pay app: its conditional waivers, and the unconditionals it carries for the pay app before. Compliant when both are in. Print all pay apps or the ones you tick."
          summary={groups.length ? `${ok} of ${groups.length} Compliant` : undefined}
          action={<Button variant="outline" className="h-9" onClick={() => open(url())}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
      {!groups.length ? (
        <p className="text-sm text-gray-700">No waivers recorded yet — add them from each pay app's Package (Contracts or Pay Apps tab).</p>
      ) : (
        <>
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="text-gray-700">{picked.size ? `${picked.size} of ${groups.length} pay apps selected` : `All ${groups.length} pay apps`}</span>
            {/* Quick picks: all of them, or just the compliant / not compliant ones; Clear un-ticks (which prints all). */}
            <span className="flex items-center gap-3 text-xs">
              <button className="text-blue-700 hover:underline" onClick={() => setPicked(new Set(groups.map((g) => g.appId)))}>Select All</button>
              <button className="text-blue-700 hover:underline" onClick={() => setPicked(new Set(groups.filter((g) => g.compliant).map((g) => g.appId)))}>Select Compliant</button>
              <button className="text-blue-700 hover:underline" onClick={() => setPicked(new Set(groups.filter((g) => !g.compliant).map((g) => g.appId)))}>Select Not Compliant</button>
              {picked.size > 0 && <button className="text-gray-600 hover:underline" onClick={() => setPicked(new Set())}>Clear</button>}
            </span>
            <label className="flex items-center gap-2 cursor-pointer ml-auto">
              <input type="checkbox" className="h-4 w-4" checked={outOnly} onChange={(e) => setOutOnly(e.target.checked)} /> Outstanding Only
            </label>
          </div>
          {contracts.map((cid) => (
            <div key={cid} className="space-y-1">
              {contracts.length > 1 && <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">{b.contracts.find((c) => c.id === cid)?.counterparty}</div>}
              <div className="flex flex-wrap gap-2">
                {groups.filter((g) => g.contractId === cid).map((g) => {
                  const on = picked.has(g.appId);
                  return (
                    <label key={g.appId} className={`flex items-center gap-2 border rounded-md px-2.5 py-1.5 text-sm cursor-pointer ${on ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                      <input type="checkbox" className="h-4 w-4" checked={on} onChange={() => flip(g.appId)} />
                      Pay App {nn(g.appNumber)}
                      {g.compliant
                        ? <span className="text-[10px] font-semibold text-green-800 bg-green-100 rounded px-1">Compliant</span>
                        : <span className="text-[10px] font-semibold text-red-800 bg-red-100 rounded px-1">{g.outstanding} Outstanding</span>}
                      {g.awaiting > 0 && <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 rounded px-1" title="Unconditionals for a pay app we haven't paid in full">{g.awaiting} Pending Funding</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="text-xs text-gray-500">None ticked prints every pay app too. Open a pay app's Package to add or check off waivers.</p>
        </>
      )}
    </Card>
  );
}

/** Pay Application Log: the GC's and each sub's pay app per pay app — line 8 vs the conditional, and the file. */
/**
 * Payoff Statement (refinance / sale): every pay app billed and unpaid plus the retainage held,
 * as of a closing date, and the releases to collect once it's paid.
 */
export function PayoffCard({ b, projectId }: { b: ProjectBundle; projectId: number }) {
  const latest = b.positionInput.applications.reduce((m, a) => (String(a.date).slice(0, 10) > m ? String(a.date).slice(0, 10) : m), '');
  const [asOf, setAsOf] = useState(latest > todayIso() ? latest : todayIso());
  const t = b.position.totals;
  const openApps = b.position.applications.filter((a) => a.open > 0.005);
  const payoff = Math.round((openApps.reduce((s, a) => s + a.open, 0) + t.retainageHeld) * 100) / 100;
  const { toast } = useToast();
  const [worst, setWorst] = useState(false);
  const open = () => { openReport(`/api/reports/payoff/${projectId}?asOf=${asOf}${worst ? '&worst=1' : ''}`).then((ok) => { if (!ok) toast({ title: 'Report Failed', description: 'The new tab says why.', variant: 'destructive' }); }); };
  return (
    <Card id="payoff" title="Payoff Statement" what="For a refinance or sale: what it takes to bring every contractor to zero (each pay app billed and not yet paid, plus the retainage held) as of a closing date, and the lien releases to collect once it's paid."
          summary={`Payoff ${money(payoff)}`}
          action={<Button variant="outline" className="h-9" onClick={open}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label className="space-y-1"><span className="text-xs text-gray-600 block">As Of (Closing Date)</span>
          <Input type="date" className="h-9 w-44" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm pb-2" title="For a capital call while differences are reconciled: each open pay app at the higher of ours and the contractor's payment due">
          <input type="checkbox" className="h-4 w-4" checked={worst} onChange={(e) => setWorst(e.target.checked)} /> Worst Case (Higher of Ours and Theirs)</label>
        <div><div className="text-[11px] uppercase tracking-wide text-gray-500">Billed, Unpaid</div><div className="font-semibold tabular-nums">{money(openApps.reduce((s, a) => s + a.open, 0))} <span className="text-xs font-normal text-gray-500">({openApps.length} pay app{openApps.length === 1 ? '' : 's'})</span></div></div>
        <div><div className="text-[11px] uppercase tracking-wide text-gray-500">Retainage Held</div><div className="font-semibold tabular-nums">{money(t.retainageHeld)}</div></div>
        <div><div className="text-[11px] uppercase tracking-wide text-gray-500">Payoff Today</div><div className="font-semibold tabular-nums text-blue-900">{money(payoff)}</div></div>
      </div>
    </Card>
  );
}

/** Ours against the contractor's, G702 and G703, for one pay app or every one that doesn't agree. */
function G702CompareCard({ b, projectId, open }: { b: ProjectBundle; projectId: number; open: (url: string) => void }) {
  const cname = (cid: number) => b.contracts.find((c) => c.id === cid)?.counterparty ?? '';
  const apps = [...b.applications].sort((x, y) => x.contractId - y.contractId || y.number - x.number)
    .map((a) => ({ a, tw: threeWayCheck(a as any, b.waivers, cname(a.contractId)) }));
  const off = apps.filter((x) => x.tw.status === 'off');
  const [pick, setPick] = useState<string>(String((off[0] ?? apps[0])?.a.id ?? ''));
  const nn = (n: number) => String(n).padStart(3, '0');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [reading, setReading] = useState(false);
  const picked = b.applications.find((a) => String(a.id) === pick) as any;
  const g703 = picked?.contractorG703 as { readAt?: string; fileName?: string; rows?: unknown[] } | null | undefined;
  const hasPdf = picked ? b.documents.some((d: any) => d.applicationId === picked.id && (/\.pdf$/i.test(d.originalName) || /pdf|^image\//i.test(d.mimeType ?? ''))) : false;
  const readTheirs = async () => {
    setReading(true);
    try {
      const r: any = await apiRequest(`/api/cost-applications/${picked.id}/read-their-g703`, 'POST', {}, 180_000);
      await qc.invalidateQueries({ queryKey: [projectKey(projectId)] });
      toast({ title: "Their G703 Read", description: `${r.rows} line${r.rows === 1 ? '' : 's'} read from ${r.fileName}${r.unmatched ? `; ${r.unmatched} didn't match a line of ours (listed at the end of the report)` : ''}. Print to see them line by line.`, duration: 9000 });
    } catch (e: any) { toast({ title: 'Not Read', description: e?.message, variant: 'destructive', duration: 10000 }); }
    finally { setReading(false); }
  };
  return (
    <Card id="g702-compare" title="G702 / G703 Comparison" what="One pay app, ours beside the contractor's: G702 lines 1 to 9 and the GC's conditional with the difference on each (all should be $0.00), then every G703 line, ours beside theirs (read by AI from their pay app PDF) so you see exactly which line is off, and the lines as entered."
          summary={apps.length ? (off.length ? `${off.length} Don't Agree` : 'All Agree') : undefined}
          action={<Button variant="outline" className="h-9" disabled={!pick} onClick={() => open(`/api/reports/g702-compare/${projectId}?app=${pick}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
      {!apps.length ? <p className="text-sm text-gray-700">No pay apps yet.</p> : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-80">
            <Select value={pick} onValueChange={setPick}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent className="pm-scope">
                {apps.map(({ a, tw }) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {b.contracts.length > 1 ? `${cname(a.contractId)} · ` : ''}{a.kind === 'invoice' ? 'Invoice' : 'Pay App'} {nn(a.docNumber)} — {tw.status === 'off' ? `⚠ Off${tw.oursOff != null ? ` ${money(Math.abs(tw.oursOff))}` : ''}` : tw.status === 'none' ? 'Theirs Not Entered' : '✓ Agrees'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {picked && <Button variant="outline" className="h-9" disabled={reading || !hasPdf} title={hasPdf ? 'AI reads the pay app PDF attached to this pay app and keeps their G703 lines for the comparison' : 'Attach the pay app PDF to this pay app first'} onClick={readTheirs}>
            {reading ? 'Reading…' : g703?.rows ? 'Read Their G703 Again' : 'Read Their G703 (AI)'}</Button>}
          {off.length > 0 && <Button variant="outline" className="h-9" onClick={() => open(`/api/reports/g702-compare/${projectId}?app=off`)}>Print All That Don't Agree ({off.length})</Button>}
          <Button variant="ghost" className="h-9" onClick={() => open(`/api/reports/g702-compare/${projectId}?app=all`)}>Print Every Pay App</Button>
          {picked && <p className="w-full text-xs text-gray-600">{g703?.rows
            ? <>Their G703: {g703.rows.length} lines read{g703.fileName ? ` from ${g703.fileName}` : ''}{g703.readAt ? ` on ${shortDate(g703.readAt.slice(0, 10))}` : ''}. The report compares every line, ours against theirs.</>
            : hasPdf ? <>Their G703 isn't read for this pay app yet: Read Their G703 so the report shows which lines differ, not just the totals.</>
            : <>No pay app PDF is attached to this pay app. Attach it on the pay app to read their G703 line by line.</>}</p>}
        </div>
      )}
    </Card>
  );
}

function PayAppLogCard({ b, projectId, open }: { b: ProjectBundle; projectId: number; open: (url: string) => void }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [issues, setIssues] = useState(false);
  const groups = useMemo(() => payAppLog(
    b.applications.map((a) => ({ id: a.id, contractId: a.contractId, number: a.number, docNumber: a.docNumber })),
    b.waivers, b.documents, (cid) => b.contracts.find((c) => c.id === cid)?.counterparty ?? '',
    (aid) => (() => { const a = b.applications.find((x) => x.id === aid); return a ? gcPaymentDue(a as any, b.waivers, b.contracts.find((c) => c.id === a.contractId)?.counterparty ?? '').due : null; })()), [b.applications, b.waivers, b.documents, b.contracts]);
  const nn = (n: number) => String(n).padStart(3, '0');
  const done = groups.filter((g) => g.complete).length;
  const flip = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const url = () => {
    const q = new URLSearchParams();
    if (picked.size && picked.size < groups.length) q.set('apps', Array.from(picked).join(','));
    if (issues) q.set('issues', '1');
    const s = q.toString();
    return `/api/reports/pay-app-log/${projectId}${s ? `?${s}` : ''}`;
  };
  return (
    <Card id="payapp-log" title="Pay Application Log" what="The GC's and each sub's pay application behind every pay app: payment due (line 8) against the vendor's conditional, and whether the file is in. Then the same by vendor across the job."
          summary={groups.length ? `${done} of ${groups.length} Complete` : undefined}
          action={<Button variant="outline" className="h-9" onClick={() => open(url())}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
      {!groups.length ? (
        <p className="text-sm text-gray-700">Nothing yet — attach pay applications and enter amounts in each pay app's Package (Pay Applications section).</p>
      ) : (
        <>
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="text-gray-700">{picked.size ? `${picked.size} of ${groups.length} pay apps selected` : `All ${groups.length} pay apps`}</span>
            <span className="flex items-center gap-3 text-xs">
              <button className="text-blue-700 hover:underline" onClick={() => setPicked(new Set(groups.map((g) => g.appId)))}>Select All</button>
              <button className="text-blue-700 hover:underline" onClick={() => setPicked(new Set(groups.filter((g) => g.complete).map((g) => g.appId)))}>Select Complete</button>
              <button className="text-blue-700 hover:underline" onClick={() => setPicked(new Set(groups.filter((g) => !g.complete).map((g) => g.appId)))}>Select Incomplete</button>
              {picked.size > 0 && <button className="text-gray-600 hover:underline" onClick={() => setPicked(new Set())}>Clear</button>}
            </span>
            <label className="flex items-center gap-2 cursor-pointer ml-auto">
              <input type="checkbox" className="h-4 w-4" checked={issues} onChange={(e) => setIssues(e.target.checked)} /> Issues Only
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => {
              const on = picked.has(g.appId);
              return (
                <label key={g.appId} className={`flex items-center gap-2 border rounded-md px-2.5 py-1.5 text-sm cursor-pointer ${on ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                  <input type="checkbox" className="h-4 w-4" checked={on} onChange={() => flip(g.appId)} />
                  Pay App {nn(g.appNumber)}
                  {g.complete && <span className="text-[10px] font-semibold text-green-800 bg-green-100 rounded px-1">Complete</span>}
                  {g.missingFiles > 0 && <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 rounded px-1">{g.missingFiles} Missing</span>}
                  {g.mismatched > 0 && <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 rounded px-1">{g.mismatched} Don't Match</span>}
                </label>
              );
            })}
          </div>
          <p className="text-xs text-gray-500">None ticked prints every pay app. Attach files and enter amounts in each pay app's Package.</p>
        </>
      )}
    </Card>
  );
}

/** Change Order Log: every vendor change order with its amount, approval pay app and executed copy. */
function CoLogCard({ b, projectId, open }: { b: ProjectBundle; projectId: number; open: (url: string) => void }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const rows = useMemo(() => coLog(b.changeOrders as any, b.sovLines as any, b.documents as any, today), [b.changeOrders, b.sovLines, b.documents, today]);
  const [openOnly, setOpenOnly] = useState(false);
  const [history, setHistory] = useState(false);
  const approved = rows.filter((r) => r.status === 'approved');
  const missing = approved.filter((r) => !r.executed).length;
  const openRows = rows.filter((r) => r.routing.open);
  const stages = CO_STAGES.map((st) => ({ st, list: rows.filter((r) => r.routing.stage === st.key) })).filter((x) => x.list.length);
  const q = [openOnly ? 'open=1' : '', history ? 'history=1' : ''].filter(Boolean).join('&');
  return (
    <Card id="co-log" title="Change Order Log" what="Where every contractor change order stands: stage, who has it, days in the stage, days added to the schedule, amount, the pay app it was approved on, and whether the executed copy is on file."
          summary={openRows.length ? `${openRows.length} Open · ${money(openRows.reduce((t, r) => t + r.amount, 0))}` : approved.length ? `${approved.length - missing} of ${approved.length} Executed` : undefined}
          action={<Button variant="outline" className="h-9" onClick={() => open(`/api/reports/co-log/${projectId}${q ? `?${q}` : ''}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
      {!rows.length ? <p className="text-sm text-gray-700">No change orders yet.</p> : <>
        <div className="flex flex-wrap gap-2">
          {stages.map(({ st, list }) => {
            const oldest = st.key !== 'approved' && st.key !== 'rejected' ? Math.max(...list.map((r) => r.routing.daysInStage ?? 0)) : null;
            return (
              <span key={st.key} className={`text-xs border rounded px-2 py-1 ${STAGE_STYLE[st.tone]}`}>
                <strong>{st.label}</strong> · {list.length} · {money(list.reduce((t, r) => t + r.amount, 0))}{oldest != null ? ` · longest ${oldest}d` : ''}
              </span>
            );
          })}
        </div>
        <p className="text-sm text-gray-700">{approved.length} approved ({money(approved.reduce((t, r) => t + r.amount, 0))}){missing ? <span className="text-amber-700 font-medium"> · {missing} without an executed copy</span> : approved.length ? <span className="text-green-700"> · all executed copies on file</span> : null}.</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Open Only</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={history} onChange={(e) => setHistory(e.target.checked)} /> Include Routing History</label>
        </div>
      </>}
    </Card>
  );
}

/** Pay app packages as zips for the lender: one, several, or all — a folder per pay app. */
export function LenderPackagesCard({ b, projectId }: { b: ProjectBundle; projectId: number }) {
  const { toast } = useToast();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [withCos, setWithCos] = useState(false);
  const nn = (n: number) => String(n).padStart(3, '0');
  const apps = [...b.applications].sort((x, y) => x.contractId - y.contractId || x.number - y.number);
  const coRows = useMemo(() => coLog(b.changeOrders as any, b.sovLines as any, b.documents as any), [b.changeOrders, b.sovLines, b.documents]);
  const fileCount = (aid: number) => {
    const a = b.applications.find((x) => x.id === aid);
    const coFiles = a ? coRows.filter((r) => r.contractId === a.contractId && r.status === 'approved' && r.startApp === a.number).reduce((t, r) => t + r.files.length, 0) : 0;
    return b.documents.filter((d) => d.applicationId === aid).length + coFiles
      + b.waivers.filter((w) => w.applicationId === aid && w.documentId && !b.documents.some((d) => d.id === w.documentId && d.applicationId === aid)).length;
  };
  const withFiles = apps.filter((a) => fileCount(a.id) > 0);
  const contracts = Array.from(new Set(apps.map((a) => a.contractId)));
  const flip = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const download = async () => {
    const ids = Array.from(picked);
    if (!ids.length) return;
    setBusy(true);
    try {
      const { AUTH_TOKEN_KEY } = await import('@/lib/auth-constants');
      const res = await fetch(`/api/cost-projects/${projectId}/packages?apps=${ids.join(',')}${withCos ? '&cos=1' : ''}`, { headers: { Authorization: `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` } });
      if (!res.ok) { toast({ title: 'No Package', description: (await res.json().catch(() => ({})))?.message, variant: 'destructive' }); return; }
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'packages.zip';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) { toast({ title: 'Download Failed', description: e?.message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  return (
    <Card id="lender-packages" defaultOpen title="Lender Packages" what="Download pay app packages as a zip — one pay app, or several in one zip with a folder each (pay applications, conditional and unconditional waivers, invoices), each with a contents sheet."
          summary={`${withFiles.length} of ${apps.length} pay apps have files`}
          action={<Button className="h-9" disabled={!picked.size || busy} onClick={download}><Download className="h-4 w-4 mr-1" /> {busy ? 'Building…' : picked.size > 1 ? `Download Zip (${picked.size})` : 'Download Zip'}</Button>}>
      {!apps.length ? <p className="text-sm text-gray-700">No pay apps yet.</p> : (
        <>
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <span className="text-sm text-gray-700">{picked.size ? `${picked.size} selected` : 'Tick the pay apps to send'}</span>
            <button className="text-blue-700 hover:underline" onClick={() => setPicked(new Set(withFiles.map((a) => a.id)))}>Select All</button>
            {withFiles.length > 0 && <button className="text-blue-700 hover:underline" onClick={() => setPicked(new Set([withFiles[withFiles.length - 1].id]))}>Latest Only</button>}
            {picked.size > 0 && <button className="text-gray-600 hover:underline" onClick={() => setPicked(new Set())}>Clear</button>}
            <label className="flex items-center gap-2 cursor-pointer ml-auto text-sm" title="Adds a Change Orders folder with every approved change order's executed copy, and a log of them">
              <input type="checkbox" className="h-4 w-4" checked={withCos} onChange={(e) => setWithCos(e.target.checked)} /> Include All Executed Change Orders to Date
            </label>
          </div>
          {contracts.map((cid) => (
            <div key={cid} className="space-y-1">
              {contracts.length > 1 && <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">{b.contracts.find((c) => c.id === cid)?.counterparty}</div>}
              <div className="flex flex-wrap gap-2">
                {apps.filter((a) => a.contractId === cid).map((a) => {
                  const n = fileCount(a.id); const on = picked.has(a.id);
                  return (
                    <label key={a.id} className={`flex items-center gap-2 border rounded-md px-2.5 py-1.5 text-sm ${n ? 'cursor-pointer' : 'opacity-50'} ${on ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
                           title={n ? `${n} file${n === 1 ? '' : 's'}` : 'No files on this pay app yet'}>
                      <input type="checkbox" className="h-4 w-4" disabled={!n} checked={on} onChange={() => flip(a.id)} />
                      {a.kind === 'invoice' ? 'Invoice' : 'Pay App'} {nn(a.docNumber)}
                      <span className="text-[10px] text-gray-500">{n} file{n === 1 ? '' : 's'}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="text-xs text-gray-500">Pay apps with no files can't be ticked. Each folder is the same as that pay app's own Download Package.</p>
        </>
      )}
    </Card>
  );
}

/** A report, rolled up to one line; open it to set its filters and print. Remembers what was left open. */
function SovCard({ b, projectId, open }: { b: ProjectBundle; projectId: number; open: (url: string) => void }) {
  const withLines = b.contracts.filter((c) => b.sovLines.some((l) => l.contractId === c.id));
  const [cid, setCid] = useState<string>('all');
  return (
    <Card id="sov" title="Contract Schedule of Values" what="Each contract's SOV as a report: base contract by section, every change order, with billed to date, percent complete, balance to finish, retainage held and the budget line each maps to."
          action={<Button variant="outline" className="h-9" disabled={!withLines.length} onClick={() => open(`/api/reports/sov/${projectId}${cid === 'all' ? '' : `?contract=${cid}`}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
      {withLines.length ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-700">Contract</span>
          <Select value={cid} onValueChange={setCid}>
            <SelectTrigger className="h-8 w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Contracts (One per Page)</SelectItem>
              {withLines.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.counterparty}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-gray-500">Prints landscape, billed through the latest pay app.</span>
        </div>
      ) : <p className="text-sm text-gray-600">No contract lines entered yet.</p>}
    </Card>
  );
}

function Card({ id, title, what, summary, action, children, defaultOpen = false }: { id: string; title: string; what: string; summary?: string; action?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const storeKey = `pm-report-open-${id}`;
  const [isOpen, setOpen] = useState(() => { try { const v = localStorage.getItem(storeKey); return v == null ? defaultOpen : v === '1'; } catch { return defaultOpen; } });
  const toggle = () => setOpen((v) => { try { localStorage.setItem(storeKey, v ? '0' : '1'); } catch { /* private mode */ } return !v; });
  return (
    <div className="bg-white border rounded-lg">
      <div className="flex items-center gap-3 px-4 py-3">
        <button className="flex items-start gap-2 text-left flex-1 min-w-0" onClick={toggle} aria-expanded={isOpen}>
          <ChevronRight className={`h-4 w-4 mt-0.5 flex-shrink-0 text-gray-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <p className={`text-xs text-gray-600 mt-0.5 ${isOpen ? '' : 'truncate'}`}>{what}</p>
          </div>
        </button>
        {!isOpen && summary && <span className="text-xs text-gray-700 tabular-nums whitespace-nowrap hidden md:inline">{summary}</span>}
        {action}
      </div>
      {isOpen && <div className="px-4 pb-4 pt-1 space-y-3 border-t">{children}</div>}
    </div>
  );
}
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><div className="text-xs text-gray-600">{label}</div>{children}</div>;
}
function Fig({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div><div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div><div className={`tabular-nums ${strong ? 'text-lg font-bold text-gray-900' : 'font-semibold text-gray-800'}`}>{value}</div></div>;
}

/** Who's waiting on what: each vendor's conditionals on every pay app (paid ones grayed, $0.00 owed), their total and what's still owed. */
function OwedByVendorCard({ b, projectId, open }: { b: ProjectBundle; projectId: number; open: (url: string) => void }) {
  const [q, setQ] = useState('');
  const [onlyOut, setOnlyOut] = useState(false);
  const o = useMemo(() => {
    const ids = new Set(b.position.applications.filter((a) => a.open > 0.005).map((a) => a.applicationId));
    return owedByVendor(b.applications as any, b.waivers, (cid) => b.contracts.find((c) => c.id === cid)?.counterparty ?? '', ids, onlyOut);
  }, [b.position.applications, b.applications, b.waivers, b.contracts, onlyOut]);
  const nn = (n: number) => String(n).padStart(3, '0');
  const unpaidCount = o.apps.filter((a) => !a.paid).length;
  const rows = o.rows.filter((r) => !q.trim() || r.vendor.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Card id="owed-by-vendor" title="Owed by Vendor" what="Each vendor's conditional release on every pay app, what they've been released in total and what's still owed on pay apps not yet paid. The GC's covers its subs' (we pay the GC, the GC pays them)."
          summary={unpaidCount ? `${unpaidCount} Unpaid Pay App${unpaidCount === 1 ? '' : 's'} · Subs Owed ${money(o.subOwed)}` : 'All Paid'}
          action={<Button variant="outline" className="h-9" onClick={() => open(`/api/reports/owed-by-vendor/${projectId}${onlyOut ? '?outstanding=1' : ''}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
      {!o.apps.length ? <p className="text-sm text-gray-700">{onlyOut ? 'Every pay app is paid.' : 'No pay apps yet.'}</p> : null}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm"><span className="text-xs text-gray-600">Find a Vendor</span>
            <Input className="h-9 w-72" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={onlyOut} onChange={(e) => setOnlyOut(e.target.checked)} /> Outstanding Only</label>
        </div>
        {o.apps.length > 0 && (
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead><tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b">
                <th className="text-left font-medium py-1 pr-3">Vendor</th>
                {o.apps.map((a) => <th key={a.id} className={`text-right font-medium py-1 px-2 ${a.paid ? 'text-gray-400' : ''}`}>Pay App {nn(a.docNumber)}{a.paid && <div className="text-[10px] normal-case text-green-700">Paid</div>}</th>)}
                {!onlyOut && <th className="text-right font-medium py-1 px-2">Total Released</th>}
                <th className="text-right font-medium py-1 pl-2">Still Owed</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.party + r.vendor} className={`border-b ${r.party === 'gc' ? 'font-semibold bg-gray-50' : ''}`}>
                    <td className={`py-1 pr-3 ${r.party === 'sub' ? 'pl-3' : ''}`}>{r.vendor}{r.party === 'gc' && <span className="ml-1 text-[10px] text-blue-700 border border-blue-200 rounded px-1">GC</span>}</td>
                    {o.apps.map((a) => {
                      const v = r.byApp[a.id];
                      return <td key={a.id} className={`py-1 px-2 text-right tabular-nums ${a.paid ? 'text-gray-400' : ''}`}>{v ? <>{money(v.amount)}{!v.received && !a.paid && <div className="text-[10px] text-amber-700 font-normal">not received</div>}</> : <span className="text-gray-300">—</span>}</td>;
                    })}
                    {!onlyOut && <td className="py-1 px-2 text-right tabular-nums">{money(r.total)}</td>}
                    <td className={`py-1 pl-2 text-right tabular-nums font-semibold ${r.owed > 0.005 ? '' : 'text-gray-400'}`}>{money(r.owed)}</td>
                  </tr>
                ))}
                {!q.trim() && o.rows.some((r) => r.party === 'sub') && (
                  <tr className="font-semibold border-t-2 border-gray-800">
                    <td className="py-1 pr-3">Subcontractors Total</td>
                    {o.apps.map((a) => <td key={a.id} className={`py-1 px-2 text-right tabular-nums ${a.paid ? 'text-gray-400' : ''}`}>{money(o.subByApp[a.id] ?? 0)}</td>)}
                    {!onlyOut && <td className="py-1 px-2 text-right tabular-nums">{money(o.subTotal)}</td>}
                    <td className="py-1 pl-2 text-right tabular-nums">{money(o.subOwed)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

type SnapRow = { id: number; kind: string; period: string; takenAt: string; takenBy: string | null; projected: number };
/** The one report for leadership, with the contingency line and the snapshot to compare against. */
function FinancialSummaryCard({ b, projectId, open }: { b: ProjectBundle; projectId: number; open: (url: string) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const snaps = useQuery<SnapRow[]>({ queryKey: [`/api/cost-projects/${projectId}/snapshots`] });
  const list = snaps.data ?? [];
  const todayEt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));
  const def = list.find((s) => dayOf(s.takenAt) < todayEt);
  const [since, setSince] = useState<string>('');
  const pick = since || (def ? String(def.id) : '0');
  const label = (s: SnapRow) => s.kind === 'month'
    ? `${new Date(s.period + '-15T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })} Month-End`
    : `${s.kind === 'baseline' ? 'Tracking Began' : 'Saved'} ${shortDate(dayOf(s.takenAt))}`;
  const save = async () => {
    try { await apiRequest(`/api/cost-projects/${projectId}/snapshots`, 'POST', {}); await qc.invalidateQueries({ queryKey: [`/api/cost-projects/${projectId}/snapshots`] }); toast({ title: 'Snapshot Saved', description: 'The next summary can compare against today.' }); }
    catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
  };
  const rows = b.summary.rows;
  const picked: string[] = Array.isArray((b.project as any).settings?.contingencyKeys) ? (b.project as any).settings.contingencyKeys : [];
  const found = rows.filter((r) => /contingenc/i.test(r.description));
  const setCont = async (key: string) => {
    try { const nb = await apiRequest(`/api/cost-projects/${projectId}/settings`, 'PUT', { contingencyKeys: key === 'auto' ? [] : [key] }); qc.setQueryData([projectKey(projectId)], nb); toast({ title: 'Contingency Line Saved' }); }
    catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
  };
  return (
    <Card id="financial-summary" title="Project Financial Summary" what="One report for leadership: budget against committed, pending and projected; contingency used against work complete; what moved since the last snapshot and why; change orders by stage; contracts and payments; and a Watch List of what needs attention."
          action={<Button className="h-9" onClick={() => open(`/api/reports/financial-summary/${projectId}?since=${pick}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label className="space-y-1"><span className="text-xs text-gray-600 block">Compare With</span>
          <div className="w-96">
            <Select value={pick} onValueChange={setSince}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent className="pm-scope">
                <SelectItem value="0">No Comparison</SelectItem>
                {list.map((s) => <SelectItem key={s.id} value={String(s.id)}>{label(s)} · {money(s.projected)} projected</SelectItem>)}
              </SelectContent>
            </Select>
          </div></label>
        <Button variant="outline" className="h-9" onClick={save}>Save Snapshot Now</Button>
        <label className="space-y-1"><span className="text-xs text-gray-600 block">Contingency Line</span>
          <div className="w-72">
            <Select value={picked[0] ?? 'auto'} onValueChange={setCont}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent className="pm-scope">
                <SelectItem value="auto">{found.length ? `Found by Name: ${found.map((r) => r.description).join(', ')}` : 'Found by Name (none found)'}</SelectItem>
                {rows.map((r) => <SelectItem key={r.key} value={r.key}>{r.description}</SelectItem>)}
              </SelectContent>
            </Select>
          </div></label>
      </div>
      <p className="text-xs text-gray-600">A snapshot is saved on its own at the start of every month (the month just ended), so the summary can say what moved and why. {list.length ? `${list.length} saved so far.` : 'The first one is saved shortly after this goes live.'}</p>
    </Card>
  );
}

/** Pay App Aging: open pay apps by days outstanding since the period-to date. */
function AgingCard({ b, projectId, open }: { b: ProjectBundle; projectId: number; open: (url: string) => void }) {
  const [asOf, setAsOf] = useState(todayIso());
  const rows = b.position.applications.filter((a) => a.open > 0.005 && String(a.date).slice(0, 10) <= asOf);
  const age = (d: string) => Math.max(0, Math.round((Date.parse(asOf + 'T12:00:00Z') - Date.parse(String(d).slice(0, 10) + 'T12:00:00Z')) / 86400000));
  const buckets = [['Current (0–30)', 0, 30], ['31–60 Days', 31, 60], ['61–90 Days', 61, 90], ['Over 90 Days', 91, Infinity]] as const;
  const sum = (lo: number, hi: number) => rows.filter((a) => { const d = age(a.date); return d >= lo && d <= hi; }).reduce((s, a) => s + a.open, 0);
  const total = rows.reduce((s, a) => s + a.open, 0);
  return (
    <Card id="aging" title="Pay App Aging" what="Every pay app not yet paid in full, by days outstanding since its period-to date: Current, 31–60, 61–90 and Over 90, by contractor and pay app. Retainage is shown apart; it isn't past due."
          summary={rows.length ? `${money(total)} Open · ${money(sum(61, Infinity))} Over 60 Days` : 'Nothing Open'}
          action={<Button variant="outline" className="h-9" onClick={() => open(`/api/reports/aging/${projectId}?asOf=${asOf}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
      <div className="flex flex-wrap items-end gap-6 text-sm">
        <label className="space-y-1"><span className="text-xs text-gray-600 block">As Of</span>
          <Input type="date" className="h-9 w-44" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
        {buckets.map(([l, lo, hi]) => (
          <div key={l}><div className="text-[11px] uppercase tracking-wide text-gray-500">{l}</div>
            <div className={`font-semibold tabular-nums ${lo > 60 && sum(lo, hi) > 0.005 ? 'text-red-700' : ''}`}>{money(sum(lo, hi))}</div></div>
        ))}
        <div><div className="text-[11px] uppercase tracking-wide text-gray-500">Total Open</div><div className="font-semibold tabular-nums">{money(total)}</div></div>
      </div>
    </Card>
  );
}
