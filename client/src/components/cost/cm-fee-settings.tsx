/**
 * The CM fee rate for this project — it ranges from job to job (2.75%, 3%,
 * 3.5%) — and which budget line it sits on. Read from the CM line's name
 * ("Construction Management Fee (3%)") until set here.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PercentInput } from './inputs';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { BaselineLine } from '@shared/cost-tracking';
import { money, projectKey, type CmFee } from './types';

export function CmFeeSettings({ projectId, baseline, cmFee, source, tenantPct, tenantSource }: {
  projectId: number; baseline: BaselineLine[]; cmFee: CmFee | null; source?: 'project' | 'line' | 'none';
  /** The tenant's rate (can differ from the capital partner's). */
  tenantPct?: number; tenantSource?: 'project' | 'line' | 'none';
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pct, setPct] = useState(cmFee ? cmFee.pct.toFixed(2) : '');
  const [key, setKey] = useState(cmFee?.key ?? '');
  const tShown = tenantPct != null ? tenantPct.toFixed(2) : '';
  const [tPct, setTPct] = useState(tShown);
  useEffect(() => { setPct(cmFee ? cmFee.pct.toFixed(2) : ''); setKey(cmFee?.key ?? ''); }, [cmFee?.pct, cmFee?.key]);
  useEffect(() => { setTPct(tShown); }, [tShown]);

  const norm = (v: string) => (v.trim() === '' ? '' : (parseFloat(v) || 0).toFixed(2));
  const dirty = (cmFee ? cmFee.pct.toFixed(2) : '') !== norm(pct) || (cmFee?.key ?? '') !== key || tShown !== norm(tPct);
  const save = useMutation({
    mutationFn: () => apiRequest(`/api/cost-projects/${projectId}/settings`, 'PUT', {
      cmFeePct: pct.trim() === '' ? null : Math.round(parseFloat(pct) * 100) / 100, cmFeeKey: key || '',
      ...(tShown !== norm(tPct) ? { tenantCmFeePct: tPct.trim() === '' ? null : Math.round(parseFloat(tPct) * 100) / 100 } : {}),
    }),
    onSuccess: (data: any) => { queryClient.setQueryData([projectKey(projectId)], data); toast({ title: 'CM fee saved' }); },
    onError: (e: any) => toast({ title: 'Not saved', description: e?.message, variant: 'destructive' }),
  });

  return (
    <div className="bg-white border rounded-lg px-4 py-3 flex flex-wrap items-end gap-3">
      <div className="mr-auto min-w-[16rem] flex-1">
        <div className="font-semibold text-gray-900 text-sm">CM fee
          {source === 'project' && <span className="ml-2 text-[10px] font-semibold text-amber-800 bg-amber-100 rounded px-1">Edited — set for this project</span>}
          {source === 'line' && <span className="ml-2 text-[10px] font-medium text-gray-600 bg-gray-100 rounded px-1">From the CM line's name</span>}
        </div>
        <div className="text-xs text-gray-600">
          Earned as the work is billed: the rate × spent to date on every other budget line.
          {cmFee && <> Earned so far <span className="font-medium tabular-nums">{money(cmFee.earned)}</span> of {money(cmFee.budget)}.</>}
          {cmFee?.supplemental && <> Supplemental CM fee (change orders): <span className="font-medium tabular-nums">{money(cmFee.supplemental.earned + cmFee.supplemental.earnedCp)}</span> of {money(cmFee.supplemental.budget)}.</>}
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-gray-600" htmlFor="cm-pct" title="What the capital partner pays you">Capital partner rate</label>
        <div className="w-28"><PercentInput id="cm-pct" className="h-9" value={pct} onValueChange={setPct} /></div>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-gray-600" htmlFor="cm-tpct" title="What the tenant pays on change orders and reimbursable invoices">
          Tenant rate{tenantSource === 'project' ? <span className="ml-1 text-[10px] font-semibold text-amber-800">Edited</span> : tenantSource === 'line' ? <span className="ml-1 text-[10px] text-gray-500">from the LAF</span> : null}
        </label>
        <div className="w-28"><PercentInput id="cm-tpct" className="h-9" value={tPct} onValueChange={setTPct} /></div>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-gray-600" htmlFor="cm-line">On budget line</label>
        <div className="w-64 max-w-full">
          <Select value={key || '__none__'} onValueChange={(v) => setKey(v === '__none__' ? '' : v)}>
            <SelectTrigger id="cm-line" className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent className="pm-scope">
              <SelectItem value="__none__">— none —</SelectItem>
              {baseline.map((b) => <SelectItem key={b.key} value={b.key}>{b.description}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button size="sm" className="h-9" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</Button>
    </div>
  );
}
