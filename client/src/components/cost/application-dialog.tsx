/**
 * Enter a pay app or an invoice, and see its G702 as you type.
 *
 * The summary is computed from the lines with the same function the server
 * uses, so it can be compared with the contractor's own G702 before the
 * check is cut: if line 8 here and line 8 there disagree, one of the two
 * pages is wrong.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from './inputs';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Paperclip } from 'lucide-react';
import { g702For, lineProgress, type Application } from '@shared/cost-tracking';
import {
  money, projectKey,
  type ContractRow, type ChangeOrderRow, type SovLineRow, type ApplicationRow, type DocumentRow,
} from './types';
import { openDocument } from './contract-card';

const num = (s: string) => {
  const v = parseFloat(String(s ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(v) ? v : 0;
};
const isoDate = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

type Draft = { work: string; stored: string; retainage: string; toDate: string };

export function ApplicationDialog({
  open, contract, app, kind, lines, changeOrders, applications, documents, projectId, onClose,
}: {
  open: boolean;
  contract: ContractRow | null;
  app: ApplicationRow | null;
  kind: 'pay_app' | 'invoice';
  lines: SovLineRow[];
  changeOrders: ChangeOrderRow[];
  applications: ApplicationRow[];
  documents: DocumentRow[];
  projectId: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [number, setNumber] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [entry, setEntry] = useState<'period' | 'toDate'>('period');
  const [draft, setDraft] = useState<Record<number, Draft>>({});
  const [file, setFile] = useState<File | null>(null);

  const mine = useMemo(() => applications.filter((a) => a.contractId === contract?.id), [applications, contract?.id]);
  const thisNumber = app ? app.number : (parseInt(number, 10) || 0);
  const cos = useMemo(() => new Map(changeOrders.map((c) => [c.id, c])), [changeOrders]);
  const contractLines = useMemo(() => lines.filter((l) => l.contractId === contract?.id
    && (l.changeOrderId == null || cos.get(l.changeOrderId)?.status !== 'void')), [lines, contract?.id, cos]);

  // Everything billed BEFORE this application, per line.
  const prior = useMemo(() => lineProgress(mine.filter((a) => a.number < thisNumber).map((a) => ({
    id: a.id, contractId: a.contractId, number: a.number, lines: a.lines,
  }))), [mine, thisNumber]);

  useEffect(() => {
    if (!open || !contract) return;
    const next = (mine.reduce((m, a) => Math.max(m, a.number), 0) || 0) + 1;
    setNumber(String(app ? app.number : next));
    setInvoiceNumber(app?.invoiceNumber ?? '');
    setPeriodStart(isoDate(app?.periodStart ?? null));
    setPeriodEnd(isoDate(app?.periodEnd ?? null));
    setEntry('period');
    setFile(null);
    const d: Record<number, Draft> = {};
    for (const l of app?.lines ?? []) {
      d[l.sovLineId] = {
        work: l.workThisPeriod ? String(l.workThisPeriod) : '',
        stored: l.storedToDate ? String(l.storedToDate) : '',
        retainage: String(l.retainageToDate),
        toDate: '',
      };
    }
    setDraft(d);
  }, [open, app?.id, contract?.id]);

  const rate = (contract?.retainagePct ?? 0) / 100;
  const workOf = (l: SovLineRow) => {
    const d = draft[l.id];
    if (!d) return 0;
    if (entry === 'toDate') {
      if (d.toDate === '') return 0;
      return Math.round((num(d.toDate) - (prior.get(l.id)?.completed ?? 0) - num(d.stored)) * 100) / 100;
    }
    return num(d.work);
  };
  const autoRetainage = (l: SovLineRow) =>
    Math.round(((prior.get(l.id)?.completed ?? 0) + workOf(l) + num(draft[l.id]?.stored ?? '')) * rate * 100) / 100;
  const retainageOf = (l: SovLineRow) => {
    const typed = draft[l.id]?.retainage;
    return typed === undefined || typed === '' ? autoRetainage(l) : num(typed);
  };

  const outLines = contractLines
    .map((l) => ({ sovLineId: l.id, workThisPeriod: workOf(l), storedToDate: num(draft[l.id]?.stored ?? ''), retainageToDate: retainageOf(l) }))
    .filter((x) => x.workThisPeriod || x.storedToDate || x.retainageToDate);

  // The G702 for this application as it stands on screen.
  const preview = useMemo(() => {
    if (!contract || !thisNumber) return null;
    const others: Application[] = mine.filter((a) => a.number !== thisNumber)
      .map((a) => ({ id: a.id, contractId: a.contractId, number: a.number, lines: a.lines }));
    const current: Application = { id: -1, contractId: contract.id, number: thisNumber, lines: outLines };
    return g702For(contract.id, thisNumber, {
      lines: lines.map((l) => ({ ...l })),
      changeOrders: changeOrders.map((c) => ({ id: c.id, contractId: c.contractId, status: c.status })),
      applications: [...others, current],
    });
  }, [contract?.id, thisNumber, JSON.stringify(outLines), mine, lines, changeOrders]);

  /**
   * Switch between entering "this period" and "total to date", carrying every
   * line's figure across. Switching with the other column left blank would
   * read as zero — and saving would quietly wipe what was entered.
   */
  const switchEntry = (to: 'period' | 'toDate') => {
    if (to === entry) return;
    setDraft((d) => {
      const out: Record<number, Draft> = {};
      for (const l of contractLines) {
        const cur = d[l.id] ?? { work: '', stored: '', retainage: '', toDate: '' };
        const priorDone = prior.get(l.id)?.completed ?? 0;
        const stored = num(cur.stored);
        if (to === 'toDate') {
          const work = num(cur.work);
          out[l.id] = { ...cur, toDate: work || stored ? String(Math.round((priorDone + work + stored) * 100) / 100) : '' };
        } else {
          const work = cur.toDate === '' ? 0 : Math.round((num(cur.toDate) - priorDone - stored) * 100) / 100;
          out[l.id] = { ...cur, work: work ? String(work) : '' };
        }
      }
      return out;
    });
    setEntry(to);
  };

  const set = (id: number, field: keyof Draft, value: string) =>
    setDraft((d) => {
      const cur: Draft = d[id] ?? { work: '', stored: '', retainage: '', toDate: '' };
      return { ...d, [id]: { ...cur, [field]: value } };
    });

  const save = useMutation({
    mutationFn: async () => {
      const body = { number: thisNumber, kind, invoiceNumber, periodStart: periodStart || null, periodEnd: periodEnd || null, lines: outLines };
      const saved = app
        ? (await apiRequest(`/api/cost-applications/${app.id}`, 'PUT', body), { id: app.id })
        : await apiRequest(`/api/cost-contracts/${contract!.id}/applications`, 'POST', body);
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('applicationId', String(saved.id));
        fd.append('contractId', String(contract!.id));
        await apiRequest(`/api/cost-projects/${projectId}/documents`, 'POST', fd, 120_000);
      }
      return saved;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] }); onClose(); },
    onError: (e: any) => {
      queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
      toast({ title: 'Not saved', description: e?.message, variant: 'destructive', duration: 10000 });
    },
  });
  const remove = useMutation({
    mutationFn: () => apiRequest(`/api/cost-applications/${app!.id}`, 'DELETE'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] }); onClose(); },
    onError: (e: any) => toast({ title: 'Not deleted', description: e?.message, variant: 'destructive' }),
  });

  if (!contract) return null;
  const groups = [
    { label: 'Base contract', lines: contractLines.filter((l) => l.changeOrderId == null) },
    ...changeOrders.filter((c) => c.contractId === contract.id && c.status !== 'void').map((c) => ({
      label: `${c.number}${c.title ? ` — ${c.title}` : ''}${c.status === 'pending' ? ' (pending)' : ''}`,
      lines: contractLines.filter((l) => l.changeOrderId === c.id),
    })),
  ].filter((g) => g.lines.length);
  const attached = app ? documents.filter((d) => d.applicationId === app.id) : [];
  const label = kind === 'invoice' ? 'Invoice' : 'Pay app';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="pm-scope max-w-[min(1100px,96vw)] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{app ? `${label} ${app.number}` : `New ${label.toLowerCase()}`} — {contract.counterparty}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="space-y-1"><Label>No.</Label>
            <Input value={number} onChange={(e) => setNumber(e.target.value)} disabled={!!app} inputMode="numeric" /></div>
          <div className="space-y-1"><Label>Invoice #</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /></div>
          <div className="space-y-1"><Label>Period from</Label>
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></div>
          <div className="space-y-1"><Label>Period to</Label>
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></div>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
          Enter
          <Button type="button" size="sm" variant={entry === 'period' ? 'default' : 'outline'} className="h-7"
                  onClick={() => switchEntry('period')}>This period (E)</Button>
          <Button type="button" size="sm" variant={entry === 'toDate' ? 'default' : 'outline'} className="h-7"
                  onClick={() => switchEntry('toDate')}>Total to date (G)</Button>
          <span>— whichever column is easier to copy off the G703. Retainage left blank is {Number(contract.retainagePct).toFixed(2)}% of work to date.</span>
        </div>

        <div className="overflow-x-auto border rounded-md">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-gray-50">
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-600">
                <th className="px-2 py-1.5">Description</th>
                <th className="px-2 py-1.5 text-right">Scheduled</th>
                <th className="px-2 py-1.5 text-right">Previous</th>
                <th className="px-2 py-1.5 text-right w-32">{entry === 'period' ? 'This period' : 'Total to date'}</th>
                <th className="px-2 py-1.5 text-right w-28">Stored</th>
                <th className="px-2 py-1.5 text-right">To date</th>
                <th className="px-2 py-1.5 text-right">%</th>
                <th className="px-2 py-1.5 text-right w-28">Retainage</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.label}>
                <tr className="bg-gray-100"><td colSpan={8} className="px-2 py-1 text-xs font-semibold text-gray-800">{g.label}</td></tr>
                {g.lines.map((l) => {
                  const p = prior.get(l.id);
                  const previous = (p?.completed ?? 0) + (p?.stored ?? 0);
                  const toDate = (p?.completed ?? 0) + workOf(l) + num(draft[l.id]?.stored ?? '');
                  const over = toDate - l.scheduledValue > 0.005;
                  return (
                    <tr key={l.id} className="border-t">
                      <td className="px-2 py-1">
                        <div className="text-gray-900">{l.itemNo ? <span className="text-gray-500 mr-1">{l.itemNo}</span> : null}{l.description}</div>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{money(l.scheduledValue)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-gray-600">{money(previous)}</td>
                      <td className="px-2 py-1">
                        <MoneyInput className="h-8"
                               value={entry === 'period' ? (draft[l.id]?.work ?? '') : (draft[l.id]?.toDate ?? '')}
                               onValueChange={(v) => set(l.id, entry === 'period' ? 'work' : 'toDate', v)} />
                      </td>
                      <td className="px-2 py-1">
                        <MoneyInput className="h-8" value={draft[l.id]?.stored ?? ''} onValueChange={(v) => set(l.id, 'stored', v)} />
                      </td>
                      <td className={`px-2 py-1 text-right tabular-nums ${over ? 'text-red-700 font-semibold' : ''}`}
                          title={over ? 'More than the scheduled value' : undefined}>{money(toDate)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-gray-600">
                        {l.scheduledValue ? `${((toDate / l.scheduledValue) * 100).toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-2 py-1">
                        <MoneyInput className="h-8" value={draft[l.id]?.retainage ?? ''} onValueChange={(v) => set(l.id, 'retainage', v)}
                                    title={`Left blank: ${money(autoRetainage(l))} (${Number(contract?.retainagePct ?? 0).toFixed(2)}% of work to date)`} />
                        {!(draft[l.id]?.retainage ?? '').trim() && autoRetainage(l) > 0 && (
                          <div className="text-[10px] text-right text-gray-600 tabular-nums mt-0.5">auto {money(autoRetainage(l))}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>

        {preview && (
          <div className="border rounded-md p-3 bg-gray-50">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-2">G702 — compare with the contractor's</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
              {([
                ['1  Original contract sum', preview.originalContractSum],
                ['2  Net change by change orders', preview.netChangeOrders],
                ['3  Contract sum to date', preview.contractSumToDate],
                ['4  Completed and stored to date', preview.completedAndStored],
                ['5  Retainage', preview.retainage],
                ['6  Earned less retainage', preview.earnedLessRetainage],
                ['7  Less previous certificates', preview.previousCertificates],
                ['8  Current payment due', preview.currentPaymentDue],
                ['9  Balance to finish', preview.balanceToFinish],
              ] as [string, number][]).map(([k, v]) => (
                <div key={k} className={`flex justify-between gap-3 ${k.startsWith('8') ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  <span>{k}</span><span className="tabular-nums">{money(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap text-sm">
          <label className="inline-flex items-center gap-2 cursor-pointer text-blue-700">
            <Paperclip className="h-4 w-4" />
            <span>{file ? file.name : `Attach the ${kind === 'invoice' ? 'invoice' : 'pay app'} PDF`}</span>
            <input type="file" className="hidden" accept=".pdf,image/*,.xlsx,.xls,.csv"
                   onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {attached.map((d) => (
            <button key={d.id} type="button" onClick={() => openDocument(d.id)} className="text-xs text-blue-700 hover:underline">
              {d.originalName}{d.storage === 'local' ? ' (not backed up)' : ''}
            </button>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {app ? (
            <Button type="button" variant="ghost" className="text-red-700" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Delete {label.toLowerCase()}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !thisNumber}>
              {save.isPending ? 'Saving…' : app ? 'Save changes' : `Record ${label.toLowerCase()}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
