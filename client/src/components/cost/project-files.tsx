/**
 * Every file on the project, rolled up by what it belongs to: each pay app
 * (newest first), executed change orders, tenant change order backup,
 * direct cost receipts, contract documents, other. Each group remembers
 * whether it was left open.
 */
import { useState } from 'react';
import { ChevronRight, Trash2 } from 'lucide-react';
import type { ProjectBundle, DocumentRow } from './types';
import { openDocument } from './contract-card';

type Group = { key: string; title: string; sub?: string; files: DocumentRow[] };

export function ProjectFilesList({ b, onRemove }: { b: ProjectBundle; onRemove: (d: DocumentRow) => void }) {
  const nn = (n: number) => String(n).padStart(2, '0');
  const used = new Set<number>();
  const take = (f: (d: DocumentRow) => boolean) => b.documents.filter((d) => !used.has(d.id) && f(d)).map((d) => { used.add(d.id); return d; });
  const apps = [...b.applications].sort((x, y) => x.contractId - y.contractId || y.number - x.number);
  const payApps: Group[] = apps.map((a) => {
    const c = b.contracts.find((x) => x.id === a.contractId);
    return { key: `app-${a.id}`, title: `${a.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${nn(a.docNumber)}`, sub: c?.counterparty, files: take((d) => d.applicationId === a.id) };
  }).filter((g) => g.files.length);
  const others: Group[] = [
    { key: 'cos', title: 'Executed Change Orders', files: take((d) => d.changeOrderId != null) },
    { key: 'tcos', title: 'Tenant Change Order Backup', files: take((d) => !!d.budgetCoId) },
    { key: 'direct', title: 'Direct Cost Receipts', files: take((d) => d.directCostId != null) },
    { key: 'contract', title: 'Contract Documents', files: take((d) => d.contractId != null) },
    { key: 'other', title: 'Other', files: take(() => true) },
  ].filter((g) => g.files.length);
  const appFileCount = payApps.reduce((t, g) => t + g.files.length, 0);
  return (
    <div className="space-y-2">
      {payApps.length > 0 && (
        <Fold k="payapps" title="Pay Apps" count={appFileCount} note={`${payApps.length} pay app${payApps.length === 1 ? '' : 's'}`}>
          <div className="space-y-1.5 pl-4">
            {payApps.map((g) => (
              <Fold key={g.key} k={g.key} title={g.title} count={g.files.length} note={g.sub} small>
                <FileRows b={b} files={g.files} onRemove={onRemove} />
              </Fold>
            ))}
          </div>
        </Fold>
      )}
      {others.map((g) => (
        <Fold key={g.key} k={g.key} title={g.title} count={g.files.length}>
          <FileRows b={b} files={g.files} onRemove={onRemove} />
        </Fold>
      ))}
    </div>
  );
}

function Fold({ k, title, count, note, small, children }: { k: string; title: string; count: number; note?: string; small?: boolean; children: React.ReactNode }) {
  const storeKey = `pm-files-open-${k}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(storeKey) === '1'; } catch { return false; } });
  const toggle = () => setOpen((v) => { try { localStorage.setItem(storeKey, v ? '0' : '1'); } catch { /* private window */ } return !v; });
  return (
    <div className={small ? '' : 'border rounded-lg'}>
      <button type="button" onClick={toggle} aria-expanded={open}
              className={`w-full flex items-center gap-2 text-left ${small ? 'py-1' : 'px-3 py-2'} hover:bg-gray-50 rounded-lg`}>
        <ChevronRight className={`h-4 w-4 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className={small ? 'text-sm text-gray-900' : 'text-sm font-semibold text-gray-900'}>{title}</span>
        {note && <span className="text-xs text-gray-500">{note}</span>}
        <span className="ml-auto text-xs text-gray-500 tabular-nums">{count} file{count === 1 ? '' : 's'}</span>
      </button>
      {open && <div className={small ? 'pl-6 pb-1' : 'px-3 pb-3'}>{children}</div>}
    </div>
  );
}

function FileRows({ b, files, onRemove }: { b: ProjectBundle; files: DocumentRow[]; onRemove: (d: DocumentRow) => void }) {
  return (
    <div className="bg-white border rounded-lg divide-y">
      {files.map((d) => {
        const w = b.waivers.find((x) => x.documentId === d.id);
        const co = d.changeOrderId != null ? b.changeOrders.find((x) => x.id === d.changeOrderId) : null;
        const what = w ? `${w.kind === 'conditional' ? 'Conditional' : 'Unconditional'} · ${w.vendor}`
          : co ? `${co.number}${co.title ? ` — ${co.title}` : ''}`
          : d.docType === 'g702' ? `GC Pay App${d.vendor ? ` · ${d.vendor}` : ''}`
          : d.docType === 'sub_pay_app' ? `Sub Pay App${d.vendor ? ` · ${d.vendor}` : ''}`
          : d.docType === 'invoice' ? 'Invoice / Backup' : '';
        return (
          <div key={d.id} className="px-3 py-1.5 flex items-center justify-between gap-3 text-sm">
            <button className="text-blue-700 hover:underline text-left break-all" onClick={() => openDocument(d.id)}>{d.originalName}</button>
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-xs text-gray-500 text-right">
                {what}
                <div>{new Date(d.createdAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}{d.storage === 'local' ? ' · not backed up' : ''}</div>
              </div>
              <button className="text-gray-400 hover:text-red-700" title="Remove this file" onClick={() => onRemove(d)}><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
