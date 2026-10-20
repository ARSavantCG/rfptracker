/**
 * How numbers read across the app (Adolfo, 2026-10-20):
 *   money — always commas and two decimals: 1,466,500.00
 *   percentages — always two decimals: 2.75%, 3.00%, 100.00%
 */

const num = (v: unknown): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,%\s]/g, ''));
  return Number.isFinite(x) ? x : NaN;
};

/** 2.75 → "2.75%". */
export function fmtPct(v: unknown): string {
  const x = num(v);
  return Number.isFinite(x) ? `${x.toFixed(2)}%` : '—';
}

/** part / whole as a percentage, two decimals. */
export function pctOf(part: number, whole: number): string {
  return whole ? fmtPct((part / whole) * 100) : '—';
}

/**
 * Percentages written inside text, to two decimals:
 * "Permit Fees (3%)" → "Permit Fees (3.00%)". Leaves anything already at
 * two decimals, and anything that isn't a number followed by %, alone.
 */
export function pctText(s: string): string {
  return String(s ?? '').replace(/(^|[^\d.])(\d+(?:\.\d+)?)\s?%/g, (_m, pre, n) => `${pre}${Number(n).toFixed(2)}%`);
}

/** "1466500" → "1,466,500.00". Text that isn't a number comes back as typed. */
export function fmtMoneyText(s: string): string {
  if (!String(s ?? '').trim()) return '';
  const x = num(s);
  return Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : s;
}

/** "2.5" → "2.50". */
export function fmtPctText(s: string): string {
  if (!String(s ?? '').trim()) return '';
  const x = num(s);
  return Number.isFinite(x) ? x.toFixed(2) : s;
}
