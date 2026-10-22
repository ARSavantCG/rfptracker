/**
 * Every printable report for the project in one place, each rolled up to a
 * line: open one to set its filters and print. Cost reports first, then CM
 * fees and billing (the capital partner's and the tenant's invoices).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Printer, FileText, Trash2, ChevronRight } from 'lucide-react';
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
      <Card id="waivers" title="Lien Waiver Log" what="Every conditional waiver by contract and pay app, and whether its unconditional has come in with the next one. Outstanding ones shaded."
            action={<Button variant="outline" className="h-9" onClick={() => open(`/api/reports/lien-waivers/${projectId}`)}><Printer className="h-4 w-4 mr-1" /> Print</Button>}>
        <p className="text-sm text-gray-700">
          {(() => {
            const cond = b.waivers.filter((w) => w.kind === 'conditional').length;
            return cond ? `${cond} conditional waiver${cond === 1 ? '' : 's'} recorded. Open a pay app's Package to add or check off waivers.` : 'No waivers recorded yet — add them from each pay app\'s Package (Contracts or Pay Apps tab).';
          })()}
        </p>
      </Card>
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
  const nextNo = (n: number) => `${tenant ? 'TEN' : 'CAP'}-${String(n + 1).padStart(2, '0')}`;
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
  const billKey = tenant ? 'billToTenant' : 'billToCapital';
  return (
    <Card id={`invoice-${d.stream}`} title={tenant ? 'Tenant Invoice — Costs + CM Fee' : 'Capital Partner Invoice — CM Fee'}
          summary={`Due now ${money(d.due)}${mine.length ? ` · ${mine.length} issued` : ''}`}
          what={tenant
            ? `${d.tenantCosOnly ? 'Their change orders as the work is done' : "The tenant's share of costs"} (${d.basis} to date), markups and their CM fee at ${d.pct.toFixed(2)}%, less credits and what's been invoiced. Every pay app, invoice and charge itemized.`
            : `The CM fee at ${d.pct.toFixed(2)}% on costs ${d.basis} to date, less what's been invoiced. Costs incurred and paid listed as backup.`}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 pb-2 border-b">
        <Labeled label={tenant ? 'Costs Counted' : 'Fee Figured On'}>
          <Select value={d.basis} onValueChange={(v) => saveSetting({ [basisKey]: v }, 'Saved')}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent className="pm-scope">
              <SelectItem value="paid">What We've Paid</SelectItem>
              <SelectItem value="billed">What's Been Billed (Completed & Stored)</SelectItem>
            </SelectContent>
          </Select>
        </Labeled>
        {tenant && (
          <Labeled label="Tenant Pays For">
            <Select value={d.tenantCosOnly ? 'cos' : 'all'} onValueChange={(v) => saveSetting({ tenantBills: v }, 'Saved')}>
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
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
        {tenant ? <Fig label={`Billable Costs ${d.basis}`} value={money(d.base)} /> : <Fig label="Costs Incurred · Paid" value={`${money(d.incurred)} · ${money(d.paidToDate)}`} />}
        <Fig label={`CM Fee (${d.pct.toFixed(2)}%)${d.suppFee ? ' — Original' : ''}`} value={money(d.earned)} />
        {d.suppFee ? <Fig label="Supplemental CM Fee" value={money(d.suppFee)} /> : null}
        <Fig label={tenant ? 'Costs + Fee to Date' : 'CM Fees to Date'} value={money(d.toDate)} />
        <Fig label="Previously Invoiced" value={money(d.previous)} />
        <Fig label="Due Now" value={money(d.due)} strong />
      </div>
      <p className="text-xs text-gray-600">{d.items.length} item{d.items.length === 1 ? '' : 's'} behind it{d.items.some((i) => i.thisInvoice) ? `, ${d.items.filter((i) => i.thisInvoice).length} new since the last invoice` : ''}.</p>
      <div className="flex items-end gap-2 flex-wrap">
        <Labeled label="Invoice no."><Input className="h-9 w-32" value={invNo} onChange={(e) => setInvNo(e.target.value)} /></Labeled>
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
        clear ? { amount: null } : { date, amount: parseFloat(amount.replace(/,/g, '')) });
      queryClient.setQueryData([projectKey(projectId)], data);
      setEditing(false);
      toast({ title: clear ? `${inv.number} marked unpaid` : `Payment recorded on ${inv.number}` });
    } catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
  };
  if (editing) return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Input type="date" className="h-8 w-36" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date paid" />
      <Input className="h-8 w-28 text-right tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount received" />
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

/** A report, rolled up to one line; open it to set its filters and print. Remembers what was left open. */
function Card({ id, title, what, summary, action, children }: { id: string; title: string; what: string; summary?: string; action?: React.ReactNode; children: React.ReactNode }) {
  const storeKey = `pm-report-open-${id}`;
  const [isOpen, setOpen] = useState(() => { try { return localStorage.getItem(storeKey) === '1'; } catch { return false; } });
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
