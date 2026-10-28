/**
 * Funding by scope (Adolfo, 2026-10-27, PepsiCo): a project can be paid for in pieces,
 * each with its own money and its own rule for overages.
 *   Interior TI      the tenant's allowance, an additional allowance they exercised under
 *                    the lease (repaid through rent), and funds they paid up front for a
 *                    change order; anything beyond those, the tenant pays.
 *   Site / Exterior  ours, at the amount first contemplated; anything beyond it comes from
 *                    Supplemental (the capital partner).
 * Each scope is a set of budget lines. Its sources are drawn in the order listed, first
 * against the projected cost (committed + pending), and separately against the work done
 * to date. Change order work we chose to absorb (an approved budget change order's share
 * not billed to the tenant, e.g. a minor architect change on the interior) is ours: it
 * doesn't draw on the tenant's allowances and is shown apart. DB-free.
 */
export type SourceKind = 'allowance' | 'amortized' | 'tenant' | 'landlord';
export const SOURCE_KINDS: ReadonlyArray<{ key: SourceKind; label: string; hint: string }> = [
  { key: 'allowance', label: 'TI Allowance', hint: 'What the lease gives the tenant toward the work' },
  { key: 'amortized', label: 'Additional Allowance (Repaid Through Rent)', hint: 'Exercised under the lease; we fund it, the tenant repays it in rent' },
  { key: 'tenant', label: 'Tenant Funds Received', hint: 'Paid to us up front (a deposit or lump sum), drawn down as the work is paid' },
  { key: 'landlord', label: 'Landlord Budget (Our Cost)', hint: 'Our money at the amount first contemplated' },
];
export type OverageRule = 'tenant' | 'supplemental';
export const OVERAGE_RULES: ReadonlyArray<{ key: OverageRule; label: string }> = [
  { key: 'tenant', label: 'Tenant Pays the Overage' },
  { key: 'supplemental', label: 'Supplemental (Capital Partner)' },
];

export interface FundingSource { id: string; kind: SourceKind; label: string; amount: number; perSf?: number | null; sf?: number | null; note?: string | null }
export interface FundingScope { id: string; name: string; lineKeys: string[]; sources: FundingSource[]; overage: OverageRule }

const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown) => { const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(x) ? x : 0; };
const id = () => Math.random().toString(36).slice(2, 10);

export function normalizeScopes(raw: unknown): FundingScope[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).map((s: any) => ({
    id: String(s?.id || id()),
    name: String(s?.name || 'Scope').slice(0, 80),
    lineKeys: Array.isArray(s?.lineKeys) ? s.lineKeys.map(String).slice(0, 500) : [],
    overage: s?.overage === 'supplemental' ? 'supplemental' : 'tenant',
    sources: (Array.isArray(s?.sources) ? s.sources : []).slice(0, 12).map((x: any) => {
      const perSf = x?.perSf == null || x.perSf === '' ? null : num(x.perSf);
      const sf = x?.sf == null || x.sf === '' ? null : num(x.sf);
      const kind: SourceKind = (['allowance', 'amortized', 'tenant', 'landlord'] as const).includes(x?.kind) ? x.kind : 'allowance';
      return { id: String(x?.id || id()), kind, label: String(x?.label || SOURCE_KINDS.find((k) => k.key === kind)!.label).slice(0, 80),
        amount: perSf != null && sf != null ? r2(perSf * sf) : r2(num(x?.amount)), perSf, sf, note: x?.note ? String(x.note).slice(0, 200) : null };
    }),
  }));
}

/** The PepsiCo pattern, amounts to fill in. */
export function scopeTemplate(): FundingScope[] {
  return [
    { id: id(), name: 'Interior TI', lineKeys: [], overage: 'tenant', sources: [
      { id: id(), kind: 'allowance', label: 'TI Allowance', amount: 0 },
      { id: id(), kind: 'amortized', label: 'Additional TI Allowance (Repaid Through Rent)', amount: 0, perSf: null, sf: null },
      { id: id(), kind: 'tenant', label: 'Tenant Funds Received', amount: 0 },
    ] },
    { id: id(), name: 'Site Improvements', lineKeys: [], overage: 'supplemental', sources: [
      { id: id(), kind: 'landlord', label: 'Site Improvements (Original)', amount: 0 },
    ] },
  ];
}

