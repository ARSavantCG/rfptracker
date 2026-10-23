/**
 * One pay app's package: its files (G702/G703, waivers, invoices, backup),
 * its conditional waivers, and the unconditional waivers it should carry for
 * the pay app before — rolled forward from that one's conditionals. Download
 * it all as one zip, named so it can be followed without opening it.
 *
 * Anything the app fills in can be typed over; what was typed over shows as
 * Edited, with what was expected beside it.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { ChevronRight, Download, GripVertical, Paperclip, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { coLog, cosOnPayApp } from '@shared/co-log';
import { waiverChecklist, waiverLog, waiverOutstanding, waiverTotals, isGcVendor, partyOf, payAppVendors, isPayAppOf, knownVendors, closeVendor, sameVendor, nextApp, carriedVendors, gcPaymentDue, paidOfFrom, unpaid, fundingNote, DOC_TYPES, type UnconditionalRow, type WaiverParty, type WaiverTotals, type MissingConditional, type WaiverLogRow } from '@shared/cost-waivers';
import { fmtMoneyText } from '@shared/format';
import { MoneyInput } from './inputs';
import { openDocument } from './contract-card';
import { money, projectKey, type ProjectBundle, type ApplicationRow, type ContractRow } from './types';

const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
/** Reordering a waiver row (not a file being dropped on it). */
const ROW_MIME = 'application/x-waiver-row';
const isRowDrag = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes(ROW_MIME);
const uKey = (r: UnconditionalRow) => (r.id ? `u${r.id}` : `ux${r.fromWaiverId}`);
type Kind = 'conditional' | 'unconditional';
const nn = (n: number) => String(n).padStart(2, '0');

