/**
 * Ledger charges to Excel and back (Adolfo, 2026-11-03): a template of every charge (the ones with no
 * contract — permits, testing, card charges), edited or added to in Excel, imported back: matched by
 * Charge ID, new rows added. Contractor payments are recorded on their pay apps, not here. Shown first.
 */
import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Upload, Download } from 'lucide-react';
import { money, projectKey, type ProjectBundle } from './types';
import { readTemplate, text, amount, isoDate, notesSheet } from './excel-io';
import { ImportPreview, type Change } from './import-preview';

const METHOD: Record<string, string> = { card: 'Card', check: 'Check', ach: 'ACH', wire: 'Wire', other: 'Other' };
const COLS = ['Charge ID', 'Date', 'Paid To', 'Invoice #', 'Description', 'Amount', 'How Paid', 'Reference', 'Budget Line', 'Who Pays', 'Reconciled', 'Notes'] as const;

export function LedgerExcel({ bundle: b, projectId }: { bundle: ProjectBundle; projectId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<{ changes: Change[]; ops: Array<() => Promise<unknown>> } | null>(null);
  const baseline = (b.project as any).baseline as Array<{ key: string; description: string }>;
  const nameOf = new Map(baseline.map((x) => [x.key, x.description]));
  const keyOf = new Map(baseline.map((x) => [x.description.trim().toLowerCase(), x.key]));

  const exportIt = () => {
    const head = [['Ledger Charges Template'], ['Project', (b.project as any).name], [], [...COLS]];
    const ws = XLSX.utils.aoa_to_sheet(head);
    const toDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
    XLSX.utils.sheet_add_aoa(ws, b.directCosts.map((d) => [d.id, toDate(d.date), d.vendor, d.invoiceNumber ?? '', d.description ?? '', d.amount, METHOD[d.method ?? ''] ?? '', d.reference ?? '',
      d.key ? nameOf.get(d.key) ?? '' : '', d.chargeTo === 'tenant' ? 'Tenant' : d.chargeTo === 'landlord' ? 'Landlord' : 'By Budget Line', d.reconciled ? 'Yes' : 'No', d.notes ?? '']),
      { origin: { r: head.length, c: 0 }, cellDates: true } as any);
    for (let i = 0; i < b.directCosts.length; i++) {
      const dc = XLSX.utils.encode_cell({ r: head.length + i, c: 1 }); if (ws[dc]) ws[dc].z = 'mm/dd/yyyy';
      const ac = XLSX.utils.encode_cell({ r: head.length + i, c: 5 }); if (ws[ac]) ws[ac].z = '#,##0.00;(#,##0.00)';
    }
    ws['!cols'] = [{ wch: 10 }, { wch: 11 }, { wch: 28 }, { wch: 14 }, { wch: 34 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 34 }, { wch: 14 }, { wch: 10 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ledger Charges');
    XLSX.utils.book_append_sheet(wb, notesSheet([
      'Charges with no contract: permits, testing, utilities, card charges. Contractor payments are recorded on their pay apps, not here.',
      'Edit a charge: change any column, keep the Charge ID. Add charges: new rows with the Charge ID blank (paste them in from Yardi or a card statement).',
      'Date: a date or mm/dd/yyyy. Amount: a number (negative for a refund).',
      `How Paid: Card, Check, ACH, Wire or Other. Who Pays: Tenant, Landlord, or By Budget Line (the line's tenant share).`,
      'Budget Line: the budget line\'s name exactly as in the app; blank leaves it unassigned. Reconciled: Yes or No.',
      'Rows deleted from the sheet are kept — delete them on the Ledger tab. Import shows every change before saving.',
      `Budget lines: ${baseline.map((x) => x.description).join(' · ')}`,
    ]), 'How To');
    const slug = String((b.project as any).name || 'Project').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
    XLSX.writeFile(wb, `KURV_Ledger_Charges_${slug}.xlsx`);
  };

  const read = async (f: File) => {
    try {
      const rows = await readTemplate(f, 'Paid To', 'Ledger Charges');
      const changes: Change[] = [];
      const ops: Array<() => Promise<unknown>> = [];
      for (const r of rows) {
        const vendor = text(r['Paid To']);
        const id = Number(text(r['Charge ID'])) || null;
        const date = isoDate(r['Date']);
        const amt = amount(r['Amount']);
        const label = `${vendor || '(no payee)'} · ${amt != null ? money(amt) : '—'}${date ? ` · ${date}` : ''}`;
        if (!vendor || !date || amt == null || amt === 0) { changes.push({ kind: 'skip', label: `Row ${r.__row}: ${label}`, detail: !vendor ? 'No Paid To.' : !date ? 'No date (or not a date).' : 'No amount.' }); continue; }
        const bl = text(r['Budget Line']);
        const key = bl ? keyOf.get(bl.toLowerCase()) : null;
        if (bl && !key) { changes.push({ kind: 'skip', label: `Row ${r.__row}: ${label}`, detail: `Budget line "${bl}" isn't in this budget (see the How To sheet for the names).` }); continue; }
        const how = text(r['How Paid']).toLowerCase();
        const method = Object.keys(METHOD).find((k) => k === how || METHOD[k].toLowerCase() === how) ?? (how ? 'other' : null);
        const who = text(r['Who Pays']).toLowerCase();
        const want = {
          date, vendor, amount: amt, invoiceNumber: text(r['Invoice #']), description: text(r['Description']), method, reference: text(r['Reference']) || null,
          key: key ?? null, chargeTo: who.startsWith('ten') ? 'tenant' : who.startsWith('land') ? 'landlord' : null,
          reconciled: /^(y|yes|true|1|x)$/i.test(text(r['Reconciled'])), notes: text(r['Notes']) || null,
        };
        if (id) {
          const cur = b.directCosts.find((d) => d.id === id);
          if (!cur) { changes.push({ kind: 'skip', label: `Row ${r.__row}: ${label}`, detail: `Charge ID ${id} isn't on this ledger. Clear it to add the row as a new charge.` }); continue; }
          const diffs: string[] = [];
          if (cur.date !== date) diffs.push(`date ${cur.date} → ${date}`);
          if (cur.vendor !== vendor) diffs.push(`paid to → ${vendor}`);
          if (Math.abs(cur.amount - amt) >= 0.005) diffs.push(`amount ${money(cur.amount)} → ${money(amt)}`);
          if ((cur.invoiceNumber ?? '') !== want.invoiceNumber) diffs.push(`invoice # → ${want.invoiceNumber || '—'}`);
          if ((cur.description ?? '') !== want.description) diffs.push('description');
          if ((cur.method ?? null) !== want.method) diffs.push(`how paid → ${METHOD[want.method ?? ''] ?? '—'}`);
          if ((cur.reference ?? null) !== want.reference) diffs.push('reference');
          if ((cur.key ?? null) !== want.key) diffs.push(`budget line → ${want.key ? nameOf.get(want.key) : 'none'}`);
          if ((cur.chargeTo ?? null) !== want.chargeTo) diffs.push(`who pays → ${want.chargeTo ?? 'by budget line'}`);
          if (!!cur.reconciled !== want.reconciled) diffs.push(want.reconciled ? 'reconciled' : 'not reconciled');
          if ((cur.notes ?? null) !== want.notes) diffs.push('notes');
          changes.push({ kind: diffs.length ? 'update' : 'same', label, detail: diffs.join(' · ') || undefined });
          if (diffs.length) ops.push(() => apiRequest(`/api/cost-direct-costs/${id}`, 'PATCH', want));
        } else {
          changes.push({ kind: 'add', label, detail: [want.description, want.key ? nameOf.get(want.key) : 'no budget line'].filter(Boolean).join(' · ') });
          ops.push(() => apiRequest(`/api/cost-projects/${projectId}/direct-costs`, 'POST', want));
        }
      }
      setPlan({ changes, ops });
    } catch (e: any) { toast({ title: 'Not Read', description: e?.message, variant: 'destructive' }); }
  };

  const apply = async () => {
    let done = 0;
    try { for (const op of plan!.ops) { await op(); done++; } toast({ title: `Ledger: ${done} saved` }); setPlan(null); }
    catch (e: any) { toast({ title: `Stopped after ${done} of ${plan!.ops.length}`, description: e?.message, variant: 'destructive' }); }
    finally { qc.invalidateQueries({ queryKey: [projectKey(projectId)] }); }
  };

  return (
    <>
      <Button variant="outline" onClick={exportIt} title="Download the ledger charges as an Excel template to edit or add to"><Download className="h-4 w-4 mr-1" /> Template</Button>
      <Button variant="outline" onClick={() => ref.current?.click()} title="Import charges from the template — shows every change first"><Upload className="h-4 w-4 mr-1" /> Import</Button>
      <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f); }} />
      <ImportPreview title="Import Ledger Charges" changes={plan?.changes ?? null} onApply={apply} onClose={() => setPlan(null)}
        note="Charges are matched by Charge ID; rows without one are added. Nothing is saved until you apply." />
    </>
  );
}
