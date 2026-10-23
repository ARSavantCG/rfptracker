/**
 * Change order routing on the Contracts tab: the stage dropdown on each change
 * order, and the Routing window (who has it, received date, amount as submitted,
 * days added to the schedule, notes, and every move with its date).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Route } from 'lucide-react';
import { CO_STAGES, coRouting, needsHigherRouting, stageOf, type CoStage } from '@shared/co-routing';
import { MoneyInput } from './inputs';
import type { ChangeOrderRow } from './types';

export const STAGE_STYLE: Record<string, string> = {
  amber: 'bg-amber-50 border-amber-300 text-amber-800',
  orange: 'bg-orange-50 border-orange-300 text-orange-800',
  violet: 'bg-violet-50 border-violet-300 text-violet-800',
  blue: 'bg-blue-50 border-blue-300 text-blue-800',
  green: 'bg-green-50 border-green-300 text-green-800',
  gray: 'bg-gray-50 border-gray-300 text-gray-600',
};
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const shortD = (iso: string | null | undefined) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function CoStageControls({ co, amount, fromLines, onChanged }: { co: ChangeOrderRow; amount: number; fromLines: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const r = coRouting(co as any, amount, todayIso());
  const st = CO_STAGES.find((x) => x.key === r.stage)!;
  const move = async (stage: CoStage) => {
    try {
      await apiRequest(`/api/cost-change-orders/${co.id}`, 'PATCH', { stage });
      onChanged();
      // A heads-up, not a block: these go to the higher-level approvers first.
      if (stage === 'signatures' && r.stage === 'review' && needsHigherRouting(amount, co.daysAdded)) {
        toast({ title: 'Needs Internal Approval First?', description: `${needsHigherRouting(amount, co.daysAdded)}: these usually route through Pending Internal Approval.`, duration: 9000 });
      }
    } catch (e: any) { toast({ title: 'Not Changed', description: e?.message, variant: 'destructive' }); }
  };
  return (
    <>
      <div className="w-52 shrink-0">
        <Select value={r.stage} onValueChange={(v) => move(v as CoStage)}>
          <SelectTrigger className={`h-7 text-xs font-medium ${STAGE_STYLE[st.tone]}`}><SelectValue /></SelectTrigger>
          <SelectContent className="pm-scope">
            {CO_STAGES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <button className="inline-flex items-center gap-1 text-xs font-normal text-blue-700 hover:underline w-36 shrink-0 truncate text-left" onClick={() => setOpen(true)} title={r.with ? `With ${r.with}: who has it, dates, notes and history` : 'Who has it, dates, notes and history'}>
        <Route className="h-3.5 w-3.5" />
        {r.open ? <>{r.with ? `With ${r.with}` : 'Routing'}{r.daysInStage != null && <span className={r.daysInStage >= 30 ? 'text-red-700 font-semibold' : r.daysInStage >= 14 ? 'text-amber-700 font-semibold' : 'text-gray-500'}> · {r.daysInStage}d</span>}</> : 'Routing'}
      </button>
      {open && <RoutingDialog co={co} amount={amount} fromLines={fromLines} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}

/** "Over $250,000.00" / "Adds 45 days": shown next to the change order's name. */
export function CoHigherTag({ co, amount }: { co: ChangeOrderRow; amount: number }) {
  const why = needsHigherRouting(amount, co.daysAdded);
  return why ? <span className="text-[11px] font-semibold text-violet-800 bg-violet-50 border border-violet-200 rounded px-1.5" title="Routes to the same approvers as large change orders">{why}</span> : null;
}

