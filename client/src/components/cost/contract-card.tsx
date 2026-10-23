/**
 * One contract: its schedule of values, grouped as the contractor groups it —
 * base contract first, then each change order as its own header with its own
 * lines (cost of work, insurance, fee) underneath — and its pay apps.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { no3 } from '@shared/doc-number';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useAiStatus } from '@/hooks/use-ai-status';
import { Plus, FileText, AlertTriangle, Paperclip, Pencil, Trash2, FolderOpen, ChevronDown, ChevronRight, DollarSign, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { PercentInput, MoneyInput } from './inputs';
import { CoStageControls } from './co-routing';
import { fmtPctText } from '@shared/format';
import { SovGridEditor } from './sov-grid-editor';
import { lineProgress, type BaselineLine, type G702 } from '@shared/cost-tracking';
import {
  money, pct, projectKey, BUCKET_LABEL, checkBadge,
  type ContractRow, type ChangeOrderRow, type SovLineRow, type ApplicationRow, type DocumentRow, type PaymentRow,
} from './types';

export function ContractCard({
  contract, changeOrders, lines, applications, documents, baseline, g702, projectId,
  onEditLine, onPaste, onOpenApplication, payments = [], onPay, onPackage, defaultOpen,
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
  defaultOpen?: boolean;
}) {
  const ai = useAiStatus();
  // The base contract and each change order roll up to their header line; remembered per contract.
  const rollKey = `pm-rolled-${contract.id}`;
  const [rolled, setRolled] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(rollKey) || '[]')); } catch { return new Set(); }
  });
  const toggleRoll = (k: string) => setRolled((r) => {
    const n = new Set(r);
    if (n.has(k)) n.delete(k); else n.add(k);
    try { localStorage.setItem(rollKey, JSON.stringify(Array.from(n))); } catch { /* private window */ }
    return n;
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
  const [coForm, setCoForm] = useState<{ number: string; title: string; approvedOn: string; received: string; proposed: string; days: string } | null>(null);
  // Open or folded, remembered per contract in this browser. Open by default
  // when it's the only contract, or a new one with nothing in it yet.
  const storeKey = `pm-contract-open-${contract.id}`;
  const [open, setOpen] = useState<boolean>(() => {
    try { const v = localStorage.getItem(storeKey); if (v != null) return v === '1'; } catch {}
    return defaultOpen ?? true;
  });
  const toggle = (v?: boolean) => {
    const next = v ?? !open;
    setOpen(next);
    try { localStorage.setItem(storeKey, next ? '1' : '0'); } catch {}
  };
  // Which group's lines are open in the grid: 'base', a change order id, or none.
  // A brand-new contract opens straight into its base contract.
  const [editing, setEditing] = useState<string | null>(lines.length === 0 && changeOrders.length === 0 ? 'base' : null);
  // The empty grid opens by itself on a new contract; if lines then arrive from
  // elsewhere (AI setup from a pay app), close it rather than leave a stale grid open.
  const autoOpened = useRef(editing === 'base');
  useEffect(() => {
    if (autoOpened.current && lines.length > 0 && editing === 'base') { autoOpened.current = false; setEditing(null); }
  }, [lines.length]);
  const billedIds = useMemo(() => new Set(applications.flatMap((a) => a.lines.map((l) => l.sovLineId))), [applications]);
  const removeContract = useMutation({
    mutationFn: () => apiRequest(`/api/cost-contracts/${contract.id}`, 'DELETE'),
    onSuccess: () => { refresh(); toast({ title: `${contract.counterparty} deleted` }); },
    onError: (e: any) => toast({ title: 'Not Deleted', description: e?.message, variant: 'destructive' }),
  });
  const removeCo = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/cost-change-orders/${id}`, 'DELETE'),
    onSuccess: () => { refresh(); toast({ title: 'Change Order Deleted' }); },
    onError: (e: any) => toast({ title: 'Not Deleted', description: e?.message, variant: 'destructive', duration: 10000 }),
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
      toast({ title: 'Not Deleted', description: 'The name did not match.' });
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
      {
        number: coForm!.number, title: coForm!.title, receivedDate: coForm!.received || undefined,
        proposedAmount: coForm!.proposed === '' ? null : Number(coForm!.proposed.replace(/,/g, '')),
        daysAdded: coForm!.days === '' ? null : Number(coForm!.days),
        ...(coForm!.approvedOn === 'pending' ? { stage: 'review' } : { stage: 'approved', startAppNumber: Number(coForm!.approvedOn) }),
      }),
    onSuccess: () => { refresh(); setCoForm(null); },
    onError: (e: any) => toast({ title: 'Not Added', description: e?.message, variant: 'destructive' }),
  });
  const nextAppNumber = applications.reduce((m, a) => Math.max(m, a.number), 0) + 1;
  const setCoStart = useMutation({
    mutationFn: ({ id, startAppNumber }: { id: number; startAppNumber: number | null }) =>
      apiRequest(`/api/cost-change-orders/${id}`, 'PATCH', { startAppNumber }),
    onSuccess: refresh,
    onError: (e: any) => toast({ title: 'Not Changed', description: e?.message, variant: 'destructive', duration: 10000 }),
  });
  const setCoStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest(`/api/cost-change-orders/${id}`, 'PATCH', { status }),
    onSuccess: refresh,
    onError: (e: any) => toast({ title: 'Not Changed', description: e?.message, variant: 'destructive' }),
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
    { id: null, label: 'Base Contract', co: null, lines: lines.filter((l) => l.changeOrderId == null) },
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
      <div className={`px-4 py-3 ${open ? 'border-b' : ''} flex flex-wrap items-start justify-between gap-3`}>
        <button className="text-left flex items-start gap-2" onClick={() => toggle()} aria-expanded={open}>
          {open ? <ChevronDown className="h-5 w-5 mt-0.5 text-gray-500" /> : <ChevronRight className="h-5 w-5 mt-0.5 text-gray-500" />}
          <div>
            <div className="font-semibold text-gray-900">{contract.counterparty}</div>
            <div className="text-xs text-gray-600">
              {BUCKET_LABEL[contract.bucket] || contract.bucket}
              {contract.contractNumber ? ` · #${contract.contractNumber}` : ''}
              {` · retainage ${Number(contract.retainagePct).toFixed(2)}%`}
              {!open && ` · ${lines.length} line${lines.length === 1 ? '' : 's'} · ${applications.length} pay app${applications.length === 1 ? '' : 's'}`}
            </div>
          </div>
        </button>
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

      {open && (<>
      <ContractDetails contract={contract} documents={documents} projectId={projectId} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
              <th className="px-3 py-1.5 w-14">Item</th>
              <th className="px-3 py-1.5">Description</th>
              <th className="px-3 py-1.5 text-right">Scheduled</th>
              <th className="px-3 py-1.5 text-right">To Date</th>
              <th className="px-3 py-1.5 text-right w-16">%</th>
              <th className="px-3 py-1.5">Budget Line</th>
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
                      <button className="inline-flex items-center gap-1 hover:text-blue-800" title={rolled.has(String(g.id ?? 'base')) ? 'Show its lines' : 'Roll up to one line'}
                              onClick={() => toggleRoll(String(g.id ?? 'base'))}>
                        {rolled.has(String(g.id ?? 'base')) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        <span>{g.label}</span>
                        {rolled.has(String(g.id ?? 'base')) && <span className="text-xs font-normal text-gray-500">· {g.lines.length} line{g.lines.length === 1 ? '' : 's'}</span>}
                      </button>
                      {g.co && <CoStageControls co={g.co} amount={g.lines.length ? total : g.co.proposedAmount || 0} fromLines={g.lines.length > 0} onChanged={refresh} />}
                      {g.co && (() => {
                        const co = g.co!;
                        const sorted = [...applications].sort((a, b) => a.number - b.number);
                        const next = (sorted.length ? sorted[sorted.length - 1].number : 0) + 1;
                        const nameOf = (n: number) => {
                          const a = sorted.find((x) => x.number === n);
                          return a ? `${a.kind === 'invoice' ? 'Invoice' : 'App'} ${no3(a.docNumber)}` : 'next pay app';
                        };
                        const auto = co.startApp == null ? 'Approved on: auto' : `Auto · approved on ${nameOf(co.startApp)}`;
                        return (
                          <div className="w-52" title="The pay app this change order was approved on. Its G702 lists it under 'approved this period'; earlier pay apps leave it out.">
                            <Select value={co.startAppNumber == null ? 'auto' : String(co.startAppNumber)}
                                    onValueChange={(v) => setCoStart.mutate({ id: co.id, startAppNumber: v === 'auto' ? null : Number(v) })}>
                              <SelectTrigger className="h-7 text-xs">
                                <SelectValue>{co.startAppNumber == null ? auto : `Approved on ${nameOf(co.startAppNumber)}`}</SelectValue>
                              </SelectTrigger>
                              <SelectContent className="pm-scope">
                                <SelectItem value="auto">{auto}</SelectItem>
                                {sorted.map((a) => <SelectItem key={a.id} value={String(a.number)}>Approved on {a.kind === 'invoice' ? 'Invoice' : 'App'} {no3(a.docNumber)}</SelectItem>)}
                                <SelectItem value={String(next)}>Approved on the Next Pay App</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      })()}
                      {g.co && <CoExecuted co={g.co} docs={documents.filter((d) => d.changeOrderId === g.co!.id)} contractId={contract.id} projectId={projectId} onDone={refresh} />}
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
                              <SelectItem value="__spread__">Spread with the Work</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {editing === String(g.id ?? 'base') ? (
                        <span className="text-xs font-semibold text-blue-800 bg-blue-100 rounded px-2 py-1">Editing</span>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={editing != null}
                                title={editing != null ? 'Save or cancel the lines you are editing first' : undefined}
                                onClick={() => setEditing(String(g.id ?? 'base'))}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> {g.lines.length ? 'Edit Lines' : 'Enter Lines'}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
                {editing === String(g.id ?? 'base') ? (
                  <SovGridEditor contractId={contract.id} changeOrderId={g.id} label={g.label} lines={g.lines}
                                 baseline={baseline} billedIds={billedIds} projectId={projectId} onDone={() => setEditing(null)} />
                ) : rolled.has(String(g.id ?? 'base')) ? null : g.lines.length === 0 ? (
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
            <label className="text-xs text-gray-600" htmlFor={`co-rec-${contract.id}`}>Received</label>
            <Input id={`co-rec-${contract.id}`} type="date" value={coForm.received} onChange={(e) => setCoForm({ ...coForm, received: e.target.value })} className="h-8 w-40 text-sm" />
            <label className="text-xs text-gray-600">Amount as Submitted</label>
            <div className="w-36"><MoneyInput className="h-8 text-sm" value={coForm.proposed} onValueChange={(v) => setCoForm({ ...coForm, proposed: v })} /></div>
            <label className="text-xs text-gray-600" htmlFor={`co-days-${contract.id}`}>Days Added</label>
            <Input id={`co-days-${contract.id}`} inputMode="numeric" value={coForm.days} onChange={(e) => setCoForm({ ...coForm, days: e.target.value.replace(/[^\d]/g, '') })} className="h-8 w-20 text-sm text-right" />
            <label className="text-xs text-gray-600">Status</label>
            <div className="w-56">
              <Select value={coForm.approvedOn} onValueChange={(v) => setCoForm({ ...coForm, approvedOn: v })}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="pm-scope">
                  <SelectItem value={String(nextAppNumber)}>Approved, on the Next Pay App</SelectItem>
                  {[...applications].sort((a, b) => b.number - a.number).map((a) => (
                    <SelectItem key={a.id} value={String(a.number)}>Approved on {a.kind === 'invoice' ? 'Invoice' : 'Pay App'} {no3(a.docNumber)}</SelectItem>
                  ))}
                  <SelectItem value="pending">Not Approved Yet (Under Review)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" className="h-8" disabled={!coForm.number.trim() || addCo.isPending} onClick={() => addCo.mutate()}>Add</Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setCoForm(null)}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="h-8"
                  onClick={() => setCoForm({ number: `PCCO #${String(changeOrders.length + 1).padStart(3, '0')}`, title: '', approvedOn: 'pending', received: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()), proposed: '', days: '' })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Change Order
          </Button>
        )}
      </div>

      {/* Pay apps and invoices on this contract. */}
      <div className="border-t px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Rolls up to one line: count, latest, and what's still open. Remembered per contract. */}
          <button className="flex items-center gap-1.5 text-left" onClick={() => toggleRoll('__apps')} aria-expanded={!rolled.has('__apps')}>
            {rolled.has('__apps') ? <ChevronRight className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Pay apps &amp; invoices</span>
            {rolled.has('__apps') && applications.length > 0 && (() => {
              const latest = [...applications].sort((a, b) => b.number - a.number)[0];
              const paidOf = (id: number) => payments.filter((p) => p.applicationId === id).reduce((t, p) => t + p.amount, 0);
              const open = Math.round(applications.reduce((t, a) => t + a.g702.currentPaymentDue - paidOf(a.id), 0) * 100) / 100;
              return (
                <span className="text-xs text-gray-600 ml-1">
                  {applications.length} · latest {latest.kind === 'invoice' ? 'Inv' : 'App'} {no3(latest.docNumber)}
                  {' · '}<span className={open > 0.005 ? 'text-red-700 font-medium' : 'text-green-700'}>{open > 0.005 ? `${money(open)} open` : 'all paid ✓'}</span>
                </span>
              );
            })()}
          </button>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-8" disabled={lines.length === 0 && !ai.on}
                    onClick={() => onOpenApplication(contract, null, 'invoice')}>
              <FileText className="h-3.5 w-3.5 mr-1" /> Invoice
            </Button>
            <Button size="sm" className="h-8" disabled={lines.length === 0 && !ai.on}
                    onClick={() => onOpenApplication(contract, null, 'pay_app')}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Pay App
            </Button>
          </div>
        </div>
        {lines.length === 0 && <p className="text-xs text-gray-500">
          {ai.on ? 'No schedule of values yet: enter it above, or start a pay app, attach the G703 and let AI set the contract up from it.' : 'Add the schedule of values first.'}
        </p>}
        {applications.length > 0 && !rolled.has('__apps') && (
          <div className="overflow-x-auto">
            {/* Headers sit exactly over their column: money right, text left, buttons centered in fixed-width columns so they line up row to row. */}
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b">
                  <th className="py-1 px-2 text-left">No.</th><th className="py-1 px-2 text-left">Invoice</th><th className="py-1 px-2 text-left">Period</th>
                  <th className="py-1 px-2 text-right w-[120px]">This Period</th><th className="py-1 px-2 text-right w-[120px]">Payment Due</th><th className="py-1 px-2 text-right w-[120px]">Paid</th><th className="py-1 px-2 text-right w-[120px]">Open</th>
                  <th className="py-1 px-2 text-center w-[150px]">Payments</th><th className="py-1 px-2 text-center w-[130px]">Package</th><th className="py-1 px-2 text-left">Files</th>
                </tr>
              </thead>
              <tbody>
                {[...applications].sort((a, b) => b.number - a.number).map((a) => (
                  <tr key={a.id} className="border-b last:border-0 hover:bg-blue-50/40 cursor-pointer"
                      onClick={() => onOpenApplication(contract, a, a.kind)}>
                    <td className="py-1.5 px-2 whitespace-nowrap">{a.kind === 'invoice' ? 'Inv' : 'App'} {no3(a.docNumber)}
                      {(() => { const bdg = checkBadge(a); return bdg ? <span className={`ml-1 font-semibold ${bdg.tone}`} title={bdg.title}>{bdg.text}{a.check.status === 'off' && a.check.dueDiff != null ? ` ${money(Math.abs(a.check.dueDiff))}` : ''}</span> : null; })()}</td>
                    <td className="py-1.5 px-2 text-gray-700">{a.invoiceNumber || '—'}</td>
                    <td className="py-1.5 px-2 text-gray-700 whitespace-nowrap">
                      {a.periodEnd ? new Date(a.periodEnd).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{money(appTotal(a))}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums font-medium">{money(a.g702.currentPaymentDue)}</td>
                    {(() => {
                      const paid = Math.round(payments.filter((p) => p.applicationId === a.id).reduce((s, p) => s + p.amount, 0) * 100) / 100;
                      const open = Math.round((a.g702.currentPaymentDue - paid) * 100) / 100;
                      return (<>
                        <td className={`py-1.5 px-2 tabular-nums ${paid ? 'text-right' : 'text-center'}`}>{paid ? money(paid) : '—'}</td>
                        <td className="py-1.5 px-2 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <button className={`tabular-nums hover:underline ${open > 0.005 ? 'text-red-700 font-medium' : 'text-green-700'}`}
                                  title="Record or view payments" onClick={() => onPay?.(contract, a)}>
                            {open > 0.005 ? money(open) : 'Paid ✓'}
                          </button>
                        </td>
                      </>);
                    })()}
                    <td className="py-1.5 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs w-[136px] justify-center" title="Record a payment: check date, check #, amount"
                              onClick={() => onPay?.(contract, a)}>
                        <DollarSign className="h-3.5 w-3.5 mr-0.5" /> {payments.some((p) => p.applicationId === a.id) ? 'Payments' : 'Record Payment'}
                      </Button>
                    </td>
                    <td className="py-1.5 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs w-[116px] justify-center" onClick={() => onPackage?.(contract, a)}>
                        <FolderOpen className="h-3.5 w-3.5 mr-1" /> Package{docsFor(a.id).length ? ` (${docsFor(a.id).length})` : ''}
                      </Button>
                    </td>
                    <td className="py-1.5 px-2 text-left" onClick={(e) => e.stopPropagation()}>
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
      </>)}
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
  // PDFs, photos and text open in the new tab in every browser; anything else (Word, Excel,
  // email) is saved under its own name, so it opens in the right program.
  const name = decodeURIComponent(res.headers.get('X-File-Name') || '') || 'file';
  const type = (res.headers.get('Content-Type') || '').split(';')[0].trim();
  const blob = new Blob([await res.arrayBuffer()], { type: type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const viewable = /^(application\/pdf|image\/(png|jpe?g|gif|webp)|text\/plain)$/i.test(type);
  if (viewable) {
    if (win) { win.location.href = url; try { setTimeout(() => { win.document.title = name; }, 800); } catch { /* cross-origin once loaded */ } }
    else window.location.href = url;
  } else {
    win?.close();
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

/**
 * The contract's particulars — number, retainage, the few dates worth
 * knowing — its documents (drop the signed contract here), and its notes.
 * Each saves when you leave the box.
 */
function ContractDetails({ contract, documents, projectId }: { contract: ContractRow; documents: DocumentRow[]; projectId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
  const [notes, setNotes] = useState(contract.notes ?? '');
  const [ret, setRet] = useState(fmtPctText(String(contract.retainagePct)));
  const [drag, setDrag] = useState(false);
  const save = async (patch: Record<string, any>) => {
    try { await apiRequest(`/api/cost-contracts/${contract.id}`, 'PATCH', patch); refresh(); }
    catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
  };
  const files = documents.filter((d) => d.contractId === contract.id && !d.applicationId && !d.directCostId && !d.changeOrderId);
  const upload = async (list: File[]) => {
    try {
      for (const f of list) {
        const fd = new FormData();
        fd.append('file', f); fd.append('contractId', String(contract.id)); fd.append('docType', 'other');
        await apiRequest(`/api/cost-projects/${projectId}/documents`, 'POST', fd, 120_000);
      }
      refresh(); toast({ title: list.length === 1 ? 'Contract file saved' : `${list.length} files saved` });
    } catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
  };
  const D = ({ label, field }: { label: string; field: 'contractDate' | 'startDate' | 'completionDate' }) => (
    <div className="space-y-1">
      <div className="text-xs text-gray-600">{label}</div>
      <Input type="date" className="h-8 text-sm" defaultValue={contract[field] ?? ''} key={`${field}-${contract[field] ?? ''}`}
             onBlur={(e) => { if ((e.target.value || null) !== (contract[field] || null)) save({ [field]: e.target.value || null }); }} />
    </div>
  );
  return (
    <div className="px-4 py-3 border-b bg-gray-50/60 space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
        <div className="space-y-1">
          <div className="text-xs text-gray-600">Contract #</div>
          <Input className="h-8 text-sm" defaultValue={contract.contractNumber ?? ''} key={`no-${contract.contractNumber ?? ''}`}
                 onBlur={(e) => { if (e.target.value !== (contract.contractNumber ?? '')) save({ contractNumber: e.target.value }); }} />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-600">Retainage</div>
          <PercentInput className="h-8 text-sm" value={ret} onValueChange={setRet}
                        onBlur={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && Math.abs(v - contract.retainagePct) >= 0.005) save({ retainagePct: v }); }} />
        </div>
        <D label="Contract Date" field="contractDate" />
        <D label="Start" field="startDate" />
        <D label="Substantial Completion" field="completionDate" />
        <div className="space-y-1">
          <div className="text-xs text-gray-600">Contract documents</div>
          <label className={`h-8 flex items-center gap-1.5 rounded-md border border-dashed px-2 text-xs cursor-pointer ${drag ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-gray-300 text-gray-600 hover:text-blue-700'}`}
                 onDragOver={(e) => { if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) { e.preventDefault(); setDrag(true); } }}
                 onDragLeave={() => setDrag(false)}
                 onDrop={(e) => { e.preventDefault(); setDrag(false); const l = Array.from(e.dataTransfer.files); if (l.length) upload(l); }}>
            <Paperclip className="h-3.5 w-3.5" /> Drop or Attach
            <input type="file" multiple className="hidden" onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ''; if (l.length) upload(l); }} />
          </label>
        </div>
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {files.map((d) => (
            <button key={d.id} className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1" onClick={() => openDocument(d.id)}>
              <Paperclip className="h-3 w-3" />{d.originalName}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1">
        <div className="text-xs text-gray-600">Notes on this contract</div>
        <Textarea rows={2} className="text-sm bg-white" value={notes} onChange={(e) => setNotes(e.target.value)}
                  onBlur={() => { if (notes !== (contract.notes ?? '')) save({ notes }).then(() => toast({ title: 'Notes Saved' })); }} />
      </div>
    </div>
  );
}


/**
 * A change order's executed (signed) copy: attach or drop it here. Approved with a copy on file = Executed —
 * it goes in the lender package for the pay app it was approved on.
 */
function CoExecuted({ co, docs, contractId, projectId, onDone }: { co: ChangeOrderRow; docs: DocumentRow[]; contractId: number; projectId: number; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const add = async (list: File[]) => {
    if (!list.length) return;
    setBusy(true);
    try {
      for (const f of list) {
        const fd = new FormData();
        fd.append('file', f); fd.append('contractId', String(contractId)); fd.append('changeOrderId', String(co.id));
        await apiRequest(`/api/cost-projects/${projectId}/documents`, 'POST', fd, 120_000);
      }
      onDone(); toast({ title: `${co.number}: Executed Copy Saved` });
    } catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const remove = async (d: DocumentRow) => {
    if (!window.confirm(`Remove ${d.originalName} from ${co.number}?`)) return;
    try { await apiRequest(`/api/cost-documents/${d.id}`, 'DELETE'); onDone(); } catch (e: any) { toast({ title: 'Not Removed', description: e?.message, variant: 'destructive' }); }
  };
  const executed = co.status === 'approved' && docs.length > 0;
  return (
    <div className={`flex items-center gap-1.5 flex-wrap text-xs rounded px-1 ${over ? 'bg-blue-100' : ''}`}
         onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); setOver(true); } }}
         onDragLeave={() => setOver(false)}
         onDrop={(e) => { if (!Array.from(e.dataTransfer.types).includes('Files')) return; e.preventDefault(); setOver(false); add(Array.from(e.dataTransfer.files)); }}>
      {co.status === 'approved' && (executed
        ? <span className="text-[10px] font-semibold text-green-800 bg-green-100 rounded px-1">Executed</span>
        : <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 rounded px-1" title="Attach the signed change order">Not Executed</span>)}
      {docs.map((d) => (
        <span key={d.id} className="inline-flex items-center gap-1">
          <button className="text-blue-700 hover:underline inline-flex items-center gap-1" onClick={() => openDocument(d.id)} title={d.originalName}>
            <Paperclip className="h-3 w-3" />{d.originalName.length > 26 ? `${d.originalName.slice(0, 24)}…` : d.originalName}
          </button>
          <button className="text-gray-400 hover:text-red-700" title="Remove this file" onClick={() => remove(d)}><X className="h-3 w-3" /></button>
        </span>
      ))}
      <label className="text-gray-500 hover:text-blue-700 cursor-pointer inline-flex items-center gap-1" title="Attach the executed (signed) change order — or drop it here">
        <Paperclip className="h-3 w-3" /> {busy ? 'Saving…' : docs.length ? 'Add' : 'Attach Executed'}
        <input type="file" multiple className="hidden" disabled={busy} onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ''; add(l); }} />
      </label>
    </div>
  );
}
