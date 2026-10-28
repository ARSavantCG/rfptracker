/**
 * Enter a pay app or an invoice, and see its G702 as you type.
 *
 * The summary is computed from the lines with the same function the server
 * uses, so it can be compared with the contractor's own G702 before the
 * check is cut: if line 8 here and line 8 there disagree, one of the two
 * pages is wrong.
 */
import { useEffect, useMemo, useState } from 'react';
import { no3 } from '@shared/doc-number';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from './inputs';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Paperclip, Sparkles, Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { useAiStatus } from '@/hooks/use-ai-status';
import { setupPlan, workOfRow, contractorG703From, type PayAppRead, type MatchResult } from '@shared/cost-payapp-read';
import { Checkbox } from '@/components/ui/checkbox';
import { g702For, lineProgress, newAppNumbers, spreadCents, retainageCents, carryForwardCheck, g702Check, G702_CHECK_LINES, type Application } from '@shared/cost-tracking';
import { fmtMoneyText, parseAmount } from '@shared/format';
import { threeWayCheck, type Waiver } from '@shared/cost-waivers';
import {
  money, projectKey,
  type ContractRow, type ChangeOrderRow, type SovLineRow, type ApplicationRow, type DocumentRow,
} from './types';
import { openDocument } from './contract-card';

const num = (s: string) => {
  const v = parseAmount(s);
  return Number.isFinite(v) ? v : 0;
};
const isoDate = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

type Draft = { work: string; stored: string; retainage: string; toDate: string };
type AiResult = PayAppRead & MatchResult & { fileName: string };
/** Largest line 5 difference that can be accepted as rounding; anything bigger gets chased. */
const RET_ADJ_MAX = 10;
type AiCell = { work: number; stored: number; retainage: number | null; previous: number | null };
const same = (a: string | undefined, b: number | null) => b != null && Math.abs(num(a ?? '') - b) < 0.005 && (a ?? '') !== '';

