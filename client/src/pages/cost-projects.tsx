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
  const [rfpSearch, setRfpSearch] = useState('');
  const [name, setName] = useState('');
  const [show, setShow] = useState<'active' | 'closed' | 'all'>('active');

  const { data, isLoading, error } = useQuery<{ projects: ListRow[] }>({ queryKey: ['/api/cost-projects'] });
  const { data: rfps = [] } = useQuery<any[]>({ queryKey: ['/api/rfp-requests'], enabled: open });

  // Only RFPs with a budget to freeze: past evaluation, or completed.
  const eligible = useMemo(() => (rfps || [])
    .filter((r: any) => ['evaluation', 'publish'].includes(r.workflowPhase) || r.status === 'completed')
    .filter((r: any) => r.status !== 'cancelled' && !isArchivedRfp(r))
    .sort((a: any, b: any) => String(b.rfpNumber).localeCompare(String(a.rfpNumber), undefined, { numeric: true })), [rfps]);
  const alreadyOpened = new Set((data?.projects || []).map((p) => p.rfpId).filter(Boolean));
  const rfpLabel = (r: any) => [r.tenantName, r.projectName && r.projectName !== r.tenantName ? r.projectName : null].filter(Boolean).join(' · ');
  // Type any part of the number, tenant or property. Every word has to match.
  const shown = useMemo(() => {
    const words = rfpSearch.toLowerCase().split(/\s+/).filter(Boolean);
    return eligible
      .filter((r: any) => {
        const hay = `${r.rfpNumber} ${r.tenantName ?? ''} ${r.projectName ?? ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      // Ones already opened go to the bottom.
      .sort((a: any, b: any) => Number(alreadyOpened.has(a.id)) - Number(alreadyOpened.has(b.id)));
  }, [eligible, rfpSearch, data]);
  const chosen = eligible.find((r: any) => String(r.id) === rfpId);

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

  const all = data?.projects || [];
  const projects = all.filter((p) => show === 'all' || (show === 'closed' ? p.status === 'closed' : p.status !== 'closed'));
  const counts = { active: all.filter((p) => p.status !== 'closed').length, closed: all.filter((p) => p.status === 'closed').length, all: all.length };

  return (
    <div className="min-h-screen bg-gray-50 pm-scope">
      <Navigation />
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Hammer className="h-7 w-7 text-blue-600" /> Project Management
            </h1>
            <p className="text-gray-600 mt-1 text-sm">What each job is actually costing, against what it was budgeted.</p>
          </div>
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> New project</Button>
        </div>

        <div className="flex gap-1 bg-gray-100 rounded-md p-1 w-fit">
          {(['active', 'closed', 'all'] as const).map((k) => (
            <button key={k} onClick={() => setShow(k)}
                    className={`text-sm px-3 py-1 rounded ${show === k ? 'bg-white shadow-sm font-semibold text-gray-900' : 'text-gray-600'}`}>
              {k === 'active' ? 'Active' : k === 'closed' ? 'Closed' : 'All'} ({counts[k]})
            </button>
          ))}
        </div>

        {isLoading && <p className="text-sm text-gray-600">Loading…</p>}
        {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}

        {!isLoading && projects.length === 0 && (
          <div className="bg-white border rounded-lg p-8 text-center text-sm text-gray-600">
            {show === 'closed' ? 'No closed projects.' : all.length === 0 ? 'No projects yet. When a deal signs, open a project from its RFP and the budget comes with it.' : 'No active projects.'}
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
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="pm-scope sm:max-w-2xl">
          <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button type="button" variant={source === 'rfp' ? 'default' : 'outline'} size="sm" onClick={() => setSource('rfp')}>From an RFP</Button>
              <Button type="button" variant={source === 'blank' ? 'default' : 'outline'} size="sm" onClick={() => setSource('blank')}>Blank</Button>
            </div>
            {source === 'rfp' ? (
              <div className="space-y-1.5">
                <Label htmlFor="rfp">RFP</Label>
                <p className="text-xs text-gray-600 -mt-1">Type any part of the RFP number, tenant or property to narrow the list.</p>
                <Input id="rfp" autoFocus value={rfpSearch} onChange={(e) => setRfpSearch(e.target.value)} />
                <div className="border rounded-md max-h-72 overflow-y-auto" role="listbox" aria-label="Signed deals">
                  {shown.length === 0 && (
                    <div className="px-3 py-3 text-sm text-gray-500">
                      {eligible.length === 0 ? 'No RFPs have reached evaluation yet.' : 'Nothing matches that.'}
                    </div>
                  )}
                  {shown.map((r: any) => {
                    const taken = alreadyOpened.has(r.id);
                    const sel = String(r.id) === rfpId;
                    return (
                      <button key={r.id} type="button" role="option" aria-selected={sel} disabled={taken}
                              onClick={() => setRfpId(String(r.id))}
                              className={`w-full text-left px-3 py-2 border-b last:border-0 text-sm flex gap-3 items-baseline
                                ${sel ? 'bg-blue-600 text-white' : taken ? 'text-gray-400 cursor-not-allowed' : 'hover:bg-blue-50'}`}>
                        <span className={`font-mono text-xs whitespace-nowrap ${sel ? 'text-blue-100' : 'text-gray-500'}`}>{r.rfpNumber}</span>
                        <span className="min-w-0">
                          {rfpLabel(r)}
                          {taken && <span className="ml-1 text-xs">(already a project)</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {chosen && <p className="text-xs text-gray-700">Selected: <span className="font-medium">{chosen.rfpNumber} — {rfpLabel(chosen)}</span></p>}
                <p className="text-xs text-gray-600">
                  Its evaluation budget becomes this project's baseline, frozen as it stands today.
                  The RFP itself is not changed.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="pname">Name</Label>
                <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} />
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
