/**
 * What an Excel import will do, before it does it: every row as Add / Update / No change / Skipped
 * (with why), counts on top, and Apply. Nothing is saved until Apply.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export type Change = { kind: 'add' | 'update' | 'same' | 'skip'; label: string; detail?: string };

const TAG: Record<Change['kind'], [string, string]> = {
  add: ['Add', 'bg-green-100 text-green-800'], update: ['Update', 'bg-blue-100 text-blue-800'],
  same: ['No change', 'bg-gray-100 text-gray-600'], skip: ['Skipped', 'bg-amber-100 text-amber-900'],
};

export function ImportPreview({ title, changes, note, onApply, onClose }: {
  title: string; changes: Change[] | null; note?: string; onApply: () => Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const n = (k: Change['kind']) => (changes ?? []).filter((c) => c.kind === k).length;
  const todo = n('add') + n('update');
  return (
    <Dialog open={!!changes} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="pm-scope w-[96vw] sm:max-w-3xl max-h-[88vh] overflow-y-auto grid-cols-[minmax(0,1fr)]">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="flex gap-3 text-sm flex-wrap">
          {(['add', 'update', 'same', 'skip'] as const).map((k) => <span key={k} className={`rounded px-2 py-0.5 font-medium ${TAG[k][1]}`}>{n(k)} {TAG[k][0]}</span>)}
        </div>
        {note && <p className="text-xs text-gray-600">{note}</p>}
        <div className="border rounded-md max-h-[50vh] overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>
              {(changes ?? []).filter((c) => c.kind !== 'same').concat((changes ?? []).filter((c) => c.kind === 'same')).map((c, i) => (
                <tr key={i} className="border-b last:border-0 align-top">
                  <td className="px-2 py-1 w-24"><span className={`text-[11px] rounded px-1.5 py-0.5 font-medium ${TAG[c.kind][1]}`}>{TAG[c.kind][0]}</span></td>
                  <td className="px-2 py-1">{c.label}{c.detail && <div className="text-xs text-gray-600">{c.detail}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || todo === 0} onClick={async () => { setBusy(true); try { await onApply(); } finally { setBusy(false); } }}>
            {busy ? 'Saving…' : todo ? `Apply ${todo} Change${todo === 1 ? '' : 's'}` : 'Nothing to Change'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
