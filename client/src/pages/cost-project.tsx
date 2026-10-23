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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { AUTH_TOKEN_KEY } from '@/lib/auth-constants';
import { ArrowLeft, Printer, Plus, Paperclip, AlertTriangle, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { BudgetPanel, TeamRollUp } from '@/components/cost/budget-panel';
import { BudgetChangeOrders } from '@/components/cost/budget-change-orders';
import { FundingSummary } from '@/components/cost/funding-summary';
import { PaymentDialog } from '@/components/cost/payment-dialog';
import { PositionView } from '@/components/cost/position-view';
import { LedgerView } from '@/components/cost/ledger-view';
import { ProjectFilesList, DeletedFilesBin } from '@/components/cost/project-files';
import { ReportsView, LenderPackagesCard } from '@/components/cost/reports-view';
import { ProjectOverview } from '@/components/cost/project-overview';
import { useAuth } from '@/hooks/useAuth';
import { PackageDialog } from '@/components/cost/package-dialog';
import { CmFeeSettings } from '@/components/cost/cm-fee-settings';
import { PercentInput } from '@/components/cost/inputs';
import { ProjectNotes } from '@/components/cost/project-notes';
import { SummaryTable } from '@/components/cost/summary-table';
import { ContractCard, openDocument } from '@/components/cost/contract-card';
import { AllocationDialog } from '@/components/cost/allocation-dialog';
import { PasteLinesDialog } from '@/components/cost/paste-lines-dialog';
import { ApplicationDialog } from '@/components/cost/application-dialog';
import { shortProjectName } from '@shared/project-name';
import { BaselineEditor } from '@/components/cost/baseline-editor';
import {
  money, signedMoney, projectKey, BUCKET_LABEL, shortDate, openReport,
  type ProjectBundle, type SovLineRow, type ContractRow, type ApplicationRow,
} from '@/components/cost/types';

export default function CostProject() {
  const [, params] = useRoute('/projects/:id');
  const id = Number(params?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = !!user && ((user as any).role === 'admin' || ((user as any).permissions || []).includes('admin.access'));
  const [tab, setTab] = useState<string | null>(null);
  const [editing, setEditing] = useState<SovLineRow | null>(null);
  const [pasteTarget, setPasteTarget] = useState<{ contractId: number; changeOrderId: number | null; label: string } | null>(null);
  const [appState, setAppState] = useState<{ contract: ContractRow; app: ApplicationRow | null; kind: 'pay_app' | 'invoice' } | null>(null);
  const [payTarget, setPayTarget] = useState<{ app: ApplicationRow; contract: ContractRow } | null>(null);
  const [pkgTarget, setPkgTarget] = useState<{ app: ApplicationRow; contract: ContractRow } | null>(null);
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
    onError: (e: any) => toast({ title: 'Not Added', description: e?.message, variant: 'destructive' }),
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
    onSuccess: () => { refresh(); toast({ title: 'File Saved' }); },
    onError: (e: any) => toast({ title: 'File Not Saved', description: e?.message, variant: 'destructive', duration: 10000 }),
  });

  const printReport = async () => {
    if (!(await openReport(`/api/reports/budget-vs-actual/${id}`))) toast({ title: 'Report Failed', variant: 'destructive' });
  };
  const removeFile = useMutation({
    mutationFn: (docId: number) => apiRequest(`/api/cost-documents/${docId}`, 'DELETE'),
    onSuccess: () => { refresh(); queryClient.invalidateQueries({ queryKey: [`/api/cost-projects/${id}/deleted-files`] }); toast({ title: 'Moved to Deleted Files' }); },
    onError: (e: any) => toast({ title: 'Not Removed', description: e?.message, variant: 'destructive' }),
  });
  const deleteProject = useMutation({
    mutationFn: (confirmText: string) => apiRequest(`/api/cost-projects/${id}`, 'DELETE', { confirm: confirmText }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cost-projects'] });
      toast({ title: 'Project Deleted' });
      navigate('/projects');
    },
    onError: (e: any) => toast({ title: 'Not Deleted', description: e?.message, variant: 'destructive' }),
  });

  if (isLoading) return <div className="min-h-screen bg-gray-50"><Navigation /><div className="p-6 text-sm text-gray-600">Loading…</div></div>;
  if (error || !b) return <div className="min-h-screen bg-gray-50"><Navigation /><div className="p-6 text-sm text-red-700">{(error as Error)?.message || 'Project not found'}</div></div>;

  const p = b.project;
  const unmappedCount = b.sovLines.filter((l) => l.allocationMode === 'unallocated' || (l.allocationMode === 'direct' && l.allocations.length === 0)).length;
  const localFiles = b.documents.filter((d) => d.storage === 'local').length;

  return (
    <div className="min-h-screen bg-gray-50 pm-scope">
      <Navigation />
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
        <Link href="/projects" className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Project Management
        </Link>

        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs text-gray-500">{p.projectNumber}{p.status === 'closed' ? ' · closed' : ''}</div>
            <h1 className="text-2xl font-bold text-gray-900">{shortProjectName(p.name)}</h1>
            {p.tenantName && <div className="text-sm text-gray-600">{p.tenantName}</div>}
          </div>
        </div>

        {/* Where things stand, at a glance. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            ['Budget', money(b.summary.totals.budget), ''],
            ['Committed', money(b.summary.totals.committed), ''],
            ['Spent to Date', money(b.summary.totals.toDate), ''],
            ['Paid', money(b.position.totals.paid), ''],
            ['Owed', money(b.position.totals.owed), b.position.totals.owed > 0.005 ? 'text-red-700' : ''],
            ['Variance', signedMoney(b.summary.totals.variance), b.summary.totals.variance < -0.005 ? 'text-red-700' : 'text-green-700'],
          ].map(([label, value, tone]) => (
            <div key={label} className="bg-white border rounded-md px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
              <div className={`text-base font-semibold tabular-nums ${tone || 'text-gray-900'}`}>{value}</div>
            </div>
          ))}
        </div>

        <Tabs value={tab ?? (isAdmin ? 'overview' : 'budget')} onValueChange={setTab}>
          <TabsList className="h-auto w-full flex-wrap justify-start gap-6 rounded-none border-b border-gray-300 bg-transparent p-0">
            {isAdmin && (
              <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent bg-transparent px-1 pb-2 pt-1 text-[15px] font-semibold text-gray-500 hover:text-gray-900 data-[state=active]:border-blue-600 data-[state=active]:text-blue-700 data-[state=active]:bg-transparent data-[state=active]:shadow-none">Overview</TabsTrigger>
            )}
            <TabsTrigger value="budget" className="rounded-none border-b-2 border-transparent bg-transparent px-1 pb-2 pt-1 text-[15px] font-semibold text-gray-500 hover:text-gray-900 data-[state=active]:border-blue-600 data-[state=active]:text-blue-700 data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Budget{b.approval.status !== 'confirmed' && <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-800 rounded px-1 font-medium">Draft</span>}
            </TabsTrigger>
            <TabsTrigger value="contracts" className="rounded-none border-b-2 border-transparent bg-transparent px-1 pb-2 pt-1 text-[15px] font-semibold text-gray-500 hover:text-gray-900 data-[state=active]:border-blue-600 data-[state=active]:text-blue-700 data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Contracts{unmappedCount > 0 && <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-800 rounded px-1 font-medium">{unmappedCount}</span>}
            </TabsTrigger>
            <TabsTrigger value="payapps" className="rounded-none border-b-2 border-transparent bg-transparent px-1 pb-2 pt-1 text-[15px] font-semibold text-gray-500 hover:text-gray-900 data-[state=active]:border-blue-600 data-[state=active]:text-blue-700 data-[state=active]:bg-transparent data-[state=active]:shadow-none">Pay Apps</TabsTrigger>
            <TabsTrigger value="ledger" className="rounded-none border-b-2 border-transparent bg-transparent px-1 pb-2 pt-1 text-[15px] font-semibold text-gray-500 hover:text-gray-900 data-[state=active]:border-blue-600 data-[state=active]:text-blue-700 data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Ledger{b.ledger.unreconciledCount > 0 && <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-800 rounded px-1 font-medium">{b.ledger.unreconciledCount}</span>}
            </TabsTrigger>
            <TabsTrigger value="reports" className="rounded-none border-b-2 border-transparent bg-transparent px-1 pb-2 pt-1 text-[15px] font-semibold text-gray-500 hover:text-gray-900 data-[state=active]:border-blue-600 data-[state=active]:text-blue-700 data-[state=active]:bg-transparent data-[state=active]:shadow-none">Reports</TabsTrigger>
            <TabsTrigger value="documents" className="rounded-none border-b-2 border-transparent bg-transparent px-1 pb-2 pt-1 text-[15px] font-semibold text-gray-500 hover:text-gray-900 data-[state=active]:border-blue-600 data-[state=active]:text-blue-700 data-[state=active]:bg-transparent data-[state=active]:shadow-none">Documents</TabsTrigger>
          </TabsList>

          {isAdmin && (
            <TabsContent value="overview" className="mt-4">
              <ProjectOverview bundle={b} />
            </TabsContent>
          )}
          <TabsContent value="reports" className="mt-4">
            <ReportsView bundle={b} projectId={id} onShowUnallocated={() => setTab('contracts')} onShowBudget={() => setTab('budget')} />
          </TabsContent>

          <TabsContent value="documents" className="mt-4 space-y-3">
            <LenderPackagesCard b={b} projectId={id} />
          {/* Every file on the project in one list — pay apps, receipts, contracts. */}
          <div className="bg-white border rounded-lg px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Project Files ({b.documents.length})
            </div>
            <div className="mt-3 space-y-3">
              {localFiles > 0 && (
                <div className="text-sm bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-3 flex gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  {localFiles} file{localFiles === 1 ? ' is' : 's are'} stored on this server's disk only, because Object Storage isn't
                  configured here. They will be lost on the next publish.
                </div>
              )}
              <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-blue-700">
                <Paperclip className="h-4 w-4" /> {uploadFile.isPending ? 'Saving…' : 'Add a File (Contract, Change Order, Invoice)'}
                <input type="file" className="hidden" disabled={uploadFile.isPending}
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile.mutate(f); e.target.value = ''; }} />
              </label>
              {b.documents.length === 0 ? (
                <p className="text-sm text-gray-600">No files yet. Attach pay apps when you record them.</p>
              ) : (
                <ProjectFilesList b={b} onRemove={(d) => { if (window.confirm(`Move ${d.originalName} to Deleted Files? You can restore it from there.`)) removeFile.mutate(d.id); }} />
              )}
              <DeletedFilesBin projectId={id} onChanged={refresh} />
                      </div>
          </div>
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
                onPackage={(contract, app) => setPkgTarget({ contract, app })}
                defaultOpen={b.contracts.length <= 1 || !b.sovLines.some((l) => l.contractId === c.id)}
              />
            ))}
            {newContract ? (
              <div className="bg-white border rounded-lg p-4 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
                <div className="sm:col-span-2 space-y-1">
                  <div className="text-xs text-gray-600">With</div>
                  <Input value={newContract.counterparty}
                         onChange={(e) => setNewContract({ ...newContract, counterparty: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-600">Type</div>
                  <Select value={newContract.bucket} onValueChange={(v) => setNewContract({ ...newContract, bucket: v })}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent className="pm-scope">{Object.entries(BUCKET_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-600">Retainage %</div>
                  <PercentInput value={newContract.retainagePct} onValueChange={(v) => setNewContract({ ...newContract, retainagePct: v })} />
                </div>
                <div className="flex gap-2">
                  <Button disabled={!newContract.counterparty.trim() || addContract.isPending} onClick={() => addContract.mutate()}>Add</Button>
                  <Button variant="ghost" onClick={() => setNewContract(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={() => setNewContract({
                counterparty: '', bucket: b.contracts.length ? 'design' : 'contractor',
                retainagePct: b.contracts.length ? '0.00' : '10.00', contractNumber: '',
              })}>
                <Plus className="h-4 w-4 mr-1" /> Contract
              </Button>
            )}
          </TabsContent>

          <TabsContent value="payapps" className="mt-4">
            <PositionView bundle={b} projectId={id} onPay={setPayTarget} onPackage={setPkgTarget} />
          </TabsContent>

          <TabsContent value="ledger" className="mt-4">
            <LedgerView bundle={b} projectId={id} />
          </TabsContent>

          <TabsContent value="budget" className="mt-4 space-y-4">
            <FundingSummary bundle={b} projectId={id} />
            <BudgetPanel bundle={b} projectId={id} />
            <BudgetChangeOrders bundle={b} projectId={id} />
            <CmFeeSettings projectId={id} baseline={p.baseline} cmFee={b.cmFee} source={b.cmSettings.source} tenantPct={b.cmSettings.tenantPct} tenantSource={b.cmSettings.tenantSource}
              feeInBudget={b.cmSettings.feeInBudget} feeInBudgetSet={b.cmSettings.feeInBudgetSet} cmUncapped={b.cmSettings.cmUncapped} />
            <TeamRollUp baseline={p.baseline} />
          </TabsContent>


        </Tabs>

        <ProjectNotes projectId={id} notes={p.notes} />



        {/* Rarely used, so out of the way. */}
        <div className="border-t pt-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-gray-500">
            {p.status === 'closed' ? 'This project is closed. It still shows under Closed on the project list.' : 'Close the project once it is finished; it moves to Closed on the project list.'}
            {shortProjectName(p.name) !== p.name && <div className="mt-1 text-[11px] text-gray-400">Full Name: {p.name}</div>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setStatus.mutate(p.status === 'closed' ? 'active' : 'closed')}>
              {p.status === 'closed' ? 'Reopen Project' : 'Close Project'}
            </Button>
            <Button variant="ghost" size="sm" className="text-red-700 hover:text-red-800 hover:bg-red-50"
                    onClick={() => {
                      if (window.confirm(`Delete ${p.projectNumber} — ${p.name}?\n\nIts contracts, change orders, pay apps, payments and file records all go with it. This cannot be undone.`)) setDeleting('');
                    }}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete Project
            </Button>
          </div>
        </div>
      </div>

      <AllocationDialog line={editing} baseline={p.baseline} projectId={id} onClose={() => setEditing(null)} />
      <PasteLinesDialog target={pasteTarget} projectId={id} onClose={() => setPasteTarget(null)} />
      <PackageDialog target={pkgTarget} bundle={b} projectId={id} onClose={() => setPkgTarget(null)} />
      <PaymentDialog target={payTarget} payments={b.payments} projectId={id} onClose={() => setPayTarget(null)} />
        <Dialog open={deleting !== null} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
          <DialogContent className="pm-scope w-[96vw] sm:max-w-md max-h-[92vh] overflow-y-auto grid-cols-[minmax(0,1fr)]">
            <DialogHeader><DialogTitle>Delete {p.projectNumber}?</DialogTitle></DialogHeader>
            <p className="text-sm text-gray-700">
              This removes the project, its {b.contracts.length} contract{b.contracts.length === 1 ? '' : 's'}, {b.applications.length} pay
              app{b.applications.length === 1 ? '' : 's'} and invoice{b.applications.length === 1 ? '' : 's'}, and {b.payments.length} payment{b.payments.length === 1 ? '' : 's'}.
              The RFP is not touched. To confirm, type <span className="font-mono font-semibold">{p.projectNumber}</span>.
            </p>
            <Input autoFocus value={deleting ?? ''} onChange={(e) => setDeleting(e.target.value)} aria-label="Project number to confirm" />
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="destructive" disabled={(deleting ?? '').trim().toUpperCase() !== p.projectNumber.toUpperCase() || deleteProject.isPending}
                      onClick={() => deleteProject.mutate((deleting ?? '').trim())}>
                {deleteProject.isPending ? 'Deleting…' : 'Delete Project'}
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
