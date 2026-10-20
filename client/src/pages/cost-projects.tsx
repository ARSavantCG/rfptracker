/**
 * Projects — every job being built, and where its money stands.
 *
 * Opened from a signed RFP, a project freezes that RFP's budget as its
 * baseline and from then on tracks what the work actually costs against it.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import Navigation from '@/components/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Hammer, Plus, AlertTriangle } from 'lucide-react';
import { money, signedMoney, type CostProjectRow } from '@/components/cost/types';
import { isArchivedRfp } from '@shared/rfp-archive';

type ListRow = CostProjectRow & {
  totals: { budget: number; committed: number; pending: number; toDate: number; variance: number } | null;
  reconciles: boolean;
  contractCount: number;
};

export default function CostProjects() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<'rfp' | 'blank'>('rfp');
  const [rfpId, setRfpId] = useState('');
  const [name, setName] = useState('');
  const [showClosed, setShowClosed] = useState(false);

  const { data, isLoading, error } = useQuery<{ projects: ListRow[] }>({ queryKey: ['/api/cost-projects'] });
  const { data: rfps = [] } = useQuery<any[]>({ queryKey: ['/api/rfp-requests?include_archived=true'], enabled: open });

  // Only RFPs with a budget to freeze: past evaluation, or completed.
  const eligible = useMemo(() => (rfps || [])
    .filter((r: any) => ['evaluation', 'publish'].includes(r.workflowPhase) || r.status === 'completed')
    .filter((r: any) => r.status !== 'cancelled')
    .sort((a: any, b: any) => String(b.rfpNumber).localeCompare(String(a.rfpNumber))), [rfps]);
  const alreadyOpened = new Set((data?.projects || []).map((p) => p.rfpId).filter(Boolean));

  const create = useMutation({
    mutationFn: () => apiRequest('/api/cost-projects', 'POST',
      source === 'rfp' ? { rfpId: Number(rfpId) } : { name }),
    onSuccess: (p: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/cost-projects'] });
      setOpen(false);
      navigate(`/projects/${p.id}`);
    },
    onError: (e: any) => toast({ title: 'Could not open the project', description: e?.message, variant: 'destructive' }),
  });

  const projects = (data?.projects || []).filter((p) => showClosed || p.status !== 'closed');
  const closedCount = (data?.projects || []).filter((p) => p.status === 'closed').length;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Hammer className="h-7 w-7 text-blue-600" /> Projects
            </h1>
            <p className="text-gray-600 mt-1 text-sm">What each job is actually costing, against what it was budgeted.</p>
          </div>
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> New project</Button>
        </div>

        {isLoading && <p className="text-sm text-gray-600">Loading…</p>}
        {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}

        {!isLoading && projects.length === 0 && (
          <div className="bg-white border rounded-lg p-8 text-center text-sm text-gray-600">
            No projects yet. When a deal signs, open a project from its RFP and the budget comes with it.
          </div>
        )}

        {projects.length > 0 && (
          <div className="bg-white border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-600 border-b">
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Tenant</th>
                  <th className="px-3 py-2 text-right">Budget</th>
                  <th className="px-3 py-2 text-right">Committed</th>
                  <th className="px-3 py-2 text-right">Spent to date</th>
                  <th className="px-3 py-2 text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                      onClick={() => navigate(`/projects/${p.id}`)}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{p.name}</div>
                      <div className="text-xs text-gray-500">
                        {p.projectNumber}{p.status === 'closed' ? ' · closed' : ''}
                        {!p.reconciles && (
                          <span className="ml-2 text-amber-700 inline-flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> does not reconcile
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{p.tenantName || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(p.totals?.budget)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(p.totals?.committed)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(p.totals?.toDate)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${(p.totals?.variance ?? 0) < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                      {signedMoney(p.totals?.variance ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {closedCount > 0 && (
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show closed projects ({closedCount})
          </label>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button type="button" variant={source === 'rfp' ? 'default' : 'outline'} size="sm" onClick={() => setSource('rfp')}>From an RFP</Button>
              <Button type="button" variant={source === 'blank' ? 'default' : 'outline'} size="sm" onClick={() => setSource('blank')}>Blank</Button>
            </div>
            {source === 'rfp' ? (
              <div className="space-y-1.5">
                <Label htmlFor="rfp">RFP</Label>
                <select id="rfp" value={rfpId} onChange={(e) => setRfpId(e.target.value)}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Choose the signed deal…</option>
                  {eligible.map((r: any) => (
                    <option key={r.id} value={r.id} disabled={alreadyOpened.has(r.id)}>
                      {r.rfpNumber} — {r.tenantName}{r.projectName ? ` · ${r.projectName}` : ''}
                      {alreadyOpened.has(r.id) ? ' (already a project)' : ''}
                      {isArchivedRfp(r) ? ' (archived)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-600">
                  Its evaluation budget becomes this project's baseline, frozen as it stands today.
                  The RFP itself is not changed.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="pname">Name</Label>
                <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Building B power upgrade" />
                <p className="text-xs text-gray-600">You can add budget lines on the project's Budget tab.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending || (source === 'rfp' ? !rfpId : !name.trim())} onClick={() => create.mutate()}>
              {create.isPending ? 'Opening…' : 'Open project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