export function ApplicationDialog({
  open, contract, app, kind, lines, changeOrders, applications, documents, projectId, onClose, waivers = [],
}: {
  /** The GC's conditional (and its typed line 8), for the three-way check. */
  waivers?: Waiver[];
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
  const ai = useAiStatus();
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  /** Lines added from the read (row index → line id), so their G703 is kept matched. */
  const [setupIds, setSetupIds] = useState<Record<string, number>>({});
  /** The contractor's G702 line 5, typed to match their retainage to the cent. */
  const [retTarget, setRetTarget] = useState('');
  /** Accepted retainage adjustment on this pay app (their rounding), in dollars; 0 = none. */
  const [retAdj, setRetAdj] = useState(0);
  /** The contractor's G702 figures for this pay app (typed or read by AI). */
  const [theirs, setTheirs] = useState<Record<string, string>>({});
  /** Groups (base contract, each change order) rolled up to their subtotal. */
  const [rolled, setRolled] = useState<Set<string>>(new Set());
  const [aiCells, setAiCells] = useState<Record<number, AiCell>>({});
  const [setupDone, setSetupDone] = useState(false);
  const [added, setAdded] = useState(0);
  const [pick, setPick] = useState({ lines: true, opening: true, paid: true, retainage: true });

  const mine = useMemo(() => applications.filter((a) => a.contractId === contract?.id), [applications, contract?.id]);
  // `number` on screen is the printed one (Invoice 2); thisNumber is the order
  // within the contract that "previous" is worked from — what the server will assign.
  const typedDoc = parseInt(number, 10) || 0;
  const thisNumber = app ? app.number : typedDoc ? newAppNumbers(kind, typedDoc, mine).seq : 0;
  const sameKind = mine.filter((a) => a.kind === kind && a.id !== app?.id);
  const docTaken = !!typedDoc && sameKind.some((a) => a.docNumber === typedDoc);
  const cos = useMemo(() => new Map(changeOrders.map((c) => [c.id, c])), [changeOrders]);
  const contractLines = useMemo(() => lines.filter((l) => l.contractId === contract?.id
    && (l.changeOrderId == null || cos.get(l.changeOrderId)?.status !== 'void')), [lines, contract?.id, cos]);

  // Everything billed BEFORE this application, per line.
  const prior = useMemo(() => lineProgress(mine.filter((a) => a.number < thisNumber).map((a) => ({
    id: a.id, contractId: a.contractId, number: a.number, lines: a.lines,
  }))), [mine, thisNumber]);

  useEffect(() => {
    if (!open || !contract) return;
    setNumber(String(app ? app.docNumber : newAppNumbers(kind, null, mine).doc));
    setInvoiceNumber(app?.invoiceNumber ?? '');
    setPeriodStart(isoDate(app?.periodStart ?? null));
    setPeriodEnd(isoDate(app?.periodEnd ?? null));
    setEntry('period');
    setFile(null);
    setAiResult(null);
    setSetupIds({});
    setAiCells({});
    setRetTarget('');
    setRetTyped(new Set());
    setRetAdj(Number(app?.retainageAdj) || 0);
    setTheirs(Object.fromEntries(Object.entries(app?.contractorG702 ?? {}).filter(([, v]) => v != null).map(([k, v]) => [k, fmtMoneyText(String(v))])));
    setSetupDone(false);
    setPick({ lines: true, opening: true, paid: true, retainage: true });
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
  // Retainage left blank: the contract rate on work to date, figured on the total
  // and spread to the cent (as a G703 is), so the lines add to the total exactly.
  // Their G702 line 5, when typed, is the total instead.
  const toDateOf = (l: SovLineRow) => (prior.get(l.id)?.completed ?? 0) + workOf(l) + num(draft[l.id]?.stored ?? '');
  const autoMap = useMemo(() => {
    const auto = contractLines.filter((l) => !(draft[l.id]?.retainage ?? '').trim());
    // A line whose retainage was released (or cut) on an earlier pay app holds only what it
    // held then plus the rate on the work billed since, not the rate on everything again.
    const exactOf = (l: SovLineRow) => {
      const p = prior.get(l.id);
      if (!p || p.toDate === 0) return toDateOf(l) * rate;
      const full = p.toDate * rate;
      return p.retainage < full - 0.01 ? p.retainage + (toDateOf(l) - p.toDate) * rate : toDateOf(l) * rate;
    };
    const items = auto.map((l) => ({ id: l.id, exact: exactOf(l) })).filter((x) => Math.abs(x.exact) >= 0.0001);
    const typed = contractLines.filter((l) => (draft[l.id]?.retainage ?? '').trim()).reduce((s, l) => s + num(draft[l.id].retainage), 0);
    const target = retTarget.trim()
      ? Math.round((num(retTarget) - typed) * 100) / 100
      : retainageCents(items.reduce((s, x) => s + x.exact, 0));
    return spreadCents(items, target);
  }, [contractLines, draft, rate, retTarget, entry, prior]);
  const autoRetainage = (l: SovLineRow) => autoMap.get(l.id) ?? 0;
  /** A retainage release: every line's retainage typed as $0.00. */
  const releaseAll = () => {
    setRetTarget('');
    setRetTyped(new Set(contractLines.map((l) => l.id)));
    setDraft((d) => Object.fromEntries(contractLines.map((l) => [l.id, { ...(d[l.id] ?? { work: '', stored: '', retainage: '', toDate: '' }), retainage: '0' }])));
  };
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
      .map((a) => ({ id: a.id, contractId: a.contractId, number: a.number, lines: a.lines, retainageAdj: a.retainageAdj ?? 0 }));
    const current: Application = { id: -1, contractId: contract.id, number: thisNumber, lines: outLines, retainageAdj: retAdj };
    return g702For(contract.id, thisNumber, {
      lines: lines.map((l) => ({ ...l })),
      changeOrders: changeOrders.map((c) => ({ id: c.id, contractId: c.contractId, status: c.status, startApp: c.startApp })),
      applications: [...others, current],
    });
  }, [contract?.id, thisNumber, JSON.stringify(outLines), mine, lines, changeOrders, retAdj]);

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

  /**
   * AI-filled cells are tinted violet. Change one and the tint goes, with a
   * note of what AI read — so an override is always visible.
   */
  const aiTint = (id: number, f: 'work' | 'stored' | 'retainage') => {
    const c = aiCells[id];
    if (!c || entry !== 'period') return '';
    const v = c[f];
    if (v == null || v === 0) return '';
    return same(draft[id]?.[f], v) ? 'bg-violet-50 border-violet-300' : '';
  };
  const aiNote = (id: number, f: 'work' | 'stored' | 'retainage') => {
    const c = aiCells[id];
    if (!c || entry !== 'period') return null;
    const v = c[f];
    if (v == null || v === 0 || same(draft[id]?.[f], v)) return null;
    return <div className="text-[10px] text-right text-amber-700 tabular-nums mt-0.5">Edited · AI read {money(v)}</div>;
  };

  /** Retainage boxes typed in this window: those stay as typed when the work changes. */
  const [retTyped, setRetTyped] = useState<Set<number>>(new Set());
  const releasing = contractLines.length > 0 && contractLines.every((l) => (draft[l.id]?.retainage ?? '').trim() !== '' && num(draft[l.id].retainage) === 0)
    && contractLines.some((l) => toDateOf(l));
  const set = (id: number, field: keyof Draft, value: string) => {
    if (field === 'retainage') setRetTyped((t) => new Set(t).add(id));
    setDraft((d) => {
      const cur: Draft = d[id] ?? { work: '', stored: '', retainage: '', toDate: '' };
      // Changing the work on a line figures its retainage again (unless it was typed here):
      // a saved retainage would otherwise stay put while the work moves.
      const clearRet = field !== 'retainage' && !retTyped.has(id);
      return { ...d, [id]: { ...cur, [field]: value, ...(clearRet ? { retainage: '' } : {}) } };
    });
  };

  const attachedNow = app ? documents.filter((d) => d.applicationId === app.id) : [];
  const readable = (n: string, t?: string | null) => /\.pdf$/i.test(n) || /pdf|^image\//i.test(t ?? '');
  const readSource: { file?: File; documentId?: number; name: string } | null = file && readable(file.name, file.type)
    ? { file, name: file.name }
    : (() => { const d = attachedNow.find((x) => readable(x.originalName, (x as any).mimeType)); return d ? { documentId: d.id, name: d.originalName } : null; })();

  /** AI reads the PDF and fills the grid. Nothing is saved until Save. */
  const read = useMutation({
    mutationFn: async (): Promise<AiResult> => {
      let body: any;
      if (readSource?.file) { body = new FormData(); body.append('file', readSource.file); }
      else body = { documentId: readSource?.documentId };
      return apiRequest(`/api/cost-contracts/${contract!.id}/read-pay-app`, 'POST', body, 180_000);
    },
    onSuccess: (r) => {
      setEntry('period');
      const cells: Record<number, AiCell> = {};
      setDraft((d) => {
        const out = { ...d };
        for (const m of r.matched) {
          cells[m.sovLineId] = { work: m.work, stored: m.stored, retainage: m.retainage, previous: m.previous };
          const cur = out[m.sovLineId] ?? { work: '', stored: '', retainage: '', toDate: '' };
          out[m.sovLineId] = {
            ...cur,
            work: m.work ? m.work.toFixed(2) : '',
            stored: m.stored ? m.stored.toFixed(2) : '',
            retainage: m.retainage != null && m.retainage !== 0 ? m.retainage.toFixed(2) : cur.retainage,
          };
        }
        return out;
      });
      setAiCells(cells);
      if (!app && r.applicationNumber && !mine.some((a) => a.kind === kind && a.docNumber === r.applicationNumber)) setNumber(String(r.applicationNumber));
      if (!invoiceNumber && r.invoiceNumber) setInvoiceNumber(r.invoiceNumber);
      if (!periodStart && r.periodFrom) setPeriodStart(r.periodFrom);
      if (!periodEnd && r.periodTo) setPeriodEnd(r.periodTo);
      setAiResult(r);
      setSetupIds({});
      // Their G702 figures go in the Theirs column (anything typed there already stays).
      setTheirs((t) => {
        const out = { ...t };
        for (const [k] of G702_CHECK_LINES) {
          const v = (r.g702 as any)?.[k];
          if (v != null && !(out[k] ?? '').trim()) out[k] = fmtMoneyText(String(v));
        }
        return out;
      });
      setSetupDone(false);
      setPick({ lines: true, opening: true, paid: true, retainage: true });
    },
    onError: (e: any) => toast({ title: 'AI could not read it', description: e?.message, variant: 'destructive', duration: 10000 }),
  });

  /** Lines the contract lacks, billing before tracking, retainage — from the pay app. */
  const plan = useMemo(() => aiResult && contract
    ? setupPlan(aiResult, aiResult, { thisNumber, priorAppCount: mine.filter((a) => a.number < thisNumber).length, retainagePct: Number(contract.retainagePct) })
    : null, [aiResult, thisNumber, mine, contract?.retainagePct]);
  const setup = useMutation({
    mutationFn: async () => apiRequest(`/api/cost-contracts/${contract!.id}/setup-from-pay-app`, 'POST', {
      lines: pick.lines ? plan!.lines : [],
      opening: pick.opening ? plan!.opening : null,
      openingPaid: pick.opening && pick.paid,
      // A day before this period began, when known: paid before this app.
      openingPaidDate: periodStart ? new Date(new Date(`${periodStart}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10) : null,
      retainagePct: pick.retainage ? plan!.retainagePct : null,
    }) as Promise<{ lineIds: Record<string, number>; openingId: number | null }>,
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
      const rows = aiResult!.rows;
      const cells: Record<number, AiCell> = {};
      setDraft((d) => {
        const out = { ...d };
        for (const [idx, id] of Object.entries(r.lineIds)) {
          const row = rows[Number(idx)];
          if (!row) continue;
          const work = workOfRow(row), stored = Math.round((row.stored ?? 0) * 100) / 100;
          const ret = row.retainage == null ? null : Math.round(row.retainage * 100) / 100;
          cells[id] = { work, stored, retainage: ret, previous: row.previous == null ? null : Math.round(row.previous * 100) / 100 };
          out[id] = { work: work ? work.toFixed(2) : '', stored: stored ? stored.toFixed(2) : '', retainage: ret ? ret.toFixed(2) : '', toDate: '' };
        }
        return out;
      });
      setAiCells((c) => ({ ...c, ...cells }));
      setSetupDone(true);
      setSetupIds(r.lineIds);
      const n = Object.keys(r.lineIds).length;
      setAdded(n);
      toast({ title: 'Contract Set Up from the Pay App',
        description: [n ? `${n} line${n === 1 ? '' : 's'} added (assign them to budget lines on the contract)` : '', r.openingId ? 'opening balance recorded' : ''].filter(Boolean).join('; ') + '. Now check this pay app and save it.' });
    },
    onError: (e: any) => toast({ title: 'Not Set Up', description: e?.message, variant: 'destructive', duration: 10000 }),
  });

  const save = useMutation({
    mutationFn: async () => {
      const contractorG702 = Object.fromEntries(G702_CHECK_LINES.map(([k]) => [k, (theirs[k] ?? '').trim() ? num(theirs[k]) : null]));
      // Their G703 as read, kept for the line-by-line comparison (left as is when not read this time).
      const contractorG703 = aiResult ? contractorG703From(aiResult, aiResult, aiResult.fileName, setupIds) : undefined;
      const body = { docNumber: typedDoc, kind, contractorG702, contractorG703, retainageAdj: retAdj || null, retainageAdjNote: retAdj ? 'Rounding: accepted the contractor\'s retainage' : null, invoiceNumber, periodStart: periodStart || null, periodEnd: periodEnd || null, lines: outLines };
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
      toast({ title: 'Not Saved', description: e?.message, variant: 'destructive', duration: 10000 });
    },
  });
  const remove = useMutation({
    mutationFn: () => apiRequest(`/api/cost-applications/${app!.id}`, 'DELETE'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] }); onClose(); },
    onError: (e: any) => toast({ title: 'Not Deleted', description: e?.message, variant: 'destructive' }),
  });

  /** Subtotal across a set of lines, for every column of the grid. */
  const totalsRow = (label: string, ls: SovLineRow[], cls: string) => {
    const sum = (f: (l: SovLineRow) => number) => Math.round(ls.reduce((s, l) => s + f(l), 0) * 100) / 100;
    const sched = sum((l) => l.scheduledValue);
    const prev = sum((l) => (prior.get(l.id)?.completed ?? 0) + (prior.get(l.id)?.stored ?? 0));
    const entered = sum((l) => (entry === 'period' ? workOf(l) : (draft[l.id]?.toDate ? num(draft[l.id].toDate) : 0)));
    const stored = sum((l) => num(draft[l.id]?.stored ?? ''));
    const td = sum(toDateOf);
    const ret = sum(retainageOf);
    return (
      <tr className={cls}>
        <td className="px-2 py-1.5">{label}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{money(sched)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{money(prev)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{money(entered)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{money(stored)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{money(td)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{sched ? `${((td / sched) * 100).toFixed(2)}%` : '—'}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{money(ret)}</td>
      </tr>
    );
  };

  if (!contract) return null;
  const groups = [
    // Base contract lines split by G703 section (Sitework, Tenant Improvements) when they have one: a subtotal each.
    ...(() => {
      const base = contractLines.filter((l) => l.changeOrderId == null);
      const secs = Array.from(new Set(base.map((l) => (l.section ?? '').trim())));
      if (secs.length < 2 && !secs[0]) return [{ label: 'Base Contract', lines: base }];
      return secs.map((sec) => ({ label: `Base Contract — ${sec || 'No Section'}`, lines: base.filter((l) => (l.section ?? '').trim() === sec) }));
    })(),
    // A CO shows from its start app on — or on any app that already bills it.
    ...changeOrders.filter((c) => c.contractId === contract.id && c.status !== 'void'
      && (c.startApp == null || c.startApp <= thisNumber || contractLines.some((l) => l.changeOrderId === c.id && draft[l.id] && (num(draft[l.id].work) || num(draft[l.id].stored) || num(draft[l.id].toDate)))))
      .map((c) => ({
      label: `${c.number}${c.title ? ` — ${c.title}` : ''}${c.status === 'pending' ? ' (pending)' : ''}`,
      lines: contractLines.filter((l) => l.changeOrderId === c.id),
    })),
  ].filter((g) => g.lines.length);
  const attached = app ? documents.filter((d) => d.applicationId === app.id) : [];
  const label = kind === 'invoice' ? 'Invoice' : 'Pay app';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="pm-scope w-[96vw] max-w-[min(1100px,96vw)] max-h-[92vh] overflow-y-auto grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>{app ? `${label} ${no3(app.docNumber)}` : `New ${label}`} — {contract.counterparty}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="space-y-1"><Label>No.</Label>
            <Input value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric"
                   className={docTaken ? 'border-red-400' : ''} />
            {docTaken && <div className="text-[11px] text-red-700">{label} {typedDoc} already exists on this contract</div>}</div>
          <div className="space-y-1"><Label>Invoice #</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /></div>
          <div className="space-y-1"><Label>Period From</Label>
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></div>
          <div className="space-y-1"><Label>Period To</Label>
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></div>
        </div>

        {ai.on && (
          <div className="flex items-center gap-3 flex-wrap rounded-md border border-violet-200 bg-violet-50/60 px-3 py-2 text-sm">
            <Button type="button" size="sm" variant="outline" className="h-8 border-violet-300 text-violet-800"
                    disabled={!readSource || read.isPending} onClick={() => read.mutate()}>
              {read.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              {read.isPending ? 'Reading…' : aiResult ? 'Read Again' : 'Read with AI'}
            </Button>
            <span className="text-xs text-gray-700">
              {readSource
                ? <>Reads <span className="font-medium">{readSource.name}</span> and fills in the lines below. Check them, then save.</>
                : 'Attach the pay app PDF (bottom of this window), then AI can fill in the lines for you.'}
            </span>
          </div>
        )}

        {aiResult && (() => {
          const theirs = aiResult.g702.currentPaymentDue;
          const ours = preview?.currentPaymentDue ?? 0;
          const ok = theirs != null && Math.abs(theirs - ours) < 0.01;
          return (
            <div className={`rounded-md border px-3 py-2 text-sm space-y-1 ${ok ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
              <div className="flex items-center gap-2 font-medium">
                {ok ? <CheckCircle2 className="h-4 w-4 text-green-700" /> : <AlertTriangle className="h-4 w-4 text-amber-700" />}
                {theirs == null
                  ? 'AI could not find line 8 (current payment due) on their G702 — compare by eye.'
                  : ok
                    ? `Matches their G702: current payment due ${money(theirs)}.`
                    : `Their G702 says ${money(theirs)} due; these lines give ${money(ours)} (${money(ours - theirs)} difference).`}
              </div>
              <div className="text-xs text-gray-700">
                {(() => {
                  const filled = aiResult.matched.length + (setupDone ? added : 0);
                  const left = aiResult.unmatched.length - (setupDone ? added : 0);
                  return <>{filled} line{filled === 1 ? '' : 's'} filled from {aiResult.fileName} (violet).
                    {left > 0 ? ` ${left} of their lines did not match ours.` : ''} This pay app is not saved until you click Record.</>;
                })()}
              </div>
              {(() => {
                const ws = setupDone ? aiResult.warnings.filter((w) => !w.includes('did not match a line')) : aiResult.warnings;
                return ws.length > 0 && (
                  <ul className="text-xs text-gray-800 list-disc pl-5">
                    {ws.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
                    {ws.length > 8 && <li>…and {ws.length - 8} more</li>}
                  </ul>
                );
              })()}
            </div>
          );
        })()}

        {plan && !setupDone && (plan.lines.length > 0 || plan.opening || plan.retainagePct != null) && (
          <div className="rounded-md border border-violet-300 bg-white px-3 py-3 text-sm space-y-2">
            <div className="font-medium text-gray-900">Set up this contract from the pay app</div>
            {plan.lines.length > 0 && (
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={pick.lines} onCheckedChange={(v) => setPick({ ...pick, lines: !!v })} />
                  <span>Add {plan.lines.length} line{plan.lines.length === 1 ? '' : 's'} from their G703 ({money(plan.lines.reduce((s, l) => s + l.scheduledValue, 0))} scheduled)
                    {plan.changeOrders.length ? `, including ${plan.changeOrders.length} change order${plan.changeOrders.length === 1 ? '' : 's'}` : ''}</span>
                </label>
                <div className="mt-1 ml-6 max-h-44 overflow-y-auto border rounded">
                  <table className="w-full text-xs">
                    <tbody>
                      {plan.lines.map((l) => (
                        <tr key={l.rowIndex} className="border-b last:border-0">
                          <td className="px-2 py-1 text-gray-500 w-14">{l.itemNo ?? ''}</td>
                          <td className="px-2 py-1">{l.description}</td>
                          <td className="px-2 py-1 text-gray-600">{l.changeOrder ?? 'Base contract'}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{money(l.scheduledValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {plan.opening && (
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox className="mt-0.5" checked={pick.opening} onCheckedChange={(v) => setPick({ ...pick, opening: !!v })} />
                <span>Record what was billed before tracking as <span className="font-medium">{plan.opening.label}</span>: {money(plan.opening.total)} of work, from their "previous application" column.
                  <span className="block text-xs text-gray-600">So "previous" and G702 line 7 match from this pay app on.</span></span>
              </label>
            )}
            {plan.opening && pick.opening && (
              <label className="flex items-center gap-2 cursor-pointer ml-6">
                <Checkbox checked={pick.paid} onCheckedChange={(v) => setPick({ ...pick, paid: !!v })} />
                <span>It has been paid (so it doesn't show as owed)</span>
              </label>
            )}
            {plan.retainagePct != null && (
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={pick.retainage} onCheckedChange={(v) => setPick({ ...pick, retainage: !!v })} />
                <span>Set contract retainage to {plan.retainagePct.toFixed(2)}% (their G702; the contract says {Number(contract.retainagePct).toFixed(2)}%)</span>
              </label>
            )}
            <div className="flex items-center gap-3">
              <Button type="button" size="sm" disabled={setup.isPending || !((pick.lines && plan.lines.length) || (pick.opening && plan.opening) || (pick.retainage && plan.retainagePct != null))}
                      onClick={() => setup.mutate()}>
                {setup.isPending ? 'Setting Up…' : 'Set Up Contract'}
              </Button>
              <span className="text-xs text-gray-600">Saves these to the contract now. This pay app still waits for you to save it.</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
          Enter
          <Button type="button" size="sm" variant={entry === 'period' ? 'default' : 'outline'} className="h-7"
                  onClick={() => switchEntry('period')}>This Period (E)</Button>
          <Button type="button" size="sm" variant={entry === 'toDate' ? 'default' : 'outline'} className="h-7"
                  onClick={() => switchEntry('toDate')}>Total to Date (G)</Button>
          <span>— whichever column is easier to copy off the G703. Retainage left blank is {Number(contract.retainagePct).toFixed(2)}% of work to date.</span>
          {releasing ? (
            <span className="ml-auto text-emerald-800 font-medium">Releasing all retainage: every line's retainage is $0.00, so line 8 pays out what was held.
              {' '}<button type="button" className="text-blue-700 hover:underline font-normal" onClick={() => { setRetTyped(new Set()); setDraft((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { ...v, retainage: '' }]))); }}>Undo</button></span>
          ) : contractLines.some((l) => toDateOf(l)) && (
            <Button type="button" size="sm" variant="outline" className="h-7 ml-auto" onClick={releaseAll}
                    title="Sets retainage to $0.00 on every line. Use when this pay app releases the retainage held (substantial or final completion).">
              Release All Retainage
            </Button>
          )}
        </div>

        <div className="overflow-auto border rounded-md max-h-[60vh]">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-gray-50 sticky top-0 z-10 shadow-[0_1px_0_#e5e7eb]">
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-600">
                <th className="px-2 py-1.5">Description</th>
                <th className="px-2 py-1.5 text-right">Scheduled</th>
                <th className="px-2 py-1.5 text-right">Previous</th>
                <th className="px-2 py-1.5 text-right w-32">{entry === 'period' ? 'This Period' : 'Total to Date'}</th>
                <th className="px-2 py-1.5 text-right w-28">Stored</th>
                <th className="px-2 py-1.5 text-right">To Date</th>
                <th className="px-2 py-1.5 text-right">%</th>
                <th className="px-2 py-1.5 text-right w-28">Retainage</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.label}>
                <tr className="bg-gray-100"><td colSpan={8} className="px-2 py-1 text-xs font-semibold text-gray-800">
                  <button className="inline-flex items-center gap-1 hover:text-blue-800" onClick={() => setRolled((r) => { const n = new Set(r); if (n.has(g.label)) n.delete(g.label); else n.add(g.label); return n; })}
                          title={rolled.has(g.label) ? 'Show its lines' : 'Roll up to its subtotal'}>
                    {rolled.has(g.label) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}{g.label}
                    {rolled.has(g.label) && <span className="font-normal text-gray-500">· {g.lines.length} line{g.lines.length === 1 ? '' : 's'} rolled up</span>}
                  </button>
                  {groups.length > 1 && g === groups[0] && (
                    <span className="float-right font-normal">
                      <button className="text-blue-700 hover:underline mr-3" onClick={() => setRolled(new Set(groups.map((x) => x.label)))}>Roll Up All</button>
                      <button className="text-blue-700 hover:underline" onClick={() => setRolled(new Set())}>Show All</button>
                    </span>
                  )}
                </td></tr>
                {!rolled.has(g.label) && g.lines.map((l) => {
                  const p = prior.get(l.id);
                  const previous = (p?.completed ?? 0) + (p?.stored ?? 0);
                  const toDate = (p?.completed ?? 0) + workOf(l) + num(draft[l.id]?.stored ?? '');
                  const over = toDate - l.scheduledValue > 0.005;
                  return (
                    <tr key={l.id} className="border-t">
                      <td className="px-2 py-1">
                        <div className="text-gray-900">{l.itemNo ? <span className="text-gray-500 mr-1">{l.itemNo}</span> : null}{l.description}</div>
                        {aiCells[l.id]?.previous != null && Math.abs(aiCells[l.id].previous! - previous) > 0.005 && (
                          <div className="text-[11px] text-red-700">Their previous {money(aiCells[l.id].previous!)} — ours {money(previous)}</div>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{money(l.scheduledValue)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-gray-600">{money(previous)}</td>
                      <td className="px-2 py-1">
                        <MoneyInput className={`h-8 ${aiTint(l.id, 'work')}`}
                               value={entry === 'period' ? (draft[l.id]?.work ?? '') : (draft[l.id]?.toDate ?? '')}
                               onValueChange={(v) => set(l.id, entry === 'period' ? 'work' : 'toDate', v)} />
                        {aiNote(l.id, 'work')}
                      </td>
                      <td className="px-2 py-1">
                        <MoneyInput className={`h-8 ${aiTint(l.id, 'stored')}`} value={draft[l.id]?.stored ?? ''} onValueChange={(v) => set(l.id, 'stored', v)} />
                        {aiNote(l.id, 'stored')}
                      </td>
                      <td className={`px-2 py-1 text-right tabular-nums ${over ? 'text-red-700 font-semibold' : ''}`}
                          title={over ? 'More than the scheduled value' : undefined}>{money(toDate)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-gray-600">
                        {l.scheduledValue ? `${((toDate / l.scheduledValue) * 100).toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-2 py-1">
                        <MoneyInput className={`h-8 ${aiTint(l.id, 'retainage')}`} value={draft[l.id]?.retainage ?? ''} onValueChange={(v) => set(l.id, 'retainage', v)}
                                    title={`Left blank: ${money(autoRetainage(l))} (${Number(contract?.retainagePct ?? 0).toFixed(2)}% of work to date)`} />
                        {!(draft[l.id]?.retainage ?? '').trim() && autoRetainage(l) > 0 && (
                          <div className="text-[10px] text-right text-gray-600 tabular-nums mt-0.5">auto {money(autoRetainage(l))}</div>
                        )}
                        {(() => {
                          const held = prior.get(l.id)?.retainage ?? 0;
                          const typed = (draft[l.id]?.retainage ?? '').trim();
                          if (typed !== '' && num(typed) === 0 && held >= 0.005) return (
                            <div className="text-[10px] text-right text-emerald-800 mt-0.5">Released {money(held)}
                              {' '}<button type="button" className="text-blue-700 hover:underline" onClick={() => { setRetTyped((t) => { const n2 = new Set(t); n2.delete(l.id); return n2; }); setDraft((d) => ({ ...d, [l.id]: { ...d[l.id], retainage: '' } })); }}>Undo</button></div>
                          );
                          if (retainageOf(l) >= 0.005) return (
                            <div className="text-right mt-0.5"><button type="button" className="text-[10px] text-blue-700 hover:underline" title="Sets this line's retainage to $0.00 so what's held on it is paid on this pay app"
                              onClick={() => set(l.id, 'retainage', '0')}>Release</button></div>
                          );
                          return null;
                        })()}
                        {aiNote(l.id, 'retainage')}
                      </td>
                    </tr>
                  );
                })}
                {totalsRow(`${g.label.startsWith('Base Contract — ') ? g.label.slice(16) : g.label.split(' — ')[0]} Subtotal`, g.lines, 'bg-gray-50 border-t font-medium')}
              </tbody>
            ))}
            <tfoot className="sticky bottom-0 z-10 bg-white shadow-[0_-1px_0_#374151]">
              {totalsRow('Total', groups.flatMap((g) => g.lines), 'font-semibold')}
            </tfoot>
          </table>
        </div>

        {preview && (
          <div className="border rounded-md p-3 bg-gray-50">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-2">G702 — ours against the contractor's</div>
            {(() => {
              const theirsNum = Object.fromEntries(G702_CHECK_LINES.map(([k]) => [k, (theirs[k] ?? '').trim() ? num(theirs[k]) : null]));
              const ck = g702Check(preview, theirsNum as any);
              const byKey = new Map(ck.lines.map((l) => [l.key as string, l]));
              const rows: [string, string, number][] = [
                ['1', 'Original contract sum', preview.originalContractSum],
                ['2', 'Net change by change orders', preview.netChangeOrders],
                ['3', 'Contract sum to date', preview.contractSumToDate],
                ['4', 'Completed and stored to date', preview.completedAndStored],
                ['5', 'Retainage', preview.retainage],
                ['6', 'Earned less retainage', preview.earnedLessRetainage],
                ['7', 'Less previous certificates', preview.previousCertificates],
                ['8', 'Current payment due', preview.currentPaymentDue],
                ['9', 'Balance to finish', preview.balanceToFinish],
              ];
              const keyOf = (no: string) => G702_CHECK_LINES.find((l) => l[1] === no)?.[0];
              const ret = byKey.get('retainage');
              const canSpread = ret && ret.ok === false && contractLines.some((l) => !(draft[l.id]?.retainage ?? '').trim() && toDateOf(l));
              // Saved retainage is kept as typed; offer to figure it again (contract rate, rounded down).
              const canRecalc = ret && ret.ok === false && !canSpread && contractLines.some((l) => (draft[l.id]?.retainage ?? '').trim() && toDateOf(l));
              // A small difference on line 5 (their line-by-line rounding) can be accepted as an adjustment
              // instead of chased: it's kept on this pay app and carries forward, so later pay apps agree.
              const theirRet = (theirs.retainage ?? '').trim() ? num(theirs.retainage) : null;
              const baseRet = Math.round((preview.retainage - retAdj) * 100) / 100;
              const adjNeeded = theirRet != null ? Math.round((theirRet - baseRet) * 100) / 100 : 0;
              const canAccept = theirRet != null && !retTarget.trim() && Math.abs(adjNeeded) >= 0.005 && Math.abs(adjNeeded) <= RET_ADJ_MAX && Math.abs(adjNeeded - retAdj) >= 0.005;
              return (
                <>
                  <table className="text-sm w-full max-w-3xl">
                    <thead><tr className="text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="text-left font-medium pb-1">Line</th><th className="text-right font-medium pb-1 pr-3">Ours</th>
                      <th className="text-right font-medium pb-1 w-40">Theirs</th><th className="text-left font-medium pb-1 pl-3">Check</th>
                    </tr></thead>
                    <tbody>
                      {rows.map(([no, label, v]) => {
                        const k = keyOf(no);
                        const c = k ? byKey.get(k) : null;
                        return (
                          <tr key={no} className={no === '8' ? 'font-semibold text-gray-900' : 'text-gray-700'}>
                            <td className="py-0.5 pr-3">{no}  {label}</td>
                            <td className={`py-0.5 pr-3 text-right tabular-nums ${no === '5' && retTarget.trim() ? 'text-amber-800' : ''}`}>{money(v)}</td>
                            <td className="py-0.5">
                              {k ? <MoneyInput className={`h-7 text-xs ${c?.ok === false ? 'border-red-400' : c?.ok ? 'border-green-400' : ''}`}
                                               value={theirs[k] ?? ''} aria-label={`Their line ${no}`}
                                               onValueChange={(val) => setTheirs((t) => ({ ...t, [k]: val }))} /> : null}
                            </td>
                            <td className="py-0.5 pl-3 text-xs font-normal">
                              {c?.ok === true && <span className="text-green-700">✓ matches</span>}
                              {c?.ok === false && <span className="text-red-700">⚠ off {money(Math.abs(c.diff!))}{c.diff! > 0 ? ' (ours higher)' : ' (theirs higher)'}{c.hint ? ` — check ${c.hint}` : ''}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="mt-2 pt-2 border-t flex items-center gap-3 flex-wrap text-xs">
                    {ck.status === 'match' && <span className="text-green-800 font-medium">✓ Matches the contractor's G702 — current payment due {money(preview.currentPaymentDue)}.</span>}
                    {ck.status === 'off' && <span className="text-red-800 font-medium">⚠ Doesn't match the contractor's G702{ck.dueDiff != null ? ` — payment due off ${money(Math.abs(ck.dueDiff))}` : ''}{ck.first && ck.first.key !== 'currentPaymentDue' ? `. Start with line ${ck.first.no}.` : '.'}</span>}
                    {ck.status === 'none' && <span className="text-gray-600">Type their line 8 (and 3, 4, 5, 7 if you like) to check this pay app against theirs. It's saved with the pay app.</span>}
                    {(() => {
                      // The third check: the GC's conditional for this pay app (and its line 8 typed in the package).
                      if (!app || !contract) return null;
                      const tw = threeWayCheck({ id: app.id, g702: { currentPaymentDue: preview.currentPaymentDue }, contractorG702: theirsNum.currentPaymentDue != null ? { currentPaymentDue: theirsNum.currentPaymentDue as number } : null }, waivers, contract.counterparty);
                      if (tw.status === 'none') return null;
                      const rate = Number(contract.retainagePct) || 0;
                      return (
                        <div className={`w-full rounded-md border p-2 ${tw.status === 'off' ? 'border-red-300 bg-red-50 text-red-900' : 'border-green-300 bg-green-50 text-green-900'}`}>
                          <div className="font-semibold">Three-Way Check on Line 8</div>
                          <div className="grid grid-cols-3 gap-2 mt-1 tabular-nums">
                            <div>Ours (These Lines)<div className="font-semibold">{tw.ours != null ? money(tw.ours) : '—'}</div></div>
                            <div>Contractor's G702<div className="font-semibold">{tw.contractor != null ? money(tw.contractor) : 'Not entered'}</div></div>
                            <div>GC Conditional<div className="font-semibold">{tw.conditional != null ? money(tw.conditional) : 'Not entered'}</div></div>
                          </div>
                          <div className="mt-1">
                            {tw.status === 'match' && '✓ All three match.'}
                            {tw.status === 'partial' && '✓ The two entered match.'}
                            {tw.status === 'off' && (tw.oursOff != null && tw.oursOff < 0
                              ? `⚠ Ours is ${money(-tw.oursOff)} lower than theirs: lines are missing, about ${money(-tw.oursOff / (1 - rate / 100))} of work this period before retainage. Most often it's change order work billed this period. Check the change order lines above.`
                              : tw.oursOff != null ? `⚠ Ours is ${money(tw.oursOff)} higher than theirs: check the amounts entered.`
                              : "⚠ The contractor's G702 and the conditional don't agree with each other. Check which one the contractor revised.")}
                          </div>
                        </div>
                      );
                    })()}
                    {(() => {
                      // Their two G702s should chain: their line 4 less last pay app's = this period's work; line 7 = last line 6.
                      const prevApp = [...mine].filter((a) => a.number < thisNumber).sort((a, b) => b.number - a.number)[0];
                      if (!prevApp) return null;
                      const cf = carryForwardCheck(theirsNum as any, prevApp.contractorG702, preview, prevApp.g702);
                      if (cf.status === 'none') return null;
                      const pn = String(prevApp.docNumber).padStart(3, '0');
                      const bad = cf.status === 'off';
                      return (
                        <div className={`w-full rounded-md border p-2 ${bad ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-green-300 bg-green-50 text-green-900'}`}>
                          <div className="font-semibold">Carry-Forward Check: Their G702 Against Their Pay App {pn}</div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 mt-1 tabular-nums">
                            {cf.implied != null && <div>Their line 4 less their Pay App {pn} line 4: <strong>{money(cf.implied)}</strong>{cf.period != null && <> · work this period on the lines: <strong>{money(cf.period)}</strong>{Math.abs(cf.periodDiff ?? 0) >= 0.005 && <span className="text-red-800 font-semibold"> (off {money(Math.abs(cf.periodDiff!))})</span>}</>}</div>}
                            {cf.line7 != null && cf.prevLine6 != null && <div>Their line 7: <strong>{money(cf.line7)}</strong> · their Pay App {pn} line 6: <strong>{money(cf.prevLine6)}</strong>{Math.abs(cf.line7Diff ?? 0) >= 0.005 && <span className="text-red-800 font-semibold"> (off {money(Math.abs(cf.line7Diff!))})</span>}</div>}
                          </div>
                          <div className="mt-1">{bad ? `⚠ Their G702s don't chain: this one and Pay App ${pn}'s disagree. One of them is wrong; the one that matches the G703 lines is usually right.` : `✓ Their G702 carries forward from Pay App ${pn}.`}</div>
                        </div>
                      );
                    })()}
                    {canSpread && theirRet != null && Math.abs(theirRet) < 0.005 && (
                      <button className="text-emerald-800 font-semibold hover:underline" onClick={releaseAll}>
                        Their line 5 is $0.00: this is a retainage release. Release All Retainage
                      </button>
                    )}
                    {canSpread && !(theirRet != null && Math.abs(theirRet) < 0.005) && (
                      <button className="text-blue-700 hover:underline" onClick={() => setRetTarget(theirs.retainage)}>
                        Spread the blank retainage boxes to match their line 5
                      </button>
                    )}
                    {canAccept && (
                      <button className="text-blue-700 hover:underline" title="Keeps our retainage as figured and records the difference as an accepted rounding adjustment on this pay app; it carries to later pay apps"
                              onClick={() => setRetAdj(adjNeeded)}>
                        Accept their retainage: {adjNeeded > 0 ? '+' : ''}{money(adjNeeded)} rounding adjustment
                      </button>
                    )}
                    {Math.abs(retAdj) >= 0.005 && (
                      <span className="text-violet-800">Line 5 includes an accepted rounding adjustment of {retAdj > 0 ? '+' : ''}{money(retAdj)} (ours at the rate: {money(baseRet)}).
                        {' '}<button className="text-blue-700 hover:underline" onClick={() => setRetAdj(0)}>Remove</button></span>
                    )}
                    {canRecalc && (
                      <button className="text-blue-700 hover:underline" title="Clears the retainage boxes so they're figured at the contract rate on work to date, rounded down to the cent like the contractor's"
                              onClick={() => { setRetTyped(new Set()); setDraft((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { ...v, retainage: '' }]))); }}>
                        Recalculate retainage at {(rate * 100).toFixed(2)}% (rounded down)
                      </button>
                    )}
                    {retTarget.trim() && (
                      <span className="text-amber-800">Retainage spread to {money(num(retTarget))} · ours would be {money(retainageCents(contractLines.reduce((s2, l) => s2 + toDateOf(l) * rate, 0)))}
                        {' '}<button className="text-blue-700 hover:underline" onClick={() => setRetTarget('')}>Undo</button></span>
                    )}
                  </div>
                </>
              );
            })()}
            {(() => {
              const cs = preview.changeOrderSummary;
              const any = cs.previous.additions || cs.previous.deductions || cs.thisPeriod.additions || cs.thisPeriod.deductions;
              if (!any) return null;
              const names = changeOrders.filter((c) => cs.thisPeriodIds.includes(c.id)).map((c) => c.number).join(', ');
              const cell = (v: number, neg = false) => <td className="px-2 py-0.5 text-right tabular-nums">{v ? (neg ? `(${money(v)})` : money(v)) : '—'}</td>;
              return (
                <div className="mt-3 pt-2 border-t">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 mb-1">Change order summary</div>
                  <table className="text-sm">
                    <thead><tr className="text-[11px] text-gray-500"><th /><th className="px-2 text-right font-medium">Additions</th><th className="px-2 text-right font-medium">Deductions</th></tr></thead>
                    <tbody>
                      <tr><td className="pr-4 text-gray-700">Approved in previous months</td>{cell(cs.previous.additions)}{cell(cs.previous.deductions, true)}</tr>
                      <tr><td className="pr-4 text-gray-700">Approved this month{names ? <span className="text-gray-500"> ({names})</span> : null}</td>{cell(cs.thisPeriod.additions)}{cell(cs.thisPeriod.deductions, true)}</tr>
                      <tr className="font-medium"><td className="pr-4">Totals</td>{cell(cs.previous.additions + cs.thisPeriod.additions)}{cell(cs.previous.deductions + cs.thisPeriod.deductions, true)}</tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}
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
              {d.originalName}{d.storage === 'local' ? ' (Not Backed Up)' : ''}
            </button>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {app ? (
            <Button type="button" variant="ghost" className="text-red-700" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Delete {label}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !thisNumber || docTaken}>
              {save.isPending ? 'Saving…' : app ? 'Save Changes' : `Record ${label}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
