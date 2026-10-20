/**
 * One project: budget vs actual, the contracts behind it, and the budget
 * itself.
 */
import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useRoute } from 'wouter';
import Navigation from '@/components/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { AUTH_TOKEN_KEY } from '@/lib/auth-constants';
import { ArrowLeft, Printer, Plus, Paperclip, AlertTriangle, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ApprovalPanel } from '@/components/cost/approval-panel';
import { PaymentDialog } from '@/components/cost/payment-dialog';
import { PositionView } from '@/components/cost/position-view';
import { LedgerView } from '@/components/cost/ledger-view';
import { SummaryTable } from '@/components/cost/summary-table';
import { ContractCard, openDocument } from '@/components/cost/contract-card';
import { AllocationDialog } from '@/components/cost/allocation-dialog';
import { PasteLinesDialog } from '@/components/cost/paste-lines-dialog';
import { ApplicationDialog } from '@/components/cost/application-dialog';
import { BaselineEditor } from '@/components/cost/baseline-editor';
import {
  money, projectKey, BUCKET_LABEL, shortDate, openReport,
  type ProjectBundle, type SovLineRow, type ContractRow, type ApplicationRow,
} from '@/components/cost/types';

export default function CostProject() {
  const [, params] = useRoute('/projects/:id');
  const id = Number(params?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('summary');
  const [editing, setEditing] = useState<SovLineRow | null>(null);
  const [pasteTarget, setPasteTarget] = useState<{ contractId: number; changeOrderId: number | null; label: string } | null>(null);
  const [appState, setAppState] = useState<{ contract: ContractRow; app: ApplicationRow | null; kind: 'pay_app' | 'invoice' } | null>(null);
  const [payTarget, setPayTarget] = useState<{ app: ApplicationRow; contract: ContractRow } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const [newContract, setNewContract] = useState<{ counterparty: string; bucket: string; retainagePct: string; contractNumber: string } | null>(null);

  const { data: b, isLoading, error } = useQuery<ProjectBundle>({ queryKey: [projectKey(id)], enabled: Number.isFinite(id) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [projectKey(id)] });
    queryClient.invalidateQueries({ queryKey: ['/api/cost-projects'] });
  };

  const addContract = useMutation({
    mutationFn: () => apiRequest(`/api/cost-projects/${id}/contracts`, 'POST', {
      counterparty: newContract!.counterparty, bucket: newContract!.bucket,
      retainagePct: parseFloat(newContract!.retainagePct), contractNumber: newContract!.contractNumber,
    }),
    onSuccess: () => { refresh(); setNewContract(null); },
    onError: (e: any) => toast({ title: 'Not added', description: e?.message, variant: 'destructive' }),
  });
  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'closed') => apiRequest(`/api/cost-projects/${id}`, 'PATCH', { status }),
    onSuccess: refresh,
  });
  const uploadFile = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return apiRequest(`/api/cost-projects/${id}/documents`, 'POST', fd, 120_000);
    },
    onSuccess: () => { refresh(); toast({ title: 'File saved' }); },
    onError: (e: any) => toast({ title: 'File not saved', description: e?.message, variant: 'destructive', duration: 10000 }),
  });

  const printReport = async () => {
    if (!(await openReport(`/api/reports/budget-vs-actual/${id}`))) toast({ title: 'Report failed', variant: 'destructive' });
  };
  const deleteProject = useMutation({
    mutationFn: (confirmText: string) => apiRequest(`/api/cost-projects/${id}`, 'DELETE', { confirm: confirmText }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cost-projects'] });
      toast({ title: 'Project deleted' });
      navigate('/projects');
    },
    onError: (e: any) => toast({ title: 'Not deleted', description: e?.message, variant: 'destructive' }),
  });

  if (isLoading) return <div className="min-h-screen bg-gray-50"><Navigation /><div className="p-6 text-sm text-gray-600">Loading…</div></div>;
  if (error || !b) return <div className="min-h-screen bg-gray-50"><Navigation /><div className="p-6 text-sm text-red-700">{(error as Error)?.message || 'Project not found'}</div></div>;

  const p = b.project;
  const unmappedCount = b.sovLines.filter((l) => l.allocationMode === 'unallocated' || (l.allocationMode === 'direct' && l.allocations.length === 0)).length;
  const localFiles = b.documents.filter((d) => d.storage === 'local').length;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
        <Link href="/projects" className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Project Management
        </Link>

        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs text-gray-500">{p.projectNumber}{p.status === 'closed' ? ' · closed' : ''}</div>
            <h1 className="text-2xl font-bold text-gray-900">{p.name}</h1>
            {p.tenantName && <div className="text-sm text-gray-600">{p.tenantName}</div>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={printReport}><Printer className="h-4 w-4 mr-1" /> Budget vs Actual</Button>
            <Button variant="ghost" onClick={() => setStatus.mutate(p.status === 'closed' ? 'active' : 'closed')}>
              {p.status === 'closed' ? 'Reopen' : 'Close project'}
            </Button>
            <Button variant="ghost" className="text-red-700 hover:text-red-800 hover:bg-red-50" title="Delete this project"
                    onClick={() => {
                      if (window.confirm(`Delete ${p.projectNumber} — ${p.name}?\n\nIts contracts, change orders, pay apps, payments and file records all go with it. This cannot be undone.`)) setDeleting('');
                    }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-auto flex-wrap justify-start bg-gray-100 p-1 gap-1">
            <TabsTrigger value="summary" className="text-sm px-3 py-1.5">Budget vs actual</TabsTrigger>
            <TabsTrigger value="contracts" className="text-sm px-3 py-1.5">
              Contracts{unmappedCount > 0 && <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-800 rounded px-1">{unmappedCount}</span>}
            </TabsTrigger>
            <TabsTrigger value="position" className="text-sm px-3 py-1.5">Position</TabsTrigger>
            <TabsTrigger value="ledger" className="text-sm px-3 py-1.5">
              Ledger{b.ledger.unreconciledCount > 0 && <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-800 rounded px-1">{b.ledger.unreconciledCount}</span>}
            </TabsTrigger>
            <TabsTrigger value="budget" className="text-sm px-3 py-1.5">
              Budget{b.approval.status !== 'confirmed' && <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-800 rounded px-1">Draft</span>}
            </TabsTrigger>
            <TabsTrigger value="files" className="text-sm px-3 py-1.5">Files{b.documents.length > 0 && ` (${b.documents.length})`}</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="mt-4">
            {b.contracts.length === 0 ? (
              <div className="bg-white border rounded-lg p-6 text-sm text-gray-600">
                No contracts yet. Add the GC's contract on the Contracts tab and paste its schedule of values.
                {p.baseline.length === 0 && ' This project has no budget lines either — add them on the Budget tab.'}
              </div>
            ) : (
              <SummaryTable summary={b.summary} cmFee={b.cmFee} onShowUnallocated={() => setTab('contracts')}
                budgetNote={b.approval.status === 'confirmed' ? (
                  <p className="text-xs text-gray-600">
                    Budget confirmed against the LAF ({money(b.approval.lafTotal)}) on {shortDate(b.approval.confirmedAt)}.
                    {Math.abs(b.approval.approvedTotal - (b.approval.originalTotal ?? 0)) >= 0.005 && ` Revised since: original ${money(b.approval.originalTotal)}, now ${money(b.approval.approvedTotal)}.`}
                  </p>
                ) : (
                  <div className="text-sm bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-2.5">
                    Draft budget — {b.approval.lafTotal == null ? 'not yet checked against the LAF.' : `LAF entered (${money(b.approval.lafTotal)}), not yet confirmed.`}{' '}
                    <button className="underline font-medium" onClick={() => setTab('budget')}>Confirm it on the Budget tab</button>
                  </div>
                )} />
            )}
          </TabsContent>

          <TabsContent value="contracts" className="mt-4 space-y-4">
            {p.baseline.length === 0 && (
              <div className="text-sm bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-3 flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5" /> Add budget lines on the Budget tab first — that's what contract lines are mapped to.
              </div>
            )}
            {b.contracts.map((c) => (
              <ContractCard key={c.id}
                contract={c}
                changeOrders={b.changeOrders.filter((co) => co.contractId === c.id)}
                lines={b.sovLines.filter((l) => l.contractId === c.id)}
                applications={b.applications.filter((a) => a.contractId === c.id)}
                documents={b.documents}
                baseline={p.baseline}
                g702={b.g702ByContract[c.id]}
                projectId={id}
                onEditLine={setEditing}
                onPaste={setPasteTarget}
                onOpenApplication={(contract, app, kind) => setAppState({ contract, app, kind })}
                payments={b.payments}
                onPay={(contract, app) => setPayTarget({ contract, app })}
              />
            ))}
            {newContract ? (
              <div className="bg-white border rounded-lg p-4 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
                <div className="sm:col-span-2 space-y-1">
                  <div className="text-xs text-gray-600">With</div>
                  <Input value={newContract.counterparty} placeholder="e.g. Nova Construction Management"
                         onChange={(e) => setNewContract({ ...newContract, counterparty: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-600">Type</div>
                  <select value={newContract.bucket} onChange={(e) => setNewContract({ ...newContract, bucket: e.target.value })}
                          className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                    {Object.entries(BUCKET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-600">Retainage %</div>
                  <Input value={newContract.retainagePct} inputMode="decimal"
                         onChange={(e) => setNewContract({ ...newContract, retainagePct: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <Button disabled={!newContract.counterparty.trim() || addContract.isPending} onClick={() => addContract.mutate()}>Add</Button>
                  <Button variant="ghost" onClick={() => setNewContract(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={() => setNewContract({
                counterparty: '', bucket: b.contracts.length ? 'design' : 'contractor',
                retainagePct: b.contracts.length ? '0' : '10', contractNumber: '',
              })}>
                <Plus className="h-4 w-4 mr-1" /> Contract
              </Button>
            )}
          </TabsContent>

          <TabsContent value="position" className="mt-4">
            <PositionView bundle={b} projectId={id} onPay={setPayTarget} />
          </TabsContent>

          <TabsContent value="ledger" className="mt-4">
            <LedgerView bundle={b} projectId={id} />
          </TabsContent>

          <TabsContent value="budget" className="mt-4 space-y-4">
            <ApprovalPanel projectId={id} baseline={p.baseline} approval={b.approval} />
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">Priced budget lines</div>
            <BaselineEditor projectId={id} baseline={p.baseline} sovLines={b.sovLines} rfpLinked={!!p.rfpId} />
          </TabsContent>

          <TabsContent value="files" className="mt-4 space-y-3">
            {localFiles > 0 && (
              <div className="text-sm bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-3 flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5" />
                {localFiles} file{localFiles === 1 ? ' is' : 's are'} stored on this server's disk only, because Object Storage isn't
                configured here. They will be lost on the next publish.
              </div>
            )}
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-blue-700">
              <Paperclip className="h-4 w-4" /> {uploadFile.isPending ? 'Saving…' : 'Add a file (contract, change order, invoice)'}
              <input type="file" className="hidden" disabled={uploadFile.isPending}
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile.mutate(f); e.target.value = ''; }} />
            </label>
            {b.documents.length === 0 ? (
              <p className="text-sm text-gray-600">No files yet. Attach pay apps when you record them.</p>
            ) : (
              <div className="bg-white border rounded-lg divide-y">
                {b.documents.map((d) => {
                  const appRow = b.applications.find((a) => a.id === d.applicationId);
                  const contract = b.contracts.find((c) => c.id === (appRow?.contractId ?? d.contractId));
                  return (
                    <div key={d.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                      <button className="text-blue-700 hover:underline text-left break-all" onClick={() => openDocument(d.id)}>{d.originalName}</button>
                      <div className="text-xs text-gray-500 text-right shrink-0">
                        {contract ? contract.counterparty : ''}{appRow ? ` · ${appRow.kind === 'invoice' ? 'Inv' : 'App'} ${appRow.number}` : ''}
                        <div>{new Date(d.createdAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}{d.storage === 'local' ? ' · not backed up' : ''}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AllocationDialog line={editing} baseline={p.baseline} projectId={id} onClose={() => setEditing(null)} />
      <PasteLinesDialog target={pasteTarget} projectId={id} onClose={() => setPasteTarget(null)} />
      <PaymentDialog target={payTarget} payments={b.payments} projectId={id} onClose={() => setPayTarget(null)} />
        <Dialog open={deleting !== null} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Delete {p.projectNumber}?</DialogTitle></DialogHeader>
            <p className="text-sm text-gray-700">
              This removes the project, its {b.contracts.length} contract{b.contracts.length === 1 ? '' : 's'}, {b.applications.length} pay
              app{b.applications.length === 1 ? '' : 's'} and invoice{b.applications.length === 1 ? '' : 's'}, and {b.payments.length} payment{b.payments.length === 1 ? '' : 's'}.
              The RFP is not touched. To confirm, type <span className="font-mono font-semibold">{p.projectNumber}</span>.
            </p>
            <Input autoFocus value={deleting ?? ''} onChange={(e) => setDeleting(e.target.value)} placeholder={p.projectNumber} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="destructive" disabled={(deleting ?? '').trim().toUpperCase() !== p.projectNumber.toUpperCase() || deleteProject.isPending}
                      onClick={() => deleteProject.mutate((deleting ?? '').trim())}>
                {deleteProject.isPending ? 'Deleting…' : 'Delete project'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <ApplicationDialog
        open={!!appState}
        contract={appState?.contract ?? null}
        app={appState?.app ?? null}
        kind={appState?.kind ?? 'pay_app'}
        lines={b.sovLines}
        changeOrders={b.changeOrders}
        applications={b.applications}
        documents={b.documents}
        projectId={id}
        onClose={() => setAppState(null)}
      />
    </div>
  );
}
