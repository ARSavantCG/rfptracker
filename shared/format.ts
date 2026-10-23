/**
 * How numbers read across the app (Adolfo, 2026-10-20):
 *   money — always commas and two decimals: 1,466,500.00
 *   percentages — always two decimals: 2.75%, 3.00%, 100.00%
 */

/**
 * A dollar amount as typed — a plain number ("1,234.50", "$1,234.50") or a formula
 * like Excel ("=19500*.5", "19500*50%", "(1200+340)/2"): + - * / ( ) and a trailing %
 * (Adolfo, 2026-10-23). Arithmetic only — nothing else is ever run. NaN if it isn't one.
 */
export function parseAmount(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let src = String(v ?? '').trim();
  if (!src) return NaN;
  if (src.startsWith('=')) src = src.slice(1);
  src = src.replace(/[$,\s]/g, '');
  if (!src || /[^0-9.+\-*/()%xX×÷]/.test(src)) return NaN;
  src = src.replace(/[xX×]/g, '*').replace(/÷/g, '/');
  let i = 0;
  const peek = () => src[i];
  const number = (): number => {
    const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?|^\d+\.?/.exec(src.slice(i));
    if (!m) throw new Error('number');
    i += m[0].length;
    let n = parseFloat(m[0]);
    if (peek() === '%') { i++; n /= 100; }
    return n;
  };
  const factor = (): number => {
    const c = peek();
    if (c === '+') { i++; return factor(); }
    if (c === '-') { i++; return -factor(); }
    if (c === '(') { i++; const v2 = expr(); if (peek() !== ')') throw new Error(')'); i++; if (peek() === '%') { i++; return v2 / 100; } return v2; }
    return number();
  };
  const term = (): number => {
    let v2 = factor();
    while (peek() === '*' || peek() === '/') { const op = src[i++]; const r = factor(); v2 = op === '*' ? v2 * r : v2 / r; }
    return v2;
  };
  const expr = (): number => {
    let v2 = term();
    while (peek() === '+' || peek() === '-') { const op = src[i++]; const r = term(); v2 = op === '+' ? v2 + r : v2 - r; }
    return v2;
  };
  try {
    const out = expr();
    return i === src.length && Number.isFinite(out) ? out : NaN;
  } catch { return NaN; }
}
/** Typed text that is a formula rather than a plain number. */
export const isFormula = (v: unknown) => /^\s*=|[0-9)%]\s*[*/xX×÷+]|[0-9)%]\s*-\s*[0-9(]/.test(String(v ?? '').replace(/^\s*-/, ''));

const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const x = parseAmount(String(v ?? '').replace(/%\s*$/, ''));
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
