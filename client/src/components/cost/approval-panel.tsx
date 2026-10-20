/**
 * Confirm the budget against the Lease Approval Form.
 *
 *   1. Enter the LAF total. The gap to the priced budget is the Deal Discount.
 *   2. Optionally paste the LAF's lines — the app puts the priced budget in
 *      the LAF's shape (soft costs folded in) and shows which lines moved.
 *   3. Put the discount on budget lines, as much or as little as you like.
 *      Whatever is left stays on its own Deal Discount line.
 *   4. Confirm. That budget becomes the Original; later changes are revisions.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { CheckCircle2, Lock, Wand2, ChevronDown, ChevronRight } from 'lucide-react';
import type { BaselineLine } from '@shared/cost-tracking';
import { parseSovPaste } from '@shared/cost-tracking';
import { matchLafLines, compareLaf, type LafLine } from '@shared/cost-budget-approval';
import { money, signedMoney, projectKey, shortDate, type ApprovalView } from './types';

const toNum = (s: string) => {
  const v = parseFloat(String(s).replace(/[$,\s]/g, ''));
  return Number.isFinite(v) ? v : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

export function ApprovalPanel({ projectId, baseline, approval }: {
  projectId: number;
  baseline: BaselineLine[];
  approval: ApprovalView;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const confirmed = approval.status === 'confirmed';

  const [lafTotal, setLafTotal] = useState(approval.lafTotal != null ? String(approval.lafTotal) : '');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [lafLines, setLafLines] = useState<LafLine[]>(approval.lafLines);
  const [paste, setPaste] = useState('');
  const [showLaf, setShowLaf] = useState(approval.lafLines.length > 0);

  const fromServer = () => Object.fromEntries(approval.allocations.map((a) => [a.key, String(a.amount)]));
  useEffect(() => {
    setLafTotal(approval.lafTotal != null ? String(approval.lafTotal) : '');
    setAlloc(fromServer());
    setLafLines(approval.lafLines);
  }, [JSON.stringify(approval)]);

  const comparison = useMemo(() => (lafLines.length ? compareLaf(lafLines, baseline) : null), [lafLines, baseline]);
  const distributed = r2(Object.values(alloc).reduce((s, v) => s + toNum(v), 0));
  const undistributed = r2(approval.discount - distributed);
  const allocDirty = JSON.stringify(Object.fromEntries(Object.entries(alloc).filter(([, v]) => toNum(v) !== 0).map(([k, v]) => [k, toNum(v)])))
    !== JSON.stringify(Object.fromEntries(approval.allocations.map((a) => [a.key, a.amount])));
  const lafDirty = (approval.lafTotal == null ? '' : String(approval.lafTotal)) !== lafTotal.trim()
    && !(approval.lafTotal != null && toNum(lafTotal) === approval.lafTotal);
  const linesDirty = JSON.stringify(lafLines) !== JSON.stringify(approval.lafLines);

  const done = (title: string) => (data: any) => {
    queryClient.setQueryData([projectKey(projectId)], data);
    queryClient.invalidateQueries({ queryKey: ['/api/cost-projects'] });
    toast({ title });
  };
  const failed = (e: any) => toast({ title: 'Not saved', description: e?.message, variant: 'destructive' });

  const save = useMutation({
    mutationFn: (body: any) => apiRequest(`/api/cost-projects/${projectId}/approval`, 'PUT', body),
    onSuccess: done('Saved'),
    onError: failed,
  });
  const confirm = useMutation({
    mutationFn: () => apiRequest(`/api/cost-projects/${projectId}/approval/confirm`, 'POST', {}),
    onSuccess: done('Budget confirmed — this is now the original budget'),
    onError: failed,
  });
  const reopen = useMutation({
    mutationFn: () => apiRequest(`/api/cost-projects/${projectId}/approval/reopen`, 'POST', {}),
    onSuccess: done('Budget back to draft'),
    onError: failed,
  });

  const saveAll = () => save.mutate({
    ...(lafDirty ? { lafTotal: lafTotal.trim() === '' ? null : toNum(lafTotal) } : {}),
    ...(linesDirty ? { lafLines } : {}),
    ...(allocDirty ? { allocations: Object.entries(alloc).map(([key, v]) => ({ key, amount: toNum(v) })).filter((a) => a.amount !== 0) } : {}),
  });
  const dirty = lafDirty || allocDirty || linesDirty;

  const readPaste = () => {
    const parsed = parseSovPaste(paste).lines.map((l) => ({ description: l.description, amount: l.scheduledValue, key: null }));
    if (!parsed.length) { toast({ title: 'Nothing read', description: 'Each row needs a description and an amount.' }); return; }
    setLafLines(matchLafLines(parsed, baseline));
    setPaste('');
    if (!lafTotal.trim()) setLafTotal(String(r2(parsed.reduce((s, l) => s + l.amount, 0))));
  };

  return (
    <div className="bg-white border rounded-lg">
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-gray-900">Budget approval</h2>
            {confirmed
              ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-800 bg-green-100 rounded px-2 py-0.5"><Lock className="h-3 w-3" /> Confirmed</span>
              : <span className="text-xs font-semibold text-amber-800 bg-amber-100 rounded px-2 py-0.5">Draft</span>}
          </div>
          <p className="text-xs text-gray-600 mt-0.5">
            {confirmed
              ? <>Confirmed {shortDate(approval.confirmedAt)}{approval.confirmedBy ? ` by ${approval.confirmedBy}` : ''}. Original budget {money(approval.originalTotal)}. Changes from here are revisions.</>
              : 'Enter the Lease Approval Form. The gap to the priced budget becomes the Deal Discount, which you can put on whichever lines it belongs to.'}
          </p>
        </div>
        {confirmed && (
          <Button variant="ghost" size="sm" disabled={reopen.isPending}
                  onClick={() => { if (window.confirm('Put this budget back to draft? The original budget snapshot will be cleared, and you will confirm again.')) reopen.mutate(); }}>
            Reopen as draft
          </Button>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* The three numbers that matter. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Priced budget</div>
            <div className="text-lg font-semibold tabular-nums">{money(approval.priced)}</div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-gray-500" htmlFor="laf-total">LAF total</label>
            <Input id="laf-total" className="h-9 tabular-nums text-right font-semibold" inputMode="decimal" placeholder="1,466,500"
                   value={lafTotal} onChange={(e) => setLafTotal(e.target.value)} />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">{approval.discount >= 0 ? 'Deal Discount' : 'Deal Premium'}</div>
            <div className="text-lg font-semibold tabular-nums text-indigo-800">
              {approval.lafTotal == null ? '—' : money(Math.abs(approval.discount))}
            </div>
          </div>
        </div>

        {/* Optional: the LAF's lines, side by side. */}
        <div className="border rounded-md">
          <button className="w-full flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-800" onClick={() => setShowLaf(!showLaf)}>
            {showLaf ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Compare line by line with the LAF {lafLines.length > 0 && <span className="text-gray-500 font-normal">({lafLines.length} lines)</span>}
          </button>
          {showLaf && (
            <div className="px-3 pb-3 space-y-2">
              <p className="text-xs text-gray-600">
                Paste the LAF's TI Allowance lines (description and cost). Soft costs — design, CM fee, permits,
                contingency — are folded into the matched lines the way the LAF builds them, so a line the deal
                didn't touch shows no difference.
              </p>
              <div className="flex gap-2 items-start">
                <Textarea rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} className="font-mono text-xs"
                          placeholder={'Office Expansion (Additional 1,500 SF)\t200,121\nNew Office Area (4,000 SF)\t915,573'} />
                <Button variant="outline" size="sm" disabled={!paste.trim()} onClick={readPaste}>Read</Button>
              </div>
              {comparison && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                        <th className="py-1 pr-2">LAF line</th><th className="py-1 pr-2">Budget line</th>
                        <th className="py-1 pr-2 text-right">Priced (loaded)</th><th className="py-1 pr-2 text-right">LAF</th>
                        <th className="py-1 text-right">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.rows.map((r, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1 pr-2">{r.description}</td>
                          <td className="py-1 pr-2">
                            <select value={lafLines[i].key ?? ''} className="h-8 w-full max-w-[220px] rounded-md border border-input bg-background px-1 text-xs"
                                    onChange={(e) => setLafLines(lafLines.map((l, j) => (j === i ? { ...l, key: e.target.value || null } : l)))}>
                              <option value="">— none —</option>
                              {baseline.map((b) => <option key={b.key} value={b.key}>{b.description}</option>)}
                            </select>
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums">{r.key ? money(r.pricedLoaded) : '—'}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{money(r.laf)}</td>
                          <td className={`py-1 text-right tabular-nums ${Math.abs(r.difference) >= 1 ? (r.difference < 0 ? 'text-indigo-800 font-semibold' : 'text-amber-800 font-semibold') : 'text-gray-400'}`}>
                            {r.key ? (Math.abs(r.difference) < 1 ? '—' : signedMoney(r.difference)) : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-semibold border-t">
                        <td className="py-1 pr-2" colSpan={2}>LAF lines total</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{money(comparison.pricedTotal)}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{money(comparison.lafSum)}</td>
                        <td className="py-1 text-right tabular-nums">{signedMoney(r2(comparison.lafSum - comparison.pricedTotal))}</td>
                      </tr>
                    </tfoot>
                  </table>
                  <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                    <p className="text-xs text-gray-500">
                      {money(comparison.loadedIn)} of soft costs folded in (×{comparison.factor.toFixed(4)}).
                      {comparison.unmatchedLaf.length > 0 && ` ${comparison.unmatchedLaf.length} LAF line(s) not matched — pick a budget line.`}
                    </p>
                    <Button variant="outline" size="sm" disabled={!comparison.suggested.length}
                            onClick={() => setAlloc(Object.fromEntries(comparison.suggested.map((s) => [s.key, String(s.amount)])))}>
                      <Wand2 className="h-3.5 w-3.5 mr-1" /> Put the discount where the lines moved
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Where the discount goes. */}
        {approval.lafTotal != null && Math.abs(approval.discount) >= 0.005 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                  <th className="py-1 pr-2">Budget line</th><th className="py-1 pr-2 text-right">Priced</th>
                  <th className="py-1 pr-2 text-right w-40">{approval.discount >= 0 ? 'Discount on this line' : 'Premium on this line'}</th>
                  <th className="py-1 text-right">Budget</th>
                </tr>
              </thead>
              <tbody>
                {baseline.map((b) => {
                  const v = toNum(alloc[b.key] ?? '');
                  return (
                    <tr key={b.key} className="border-b last:border-0">
                      <td className="py-1 pr-2">{b.description}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-gray-600">{money(b.budget)}</td>
                      <td className="py-1 pr-2">
                        <Input className="h-8 text-right tabular-nums" inputMode="decimal" placeholder="0"
                               value={alloc[b.key] ?? ''} onChange={(e) => setAlloc({ ...alloc, [b.key]: e.target.value })} />
                      </td>
                      <td className="py-1 text-right tabular-nums font-medium">{money(r2(Number(b.budget) - v))}</td>
                    </tr>
                  );
                })}
                <tr className="bg-indigo-50/60">
                  <td className="py-1.5 pr-2 italic text-indigo-900">{approval.discount >= 0 ? 'Deal Discount' : 'Deal Premium'} — not yet on a line</td>
                  <td />
                  <td className="py-1.5 pr-2 text-right tabular-nums text-indigo-900">{money(undistributed)}</td>
                  <td className="py-1.5 text-right tabular-nums text-indigo-900">{signedMoney(-undistributed)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-800 font-semibold">
                  <td className="py-2 pr-2">Budget (= LAF)</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{money(approval.priced)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{money(approval.discount)}</td>
                  <td className="py-2 text-right tabular-nums">{money(approval.approvedTotal)}</td>
                </tr>
              </tfoot>
            </table>
            {Math.abs(undistributed) >= 0.005 && Math.sign(undistributed) !== Math.sign(approval.discount) && (
              <p className="text-xs text-amber-800 mt-1">You've put more on lines than the discount itself; the difference shows as a premium.</p>
            )}
          </div>
        )}

        <div className="flex gap-2 justify-end flex-wrap">
          {dirty && (
            <Button variant="ghost" size="sm" onClick={() => {
              setLafTotal(approval.lafTotal != null ? String(approval.lafTotal) : ''); setAlloc(fromServer()); setLafLines(approval.lafLines);
            }}>Discard</Button>
          )}
          <Button size="sm" variant={confirmed ? 'default' : 'outline'} disabled={!dirty || save.isPending} onClick={saveAll}>
            {save.isPending ? 'Saving…' : confirmed ? 'Save revision' : 'Save'}
          </Button>
          {!confirmed && (
            <Button size="sm" disabled={dirty || approval.lafTotal == null || confirm.isPending}
                    title={dirty ? 'Save first' : approval.lafTotal == null ? 'Enter the LAF total first' : undefined}
                    onClick={() => {
                      if (window.confirm(`Confirm ${money(approval.approvedTotal)} as the original budget? It is locked as of today; later changes show as revisions against it.`)) confirm.mutate();
                    }}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Confirm budget
            </Button>
          )}
        </div>

        {confirmed && approval.revisions.length > 0 && (
          <div className="text-xs text-gray-600 border-t pt-2">
            <div className="font-semibold text-gray-700 mb-1">Revisions</div>
            {approval.revisions.slice().reverse().map((r, i) => (
              <div key={i}>{shortDate(r.at)} — {r.note}: budget {money(r.total)}{r.by ? ` (${r.by})` : ''}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