export function PackageDialog({ target, bundle, projectId, onClose }: {
  target: { app: ApplicationRow; contract: ContractRow } | null;
  bundle: ProjectBundle;
  projectId: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
  const [dropType, setDropType] = useState('g702');
  const [drag, setDrag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newC, setNewC] = useState<{ vendor: string; amount: string } | null>(null);
  const [newU, setNewU] = useState<{ vendor: string; amount: string } | null>(null);

  const app = target?.app;
  const label = app?.kind === 'invoice' ? 'Invoice' : 'Pay App';
  const apps = useMemo(() => bundle.applications.map((a) => ({ id: a.id, contractId: a.contractId, number: a.number, docNumber: a.docNumber })), [bundle.applications]);
  const gcName = target?.contract.counterparty ?? '';
  const ck = useMemo(() => (app ? waiverChecklist(app.id, apps, bundle.waivers, gcName) : null), [app?.id, apps, bundle.waivers, gcName]);
  /** Line 8 as the paperwork says it (typed, the GC's G702, or ours). */
  const dueOf = (aid: number) => { const a = bundle.applications.find((x) => x.id === aid); const c = bundle.contracts.find((x) => x.id === a?.contractId); return a ? gcPaymentDue(a as any, bundle.waivers, c?.counterparty ?? '') : { due: null, source: null }; };
  const paidOf = useMemo(() => paidOfFrom(bundle.payments, (aid) => dueOf(aid).due), [bundle.payments, bundle.applications, bundle.waivers, bundle.contracts]);
  // Owed on pay apps before the previous one (that one's are the unconditionals below).
  const earlier = useMemo(() => {
    if (!app || !ck?.previous) return [] as WaiverLogRow[];
    const before = ck.previous.number;
    return waiverLog(apps.filter((a) => a.contractId === app.contractId), bundle.waivers, () => gcName, paidOf)
      .filter((r) => waiverOutstanding(r.status) && (apps.find((a) => a.id === r.appId)?.number ?? 0) < before);
  }, [app?.id, ck, apps, bundle.waivers, gcName, paidOf]);
  const prevApp = ck?.previous ? bundle.applications.find((a) => a.id === ck.previous!.id) : undefined;
  // Paid in full? An unconditional for a pay app we haven't paid can't exist yet — it waits on us, not the contractor.
  const prevPaid = ck?.previous ? paidOf(ck.previous.id) : null;
  const prevWaiting = unpaid(prevPaid);
  // The pay app after this one: where this pay app's conditionals are answered by unconditionals.
  const nextRef = app ? nextApp(apps.find((a) => a.id === app.id)!, apps) : null;
  const nextLabel = nextRef ? `Pay App ${nn(nextRef.docNumber || nextRef.number)}` : 'the next pay app';
  const nextList = useMemo(() => (nextRef ? waiverChecklist(nextRef.id, apps, bundle.waivers, gcName).unconditionals : []), [nextRef?.id, apps, bundle.waivers, gcName]);
  // Every vendor name already used on this project, to pick from.
  const vendorListId = `vendors-${projectId}`;
  const vendors = useMemo(() => knownVendors(
    [...bundle.waivers.map((w) => w.vendor), ...bundle.documents.map((d) => d.vendor)],
    bundle.contracts.map((c) => c.counterparty),
  ), [bundle.waivers, bundle.documents, bundle.contracts]);

  // Reordering: drag by the grip; the new order shows at once and is saved behind it.
  const [armed, setArmed] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ kind: Kind; key: string } | null>(null);
  const [dropAt, setDropAt] = useState<{ kind: Kind; key: string; after: boolean } | null>(null);
  const [override, setOverride] = useState<{ kind: Kind; keys: string[] } | null>(null);
  // Rolled up or open, per section: open by default while anything in it needs attention.
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const isOpen = (k: string, def: boolean) => folds[k] ?? def;
  const toggle = (k: string, def: boolean) => setFolds((f) => ({ ...f, [k]: !(f[k] ?? def) }));
  const arrange = <T,>(kind: Kind, list: T[], keyOf: (x: T) => string) =>
    override?.kind === kind ? [...list].sort((a, b) => override.keys.indexOf(keyOf(a)) - override.keys.indexOf(keyOf(b))) : list;
  const conds = ck ? arrange('conditional', ck.conditionals, (w) => `c${w.id}`) : [];
  const unconds = ck ? arrange('unconditional', ck.unconditionals, uKey) : [];
  const reorder = async (kind: Kind, from: string, to: string, after: boolean) => {
    const keys = kind === 'conditional' ? conds.map((w) => `c${w.id}`) : unconds.map(uKey);
    const rest = keys.filter((k) => k !== from);
    let at = rest.indexOf(to); if (at < 0) return;
    if (after) at++;
    const next = [...rest.slice(0, at), from, ...rest.slice(at)];
    if (next.join() === keys.join()) return;
    setOverride({ kind, keys: next });
    try {
      const rows = kind === 'conditional'
        ? next.map((k) => ({ id: Number(k.slice(1)) }))
        : next.map((k) => { const r = unconds.find((x) => uKey(x) === k)!; return r.id ? { id: r.id } : { fromWaiverId: r.fromWaiverId, vendor: r.vendor, amount: r.amount }; });
      await apiRequest(`/api/cost-applications/${app!.id}/waivers/order`, 'POST', { kind, rows });
      await queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] });
    } catch (e: any) { toast({ title: 'Order Not Saved', description: e?.message, variant: 'destructive' }); }
    finally { setOverride(null); }
  };
  /** Row props: reorder by the grip, and keep dropping files on the row. */
  const rowDnd = (kind: Kind, key: string, files: { onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void }) => ({
    draggable: armed === key,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData(ROW_MIME, key); e.dataTransfer.effectAllowed = 'move'; setMoving({ kind, key }); },
    onDragEnd: () => { setArmed(null); setMoving(null); setDropAt(null); },
    onDragOver: (e: React.DragEvent) => {
      if (isRowDrag(e)) {
        if (moving?.kind !== kind) return;
        e.preventDefault();
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const after = e.clientY > box.top + box.height / 2;
        if (dropAt?.key !== key || dropAt.after !== after) setDropAt({ kind, key, after });
        return;
      }
      files.onDragOver(e);
    },
    onDragLeave: files.onDragLeave,
    onDrop: (e: React.DragEvent) => {
      if (isRowDrag(e)) {
        e.preventDefault();
        const from = e.dataTransfer.getData(ROW_MIME);
        const at = dropAt;
        setArmed(null); setMoving(null); setDropAt(null);
        if (from && at && from !== key && moving?.kind === kind) reorder(kind, from, key, at.after);
        return;
      }
      files.onDrop(e);
    },
  });
  const dropLine = (kind: Kind, key: string) =>
    dropAt?.kind === kind && dropAt.key === key && moving?.key !== key ? (dropAt.after ? 'shadow-[inset_0_-2px_0_0_#2563eb]' : 'shadow-[inset_0_2px_0_0_#2563eb]') : moving?.key === key ? 'opacity-40' : '';
  const grip = (key: string, top?: boolean) => (
    <td className={`pl-1 w-6 ${top ? 'align-top pt-2.5' : ''}`}>
      <span className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-700 inline-flex" title="Drag to reorder"
            onMouseDown={() => setArmed(key)} onMouseUp={() => setArmed(null)} onTouchStart={() => setArmed(key)}>
        <GripVertical className="h-4 w-4" />
      </span>
    </td>
  );
  const files = app ? bundle.documents.filter((d) => d.applicationId === app.id) : [];
  const docName = (id: number | null) => bundle.documents.find((d) => d.id === id)?.originalName;

  const call = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true);
    try { await fn(); refresh(); if (ok) toast({ title: ok }); return true; }
    catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); refresh(); return false; }
    finally { setBusy(false); }
  };
  const upload = (file: File, extra: Record<string, string>, appId?: number) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('applicationId', String(appId ?? app!.id));
    fd.append('contractId', String(target!.contract.id));
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    return apiRequest(`/api/cost-projects/${projectId}/documents`, 'POST', fd, 120_000);
  };
  const dropFiles = (e: React.DragEvent, extra: Record<string, string>) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); e.stopPropagation(); setDrag(null);
    const list = Array.from(e.dataTransfer.files);
    if (list.length) call(async () => { for (const f of list) await upload(f, extra); }, list.length === 1 ? 'File saved' : `${list.length} files saved`);
  };
  const dz = (key: string, extra: Record<string, string>) => ({
    onDragOver: (e: React.DragEvent) => { if (isFileDrag(e)) { e.preventDefault(); e.stopPropagation(); setDrag(key); } },
    onDragLeave: () => setDrag((d) => (d === key ? null : d)),
    onDrop: (e: React.DragEvent) => dropFiles(e, extra),
  });

  /** Save a change to an unconditional row; an expected row not yet saved is created first. */
  const saveU = (r: UnconditionalRow, patch: Record<string, any>) => call(async () => {
    if (r.id) return apiRequest(`/api/cost-waivers/${r.id}`, 'PATCH', patch);
    return apiRequest(`/api/cost-applications/${app!.id}/waivers`, 'POST', {
      kind: 'unconditional', vendor: r.vendor, amount: r.amount, fromWaiverId: r.fromWaiverId, received: false, ...patch,
    });
  });
  const uploadToU = async (r: UnconditionalRow, f: File) => {
    let id = r.id;
    if (!id) {
      const row: any = await apiRequest(`/api/cost-applications/${app!.id}/waivers`, 'POST', {
        kind: 'unconditional', vendor: r.vendor, amount: r.amount, fromWaiverId: r.fromWaiverId, received: false,
      });
      id = row.id;
    }
    await upload(f, { docType: 'unconditional', waiverId: String(id) });
  };

  /** An earlier pay app's unconditional: saved on the pay app it's due with (created if only expected). */
  const ensureEarlierU = async (r: WaiverLogRow) => {
    if (r.unconditionalId) return r.unconditionalId;
    const row: any = await apiRequest(`/api/cost-applications/${r.unconditionalAppId}/waivers`, 'POST', {
      kind: 'unconditional', vendor: r.vendor, amount: r.conditionalAmount, fromWaiverId: r.conditionalId, received: false,
    });
    return row.id as number;
  };
  const markEarlier = (r: WaiverLogRow, patch: { received?: boolean; notNeeded?: boolean }) => call(async () => {
    if (r.status === 'unconditional outstanding') return apiRequest(`/api/cost-waivers/${await ensureEarlierU(r)}`, 'PATCH', patch);
    if (r.status === 'conditional outstanding') return apiRequest(`/api/cost-waivers/${r.conditionalId}`, 'PATCH', patch);
    return apiRequest(`/api/cost-applications/${r.appId}/waivers`, 'POST', { kind: 'conditional', vendor: r.vendor, amount: 0, received: false, notNeeded: true });
  }, patch.received ? `${r.vendor}: received` : `${r.vendor}: not needed`);

  const download = async () => {
    const { AUTH_TOKEN_KEY } = await import('@/lib/auth-constants');
    const res = await fetch(`/api/cost-applications/${app!.id}/package`, { headers: { Authorization: `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` } });
    if (!res.ok) { toast({ title: 'No Package', description: (await res.json().catch(() => ({})))?.message, variant: 'destructive' }); return; }
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'package.zip';
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  if (!target || !app || !ck) return null;
  /** A pay app row: its payment due (GC from the G702, a sub's as typed) against its conditional. */
  const payCheck = (r: { vendor: string; party: WaiverParty }) => {
    const cond = conds.find((w) => !w.notNeeded && (r.party === 'gc' ? partyOf(w, gcName) === 'gc' : sameVendor(w.vendor, r.vendor)));
    const due = r.party === 'gc' ? dueOf(app.id).due : cond?.payAppDue ?? null;
    return { cond, due, diff: cond && due != null ? Math.round((due - cond.amount) * 100) / 100 : null };
  };
  // Change orders this pay app's G702 carries as approved this period.
  const cosHere = cosOnPayApp(coLog(bundle.changeOrders as any, bundle.sovLines as any, bundle.documents as any), app.contractId, app.number);
  // Subs from the pay app before who aren't here: a one-click add, not a requirement.
  const carried = carriedVendors(apps.find((a) => a.id === app.id)!, apps, bundle.waivers, gcName);
  /** A sub marked not needed with nothing on it: not billing this pay app — one quiet line, not a row. */
  const notBilling = (w: { notNeeded: boolean; amount: number }) => w.notNeeded && Math.abs(w.amount) < 0.005;
  /** An expected unconditional for a pay app we haven't paid in full. */
  const awaitingRow = (r: UnconditionalRow) => prevWaiting && r.source === 'expected' && !r.received && !r.notNeeded;
  const waitCount = ck.unconditionals.filter(awaitingRow).length;
  const outNow = ck.outstanding - waitCount;

  /** Under a conditional: has its unconditional come in (with the next pay app)? Tick or attach it from here. */
  const AnswerLine = ({ w }: { w: { id: number; vendor: string; amount: number } }) => {
    if (!nextRef) return <div className="text-[10px] text-gray-500 mt-0.5">Unconditional: due with the next pay app</div>;
    const u = nextList.find((x) => x.fromWaiverId === w.id);
    const ensure = async () => u?.id ?? ((await apiRequest(`/api/cost-applications/${nextRef.id}/waivers`, 'POST', {
      kind: 'unconditional', vendor: w.vendor, amount: w.amount, fromWaiverId: w.id, received: false })) as any).id as number;
    if (u?.notNeeded) return <div className="text-[10px] text-gray-500 mt-0.5">Unconditional: not needed</div>;
    if (u?.received) return <div className="text-[10px] text-green-700 mt-0.5">Unconditional: received with {nextLabel}{u.documentId ? ` · ${short(docName(u.documentId) ?? '')}` : ''}</div>;
    const mine = paidOf(app.id);
    if (unpaid(mine)) return <div className="text-[10px] text-amber-700 mt-0.5" title={`Due with ${nextLabel}, once we pay this pay app in full`}>Unconditional: pending funding of this pay app ({money(mine!.paid)} of {money(mine!.due)} paid)</div>;
    return (
      <div className="text-[10px] mt-0.5 flex items-center gap-2 flex-wrap">
        <span className="text-amber-700">Unconditional: due with {nextLabel}</span>
        <button className="text-blue-700 hover:underline" onClick={() => call(async () => apiRequest(`/api/cost-waivers/${await ensure()}`, 'PATCH', { received: true }), `Unconditional received — saved on ${nextLabel}`)}>Mark Received</button>
        <label className="text-blue-700 hover:underline cursor-pointer">Attach
          <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) call(async () => upload(f, { docType: 'unconditional', waiverId: String(await ensure()) }, nextRef.id), `Unconditional saved on ${nextLabel}`); }} />
        </label>
      </div>
    );
  };

  // Pay applications: one row per vendor (the GC first if it has no conditional yet).
  const payRows = payAppVendors(conds, gcName);
  const payFiles = (r: { vendor: string; party: WaiverParty }) => files.filter((d) => !bundle.waivers.some((w) => w.documentId === d.id) && isPayAppOf(d, r));
  /** What a file is, as the Files dropdown shows it. */
  const assignedTo = (d: typeof files[number]) => {
    const w = bundle.waivers.find((x) => x.documentId === d.id && x.applicationId === app.id);
    if (w && w.kind === 'conditional') return `cw:${w.id}`;
    if (w) { const r = unconds.find((x) => x.id === w.id); if (r) return `uw:${uKey(r)}`; }
    if (!w) { const i = payRows.findIndex((r) => isPayAppOf(d, r)); if (i >= 0) return `pa:${i}`; }
    return `t:${d.docType && d.docType !== 'sub_pay_app' ? d.docType : 'g702'}`;
  };
  const unassigned = files.filter((d) => ['t:conditional', 't:unconditional', 't:g702'].includes(assignedTo(d)));
  const assign = (docId: number, v: string) => call(async () => {
    const [kind, ref] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
    const linked = bundle.waivers.find((x) => x.documentId === docId);
    if (kind === 'cw') return apiRequest(`/api/cost-waivers/${ref}`, 'PATCH', { documentId: docId });
    if (kind === 'uw') {
      const r = unconds.find((x) => uKey(x) === ref)!;
      let id = r.id;
      if (!id) id = ((await apiRequest(`/api/cost-applications/${app.id}/waivers`, 'POST', { kind: 'unconditional', vendor: r.vendor, amount: r.amount, fromWaiverId: r.fromWaiverId, received: false })) as any).id;
      return apiRequest(`/api/cost-waivers/${id}`, 'PATCH', { documentId: docId });
    }
    if (linked && (ref === 'conditional' || ref === 'unconditional')) await apiRequest(`/api/cost-waivers/${linked.id}`, 'PATCH', { documentId: null });
    if (kind === 'pa') { const r = payRows[Number(ref)]; return apiRequest(`/api/cost-documents/${docId}`, 'PATCH', { docType: r.party === 'gc' ? 'g702' : 'sub_pay_app', vendor: r.vendor }); }
    return apiRequest(`/api/cost-documents/${docId}`, 'PATCH', { docType: ref, vendor: null });
  }, 'File Assigned');

  // Roll-up lines for the waiver sections.
  const sumLine = (rows: Array<{ vendor: string; amount: number; notNeeded: boolean; party?: WaiverParty | null; received: boolean }>, noun: string) => {
    const live = rows.filter((r) => !r.notNeeded);
    const t = waiverTotals(rows, gcName);
    return `${live.length} ${noun}${live.length === 1 ? '' : 's'} · ${live.filter((r) => r.received).length} of ${live.length} Received · Subs ${money(t.subs)} · GC ${money(t.gc)} · GC Less Subs ${money(t.gap)}`;
  };
  const condOut = conds.filter((w) => !w.received && !w.notNeeded).length + ck.missing.length;
  const uncondWait = unconds.filter(awaitingRow).length;
  const uncondOut = unconds.filter((r) => !r.received && !r.notNeeded).length - uncondWait;
  const condOpen = !!newC || ck.missing.length > 0 || !ck.conditionals.length || conds.some((w) => !w.received && !w.notNeeded);
  const liveConds = conds.filter((w) => !w.notNeeded);
  const answered = liveConds.filter((w) => nextList.some((u) => u.fromWaiverId === w.id && (u.received || u.notNeeded))).length;
  const condSummary = ck.conditionals.length
    ? `${sumLine(conds, 'Conditional')}${nextRef && liveConds.length ? ` · Unconditionals ${answered} of ${liveConds.length} In (${nextLabel})` : ''}`
    : 'None Yet';
  const uncondOpen = !!newU || unconds.some((r) => !r.received && !r.notNeeded);
  const uncondSummary = unconds.length ? sumLine(unconds, 'Unconditional') : 'None Expected';
  const prevLabel = ck.previous ? `Pay App ${nn(ck.previous.docNumber || ck.previous.number)}` : null;

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* Fits the window: the title, status and download stay put; the lists scroll beneath them. */}
      <DialogContent className="pm-scope w-[96vw] max-w-[min(1200px,96vw)] h-auto max-h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        <div className="px-6 pt-5 pb-3 border-b pr-12 space-y-2 flex-shrink-0">
        <DialogHeader>
          <DialogTitle>{target.contract.counterparty} — {label} {nn(app.docNumber)} Package</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs text-gray-600">
            {outNow ? <span className="text-red-700 font-medium">{outNow} waiver{outNow === 1 ? '' : 's'} outstanding{ck.missing.length ? ` (${ck.missing.length} conditional${ck.missing.length === 1 ? '' : 's'} not entered)` : ''}.</span> : <span className="text-green-700 font-medium">All waivers in.</span>}
            {waitCount > 0 && <span className="text-amber-700 font-medium"> {waitCount} pending funding of {prevLabel}.</span>}
            {earlier.length > 0 && <span className="text-red-700 font-medium"> {earlier.length} more from earlier pay apps.</span>}
            {' '}Download gives one zip, sorted into folders, with a contents sheet.
          </p>
          <Button onClick={download} disabled={!files.length}><Download className="h-4 w-4 mr-1" /> Download Package</Button>
        </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 py-4 space-y-4">
        <datalist id={vendorListId}>{vendors.map((v) => <option key={v} value={v} />)}</datalist>

        {/* Files: drop anything here, then say what each one is — or drop it on its row below. */}
        <section className="space-y-2">
          <div {...dz('files', { docType: dropType })}
               className={`border-2 border-dashed rounded-md px-3 py-3 flex items-center gap-3 flex-wrap text-sm ${drag === 'files' ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}`}>
            <Upload className="h-4 w-4 text-gray-500" />
            <span>Drop files here as</span>
            <div className="w-60">
              <Select value={dropType} onValueChange={setDropType}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="pm-scope">{DOC_TYPES.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <label className="text-blue-700 cursor-pointer hover:underline">or browse
              <input type="file" multiple className="hidden" onChange={(e) => {
                const list = Array.from(e.target.files ?? []); e.target.value = '';
                if (list.length) call(async () => { for (const f of list) await upload(f, { docType: dropType }); }, 'Saved');
              }} />
            </label>
            <span className="text-xs text-gray-500">Pay apps and waivers are better dropped on their row below — they're named by vendor.</span>
          </div>
          {files.length > 0 && (
            <Fold title={`Files (${files.length})`} badge={unassigned.length ? { tone: 'warn', text: `${unassigned.length} Not Assigned` } : null} open={isOpen('files', unassigned.length > 0)} onToggle={() => toggle('files', unassigned.length > 0)}
                  summary={unassigned.length ? <span className="text-amber-700 font-medium">{unassigned.length} not assigned</span> : 'All assigned'}>
              <div className="border rounded-md divide-y">
                {files.map((d) => {
                  const v = assignedTo(d);
                  const loose = unassigned.includes(d);
                  return (
                    <div key={d.id} className={`px-3 py-1.5 flex items-center gap-3 text-sm ${loose ? 'bg-amber-50/60' : ''}`}>
                      <button className="text-blue-700 hover:underline text-left break-all flex-1 min-w-0" onClick={() => openDocument(d.id)}>{d.originalName}</button>
                      {loose && <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 rounded px-1 whitespace-nowrap">Not Assigned</span>}
                      <div className="w-72 max-w-[45%] flex-shrink-0">
                        <Select value={v} onValueChange={(nv) => assign(d.id, nv)}>
                          <SelectTrigger className="h-7 text-xs text-left [&>span]:truncate" aria-label={`What ${d.originalName} is`}><SelectValue /></SelectTrigger>
                          <SelectContent className="pm-scope max-h-80">
                            <SelectGroup><SelectLabel>Pay Applications</SelectLabel>
                              {payRows.map((r, i) => <SelectItem key={`pa${i}`} value={`pa:${i}`}>Pay App — {r.vendor} ({r.party === 'gc' ? 'GC' : 'Sub'})</SelectItem>)}
                            </SelectGroup>
                            {conds.length > 0 && <SelectGroup><SelectLabel>Conditional Waivers — {label} {nn(app.docNumber)}</SelectLabel>
                              {conds.map((w) => <SelectItem key={`cw${w.id}`} value={`cw:${w.id}`}>Conditional — {w.vendor}</SelectItem>)}
                            </SelectGroup>}
                            {unconds.length > 0 && <SelectGroup><SelectLabel>Unconditional Waivers — {prevLabel}</SelectLabel>
                              {unconds.map((r) => <SelectItem key={`uw${uKey(r)}`} value={`uw:${uKey(r)}`}>Unconditional — {r.vendor}</SelectItem>)}
                            </SelectGroup>}
                            <SelectGroup><SelectLabel>Other</SelectLabel>
                              {DOC_TYPES.filter(([k]) => k === 'invoice' || k === 'other' || k === 'conditional' || k === 'unconditional' || k === 'g702').map(([k, t]) => (
                                <SelectItem key={k} value={`t:${k}`}>{k === 'conditional' || k === 'unconditional' ? `${t} (Not Assigned)` : k === 'g702' ? 'G702 / G703 (Not Assigned)' : t}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                      <button className="text-gray-400 hover:text-red-700 flex-shrink-0" title="Remove this file"
                              onClick={() => { if (window.confirm(`Remove ${d.originalName}?`)) call(() => apiRequest(`/api/cost-documents/${d.id}`, 'DELETE'), 'File Removed'); }}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </Fold>
          )}
        </section>

        {/* Pay applications: the GC's G702/G703 and each sub's own, one row per vendor. */}
        <Fold title={`Pay Applications — ${label} ${nn(app.docNumber)}`}
              badge={(() => {
                const off = payRows.map(payCheck).filter((v) => v.diff != null && Math.abs(v.diff) >= 0.01).length;
                if (off) return { tone: 'warn' as const, text: `${off} Don't Match` };
                const n = payRows.filter((r) => payFiles(r).length).length;
                return n === payRows.length ? { tone: 'ok' as const, text: 'All Attached' } : { tone: 'muted' as const, text: `${n} of ${payRows.length} Attached` };
              })()} open={isOpen('payapps', !payRows[0] || !payFiles(payRows[0]).length)} onToggle={() => toggle('payapps', !payRows[0] || !payFiles(payRows[0]).length)}
              summary={`${payRows.filter((r) => payFiles(r).length).length} of ${payRows.length} attached`}>
          <p className="text-xs text-gray-600">The GC's pay application and each sub's, as backup. Vendors come from the conditional waivers below. Drop a file on its row.</p>
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b bg-gray-50">
                <th className="px-2 py-1.5">Vendor</th><th className="px-2 py-1.5 w-16">GC / Sub</th>
                <th className="px-2 py-1.5 w-36 text-right" title="Current Payment Due on the vendor's own pay application (G702 line 8)">Payment Due (Line 8)</th>
                <th className="px-2 py-1.5 w-28 text-right">Conditional</th><th className="px-2 py-1.5 w-28">Check</th>
                <th className="px-2 py-1.5">Pay Application (Drop It on the Row)</th>
              </tr></thead>
              <tbody>
                {payRows.map((r, i) => {
                  const key = `pa${i}`; const mine = payFiles(r);
                  const extra = { docType: r.party === 'gc' ? 'g702' : 'sub_pay_app', vendor: r.vendor };
                  return (
                    <tr key={key} {...dz(key, extra)} className={`border-b last:border-0 ${drag === key ? 'bg-blue-100' : ''}`}>
                      <td className="px-2 py-1.5">{r.vendor}</td>
                      <td className="px-2"><span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${r.party === 'gc' ? 'text-blue-800 bg-blue-100' : 'text-gray-700 bg-gray-100'}`}>{r.party === 'gc' ? 'GC' : 'Sub'}</span></td>
                      {(() => {
                        const v = payCheck(r);
                        return (<>
                          <td className="px-1 py-1 text-right tabular-nums">
                            {r.party === 'gc' && v.cond
                              ? (() => {
                                  const d = dueOf(app.id);
                                  const fallback = d.source === 'typed' ? (app.contractorG702 as any)?.currentPaymentDue ?? app.g702.currentPaymentDue : d.due;
                                  return (<>
                                    {/* Type what their G702 says; clear it to go back to theirs / ours. */}
                                    <OptMoney key={`gc-${v.cond.id}-${v.cond.payAppDue ?? 'x'}-${d.due}`} value={d.due} label={`${r.vendor} payment due`}
                                              onSave={(n) => {
                                                // Same as the G702 figure it already showed: nothing to save. Cleared: back to theirs / ours.
                                                if (n != null && v.cond!.payAppDue == null && fallback != null && Math.abs(n - fallback) < 0.005) return;
                                                call(() => apiRequest(`/api/cost-waivers/${v.cond!.id}`, 'PATCH', { payAppDue: n }));
                                              }} />
                                    <div className="text-[10px] text-gray-500">{d.source === 'typed' ? 'As entered' : d.source === 'contractor' ? "From the GC's G702" : 'Calculated from this pay app (work less retainage) — type theirs to change'}</div>
                                  </>);
                                })()
                              : r.party === 'gc'
                              ? <span title="Add the GC's conditional to type over it">{money(v.due ?? 0)}<div className="text-[10px] text-gray-500">Calculated</div></span>
                              : v.cond ? <OptMoney value={v.cond.payAppDue ?? null} label={`${r.vendor} payment due`} onSave={(n) => call(() => apiRequest(`/api/cost-waivers/${v.cond!.id}`, 'PATCH', { payAppDue: n }))} />
                              : <span className="text-gray-400 text-xs">Add the conditional</span>}
                          </td>
                          <td className="px-2 text-right tabular-nums">{v.cond ? money(v.cond.amount) : '—'}</td>
                          <td className="px-2 text-xs whitespace-nowrap">
                            {v.diff == null ? <span className="text-gray-400">—</span>
                              : Math.abs(v.diff) < 0.01 ? <span className="text-green-700 font-medium">Matches</span>
                              : <span className="text-amber-700 font-medium" title={v.diff > 0 ? 'Pay app is more than the conditional' : 'Pay app is less than the conditional'}>Off by {money(Math.abs(v.diff))}</span>}
                          </td>
                        </>);
                      })()}
                      <td className="px-2 py-1 text-xs">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {mine.map((d) => (
                            <span key={d.id} className="inline-flex items-center gap-1">
                              <button className="text-blue-700 hover:underline inline-flex items-center gap-1 text-left break-all" onClick={() => openDocument(d.id)}><Paperclip className="h-3 w-3 flex-shrink-0" />{short(d.originalName)}</button>
                              <button className="text-gray-400 hover:text-red-700" title="Not this vendor's pay app — move it back to Files"
                                      onClick={() => call(() => apiRequest(`/api/cost-documents/${d.id}`, 'PATCH', { docType: 'other', vendor: null }), 'Moved to Files')}><X className="h-3 w-3" /></button>
                            </span>
                          ))}
                          <label className="text-gray-500 hover:text-blue-700 cursor-pointer inline-flex items-center gap-1">
                            <Paperclip className="h-3 w-3" /> {mine.length ? 'Add Another' : 'Attach or Drop'}
                            <input type="file" multiple className="hidden" onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ''; if (list.length) call(async () => { for (const f of list) await upload(f, extra); }, 'Pay App Saved'); }} />
                          </label>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {(() => {
                // Subs together: their pay apps against their conditionals.
                const subs = payRows.filter((r) => r.party === 'sub').map(payCheck).filter((v) => v.cond);
                if (!subs.length) return null;
                const due = subs.reduce((t, v) => t + (v.due ?? 0), 0), cond = subs.reduce((t, v) => t + v.cond!.amount, 0);
                const typed = subs.filter((v) => v.due != null).length;
                const diff = Math.round((due - cond) * 100) / 100;
                return (
                  <tfoot className="border-t-2 border-gray-300 bg-gray-50/70"><tr className="font-medium">
                    <td colSpan={2} className="px-2 py-1.5 text-gray-700">Subcontractors ({subs.length}){typed < subs.length ? <span className="text-[11px] font-normal text-gray-500"> · {typed} of {subs.length} entered</span> : null}</td>
                    <td className="px-2 text-right tabular-nums">{money(due)}</td><td className="px-2 text-right tabular-nums">{money(cond)}</td>
                    <td className="px-2 text-xs">{typed < subs.length ? '' : Math.abs(diff) < 0.01 ? <span className="text-green-700">Matches</span> : <span className="text-amber-700">Off by {money(Math.abs(diff))}</span>}</td><td />
                  </tr></tfoot>
                );
              })()}
            </table>
          </div>
        </Fold>

        {/* Change orders approved on this pay app — their executed copies go in the package. */}
        {cosHere.length > 0 && (
          <Fold title={`Change Orders — Approved on ${label} ${nn(app.docNumber)}`}
                badge={cosHere.every((r) => r.executed) ? { tone: 'ok', text: 'All Executed' } : { tone: 'warn', text: `${cosHere.filter((r) => !r.executed).length} Not Executed` }}
                open={isOpen('cos', cosHere.some((r) => !r.executed))} onToggle={() => toggle('cos', cosHere.some((r) => !r.executed))}
                summary={`${cosHere.length} change order${cosHere.length === 1 ? '' : 's'} · ${money(cosHere.reduce((t, r) => t + r.amount, 0))}`}>
            <p className="text-xs text-gray-600">The change orders this pay app's G702 carries as approved this period. Attach each signed copy — here or on the Contracts tab.</p>
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b bg-gray-50">
                  <th className="px-2 py-1.5">Change Order</th><th className="px-2 py-1.5 w-36 text-right">Amount</th><th className="px-2 py-1.5">Executed Copy (Drop It on the Row)</th>
                </tr></thead>
                <tbody>
                  {cosHere.map((r) => {
                    const key = `co${r.id}`;
                    const addCo = (list: File[]) => call(async () => {
                      for (const f of list) {
                        const fd = new FormData();
                        fd.append('file', f); fd.append('contractId', String(r.contractId)); fd.append('changeOrderId', String(r.id));
                        await apiRequest(`/api/cost-projects/${projectId}/documents`, 'POST', fd, 120_000);
                      }
                    }, `${r.number}: Executed Copy Saved`);
                    return (
                      <tr key={key} className={`border-b last:border-0 ${drag === key ? 'bg-blue-100' : !r.executed ? 'bg-amber-50/60' : ''}`}
                          onDragOver={(e) => { if (isFileDrag(e)) { e.preventDefault(); e.stopPropagation(); setDrag(key); } }}
                          onDragLeave={() => setDrag((d) => (d === key ? null : d))}
                          onDrop={(e) => { if (!isFileDrag(e)) return; e.preventDefault(); e.stopPropagation(); setDrag(null); addCo(Array.from(e.dataTransfer.files)); }}>
                        <td className="px-2 py-1.5">{r.number}{r.title ? <span className="text-gray-600"> — {r.title}</span> : null}</td>
                        <td className="px-2 text-right tabular-nums">{money(r.amount)}</td>
                        <td className="px-2 py-1 text-xs">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {r.executed ? <span className="text-[10px] font-semibold text-green-800 bg-green-100 rounded px-1">Executed</span> : <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 rounded px-1">Not Executed</span>}
                            {r.files.map((f) => (
                              <button key={f.id} className="text-blue-700 hover:underline inline-flex items-center gap-1 text-left break-all" onClick={() => openDocument(f.id)}><Paperclip className="h-3 w-3 flex-shrink-0" />{short(f.originalName)}</button>
                            ))}
                            <label className="text-gray-500 hover:text-blue-700 cursor-pointer inline-flex items-center gap-1">
                              <Paperclip className="h-3 w-3" /> {r.files.length ? 'Add Another' : 'Attach or Drop'}
                              <input type="file" multiple className="hidden" onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ''; if (l.length) addCo(l); }} />
                            </label>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Fold>
        )}

        {/* Conditional waivers for this pay app */}
        <Fold title={`Conditional Waivers — ${label} ${nn(app.docNumber)}`}
              badge={condOut ? { tone: 'bad', text: `${condOut} Outstanding` } : ck.conditionals.length ? { tone: 'ok', text: 'Compliant' } : null} open={isOpen('cond', condOpen)} onToggle={() => toggle('cond', condOpen)}
              summary={condSummary}
              action={!newC && <Button size="sm" variant="outline" className="h-7" onClick={() => { setNewC({ vendor: '', amount: '' }); setFolds((f) => ({ ...f, cond: true })); }}><Plus className="h-3.5 w-3.5 mr-1" /> Conditional</Button>}>
          <p className="text-xs text-gray-600">One per vendor being paid from this pay app — the GC and each sub. Drag <GripVertical className="h-3 w-3 inline -mt-0.5" /> to reorder. Next pay app, the app expects an unconditional from each of them.</p>
          <WaiverTable footer={ck.conditionals.length ? <TotalsRows t={waiverTotals(ck.conditionals, gcName)} gcName={gcName} check={{ label: `${label} ${nn(app.docNumber)} Payment Due (G702 Line 8)`, amount: dueOf(app.id).due ?? app.g702.currentPaymentDue }} /> : null}>
            {conds.filter((w) => !notBilling(w)).map((w) => {
              const key = `c${w.id}`;
              return (
                <tr key={w.id} {...rowDnd('conditional', key, dz(key, { docType: 'conditional', waiverId: String(w.id) }))}
                    className={`border-b last:border-0 ${dropLine('conditional', key)} ${drag === key ? 'bg-blue-100' : w.notNeeded ? 'opacity-50' : ''}`}>
                  {grip(key)}
                  <td className="px-1 py-1"><Input className="h-8" defaultValue={w.vendor} aria-label="Vendor" list={vendorListId} autoComplete="off"
                         onBlur={(e) => e.target.value.trim() && e.target.value !== w.vendor && call(() => apiRequest(`/api/cost-waivers/${w.id}`, 'PATCH', { vendor: e.target.value }))} />
                    {!w.notNeeded && <AnswerLine w={w} />}</td>
                  <td className="px-1"><PartyPill row={w} gcName={gcName} onSet={(p) => call(() => apiRequest(`/api/cost-waivers/${w.id}`, 'PATCH', { party: p }))} /></td>
                  <td className="px-1 py-1"><BlurMoney value={w.amount} onSave={(v) => call(() => apiRequest(`/api/cost-waivers/${w.id}`, 'PATCH', { amount: v }))} /></td>
                  <td className="px-2 text-center"><input type="checkbox" className="h-4 w-4 accent-green-600" checked={w.received}
                         onChange={(e) => call(() => apiRequest(`/api/cost-waivers/${w.id}`, 'PATCH', { received: e.target.checked }))} /></td>
                  <td className="px-2 text-xs"><FileCell name={docName(w.documentId)} id={w.documentId}
                         onPick={(f) => call(() => upload(f, { docType: 'conditional', waiverId: String(w.id) }), 'Waiver Saved')}
                         onUnlink={() => call(() => apiRequest(`/api/cost-waivers/${w.id}`, 'PATCH', { documentId: null }), 'Unlinked — the file is back in Files')} /></td>
                  <td className="px-2 text-center"><input type="checkbox" className="h-4 w-4" checked={w.notNeeded} title="Not needed"
                         onChange={(e) => call(() => apiRequest(`/api/cost-waivers/${w.id}`, 'PATCH', { notNeeded: e.target.checked }))} /></td>
                  <td className="px-1 text-center"><button className="p-1 text-gray-400 hover:text-red-700" title="Remove"
                         onClick={() => { if (window.confirm(`Remove ${w.vendor}'s conditional?`)) call(() => apiRequest(`/api/cost-waivers/${w.id}`, 'DELETE')); }}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              );
            })}
            {conds.some(notBilling) && (
              <tr className="border-b bg-gray-50/70">
                <td />
                <td colSpan={7} className="px-2 py-1.5 text-xs text-gray-600">
                  <span className="font-medium text-gray-700">Not Billing This Pay App:</span>{' '}
                  {conds.filter(notBilling).map((w, i) => (
                    <span key={w.id}>{i > 0 && ', '}{w.vendor}{' '}
                      <button className="text-blue-700 hover:underline" title={`${w.vendor} is billing after all — put them back on the list`}
                              onClick={() => call(() => apiRequest(`/api/cost-waivers/${w.id}`, 'DELETE'), `${w.vendor} back on the list`)}>(Undo)</button>
                    </span>
                  ))}
                </td>
              </tr>
            )}
            {carried.length > 0 && (
              <tr className="border-b">
                <td />
                <td colSpan={7} className="px-2 py-1.5 text-xs text-gray-600">
                  <span className="text-gray-500">Also on {prevLabel}:</span>{' '}
                  {carried.map((c, i) => (
                    <span key={c.vendor}>{i > 0 && ' · '}{c.vendor}{' '}
                      <button className="text-blue-700 hover:underline" onClick={() => { setNewC({ vendor: c.vendor, amount: '' }); setFolds((f) => ({ ...f, cond: true })); }}>(Add)</button>
                    </span>
                  ))}
                  <span className="text-gray-400"> — only if they're billing this pay app</span>
                </td>
              </tr>
            )}
            {ck.missing.map((m) => (
              <MissingRow key={`m${m.vendor}`} m={m} busy={busy} start={m.party === 'gc' ? dueOf(app.id).due : null}
                          onAdd={(amount) => call(() => apiRequest(`/api/cost-applications/${app.id}/waivers`, 'POST', { kind: 'conditional', vendor: m.vendor, amount, party: m.party === 'gc' && !isGcVendor(m.vendor, gcName) ? 'gc' : undefined }), 'Conditional added')}
                          onSkip={() => call(() => apiRequest(`/api/cost-applications/${app.id}/waivers`, 'POST', { kind: 'conditional', vendor: m.vendor, amount: 0, received: false, notNeeded: true }), `${m.vendor}: not this pay app`)} />
            ))}
            {newC && (
              <tr className="border-t bg-blue-50/40">
                <td />
                <td className="px-1 py-1"><Input autoFocus className="h-8" value={newC.vendor} aria-label="Vendor" list={vendorListId} autoComplete="off" onChange={(e) => setNewC({ ...newC, vendor: e.target.value })} />
                  <UseKnown typed={newC.vendor} known={vendors} onUse={(v) => setNewC({ ...newC, vendor: v })} /></td>
                <td className="px-1 text-[11px] text-gray-500">{newC.vendor.trim() ? (isGcVendor(newC.vendor, gcName) ? 'GC' : 'Sub') : ''}</td>
                <td className="px-1 py-1"><MoneyInput className="h-8" value={newC.amount} aria-label="Amount" onValueChange={(v) => setNewC({ ...newC, amount: v })} /></td>
                <td colSpan={4} className="px-2">
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => setNewC(null)}>Cancel</Button>
                    <Button size="sm" className="h-7" disabled={!newC.vendor.trim() || busy}
                            onClick={async () => { if (await call(() => apiRequest(`/api/cost-applications/${app.id}/waivers`, 'POST', { kind: 'conditional', vendor: newC.vendor, amount: newC.amount.replace(/,/g, '') }), 'Conditional added')) setNewC({ vendor: '', amount: '' }); }}>
                      Add
                    </Button>
                  </div>
                </td>
              </tr>
            )}
            {!ck.conditionals.length && !ck.missing.length && !newC && <tr><td colSpan={8} className="px-3 py-2 text-sm text-gray-500">None yet.</td></tr>}
          </WaiverTable>
        </Fold>

        {/* Unconditional waivers for the pay app before */}
        <Fold title={`Unconditional Waivers${prevLabel ? ` — For ${prevLabel}` : ''}`}
              badge={uncondOut ? { tone: 'bad', text: `${uncondOut} Outstanding` } : uncondWait ? { tone: 'warn', text: `${uncondWait} Pending Funding` } : unconds.length ? { tone: 'ok', text: 'Compliant' } : null} open={isOpen('uncond', uncondOpen)} onToggle={() => toggle('uncond', uncondOpen)}
              summary={uncondSummary}
              action={!newU && <Button size="sm" variant="outline" className="h-7" onClick={() => { setNewU({ vendor: '', amount: '' }); setFolds((f) => ({ ...f, uncond: true })); }}><Plus className="h-3.5 w-3.5 mr-1" /> Unconditional</Button>}>
          <p className="text-xs text-gray-600">
            {prevLabel ? `Expected from every vendor that gave a conditional on ${prevLabel}, for the same amount, in the same order. Type over anything that's different — it's marked Edited.` : 'This is the first pay app on the contract, so none are expected yet.'}
          </p>
          <WaiverTable footer={ck.unconditionals.length ? <TotalsRows t={waiverTotals(ck.unconditionals, gcName)} gcName={gcName} check={prevApp ? { label: `${prevLabel} Payment Due (G702 Line 8)`, amount: dueOf(prevApp.id).due ?? prevApp.g702.currentPaymentDue } : undefined} /> : null}>
            {unconds.map((r) => {
              const key = uKey(r);
              return (
                <tr key={key} className={`border-b last:border-0 ${dropLine('unconditional', key)} ${drag === key ? 'bg-blue-100' : r.notNeeded ? 'opacity-50' : !r.received ? (awaitingRow(r) ? 'bg-amber-50/70' : 'bg-red-50/40') : ''}`}
                    {...rowDnd('unconditional', key, {
                      onDragOver: (e: React.DragEvent) => { if (isFileDrag(e)) { e.preventDefault(); e.stopPropagation(); setDrag(key); } },
                      onDragLeave: () => setDrag((d) => (d === key ? null : d)),
                      onDrop: (e: React.DragEvent) => {
                        if (!isFileDrag(e)) return; e.preventDefault(); e.stopPropagation(); setDrag(null);
                        const f = e.dataTransfer.files[0]; if (f) call(() => uploadToU(r, f), 'Waiver saved');
                      },
                    })}>
                  {grip(key, true)}
                  <td className="px-1 py-1">
                    <Input className="h-8" defaultValue={r.vendor} key={`${key}-${r.vendor}`} aria-label="Vendor" list={vendorListId} autoComplete="off"
                           onBlur={(e) => e.target.value.trim() && e.target.value !== r.vendor && saveU(r, { vendor: e.target.value })} />
                    <div className="text-[10px] mt-0.5">
                      {r.source === 'expected' ? <span className="text-gray-500">Expected from {prevLabel}</span> : <span className="text-gray-500">Added</span>}
                      {awaitingRow(r) && <span className="ml-1 font-semibold text-amber-800 bg-amber-100 rounded px-1">Pending Funding — {fundingNote(ck.previous!.docNumber || ck.previous!.number, prevPaid!, partyOf(r, gcName), r.expectedAmount)}</span>}
                      {(() => {
                        // Entered on the pay app it releases: it belongs with the next one, answering this one's conditional.
                        const c = r.source === 'added' && r.id && nextRef ? conds.find((x) => sameVendor(x.vendor, r.vendor)) : null;
                        const before = ck.previous && bundle.waivers.some((x) => x.applicationId === ck.previous!.id && x.kind === 'conditional' && sameVendor(x.vendor, r.vendor));
                        if (!c || before) return null;
                        return (
                          <span className="block mt-0.5 text-amber-800">
                            Looks like the release for this pay app's conditional — it belongs with {nextLabel}.{' '}
                            <button className="text-blue-700 hover:underline font-medium" onClick={() => call(() => apiRequest(`/api/cost-waivers/${r.id}`, 'PATCH', { applicationId: nextRef!.id, fromWaiverId: c.id }), `Moved to ${nextLabel}`)}>Move to {nextLabel}</button>
                          </span>
                        );
                      })()}
                      {r.edited && <span className="ml-1 font-semibold text-amber-800 bg-amber-100 rounded px-1" title={`Expected: ${r.expectedVendor} ${money(r.expectedAmount ?? 0)}`}>Edited — Expected {r.expectedVendor !== r.vendor ? `${r.expectedVendor} ` : ''}{money(r.expectedAmount ?? 0)}</span>}
                    </div>
                  </td>
                  <td className="px-1 align-top pt-1.5"><PartyPill row={r} gcName={gcName} onSet={(p) => saveU(r, { party: p })} /></td>
                  <td className="px-1 py-1 align-top"><BlurMoney value={r.amount} key={`${key}-${r.amount}`} onSave={(v) => saveU(r, { amount: v })} /></td>
                  <td className="px-2 text-center align-top pt-2"><input type="checkbox" className="h-4 w-4 accent-green-600" checked={r.received} onChange={(e) => saveU(r, { received: e.target.checked })} /></td>
                  <td className="px-2 text-xs align-top pt-2"><FileCell name={docName(r.documentId)} id={r.documentId} onPick={(f) => call(() => uploadToU(r, f), 'Waiver Saved')}
                         onUnlink={r.id ? () => call(() => apiRequest(`/api/cost-waivers/${r.id}`, 'PATCH', { documentId: null }), 'Unlinked — the file is back in Files') : undefined} /></td>
                  <td className="px-2 text-center align-top pt-2"><input type="checkbox" className="h-4 w-4" checked={r.notNeeded} title="Not needed" onChange={(e) => saveU(r, { notNeeded: e.target.checked })} /></td>
                  <td className="px-1 text-center align-top pt-1">
                    {r.id && (r.source === 'added' || r.edited) && (
                      <button className="p-1 text-gray-400 hover:text-red-700" title={r.source === 'added' ? 'Remove' : 'Undo the edit (back to expected)'}
                              onClick={() => call(() => apiRequest(`/api/cost-waivers/${r.id}`, 'DELETE'))}><Trash2 className="h-4 w-4" /></button>
                    )}
                  </td>
                </tr>
              );
            })}
            {newU && (
              <tr className="border-t bg-blue-50/40">
                <td />
                <td className="px-1 py-1"><Input autoFocus className="h-8" value={newU.vendor} aria-label="Vendor" list={vendorListId} autoComplete="off" onChange={(e) => setNewU({ ...newU, vendor: e.target.value })} />
                  <UseKnown typed={newU.vendor} known={vendors} onUse={(v) => setNewU({ ...newU, vendor: v })} /></td>
                <td className="px-1 text-[11px] text-gray-500">{newU.vendor.trim() ? (isGcVendor(newU.vendor, gcName) ? 'GC' : 'Sub') : ''}</td>
                <td className="px-1 py-1"><MoneyInput className="h-8" value={newU.amount} aria-label="Amount" onValueChange={(v) => setNewU({ ...newU, amount: v })} /></td>
                <td colSpan={4} className="px-2">
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => setNewU(null)}>Cancel</Button>
                    <Button size="sm" className="h-7" disabled={!newU.vendor.trim() || busy}
                            onClick={async () => { if (await call(() => apiRequest(`/api/cost-applications/${app.id}/waivers`, 'POST', { kind: 'unconditional', vendor: newU.vendor, amount: newU.amount.replace(/,/g, ''), received: true }), 'Unconditional added')) setNewU(null); }}>
                      Add
                    </Button>
                  </div>
                </td>
              </tr>
            )}
            {!ck.unconditionals.length && !newU && <tr><td colSpan={8} className="px-3 py-2 text-sm text-gray-500">None expected.</td></tr>}
          </WaiverTable>
        </Fold>

        {/* Anything still owed from pay apps before the last one */}
        {earlier.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-red-700">Still Outstanding from Earlier Pay Apps ({earlier.length})</h3>
            <p className="text-xs text-gray-600">Waivers owed on pay apps before {prevLabel}. Tick them off here as they come in.</p>
            <div className="border border-red-200 rounded-md overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b bg-red-50/60">
                  <th className="px-2 py-1.5">Pay App</th><th className="px-2 py-1.5">Vendor</th><th className="px-2 py-1.5 text-right">Amount</th>
                  <th className="px-2 py-1.5">Missing</th><th className="px-2 py-1.5 w-20 text-center">Received</th><th className="px-2 py-1.5">File</th><th className="px-2 py-1.5 w-24" />
                </tr></thead>
                <tbody>
                  {earlier.map((r) => (
                    <tr key={`${r.appId}-${r.conditionalId ?? r.vendor}-${r.status}`} className="border-b last:border-0">
                      <td className="px-2 py-1.5 whitespace-nowrap">Pay App {nn(r.appNumber)}</td>
                      <td className="px-2 py-1.5">{r.vendor}{r.party === 'gc' && <span className="ml-1 text-[10px] font-semibold text-blue-800 bg-blue-100 rounded px-1">GC</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.status === 'conditional missing' ? (r.conditionalAmount ? <span className="text-gray-500">last {money(r.conditionalAmount)}</span> : '—') : money(r.unconditionalAmount ?? r.conditionalAmount)}</td>
                      <td className="px-2 py-1.5 text-red-700 text-xs">
                        {r.status === 'unconditional outstanding' ? `Unconditional (due with Pay App ${nn(r.unconditionalDueWith ?? 0)})` : r.status === 'conditional outstanding' ? 'Conditional not received' : 'Conditional never entered'}
                      </td>
                      <td className="px-2 text-center">
                        {r.status !== 'conditional missing' && <input type="checkbox" className="h-4 w-4 accent-green-600" checked={false} onChange={() => markEarlier(r, { received: true })} />}
                      </td>
                      <td className="px-2 text-xs">
                        {r.status === 'unconditional outstanding' && r.unconditionalAppId && (
                          <FileCell name={undefined} id={null} onPick={(f) => call(async () => { const wid = await ensureEarlierU(r); await upload(f, { docType: 'unconditional', waiverId: String(wid) }, r.unconditionalAppId!); }, 'Waiver saved')} />
                        )}
                        {r.status === 'conditional outstanding' && r.conditionalId && (
                          <FileCell name={undefined} id={null} onPick={(f) => call(() => upload(f, { docType: 'conditional', waiverId: String(r.conditionalId) }, r.appId), 'Waiver saved')} />
                        )}
                      </td>
                      <td className="px-2 text-right">
                        <button className="text-xs text-gray-500 hover:text-gray-900 hover:underline" onClick={() => markEarlier(r, { notNeeded: true })}>Not Needed</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WaiverTable({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="border rounded-md overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b bg-gray-50">
            <th className="w-6" /><th className="px-2 py-1.5">Vendor</th><th className="px-2 py-1.5 w-16">GC / Sub</th><th className="px-2 py-1.5 w-40 text-right">Amount</th>
            <th className="px-2 py-1.5 w-20 text-center">Received</th><th className="px-2 py-1.5">File (Drop It on the Row)</th>
            <th className="px-2 py-1.5 w-20 text-center">Not Needed</th><th className="w-9" />
          </tr>
        </thead>
        <tbody>{children}</tbody>
        {footer && <tfoot className="border-t-2 border-gray-300 bg-gray-50/70">{footer}</tfoot>}
      </table>
    </div>
  );
}

/** GC or sub: worked out from the contract's name until set by hand. Click to switch. */
function PartyPill({ row, gcName, onSet }: { row: { vendor: string; party?: WaiverParty | null }; gcName: string; onSet: (p: WaiverParty | null) => void }) {
  const p = partyOf(row, gcName);
  const auto = isGcVendor(row.vendor, gcName) ? 'gc' : 'sub';
  return (
    <button type="button" onClick={() => { const next: WaiverParty = p === 'gc' ? 'sub' : 'gc'; onSet(next === auto ? null : next); }}
            title={`${p === 'gc' ? 'The general contractor' : 'A subcontractor or supplier'}${row.party ? ' — set by hand' : ' — from the contract name'}. Click to switch.`}
            className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${p === 'gc' ? 'text-blue-800 bg-blue-100' : 'text-gray-700 bg-gray-100'} ${row.party ? 'ring-1 ring-amber-400' : ''}`}>
      {p === 'gc' ? 'GC' : 'Sub'}
    </button>
  );
}

/** Subs, GC and the gap between them; and the GC's release against the G702. */
function TotalsRows({ t, gcName, check }: { t: WaiverTotals; gcName: string; check?: { label: string; amount: number } }) {
  const row = (label: React.ReactNode, amount: number, note?: React.ReactNode, strong?: boolean) => (
    <tr className={strong ? 'font-semibold' : ''}>
      <td /><td colSpan={2} className="px-2 py-1 text-gray-700">{label}</td>
      <td className="px-2 py-1 text-right tabular-nums">{money(amount)}</td>
      <td colSpan={4} className="px-2 py-1 text-xs text-gray-600">{note}</td>
    </tr>
  );
  const diff = check ? Math.round((t.gc - check.amount) * 100) / 100 : 0;
  return (
    <>
      {row(`Subcontractors (${t.subCount})`, t.subs)}
      {row(<span title={gcName}>GC{t.gcCount > 1 ? ` (${t.gcCount} releases)` : ''}</span>, t.gc, !t.gcCount ? <span className="text-red-700">No GC release</span> : null)}
      {t.gcCount > 0 && row('GC Less Subs', t.gap,
        <>{t.gapPct != null && <span className="tabular-nums">{t.gapPct.toFixed(1)}% of the GC's release — </span>}the GC's own work, fee and general conditions, or sub releases not in yet{t.gap < -0.005 ? <span className="text-red-700 font-medium"> · subs exceed the GC's release</span> : null}</>, true)}
      {check && t.gcCount > 0 && row(check.label, check.amount,
        Math.abs(diff) < 0.01 ? <span className="text-green-700 font-medium">GC release matches</span> : <span className="text-amber-700 font-medium">GC release is {money(Math.abs(diff))} {diff > 0 ? 'more' : 'less'}</span>)}
    </>
  );
}

/** A conditional this pay app should have and doesn't. */
function MissingRow({ m, busy, start, onAdd, onSkip }: { m: MissingConditional; busy: boolean; start: number | null; onAdd: (amount: string) => void; onSkip: () => void }) {
  // The GC's starts at this pay app's payment due; a sub's is typed from their waiver.
  const [amount, setAmount] = useState(start != null && start > 0 ? fmtMoneyText(start.toFixed(2)) : '');
  return (
    <tr className="border-b last:border-0 bg-red-50/60">
      <td />
      <td className="px-2 py-1.5">
        <div className="text-gray-900">{m.vendor}</div>
        <div className="text-[10px] text-red-700 font-medium">Missing — {m.why === 'gc' ? 'the GC gives one with every pay app' : `was on the previous pay app${m.lastAmount != null ? ` (${money(m.lastAmount)})` : ''}`}</div>
      </td>
      <td className="px-1"><span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${m.party === 'gc' ? 'text-blue-800 bg-blue-100' : 'text-gray-700 bg-gray-100'}`}>{m.party === 'gc' ? 'GC' : 'Sub'}</span></td>
      <td className="px-1 py-1"><MoneyInput className="h-8" value={amount} aria-label={`${m.vendor} amount`} onValueChange={setAmount} /></td>
      <td colSpan={4} className="px-2">
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" className="h-7 text-gray-600" disabled={busy} onClick={onSkip} title="They aren't being paid on this pay app">Not This Pay App</Button>
          <Button size="sm" className="h-7" disabled={busy} onClick={() => onAdd(amount.replace(/[$,\s]/g, ''))}>Add</Button>
        </div>
      </td>
    </tr>
  );
}

/** "Use Nova Construction Management, LLC" — when what's typed is close to a name already on the project. */
function UseKnown({ typed, known, onUse }: { typed: string; known: readonly string[]; onUse: (v: string) => void }) {
  const near = closeVendor(typed, known);
  if (!near) return null;
  return (
    <button type="button" className="mt-0.5 text-[11px] text-blue-700 hover:underline text-left" onClick={() => onUse(near)}>
      Use “{near}” (already on this project)
    </button>
  );
}

/** A section that rolls up to one line: title, a summary while closed, and its action button. */
type Badge = { tone: 'ok' | 'bad' | 'warn' | 'muted'; text: string };
const BADGE: Record<Badge['tone'], string> = {
  ok: 'text-green-800 bg-green-100', bad: 'text-red-800 bg-red-100', warn: 'text-amber-800 bg-amber-100', muted: 'text-gray-600 bg-gray-100',
};
function Fold({ title, badge, summary, open, onToggle, action, children }: { title: string; badge?: Badge | null; summary?: React.ReactNode; open: boolean; onToggle: () => void; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="flex items-center gap-1.5 min-w-0 flex-1 text-left" onClick={onToggle} aria-expanded={open}>
          <ChevronRight className={`h-4 w-4 flex-shrink-0 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`} />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">{title}</h3>
          {badge && <span className={`ml-1 text-[10px] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap ${BADGE[badge.tone]}`}>{badge.text}</span>}
          {!open && summary && <span className="block min-w-0 text-xs text-gray-600 ml-2 truncate normal-case" title={typeof summary === 'string' ? summary : undefined}>{summary}</span>}
        </button>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {open && children}
    </section>
  );
}

/** A money box that may be left blank (not entered yet); saves when you leave it. */
function OptMoney({ value, label, onSave }: { value: number | null; label: string; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value == null ? '' : fmtMoneyText(String(value)));
  return <MoneyInput className="h-8 text-right" value={v} aria-label={label} onValueChange={setV}
                     onBlur={(e) => {
                       const t = e.target.value.replace(/[$,\s]/g, '');
                       const n = t === '' ? null : parseFloat(t) || 0;
                       if (n === null ? value !== null : value === null || Math.abs(n - value) >= 0.005) onSave(n);
                     }} />;
}

/** A money box that saves when you leave it. */
function BlurMoney({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(fmtMoneyText(String(value)));
  return <MoneyInput className="h-8" value={v} aria-label="Amount" onValueChange={setV}
                     onBlur={(e) => { const n = parseFloat(e.target.value.replace(/[$,\s]/g, '')) || 0; if (Math.abs(n - value) >= 0.005) onSave(n); }} />;
}

const short = (name: string) => (name.length > 34 ? `${name.slice(0, 32)}…` : name);

/** A waiver's file: open it, replace it (the old one goes back to Files), or unlink it. */
function FileCell({ name, id, onPick, onUnlink }: { name?: string; id: number | null; onPick: (f: File) => void; onUnlink?: () => void }) {
  return id && name ? (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <button className="text-blue-700 hover:underline inline-flex items-center gap-1 text-left break-all" onClick={() => openDocument(id)}>
        <Paperclip className="h-3 w-3 flex-shrink-0" />{short(name)}
      </button>
      <label className="text-gray-500 hover:text-blue-700 cursor-pointer" title="Replace with another file (this one goes back to Files)">
        <RefreshCw className="h-3 w-3 inline" />
        <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
      </label>
      {onUnlink && <button className="text-gray-400 hover:text-red-700" title="Wrong file — unlink it (it goes back to Files)" onClick={onUnlink}><X className="h-3 w-3" /></button>}
    </span>
  ) : (
    <label className="text-gray-500 hover:text-blue-700 cursor-pointer inline-flex items-center gap-1">
      <Paperclip className="h-3 w-3" /> Attach or Drop
      <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
    </label>
  );
}
