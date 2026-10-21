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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Download, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import { waiverChecklist, DOC_TYPES, type UnconditionalRow } from '@shared/cost-waivers';
import { fmtMoneyText } from '@shared/format';
import { MoneyInput } from './inputs';
import { openDocument } from './contract-card';
import { money, projectKey, type ProjectBundle, type ApplicationRow, type ContractRow } from './types';

const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
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
  const ck = useMemo(() => (app ? waiverChecklist(app.id, apps, bundle.waivers) : null), [app?.id, apps, bundle.waivers]);
  const files = app ? bundle.documents.filter((d) => d.applicationId === app.id) : [];
  const docName = (id: number | null) => bundle.documents.find((d) => d.id === id)?.originalName;

  const call = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true);
    try { await fn(); refresh(); if (ok) toast({ title: ok }); return true; }
    catch (e: any) { toast({ title: 'Not saved', description: e?.message, variant: 'destructive' }); refresh(); return false; }
    finally { setBusy(false); }
  };
  const upload = (file: File, extra: Record<string, string>) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('applicationId', String(app!.id));
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

  const download = async () => {
    const { AUTH_TOKEN_KEY } = await import('@/lib/auth-constants');
    const res = await fetch(`/api/cost-applications/${app!.id}/package`, { headers: { Authorization: `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` } });
    if (!res.ok) { toast({ title: 'No package', description: (await res.json().catch(() => ({})))?.message, variant: 'destructive' }); return; }
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'package.zip';
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  if (!target || !app || !ck) return null;
  const prevLabel = ck.previous ? `Pay App ${nn(ck.previous.docNumber || ck.previous.number)}` : null;

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="pm-scope sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{target.contract.counterparty} — {label} {nn(app.docNumber)} package</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap -mt-2">
          <p className="text-xs text-gray-600">
            {ck.outstanding ? <span className="text-red-700 font-medium">{ck.outstanding} waiver{ck.outstanding === 1 ? '' : 's'} outstanding.</span> : <span className="text-green-700 font-medium">All waivers in.</span>}
            {' '}Download gives one zip, sorted into folders, with a contents sheet.
          </p>
          <Button onClick={download} disabled={!files.length}><Download className="h-4 w-4 mr-1" /> Download package</Button>
        </div>

        {/* Files */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Files</h3>
          <div {...dz('files', { docType: dropType })}
               className={`border-2 border-dashed rounded-md px-3 py-3 flex items-center gap-3 flex-wrap text-sm ${drag === 'files' ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}`}>
            <Upload className="h-4 w-4 text-gray-500" />
            <span>Drop files here as</span>
            <div className="w-56">
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
            <span className="text-xs text-gray-500">Waiver files are better dropped on their row below — they're named by vendor and amount.</span>
          </div>
          {files.length > 0 && (
            <div className="border rounded-md divide-y">
              {files.map((d) => {
                const w = bundle.waivers.find((x) => x.documentId === d.id);
                return (
                  <div key={d.id} className="px-3 py-1.5 flex items-center gap-3 text-sm">
                    <button className="text-blue-700 hover:underline text-left break-all flex-1" onClick={() => openDocument(d.id)}>{d.originalName}</button>
                    {w ? (
                      <span className="text-xs text-gray-600 whitespace-nowrap">{w.kind === 'conditional' ? 'Conditional' : 'Unconditional'} · {w.vendor}</span>
                    ) : (
                      <div className="w-48">
                        <Select value={d.docType || 'g702'} onValueChange={(v) => call(() => apiRequest(`/api/cost-documents/${d.id}`, 'PATCH', { docType: v }))}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent className="pm-scope">{DOC_TYPES.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                    <button className="text-gray-400 hover:text-red-700" title="Remove this file"
                            onClick={() => { if (window.confirm(`Remove ${d.originalName}?`)) call(() => apiRequest(`/api/cost-documents/${d.id}`, 'DELETE'), 'File removed'); }}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Conditional waivers for this pay app */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Conditional waivers — {label} {nn(app.docNumber)}</h3>
            {!newC && <Button size="sm" variant="outline" className="h-7" onClick={() => setNewC({ vendor: '', amount: '' })}><Plus className="h-3.5 w-3.5 mr-1" /> Conditional</Button>}
          </div>
          <p className="text-xs text-gray-600">One per vendor being paid from this pay app — the GC and each sub. Next pay app, the app expects an unconditional from each of them.</p>
          <WaiverTable>
            {ck.conditionals.map((w) => (
              <tr key={w.id} {...dz(`c${w.id}`, { docType: 'conditional', waiverId: String(w.id) })}
                  className={`border-b last:border-0 ${drag === `c${w.id}` ? 'bg-blue-100' : w.notNeeded ? 'opacity-50' : ''}`}>
                <td className="px-1 py-1"><Input className="h-8" defaultValue={w.vendor} aria-label="Vendor"
                       onBlur={(e) => e.target.value.trim() && e.target.value !== w.vendor && call(() => apiRequest(`/api/cost-waivers/${w.id}`, 'PATCH', { vendor: e.target.value }))} /></td>
                <td className="px-1 py-1"><BlurMoney value={w.amount} onSave={(v) => call(() => apiRequest(`/api/cost-waivers/${w.id}`, 'PATCH', { amount: v }))} /></td>
                <td className="px-2 text-center"><input type="checkbox" className="h-4 w-4 accent-green-600" checked={w.received}
                       onChange={(e) => call(() => apiRequest(`/api/cost-waivers/${w.id}`, 'PATCH', { received: e.target.checked }))} /></td>
                <td className="px-2 text-xs"><FileCell name={docName(w.documentId)} id={w.documentId}
                       onPick={(f) => call(() => upload(f, { docType: 'conditional', waiverId: String(w.id) }), 'Waiver saved')} /></td>
                <td className="px-2 text-center"><input type="checkbox" className="h-4 w-4" checked={w.notNeeded} title="Not needed"
                       onChange={(e) => call(() => apiRequest(`/api/cost-waivers/${w.id}`, 'PATCH', { notNeeded: e.target.checked }))} /></td>
                <td className="px-1 text-center"><button className="p-1 text-gray-400 hover:text-red-700" title="Remove"
                       onClick={() => { if (window.confirm(`Remove ${w.vendor}'s conditional?`)) call(() => apiRequest(`/api/cost-waivers/${w.id}`, 'DELETE')); }}><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}
            {newC && (
              <tr className="border-t bg-blue-50/40">
                <td className="px-1 py-1"><Input autoFocus className="h-8" value={newC.vendor} aria-label="Vendor" onChange={(e) => setNewC({ ...newC, vendor: e.target.value })} /></td>
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
            {!ck.conditionals.length && !newC && <tr><td colSpan={6} className="px-3 py-2 text-sm text-gray-500">None yet.</td></tr>}
          </WaiverTable>
        </section>

        {/* Unconditional waivers for the pay app before */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Unconditional waivers {prevLabel ? `— for ${prevLabel}` : ''}
            </h3>
            {!newU && <Button size="sm" variant="outline" className="h-7" onClick={() => setNewU({ vendor: '', amount: '' })}><Plus className="h-3.5 w-3.5 mr-1" /> Unconditional</Button>}
          </div>
          <p className="text-xs text-gray-600">
            {prevLabel ? `Expected from every vendor that gave a conditional on ${prevLabel}, for the same amount. Type over anything that's different — it's marked Edited.` : 'This is the first pay app on the contract, so none are expected yet.'}
          </p>
          <WaiverTable>
            {ck.unconditionals.map((r, i) => {
              const key = `u${r.id ?? `x${i}`}`;
              return (
                <tr key={key} className={`border-b last:border-0 ${drag === key ? 'bg-blue-100' : r.notNeeded ? 'opacity-50' : !r.received ? 'bg-red-50/40' : ''}`}
                    onDragOver={(e) => { if (isFileDrag(e)) { e.preventDefault(); e.stopPropagation(); setDrag(key); } }}
                    onDragLeave={() => setDrag((d) => (d === key ? null : d))}
                    onDrop={(e) => {
                      if (!isFileDrag(e)) return; e.preventDefault(); e.stopPropagation(); setDrag(null);
                      const f = e.dataTransfer.files[0]; if (f) call(() => uploadToU(r, f), 'Waiver saved');
                    }}>
                  <td className="px-1 py-1">
                    <Input className="h-8" defaultValue={r.vendor} key={`${key}-${r.vendor}`} aria-label="Vendor"
                           onBlur={(e) => e.target.value.trim() && e.target.value !== r.vendor && saveU(r, { vendor: e.target.value })} />
                    <div className="text-[10px] mt-0.5">
                      {r.source === 'expected' ? <span className="text-gray-500">Expected from {prevLabel}</span> : <span className="text-gray-500">Added</span>}
                      {r.edited && <span className="ml-1 font-semibold text-amber-800 bg-amber-100 rounded px-1" title={`Expected: ${r.expectedVendor} ${money(r.expectedAmount ?? 0)}`}>Edited — expected {r.expectedVendor !== r.vendor ? `${r.expectedVendor} ` : ''}{money(r.expectedAmount ?? 0)}</span>}
                    </div>
                  </td>
                  <td className="px-1 py-1 align-top"><BlurMoney value={r.amount} key={`${key}-${r.amount}`} onSave={(v) => saveU(r, { amount: v })} /></td>
                  <td className="px-2 text-center align-top pt-2"><input type="checkbox" className="h-4 w-4 accent-green-600" checked={r.received} onChange={(e) => saveU(r, { received: e.target.checked })} /></td>
                  <td className="px-2 text-xs align-top pt-2"><FileCell name={docName(r.documentId)} id={r.documentId} onPick={(f) => call(() => uploadToU(r, f), 'Waiver saved')} /></td>
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
                <td className="px-1 py-1"><Input autoFocus className="h-8" value={newU.vendor} aria-label="Vendor" onChange={(e) => setNewU({ ...newU, vendor: e.target.value })} /></td>
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
            {!ck.unconditionals.length && !newU && <tr><td colSpan={6} className="px-3 py-2 text-sm text-gray-500">None expected.</td></tr>}
          </WaiverTable>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function WaiverTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="border rounded-md overflow-x-auto">
      <table className="w-full text-sm min-w-[680px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b bg-gray-50">
            <th className="px-2 py-1.5">Vendor</th><th className="px-2 py-1.5 w-40 text-right">Amount</th>
            <th className="px-2 py-1.5 w-20 text-center">Received</th><th className="px-2 py-1.5">File (drop it on the row)</th>
            <th className="px-2 py-1.5 w-20 text-center">Not needed</th><th className="w-9" />
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** A money box that saves when you leave it. */
function BlurMoney({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(fmtMoneyText(String(value)));
  return <MoneyInput className="h-8" value={v} aria-label="Amount" onValueChange={setV}
                     onBlur={(e) => { const n = parseFloat(e.target.value.replace(/[$,\s]/g, '')) || 0; if (Math.abs(n - value) >= 0.005) onSave(n); }} />;
}

function FileCell({ name, id, onPick }: { name?: string; id: number | null; onPick: (f: File) => void }) {
  return id && name ? (
    <button className="text-blue-700 hover:underline inline-flex items-center gap-1 text-left break-all" onClick={() => openDocument(id)}>
      <Paperclip className="h-3 w-3 flex-shrink-0" />{name.length > 34 ? `${name.slice(0, 32)}…` : name}
    </button>
  ) : (
    <label className="text-gray-500 hover:text-blue-700 cursor-pointer inline-flex items-center gap-1">
      <Paperclip className="h-3 w-3" /> Attach or drop
      <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
    </label>
  );
}
