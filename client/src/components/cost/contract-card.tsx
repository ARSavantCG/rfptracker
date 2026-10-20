/**
 * One contract: its schedule of values, grouped as the contractor groups it —
 * base contract first, then each change order as its own header with its own
 * lines (cost of work, insurance, fee) underneath — and its pay apps.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Plus, FileText, AlertTriangle, Paperclip, Pencil, Trash2, FolderOpen } from 'lucide-react';
import { SovGridEditor } from './sov-grid-editor';
import { lineProgress, type BaselineLine, type G702 } from '@shared/cost-tracking';
import {
  money, pct, projectKey, BUCKET_LABEL,
  type ContractRow, type ChangeOrderRow, type SovLineRow, type ApplicationRow, type DocumentRow, type PaymentRow,
} from './types';

export function ContractCard({
  contract, changeOrders, lines, applications, documents, baseline, g702, projectId,
  onEditLine, onPaste, onOpenApplication, payments = [], onPay, onPackage,
}: {
  contract: ContractRow;
  changeOrders: ChangeOrderRow[];
  lines: SovLineRow[];
  applications: ApplicationRow[];
  documents: DocumentRow[];
  baseline: BaselineLine[];
  g702: G702 | undefined;
  projectId: number;
  onEditLine: (l: SovLineRow) => void;
  onPaste: (t: { contractId: number; changeOrderId: number | null; label: string }) => void;
  onOpenApplication: (contract: ContractRow, app: ApplicationRow | null, kind: 'pay_app' | 'invoice') => void;
  payments?: PaymentRow[];
  onPay?: (contract: ContractRow, app: ApplicationRow) => void;
  onPackage?: (contract: ContractRow, app: ApplicationRow) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
  const [coForm, setCoForm] = useState<{ number: string; title: string } | null>(null);
  // Which group's lines are open in the grid: 'base', a change order id, or none.
  // A brand-new contract opens straight into its base contract.
  const [editing, setEditing] = useState<string | null>(lines.length === 0 && changeOrders.length === 0 ? 'base' : null);
  const billedIds = useMemo(() => new Set(applications.flatMap((a) => a.lines.map((l) => l.sovLineId))), [applications]);
  const removeContract = useMutation({
    mutationFn: () => apiRequest(`/api/cost-contracts/${contract.id}`, 'DELETE'),
    onSuccess: () => { refresh(); toast({ title: `${contract.counterparty} deleted` }); },
    onError: (e: any) => toast({ title: 'Not deleted', description: e?.message, variant: 'destructive' }),
  });
  const removeCo = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/cost-change-orders/${id}`, 'DELETE'),
    onSuccess: () => { refresh(); toast({ title: 'Change order deleted' }); },
    onError: (e: any) => toast({ title: 'Not deleted', description: e?.message, variant: 'destructive', duration: 10000 }),
  });
  const confirmDeleteContract = () => {
    const what = [
      `${lines.length} line${lines.length === 1 ? '' : 's'}`,
      `${changeOrders.length} change order${changeOrders.length === 1 ? '' : 's'}`,
      `${applications.length} pay app${applications.length === 1 ? '' : 's'}/invoice${applications.length === 1 ? '' : 's'}`,
      `${payments.filter((p) => p.contractId === contract.id).length} payment(s)`,
    ].join(', ');
    if (!window.confirm(`Delete the contract with ${contract.counterparty}?\n\nIts ${what} all go with it. This cannot be undone.`)) return;
    const typed = window.prompt(`To confirm, type the name exactly: ${contract.counterparty}`);
    if (typed == null) return;
    if (typed.trim().toLowerCase() !== contract.counterparty.trim().toLowerCase()) {
      toast({ title: 'Not deleted', description: 'The name did not match.' });
      return;
    }
    removeContract.mutate();
  };

  const progress = useMemo(() => lineProgress(applications.map((a) => ({
    id: a.id, contractId: a.contractId, number: a.number, lines: a.lines,
  }))), [applications]);
  const baselineName = useMemo(() => new Map(baseline.map((b) => [b.key, b.description])), [baseline]);

  const addCo = useMutation({
    mutationFn: () => apiRequest(`/api/cost-contracts/${contract.id}/change-orders`, 'POST',
      { number: coForm!.number, title: coForm!.title, status: 'pending' }),
    onSuccess: () => { refresh(); setCoForm(null); },
    onError: (e: any) => toast({ title: 'Not added', description: e?.message, variant: 'destructive' }),
  });
  const setCoStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest(`/api/cost-change-orders/${id}`, 'PATCH', { status }),
    onSuccess: refresh,
    onError: (e: any) => toast({ title: 'Not changed', description: e?.message, variant: 'destructive' }),
  });
  /** Map every unmapped line in a group in one go — most of a GC's lines land on one or two budget lines. */
  const bulkMap = useMutation({
    mutationFn: async ({ ids, key }: { ids: number[]; key: string }) => {
      for (const id of ids) {
        await apiRequest(`/api/cost-sov-lines/${id}`, 'PATCH',
          key === '__spread__'
            ? { allocationMode: 'spread', allocations: [] }
            : { allocationMode: 'direct', allocations: [{ baselineKey: key, pct: 100 }] });
      }
      return ids.length;
    },
    onSuccess: (n: number) => { refresh(); toast({ title: `${n} line${n === 1 ? '' : 's'} mapped` }); },
    onError: (e: any) => { refresh(); toast({ title: 'Some lines were not mapped', description: e?.message, variant: 'destructive' }); },
  });

  const groups: { id: number | null; label: string; co: ChangeOrderRow | null; lines: SovLineRow[] }[] = [
    { id: null, label: 'Base contract', co: null, lines: lines.filter((l) => l.changeOrderId == null) },
    ...changeOrders.map((co) => ({
      id: co.id, label: `${co.number}${co.title ? ` — ${co.title}` : ''}`, co,
      lines: lines.filter((l) => l.changeOrderId === co.id),
    })),
  ];

  const allocationLabel = (l: SovLineRow) => {
    if (l.allocationMode === 'spread') return <span className="text-gray-600">Spread with the work</span>;
    if (l.allocationMode !== 'direct' || l.allocations.length === 0) {
      return <span className="text-amber-700 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Not mapped</span>;
    }
    const placed = l.allocations.reduce((s, a) => s + a.pct, 0);
    return (
      <span className="text-gray-800">
        {l.allocations.map((a) => `${baselineName.get(a.baselineKey) ?? 'Removed line'}${l.allocations.length > 1 || a.pct !== 100 ? ` ${Number(a.pct).toFixed(2)}%` : ''}`).join(' · ')}
        {placed < 99.995 && <span className="text-amber-700"> · {(100 - placed).toFixed(2)}% unmapped</span>}
      </span>
    );
  };

  const docsFor = (appId: number) => documents.filter((d) => d.applicationId === appId);
  const appTotal = (a: ApplicationRow) => a.lines.reduce((s, l) => s + l.workThisPeriod, 0);

  return (
    <div className="bg-white border rounded-lg">
      <div className="px-4 py-3 border-b flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-gray-900">{contract.counterparty}</div>
          <div className="text-xs text-gray-600">
            {BUCKET_LABEL[contract.bucket] || contract.bucket}
            {contract.contractNumber ? ` · #${contract.contractNumber}` : ''}
            {` · retainage ${Number(contract.retainagePct).toFixed(2)}%`}
          </div>
        </div>
        <div className="flex items-start gap-3">
        {g702 && (
          <div className="grid grid-cols-3 gap-x-5 text-right text-xs">
            <div><div className="text-gray-500">Contract to date</div><div className="font-semibold tabular-nums text-sm">{money(g702.contractSumToDate)}</div></div>
            <div><div className="text-gray-500">Completed</div><div className="font-semibold tabular-nums text-sm">{money(g702.completedAndStored)}</div></div>
            <div><div className="text-gray-500">Balance</div><div className="font-semibold tabular-nums text-sm">{money(g702.balanceToFinish)}</div></div>
          </div>
        )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-700" title="Delete this contract"
                  disabled={removeContract.isPending} onClick={confirmDeleteContract}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
              <th className="px-3 py-1.5 w-14">Item</th>
              <th className="px-3 py-1.5">Description</th>
              <th className="px-3 py-1.5 text-right">Scheduled</th>
              <th className="px-3 py-1.5 text-right">To date</th>
              <th className="px-3 py-1.5 text-right w-16">%</th>
              <th className="px-3 py-1.5">Budget line</th>
            </tr>
          </thead>
          {groups.map((g) => {
            const total = g.lines.reduce((s, l) => s + l.scheduledValue, 0);
            const done = g.lines.reduce((s, l) => s + (progress.get(l.id)?.toDate ?? 0), 0);
            const unmapped = g.lines.filter((l) => l.allocationMode === 'unallocated' || (l.allocationMode === 'direct' && l.allocations.length === 0));
            const isVoid = g.co?.status === 'void';
            return (
              <tbody key={g.id ?? 'base'} className={isVoid ? 'opacity-50' : ''}>
                <tr className="bg-gray-100 border-y">
                  <td colSpan={2} className="px-3 py-1.5 font-semibold text-gray-900">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{g.label}</span>
                      {g.co && (
                        <div className="w-28">
                          <Select value={g.co.status} onValueChange={(v) => setCoStatus.mutate({ id: g.co!.id, status: v })}>
                            <SelectTrigger className={`h-7 text-xs font-medium ${
                              g.co.status === 'approved' ? 'bg-green-50 border-green-300 text-green-800'
                              : g.co.status === 'pending' ? 'bg-amber-50 border-amber-300 text-amber-800'
                              : 'bg-gray-50 border-gray-300 text-gray-600'}`}><SelectValue /></SelectTrigger>
                            <SelectContent className="pm-scope">
                              <SelectItem value="approved">Approved</SelectItem>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="void">Void</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {g.co && (
                        <button className="text-gray-400 hover:text-red-700" title="Delete this change order"
                                onClick={() => {
                                  if (window.confirm(`Delete ${g.label} and its ${g.lines.length} line${g.lines.length === 1 ? '' : 's'}? This cannot be undone.`)) removeCo.mutate(g.co!.id);
                                }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{money(total)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{money(done)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-600 tabular-nums">{pct(done, total)}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1 justify-end flex-wrap">
                      {unmapped.length > 0 && baseline.length > 0 && (
                        <div className="w-52">
                          <Select value="" disabled={bulkMap.isPending} onValueChange={(v) => v && bulkMap.mutate({ ids: unmapped.map((l) => l.id), key: v })}>
                            <SelectTrigger className="h-7 text-xs border-amber-300 bg-amber-50 text-amber-900 data-[placeholder]:text-amber-900">
                              <SelectValue placeholder={`Map ${unmapped.length} unmapped to…`} />
                            </SelectTrigger>
                            <SelectContent className="pm-scope">
                              {baseline.map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}
                              <SelectItem value="__spread__">Spread with the work</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <Button size="sm" variant={editing === String(g.id ?? 'base') ? 'default' : 'outline'} className="h-7 px-2 text-xs"
                              disabled={editing != null && editing !== String(g.id ?? 'base')}
                              onClick={() => setEditing(editing === String(g.id ?? 'base') ? null : String(g.id ?? 'base'))}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> {g.lines.length ? 'Edit lines' : 'Enter lines'}
                      </Button>
                    </div>
                  </td>
                </tr>
                {editing === String(g.id ?? 'base') ? (
                  <SovGridEditor contractId={contract.id} changeOrderId={g.id} label={g.label} lines={g.lines}
                                 baseline={baseline} billedIds={billedIds} projectId={projectId} onDone={() => setEditing(null)} />
                ) : g.lines.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-2 text-xs text-gray-600">
                    No lines yet — click <span className="font-medium">Enter lines</span> to type {g.co ? 'the change order\'s cost of work, insurance and fee' : 'the schedule of values'}, or paste it from Excel.
                  </td></tr>
                ) : g.lines.map((l) => {
                  const p = progress.get(l.id);
                  return (
                    <tr key={l.id} className="border-b hover:bg-blue-50/40 cursor-pointer" onClick={() => onEditLine(l)}>
                      <td className="px-3 py-1.5 text-xs text-gray-500 tabular-nums">{l.itemNo || ''}</td>
                      <td className="px-3 py-1.5">
                        <div className="text-gray-900">{l.description}</div>
                        {l.code && <div className="text-[11px] text-gray-500 font-mono">{l.code}</div>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(l.scheduledValue)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(p?.toDate ?? 0)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{pct(p?.toDate ?? 0, l.scheduledValue)}</td>
                      <td className="px-3 py-1.5 text-xs">{allocationLabel(l)}</td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>

      <div className="px-4 py-2 border-t flex flex-wrap gap-2 items-center">
        {coForm ? (
          <div className="flex flex-wrap gap-2 items-center">
            <label className="text-xs text-gray-600" htmlFor={`co-no-${contract.id}`}>CO #</label>
            <Input id={`co-no-${contract.id}`} value={coForm.number} onChange={(e) => setCoForm({ ...coForm, number: e.target.value })}
                   className="h-8 w-28 text-sm" />
            <label className="text-xs text-gray-600" htmlFor={`co-title-${contract.id}`}>For</label>
            <Input id={`co-title-${contract.id}`} value={coForm.title} onChange={(e) => setCoForm({ ...coForm, title: e.target.value })}
                   className="h-8 w-56 text-sm" />
            <Button size="sm" className="h-8" disabled={!coForm.number.trim() || addCo.isPending} onClick={() => addCo.mutate()}>Add</Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setCoForm(null)}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="h-8"
                  onClick={() => setCoForm({ number: `PCCO #${String(changeOrders.length + 1).padStart(3, '0')}`, title: '' })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Change order
          </Button>
        )}
      </div>

      {/* Pay apps and invoices on this contract. */}
      <div className="border-t px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">Pay apps &amp; invoices</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-8" disabled={lines.length === 0}
                    onClick={() => onOpenApplication(contract, null, 'invoice')}>
              <FileText className="h-3.5 w-3.5 mr-1" /> Invoice
            </Button>
            <Button size="sm" className="h-8" disabled={lines.length === 0}
                    onClick={() => onOpenApplication(contract, null, 'pay_app')}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Pay app
            </Button>
          </div>
        </div>
        {lines.length === 0 && <p className="text-xs text-gray-500">Add the schedule of values first.</p>}
        {applications.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                  <th className="py-1 pr-2">No.</th><th className="py-1 pr-2">Invoice</th><th className="py-1 pr-2">Period</th>
                  <th className="py-1 pr-2 text-right">This period</th><th className="py-1 pr-2 text-right">Payment due</th><th className="py-1 pr-2 text-right">Paid</th><th className="py-1 pr-2 text-right">Open</th><th className="py-1">Files</th>
                </tr>
              </thead>
              <tbody>
                {[...applications].sort((a, b) => b.number - a.number).map((a) => (
                  <tr key={a.id} className="border-b last:border-0 hover:bg-blue-50/40 cursor-pointer"
                      onClick={() => onOpenApplication(contract, a, a.kind)}>
                    <td className="py-1.5 pr-2">{a.kind === 'invoice' ? 'Inv' : 'App'} {a.number}</td>
                    <td className="py-1.5 pr-2 text-gray-700">{a.invoiceNumber || '—'}</td>
                    <td className="py-1.5 pr-2 text-gray-700 text-xs">
                      {a.periodEnd ? new Date(a.periodEnd).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{money(appTotal(a))}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums font-medium">{money(a.g702.currentPaymentDue)}</td>
                    {(() => {
                      const paid = Math.round(payments.filter((p) => p.applicationId === a.id).reduce((s, p) => s + p.amount, 0) * 100) / 100;
                      const open = Math.round((a.g702.currentPaymentDue - paid) * 100) / 100;
                      return (<>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{paid ? money(paid) : '—'}</td>
                        <td className="py-1.5 pr-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <button className={`tabular-nums hover:underline ${open > 0.005 ? 'text-red-700 font-medium' : 'text-green-700'}`}
                                  title="Record or view payments" onClick={() => onPay?.(contract, a)}>
                            {open > 0.005 ? money(open) : 'Paid'}
                          </button>
                        </td>
                      </>);
                    })()}
                    <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs mr-2" onClick={() => onPackage?.(contract, a)}>
                        <FolderOpen className="h-3.5 w-3.5 mr-1" /> Package{docsFor(a.id).length ? ` (${docsFor(a.id).length})` : ''}
                      </Button>
                      {docsFor(a.id).slice(0, 1).map((d) => (
                        <a key={d.id} href={`/api/cost-documents/${d.id}/download`} target="_blank" rel="noreferrer"
                           onClick={(e) => { e.preventDefault(); openDocument(d.id); }}
                           className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline mr-2">
                          <Paperclip className="h-3 w-3" />{d.originalName.length > 22 ? d.originalName.slice(0, 20) + '…' : d.originalName}
                        </a>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Files are behind the auth token, which a plain link cannot carry. Fetch with
 * the token and open the result, the same way the reports open.
 */
export async function openDocument(id: number) {
  const { AUTH_TOKEN_KEY } = await import('@/lib/auth-constants');
  const win = window.open('', '_blank');
  const res = await fetch(`/api/cost-documents/${id}/download`, {
    headers: { Authorization: `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` },
  });
  if (!res.ok) {
    if (win) win.document.body.innerText = `Could not open the file (${res.status}).`;
    return;
  }
  const url = URL.createObjectURL(await res.blob());
  if (win) win.location.href = url; else window.location.href = url;
}