function RoutingDialog({ co, amount, fromLines, onClose, onChanged }: { co: ChangeOrderRow; amount: number; fromLines: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const r = coRouting(co as any, amount, todayIso());
  const [stage, setStage] = useState<CoStage>(stageOf(co));
  const [withWho, setWith] = useState(co.routedTo ?? '');
  const [at, setAt] = useState(todayIso());
  const [note, setNote] = useState('');
  const [received, setReceived] = useState(String(co.receivedDate ?? co.createdAt ?? '').slice(0, 10));
  const [proposed, setProposed] = useState(co.proposedAmount != null ? String(co.proposedAmount) : '');
  const [days, setDays] = useState(co.daysAdded != null ? String(co.daysAdded) : '');
  const [busy, setBusy] = useState(false);
  const save = async (body: Record<string, unknown>, ok?: string) => {
    setBusy(true);
    try { await apiRequest(`/api/cost-change-orders/${co.id}`, 'PATCH', body); onChanged(); if (ok) toast({ title: ok }); }
    catch (e: any) { toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const moved = stage !== r.stage;
  const higher = needsHigherRouting(fromLines ? amount : Number(proposed.replace(/,/g, '')) || 0, days === '' ? null : Number(days));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="pm-scope max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Routing — {co.number}{co.title ? ` · ${co.title}` : ''}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <label className="space-y-1"><span className="text-xs text-gray-600">Received From Contractor</span>
            <Input type="date" className="h-9" value={received} onChange={(e) => setReceived(e.target.value)} onBlur={() => received && save({ receivedDate: received })} /></label>
          <label className="space-y-1"><span className="text-xs text-gray-600">Amount as Submitted</span>
            <MoneyInput className="h-9" value={proposed} onValueChange={setProposed} onBlur={() => save({ proposedAmount: proposed === '' ? null : Number(proposed.replace(/,/g, '')) })} /></label>
          <label className="space-y-1"><span className="text-xs text-gray-600">Days Added to Schedule</span>
            <Input className="h-9 text-right tabular-nums" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^\d]/g, ''))} onBlur={() => save({ daysAdded: days === '' ? null : Number(days) })} /></label>
        </div>
        <p className="text-xs text-gray-600">
          {fromLines ? <>Amount from its schedule of values lines: <strong>{money(amount)}</strong>. </> : null}
          {higher ? <span className="text-violet-800 font-medium">{higher}: routes through Pending Internal Approval.</span> : 'Under $250,000.00 and under 30 days added: approved locally.'}
        </p>

        <div className="border rounded-lg p-3 space-y-2">
          <div className="text-sm font-semibold">Move or Update</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="space-y-1"><span className="text-xs text-gray-600">Stage</span>
              <Select value={stage} onValueChange={(v) => setStage(v as CoStage)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent className="pm-scope">{CO_STAGES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select></label>
            <label className="space-y-1"><span className="text-xs text-gray-600">With (Who Has It)</span>
              <Input className="h-9" value={withWho} onChange={(e) => setWith(e.target.value)} /></label>
            <label className="space-y-1"><span className="text-xs text-gray-600">Date</span>
              <Input type="date" className="h-9" value={at} onChange={(e) => setAt(e.target.value)} /></label>
          </div>
          <label className="space-y-1 block"><span className="text-xs text-gray-600">Note</span>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="flex gap-2">
            <Button disabled={busy || (!moved && !note.trim() && withWho === (co.routedTo ?? ''))}
                    onClick={async () => { await save({ ...(moved ? { stage } : {}), routedTo: withWho, at, ...(note.trim() ? { note: note.trim() } : {}) }, moved ? `Moved to ${CO_STAGES.find((s) => s.key === stage)!.label}` : 'Saved'); setNote(''); }}>
              {moved ? `Move to ${CO_STAGES.find((s) => s.key === stage)!.label}` : 'Save'}
            </Button>
            <span className="text-xs text-gray-500 self-center">{CO_STAGES.find((s) => s.key === stage)!.hint}</span>
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold mb-1">History</div>
          {r.history.length === 0 ? <p className="text-xs text-gray-500">No moves recorded yet.</p> : (
            <ol className="text-sm space-y-1">
              {[...r.history].reverse().map((h, i) => {
                const s = CO_STAGES.find((x) => x.key === h.stage);
                return (
                  <li key={i} className="flex gap-2 items-start">
                    <span className="text-xs text-gray-500 w-24 shrink-0 tabular-nums">{shortD(h.at)}</span>
                    <span className={`text-[11px] font-semibold border rounded px-1.5 shrink-0 ${STAGE_STYLE[s?.tone ?? 'gray']}`}>{s?.label ?? h.stage}</span>
                    <span className="text-xs text-gray-700">{h.to ? `With ${h.to}` : ''}{h.to && h.note ? ' · ' : ''}{h.note}{h.by ? <span className="text-gray-400"> ({h.by})</span> : null}</span>
                  </li>
                );
              })}
            </ol>
          )}
          {r.received && <p className="text-xs text-gray-500 mt-2">Received {shortD(r.received)} · {r.daysOpen} day{r.daysOpen === 1 ? '' : 's'} {r.open ? 'open' : 'to close'}.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
