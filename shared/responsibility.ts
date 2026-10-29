/**
 * Who is responsible for each dollar of a pay app: tenant or landlord (Adolfo, 2026-10-29).
 * Taken from the pay app's own scope data, line by line: each line's net this period
 * (work + change in stored material − change in retainage held, so a retainage release
 * counts where it was held), assigned by
 *   1. the line's G703 section: Sitework → landlord; Tenant Improvements / Interior / TI → tenant;
 *   2. else the budget line it's mapped to: the funding scope holding it (a scope funded by
 *      the landlord, or whose overage goes to Supplemental → landlord; allowance / tenant
 *      funds → tenant; a grouping scope by its name), else that line's tenant share;
 *   3. else a change order line → tenant, a base contract line → landlord.
 * A payment then splits in the proportion of its pay app's net. DB-free.
 */
type Line = { id: number; contractId: number; changeOrderId: number | null; section?: string | null; allocationMode?: string; allocations?: Array<{ baselineKey: string; pct: number }> };
type App = { id: number; contractId: number; number: number; lines: Array<{ sovLineId: number; workThisPeriod: number; storedToDate: number; retainageToDate: number }> };
type Scope = { name: string; lineKeys: string[]; sources?: Array<{ kind: string }>; overage?: string };

const r2 = (v: number) => Math.round(v * 100) / 100;
const n = (v: unknown) => Number(v) || 0;

export function sectionTenantShare(section: string | null | undefined): number | null {
  const s = String(section ?? '').trim();
  if (!s) return null;
  if (/site|landlord|base building|shell/i.test(s)) return 0;
  if (/tenant|interior|\bti\b|\btis\b/i.test(s)) return 1;
  return null;
}

export function lineTenantShare(line: Line, ctx: { scopes: Scope[]; tenantPct: Map<string, number> }): number {
  const bySection = sectionTenantShare(line.section);
  if (bySection != null) return bySection;
  const keyShare = (k: string): number | null => {
    const sc = ctx.scopes.find((s) => s.lineKeys.includes(k));
    if (sc) {
      const kinds = (sc.sources ?? []).map((x) => x.kind);
      if (kinds.length) {
        if (kinds.every((x) => x === 'landlord') || sc.overage === 'supplemental') return 0;
        return 1;
      }
      const byName = sectionTenantShare(sc.name);
      if (byName != null) return byName;
    }
    const p = ctx.tenantPct.get(k);
    return p == null ? null : Math.max(0, Math.min(1, p / 100));
  };
  const al = (line.allocations ?? []).filter((a) => n(a.pct) > 0);
  if (line.allocationMode === 'direct' && al.length) {
    let w = 0, t = 0;
    for (const a of al) { const s = keyShare(a.baselineKey); if (s == null) continue; w += n(a.pct); t += n(a.pct) * s; }
    if (w > 0) return t / w;
  }
  return line.changeOrderId != null ? 1 : 0;
}

/** Each pay app's net this period, split tenant / landlord. */
export function payAppSplits(input: { applications: readonly App[]; lines: readonly Line[]; scopes?: Scope[]; tenantPct?: Map<string, number> }) {
  const ctx = { scopes: input.scopes ?? [], tenantPct: input.tenantPct ?? new Map<string, number>() };
  const lineById = new Map(input.lines.map((l) => [l.id, l]));
  const share = new Map<number, number>();
  const shareOf = (id: number) => {
    if (!share.has(id)) { const l = lineById.get(id); share.set(id, l ? lineTenantShare(l, ctx) : 0); }
    return share.get(id)!;
  };
  const out = new Map<number, { tenant: number; landlord: number; net: number }>();
  const byContract = new Map<number, App[]>();
  for (const a of input.applications) byContract.set(a.contractId, [...(byContract.get(a.contractId) ?? []), a]);
  byContract.forEach((apps) => {
    let prev = new Map<number, { stored: number; ret: number }>();
    for (const a of [...apps].sort((x, y) => x.number - y.number)) {
      const cur = new Map<number, { work: number; stored: number; ret: number }>();
      for (const l of a.lines) {
        const c = cur.get(l.sovLineId) ?? { work: 0, stored: 0, ret: 0 };
        c.work += n(l.workThisPeriod); c.stored += n(l.storedToDate); c.ret += n(l.retainageToDate);
        cur.set(l.sovLineId, c);
      }
      let tenant = 0, total = 0;
      for (const id of Array.from(new Set([...Array.from(prev.keys()), ...Array.from(cur.keys())]))) {
        const c = cur.get(id) ?? { work: 0, stored: 0, ret: 0 };
        const p = prev.get(id) ?? { stored: 0, ret: 0 };
        const net = c.work + (c.stored - p.stored) - (c.ret - p.ret);
        total += net; tenant += net * shareOf(id);
      }
      out.set(a.id, { tenant: r2(tenant), landlord: r2(total - tenant), net: r2(total) });
      prev = new Map(Array.from(cur.entries()).map(([k, v]) => [k, { stored: v.stored, ret: v.ret }]));
    }
  });
  return out;
}
