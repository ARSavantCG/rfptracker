/**
 * Estimate to Complete (Adolfo, 2026-10-29): by budget line, what's left to spend and where
 * the project lands. With nothing typed, each line's remaining is what's left on its
 * commitments (committed less billed to date): a $1,000,000 contract billed $800,000 has
 * $200,000 to go. On top of that, forecast items: costs coming that no contract covers (a
 * permit fee paid by card), changes expected, or adjustments to a commitment (it won't all
 * be used). Uncommitted budget is not assumed spent; forecast it to count it.
 *   ETC (estimate to complete)  = remaining on commitments + pending change orders (optional) + forecast items
 *   EAC (estimate at completion) = billed to date + ETC
 *   Variance                     = budget − EAC (negative = over)
 * DB-free.
 */
export type ForecastKind = 'cost' | 'change' | 'adjust';
export const FORECAST_KINDS: ReadonlyArray<{ key: ForecastKind; label: string; hint: string }> = [
  { key: 'cost', label: 'Anticipated Cost (Not Committed)', hint: 'A fee, card charge or other cost no contract covers' },
  { key: 'change', label: 'Anticipated Change', hint: 'A change order or extra expected, not yet submitted' },
  { key: 'adjust', label: 'Commitment Adjustment', hint: "A commitment won't be fully used (negative) or will run over" },
];
export interface ForecastItem { id: string; key: string; kind: ForecastKind; description: string; amount: number; note?: string | null; date: string; by?: string | null }
export interface ForecastSetup { items: ForecastItem[]; includePending: boolean }

const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown) => { const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(x) ? x : 0; };

export function normalizeForecast(raw: any): ForecastSetup {
  const items = (Array.isArray(raw?.items) ? raw.items : []).slice(0, 500).map((x: any) => ({
    id: String(x?.id || ''), key: String(x?.key || ''),
    kind: (['cost', 'change', 'adjust'] as const).includes(x?.kind) ? x.kind : 'cost',
    description: String(x?.description || '').slice(0, 200), amount: r2(num(x?.amount)),
    note: x?.note ? String(x.note).slice(0, 500) : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(x?.date || '')) ? String(x.date) : '',
    by: x?.by ? String(x.by) : null,
  })).filter((x: ForecastItem) => x.id && x.key);
  return { items, includePending: raw?.includePending !== false };
}

export interface ForecastRow {
  key: string; description: string; bucket?: string;
  budget: number; committed: number; pending: number; toDate: number;
  /** Committed less billed to date (never below zero: a line billed past its commitment has nothing left on it). */
  remaining: number;
  items: ForecastItem[];
  forecast: number;
  etc: number; eac: number; variance: number;
  /** Budget not committed and not forecast: savings if it stays that way. */
  uncommitted: number;
}

export function computeForecast(
  rows: ReadonlyArray<{ key: string; description: string; bucket?: string; budget: number; committed: number; pending: number; toDate: number }>,
  setup: ForecastSetup,
) {
  const byKey = new Map<string, ForecastItem[]>();
  for (const it of setup.items) byKey.set(it.key, [...(byKey.get(it.key) ?? []), it]);
  const known = new Set(rows.map((r) => r.key));
  const out: ForecastRow[] = rows.map((r) => {
    const items = byKey.get(r.key) ?? [];
    const remaining = r2(Math.max(0, r.committed - r.toDate));
    const pending = setup.includePending ? r.pending : 0;
    const forecast = r2(items.reduce((t, i) => t + i.amount, 0));
    const etc = r2(remaining + pending + forecast);
    const eac = r2(r.toDate + etc);
    return {
      key: r.key, description: r.description, bucket: r.bucket,
      budget: r2(r.budget), committed: r2(r.committed), pending: r2(r.pending), toDate: r2(r.toDate),
      remaining, items, forecast, etc, eac, variance: r2(r.budget - eac),
      uncommitted: r2(Math.max(0, r.budget - r.committed - pending - Math.max(0, forecast))),
    };
  }).filter((r) => [r.budget, r.committed, r.pending, r.toDate, r.forecast].some((v) => Math.abs(v) >= 0.005) || r.items.length);
  // Items on a line that's since been removed: kept visible rather than lost.
  const orphans = setup.items.filter((i) => !known.has(i.key));
  const sum = (k: keyof ForecastRow) => r2(out.reduce((t, r) => t + (r[k] as number), 0));
  const orphanTotal = r2(orphans.reduce((t, i) => t + i.amount, 0));
  const totals = {
    budget: sum('budget'), committed: sum('committed'), pending: sum('pending'), toDate: sum('toDate'),
    remaining: sum('remaining'), forecast: r2(sum('forecast') + orphanTotal),
    etc: r2(sum('etc') + orphanTotal), eac: r2(sum('eac') + orphanTotal), variance: r2(sum('variance') - orphanTotal),
    uncommitted: sum('uncommitted'),
  };
  const byKind = (k: ForecastKind) => r2(setup.items.filter((i) => i.kind === k).reduce((t, i) => t + i.amount, 0));
  return { rows: out, orphans, totals, includePending: setup.includePending, kinds: { cost: byKind('cost'), change: byKind('change'), adjust: byKind('adjust') } };
}
