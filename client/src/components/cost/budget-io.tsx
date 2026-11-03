/**
 * Budget to Excel and back (Adolfo, 2026-11-03): export the budget lines as a template, edit or add
 * lines in Excel, import it — matched by Line ID (or the line's name), shown before anything saves.
 * Lines left out of the file are kept (remove them on the Budget tab). On a confirmed budget the
 * import is logged as a revision, like any edit.
 */
import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Download, Upload } from 'lucide-react';
import { BUCKET_LABEL, money, projectKey, type ProjectBundle } from './types';
import { readTemplate, text, amount, percent, notesSheet } from './excel-io';
import { ImportPreview, type Change } from './import-preview';

const COLS = ['Line ID', 'Budget Line', 'Category', 'Budget', 'Tenant Share %'] as const;
const MONEY = '#,##0.00;(#,##0.00)';
const toBucket = (v: string) => {
  const s = v.trim().toLowerCase();
  const hit = Object.entries(BUCKET_LABEL).find(([k, l]) => k === s || l.toLowerCase() === s || (s.startsWith('misc') && k === 'misc') || (s.startsWith('construction man') && k === 'cm'));
  return hit ? hit[0] : null;
};

export function BudgetExcel({ bundle: b, projectId }: { bundle: ProjectBundle; projectId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<{ changes: Change[]; next: any[] } | null>(null);
  const baseline = ((b.project as any).baseline ?? []) as Array<{ key: string; description: string; bucket: string; budget: number; tenantSharePct: number; masterItemId?: number }>;

  const exportIt = () => {
    const head = [['Budget Template'], ['Project', (b.project as any).name], [], [...COLS]];
    const ws = XLSX.utils.aoa_to_sheet(head);
    XLSX.utils.sheet_add_aoa(ws, baseline.map((l) => [l.key, l.description, BUCKET_LABEL[l.bucket] ?? l.bucket, l.budget, (l.tenantSharePct ?? 100) / 100]), { origin: { r: head.length, c: 0 } });
    for (let i = 0; i < baseline.length; i++) {
      const m = XLSX.utils.encode_cell({ r: head.length + i, c: 3 }); if (ws[m]) ws[m].z = MONEY;
      const p = XLSX.utils.encode_cell({ r: head.length + i, c: 4 }); if (ws[p]) ws[p].z = '0.00%';
    }
    ws['!cols'] = [{ wch: 14 }, { wch: 52 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Budget');
    XLSX.utils.book_append_sheet(wb, notesSheet([
      'Edit any line: its name, category, budget or tenant share. Keep the Line ID as is — that is how the import finds the line.',
      'Add a line: a new row with the Line ID left blank.',
      'Category: Contractor, Design, CM or Miscellaneous.',
      'Budget: the line\'s priced amount (before any deal discount). Tenant Share: 0% to 100%.',
      'Lines you delete from the sheet are kept in the app — remove them on the Budget tab.',
      'Import shows every change before anything is saved. On a confirmed budget it is logged as a revision.',
    ]), 'How To');
    const slug = String((b.project as any).name || 'Project').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
    XLSX.writeFile(wb, `KURV_Budget_Template_${slug}.xlsx`);
  };

  const read = async (f: File) => {
    try {
      const rows = await readTemplate(f, 'Budget Line', 'Budget');
      const byKey = new Map(baseline.map((l) => [l.key, l]));
      const byName = new Map(baseline.map((l) => [l.description.trim().toLowerCase(), l]));
      const next = baseline.map((l) => ({ ...l }));
      const changes: Change[] = [];
      const touched = new Set<string>();
      for (const r of rows) {
        const id = text(r['Line ID']); const name = text(r['Budget Line']);
        if (!name && !id) continue;
        const cur = (id && byKey.get(id)) || (!id && byName.get(name.toLowerCase())) || null;
        if (id && !cur) { changes.push({ kind: 'skip', label: `Row ${r.__row}: ${name || id}`, detail: `Line ID ${id} isn't in this budget. Clear the Line ID to add it as a new line.` }); continue; }
        const bucket = text(r['Category']) ? toBucket(text(r['Category'])) : (cur?.bucket ?? 'contractor');
        if (!bucket) { changes.push({ kind: 'skip', label: `Row ${r.__row}: ${name}`, detail: `Category "${text(r['Category'])}" — use Contractor, Design, CM or Miscellaneous.` }); continue; }
        const budget = amount(r['Budget']);
        if (budget == null && !cur) { changes.push({ kind: 'skip', label: `Row ${r.__row}: ${name}`, detail: 'No budget amount.' }); continue; }
        const share = percent(r['Tenant Share %']);
        const want = { description: name || cur!.description, bucket, budget: budget ?? cur!.budget, tenantSharePct: share == null ? (cur?.tenantSharePct ?? 100) : Math.max(0, Math.min(100, share)) };
        if (!cur) { next.push({ key: '', ...want } as any); changes.push({ kind: 'add', label: want.description, detail: `${BUCKET_LABEL[bucket]} · ${money(want.budget)}${want.tenantSharePct !== 100 ? ` · tenant ${want.tenantSharePct}%` : ''}` }); continue; }
        touched.add(cur.key);
        const diffs: string[] = [];
        if (want.description !== cur.description) diffs.push(`name "${cur.description}" → "${want.description}"`);
        if (want.bucket !== cur.bucket) diffs.push(`category ${BUCKET_LABEL[cur.bucket]} → ${BUCKET_LABEL[want.bucket]}`);
        if (Math.abs(want.budget - cur.budget) >= 0.005) diffs.push(`budget ${money(cur.budget)} → ${money(want.budget)}`);
        if (Math.abs(want.tenantSharePct - (cur.tenantSharePct ?? 100)) >= 0.0001) diffs.push(`tenant share ${cur.tenantSharePct}% → ${want.tenantSharePct}%`);
        const i = next.findIndex((x) => x.key === cur.key);
        next[i] = { ...next[i], ...want };
        changes.push({ kind: diffs.length ? 'update' : 'same', label: want.description, detail: diffs.join(' · ') || undefined });
      }
      const kept = baseline.filter((l) => !touched.has(l.key)).length;
      setPlan({ changes, next });
      if (kept) toast({ title: `${kept} line${kept === 1 ? '' : 's'} not in the file`, description: 'Kept as they are.' });
    } catch (e: any) { toast({ title: 'Not Read', description: e?.message, variant: 'destructive' }); }
  };

  const apply = async () => {
    try {
      await apiRequest(`/api/cost-projects/${projectId}`, 'PATCH', { baseline: plan!.next });
      const data = await apiRequest(`/api/cost-projects/${projectId}/approval`, 'PUT', { note: 'Budget revised (Excel import)' });
      qc.setQueryData([projectKey(projectId)], data);
      toast({ title: 'Budget imported' });
      setPlan(null);
    } catch (e: any) { toast({ title: 'Not Imported', description: e?.message, variant: 'destructive' }); qc.invalidateQueries({ queryKey: [projectKey(projectId)] }); }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={exportIt} title="Download the budget as an Excel template"><Download className="h-3.5 w-3.5 mr-1" /> Excel</Button>
      <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} title="Import the budget template back — shows every change first"><Upload className="h-3.5 w-3.5 mr-1" /> Import</Button>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f); }} />
      <ImportPreview title="Import Budget" changes={plan?.changes ?? null} onApply={apply} onClose={() => setPlan(null)}
        note="Lines are matched by Line ID (or name, for rows without one). Nothing is saved until you apply." />
    </>
  );
}