export interface SourceUse { id: string; kind: SourceKind; label: string; amount: number; projected: number; toDate: number; leftProjected: number; leftToDate: number }
export interface ScopeResult {
  id: string; name: string; overage: OverageRule; lineKeys: string[]; lines: string[];
  budget: number; committed: number; pending: number; projected: number; toDate: number;
  /** Absorbed change order work on these lines: ours, outside the sources. */
  absorbed: number;
  funding: number; sources: SourceUse[];
  /** Beyond every source: owed by the tenant, or needed from Supplemental. */
  overageProjected: number; overageToDate: number;
  /** Sources not needed at the projected cost (allowance the tenant leaves on the table, our budget saved). */
  unused: number;
}
export interface ScopesResult { absorbed: number; scopes: ScopeResult[]; unassigned: { lines: string[]; projected: number; toDate: number }; tenantOverage: number; supplemental: number; amortized: number; tenantFundsLeft: number }

/** Our share of approved budget change orders, by budget line. */
export function absorbedByLine(cos: ReadonlyArray<{ status: string; lines: ReadonlyArray<{ key: string; amount: number; tenantPct?: number | null }> }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cos) if (c.status === 'approved') for (const l of c.lines) {
    const ours = (num(l.amount) * (100 - (l.tenantPct ?? 100))) / 100;
    if (Math.abs(ours) >= 0.005) m.set(l.key, r2((m.get(l.key) ?? 0) + ours));
  }
  return m;
}

export function computeScopes(scopes: readonly FundingScope[], rows: ReadonlyArray<{ key: string; description: string; budget: number; committed: number; pending: number; toDate: number }>, absorbed: ReadonlyMap<string, number> = new Map()): ScopesResult {
  const used = new Set<string>();
  const out: ScopeResult[] = scopes.map((s) => {
    const ls = rows.filter((r) => s.lineKeys.includes(r.key) && !used.has(r.key));
    ls.forEach((r) => used.add(r.key));
    const budget = r2(ls.reduce((t, r) => t + r.budget, 0));
    const committed = r2(ls.reduce((t, r) => t + r.committed, 0));
    const pending = r2(ls.reduce((t, r) => t + r.pending, 0));
    const toDate = r2(ls.reduce((t, r) => t + r.toDate, 0));
    // Projected: what's committed + pending once a line is bought out; its budget before then.
    const projected = r2(ls.reduce((t, r) => t + (Math.abs(r.committed + r.pending) >= 0.005 ? r.committed + r.pending : r.budget), 0));
    const ours = r2(Math.min(projected, ls.reduce((t, r) => t + Math.max(0, absorbed.get(r.key) ?? 0), 0)));
    // Absorbed work is taken out before the sources draw (to date, in proportion to the work done).
    let restP = projected - ours, restT = Math.max(0, toDate - (projected ? (ours * toDate) / projected : 0));
    const sources = s.sources.map((x) => {
      const p = Math.max(0, Math.min(x.amount, restP)), t = Math.max(0, Math.min(x.amount, restT));
      restP -= p; restT -= t;
      return { id: x.id, kind: x.kind, label: x.label, amount: r2(x.amount), projected: r2(p), toDate: r2(t), leftProjected: r2(x.amount - p), leftToDate: r2(x.amount - t) };
    });
    const funding = r2(s.sources.reduce((t, x) => t + x.amount, 0));
    // A scope with no sources is only a grouping (Sitework, Tenant Improvements): no overage to anyone.
    const grouping = !s.sources.length;
    return { id: s.id, name: s.name, overage: s.overage, lineKeys: s.lineKeys, lines: ls.map((r) => r.description), budget, committed, pending, projected, toDate, absorbed: ours, funding, sources,
      overageProjected: grouping ? 0 : r2(Math.max(0, restP)), overageToDate: grouping ? 0 : r2(Math.max(0, restT)), unused: r2(Math.max(0, funding - (projected - ours))) };
  });
  const rest = rows.filter((r) => !used.has(r.key) && !r.key.startsWith('__') && (Math.abs(r.budget) >= 0.005 || Math.abs(r.committed + r.pending) >= 0.005));
  return {
    scopes: out,
    absorbed: r2(out.reduce((t, s) => t + s.absorbed, 0)),
    unassigned: { lines: rest.map((r) => r.description), projected: r2(rest.reduce((t, r) => t + (Math.abs(r.committed + r.pending) >= 0.005 ? r.committed + r.pending : r.budget), 0)), toDate: r2(rest.reduce((t, r) => t + r.toDate, 0)) },
    tenantOverage: r2(out.filter((s) => s.overage === 'tenant').reduce((t, s) => t + s.overageProjected, 0)),
    supplemental: r2(out.filter((s) => s.overage === 'supplemental').reduce((t, s) => t + s.overageProjected, 0)),
    amortized: r2(out.reduce((t, s) => t + s.sources.filter((x) => x.kind === 'amortized').reduce((u, x) => u + x.projected, 0), 0)),
    tenantFundsLeft: r2(out.reduce((t, s) => t + s.sources.filter((x) => x.kind === 'tenant').reduce((u, x) => u + x.leftToDate, 0), 0)),
  };
}
