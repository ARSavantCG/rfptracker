/**
 * Reading back the app's own Excel templates (Adolfo, 2026-11-03): find the header row (the one with
 * the column the template always has), then each row below it as { header: value }. Blank rows and the
 * totals row are skipped. Money and percentages read whether typed as numbers, "$1,234.50" or "70%".
 */
import * as XLSX from 'xlsx';

export type SheetRow = Record<string, unknown> & { __row: number };

export async function readTemplate(file: File, mustHave: string, sheet?: string): Promise<SheetRow[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const ws = wb.Sheets[sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
  const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
  const h = aoa.findIndex((r) => r.some((c) => norm(c) === mustHave.toLowerCase()));
  if (h < 0) throw new Error(`This doesn't look like the template: no "${mustHave}" column. Export the template first and fill that in.`);
  const headers = aoa[h].map((c) => String(c ?? '').trim());
  const out: SheetRow[] = [];
  for (let i = h + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r.some((c) => String(c ?? '').trim() !== '')) continue;
    if (/^(contract )?total/i.test(String(r[0] ?? '').trim()) || /^total$/i.test(String(r[0] ?? '').trim())) continue;
    const o: SheetRow = { __row: i + 1 };
    headers.forEach((k, j) => { if (k) o[k] = r[j]; });
    out.push(o);
  }
  return out;
}

export const text = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim());
/** A number from a cell: 1234.5, "$1,234.50", "(1,234.50)" (negative). null when blank or unreadable. */
export function amount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  const n = Number(s.replace(/[()$,\s-]/g, ''));
  return Number.isFinite(n) ? Math.round((neg ? -n : n) * 100) / 100 : null;
}
/** A percentage 0–100 from a cell: 0.7 (Excel %), 70, "70%". */
export function percent(v: unknown): number | null {
  if (typeof v === 'number') return v <= 1 && v >= 0 ? Math.round(v * 1e8) / 1e6 : v;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(/[%\s,]/g, ''));
  if (!Number.isFinite(n)) return null;
  return s.includes('%') || n > 1 ? n : Math.round(n * 1e8) / 1e6;
}
/** A date (YYYY-MM-DD) from a cell: an Excel date, "10/31/2026" or "2026-10-31". */
export function isoDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}
/** A sheet of how-to notes, added to every template. */
export function notesSheet(lines: string[]) {
  return XLSX.utils.aoa_to_sheet([['How to use this template'], [], ...lines.map((l) => [l])]);
}
