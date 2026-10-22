/**
 * Lien waivers on pay apps.
 *
 * Each pay app arrives with CONDITIONAL waivers — one per vendor being paid
 * from it (the GC and its subs), each for the amount on this pay app. The
 * next pay app arrives with the UNCONDITIONAL waivers for the last one: the
 * same vendors, the same amounts, now that the money has been paid.
 *
 * So once Pay App 1's conditionals are in, Pay App 2's unconditionals are
 * already known. This module works out that list, matches what has arrived
 * against it, and marks anything changed by hand as Edited so the person
 * reading it can tell what the app expected from what was typed over it.
 *
 * Pure: no database import.
 */

export type WaiverKind = 'conditional' | 'unconditional';

export interface Waiver {
  id: number;
  contractId: number;
  /** The pay app package this waiver came in with. */
  applicationId: number;
  kind: WaiverKind;
  vendor: string;
  amount: number;
  /** For an unconditional: the conditional (on the previous pay app) it answers. */
  fromWaiverId: number | null;
  received: boolean;
  notNeeded: boolean;
  documentId: number | null;
  /** Position in its pay app's list, as arranged by hand; null = in the order entered. */
  sortOrder?: number | null;
  /** 'gc' or 'sub' as set by hand; null = worked out from the contract's name. */
  party?: WaiverParty | null;
}

export type WaiverParty = 'gc' | 'sub';

export interface AppRef {
  id: number;
  contractId: number;
  number: number;
  /** Printed number, when it differs from the order number. */
  docNumber?: number | null;
}

export interface UnconditionalRow {
  /** null until anything about it has been saved — it is only expected. */
  id: number | null;
  vendor: string;
  amount: number;
  /** What the previous pay app's conditional said, when this row comes from one. */
  expectedVendor: string | null;
  expectedAmount: number | null;
  fromWaiverId: number | null;
  received: boolean;
  notNeeded: boolean;
  documentId: number | null;
  /** Rolled forward from a conditional, or added by hand. */
  source: 'expected' | 'added';
  /** Differs from what was expected — vendor or amount typed over. */
  edited: boolean;
  /** As set by hand on this row or, failing that, on the conditional it answers; null = work it out. */
  party: WaiverParty | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
export const vendorKey = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The pay app before this one on the same contract, if any. */
export function previousApp(app: AppRef, apps: readonly AppRef[]): AppRef | null {
  const prior = apps.filter((a) => a.contractId === app.contractId && a.number < app.number);
  return prior.length ? prior.reduce((m, a) => (a.number > m.number ? a : m), prior[0]) : null;
}

/** The pay app after this one on the same contract, if any. */
export function nextApp(app: AppRef, apps: readonly AppRef[]): AppRef | null {
  const later = apps.filter((a) => a.contractId === app.contractId && a.number > app.number);
  return later.length ? later.reduce((m, a) => (a.number < m.number ? a : m), later[0]) : null;
}

/** As arranged by hand, then in the order entered. */
const byOrder = <T extends Waiver>(list: T[]) =>
  [...list].sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) || a.id - b.id);

/**
 * Is this vendor the GC — the contract's own counterparty? Names are typed
 * loosely ("Nova Construction Management, I" for "…, LLC"), so they match on
 * a shared start of at least ten letters, or the whole of the shorter one.
 */
export function isGcVendor(vendor: string, contractName: string): boolean { return sameVendor(vendor, contractName); }

/** Same vendor, allowing for how names get typed: a shared start of ten letters, or all of the shorter. */
export function sameVendor(x: string, y: string): boolean {
  const a = vendorKey(x), b = vendorKey(y);
  if (!a || !b) return false;
  const short = Math.min(a.length, b.length);
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  // All of the shorter ("Nova Construction" / "…, LLC"), or nearly all of it with ten letters at least
  // ("…Management, I" / "…Management, LLC") — not just a shared first word ("Centerline Plumbing" / "Centerline Electric").
  return n === short || (n >= 10 && n >= 0.8 * short);
}

/**
 * The vendor names already used on a project, one spelling each (the one used most),
 * for picking from so names stay the same from one pay app to the next.
 */
export function knownVendors(names: ReadonlyArray<string | null | undefined>, preferred: ReadonlyArray<string | null | undefined> = []): string[] {
  const prefer = preferred.map((x) => String(x ?? '').trim()).filter(Boolean);
  const groups: Array<{ names: Map<string, number> }> = [];
  for (const raw of [...prefer, ...names]) {
    const name = String(raw ?? '').trim();
    if (!name || !vendorKey(name)) continue;
    // Spellings of the same vendor ("…Management, I" / "…Management, LLC") are one entry.
    let g = groups.find((x) => Array.from(x.names.keys()).some((n) => sameVendor(n, name)));
    if (!g) { g = { names: new Map() }; groups.push(g); }
    g.names.set(name, (g.names.get(name) ?? 0) + 1);
  }
  // The contract's own spelling wins; otherwise the one used most, then the longest.
  return groups.map((g) => prefer.find((p) => g.names.has(p))
    ?? Array.from(g.names).sort((p, q) => q[1] - p[1] || q[0].length - p[0].length)[0][0])
    .sort((p, q) => p.localeCompare(q));
}

/** A known spelling close to what was typed but not the same — to offer instead. */
export function closeVendor(typed: string, known: readonly string[]): string | null {
  const t = typed.trim();
  if (vendorKey(t).length < 4) return null;
  if (known.some((k) => k === t)) return null;
  return known.find((k) => sameVendor(k, t)) ?? null;
}

export const partyOf = (row: { vendor: string; party?: WaiverParty | null }, contractName: string): WaiverParty =>
  row.party ?? (isGcVendor(row.vendor, contractName) ? 'gc' : 'sub');

export interface WaiverTotals {
  all: number; count: number;
  gc: number; gcCount: number;
  subs: number; subCount: number;
  /** GC's release less the subs' — the GC's own work, fee and general conditions, or sub releases not in yet. */
  gap: number;
  /** Gap as a share of the GC's release; null with no GC release. */
  gapPct: number | null;
}

/** Totals for a waiver list, leaving out rows marked not needed. */
export function waiverTotals(rows: ReadonlyArray<{ vendor: string; amount: number; notNeeded: boolean; party?: WaiverParty | null }>, contractName: string): WaiverTotals {
  let gc = 0, subs = 0, gcCount = 0, subCount = 0;
  for (const r of rows) {
    if (r.notNeeded) continue;
    if (partyOf(r, contractName) === 'gc') { gc += r.amount; gcCount++; } else { subs += r.amount; subCount++; }
  }
  const gap = r2(gc - subs);
  return { all: r2(gc + subs), count: gcCount + subCount, gc: r2(gc), gcCount, subs: r2(subs), subCount, gap, gapPct: gc > 0.005 ? Math.round((gap / gc) * 10000) / 100 : null };
}

/**
 * The checklist for one pay app: its conditionals as entered, and the
 * unconditionals it should carry for the previous pay app — every
 * conditional from that one (not marked not needed), matched to what has
 * been saved here by link first, then by vendor name; plus any added by hand.
 */
export interface MissingConditional {
  vendor: string;
  party: WaiverParty;
  /** What they released on the pay app before, if they were on it. */
  lastAmount: number | null;
  why: 'gc' | 'was on the previous pay app';
}

/**
 * Tracking starts with the first pay app on the contract that has any waiver
 * on it — the ones before were paid before waivers were kept here.
 */
export function trackingStarts(contractId: number, apps: readonly AppRef[], waivers: readonly Waiver[]): number | null {
  const ids = new Set(waivers.filter((w) => w.contractId === contractId).map((w) => w.applicationId));
  const nums = apps.filter((a) => a.contractId === contractId && ids.has(a.id)).map((a) => a.number);
  return nums.length ? Math.min(...nums) : null;
}

/**
 * Conditionals this pay app should have and doesn't: the GC's always, and
 * every vendor that gave one on the pay app before. One entered here — even
 * marked not needed ("not this month") — answers it.
 */
export function missingConditionals(app: AppRef, apps: readonly AppRef[], waivers: readonly Waiver[], contractName?: string): MissingConditional[] {
  const start = trackingStarts(app.contractId, apps, waivers);
  if (start == null || app.number < start) return [];
  const here = waivers.filter((w) => w.applicationId === app.id && w.kind === 'conditional');
  const prev = previousApp(app, apps);
  const before = prev ? byOrder(waivers.filter((w) => w.applicationId === prev.id && w.kind === 'conditional' && !w.notNeeded && w.amount > 0.005)) : [];
  const out: MissingConditional[] = [];
  const has = (v: string) => here.some((w) => sameVendor(w.vendor, v));
  if (contractName && !here.some((w) => partyOf(w, contractName) === 'gc')) {
    const last = before.find((w) => partyOf(w, contractName) === 'gc');
    out.push({ vendor: last?.vendor ?? contractName, party: 'gc', lastAmount: last ? r2(last.amount) : null, why: 'gc' });
  }
  for (const w of before) {
    if (contractName && partyOf(w, contractName) === 'gc') continue;
    if (has(w.vendor) || out.some((m) => sameVendor(m.vendor, w.vendor))) continue;
    out.push({ vendor: w.vendor, party: w.party ?? 'sub', lastAmount: r2(w.amount), why: 'was on the previous pay app' });
  }
  return out;
}

export function waiverChecklist(appId: number, apps: readonly AppRef[], waivers: readonly Waiver[], contractName?: string) {
  const app = apps.find((a) => a.id === appId);
  if (!app) return { conditionals: [], unconditionals: [] as UnconditionalRow[], previous: null as AppRef | null, outstanding: 0, missing: [] as MissingConditional[] };
  const prev = previousApp(app, apps);
  const conditionals = byOrder(waivers.filter((w) => w.applicationId === appId && w.kind === 'conditional'));
  const mine = waivers.filter((w) => w.applicationId === appId && w.kind === 'unconditional');
  const expected = prev ? byOrder(waivers.filter((w) => w.applicationId === prev.id && w.kind === 'conditional' && !w.notNeeded)) : [];
  const rank = new Map<UnconditionalRow, number>();

  const used = new Set<number>();
  const rows: UnconditionalRow[] = expected.map((c, i) => {
    const hit = mine.find((u) => !used.has(u.id) && u.fromWaiverId === c.id)
      ?? mine.find((u) => !used.has(u.id) && u.fromWaiverId == null && vendorKey(u.vendor) === vendorKey(c.vendor));
    if (hit) used.add(hit.id);
    const vendor = hit ? hit.vendor : c.vendor;
    const amount = hit ? hit.amount : c.amount;
    return {
      id: hit?.id ?? null, vendor, amount,
      expectedVendor: c.vendor, expectedAmount: r2(c.amount), fromWaiverId: c.id,
      received: hit?.received ?? false, notNeeded: hit?.notNeeded ?? false, documentId: hit?.documentId ?? null,
      source: 'expected',
      edited: !!hit && (vendorKey(hit.vendor) !== vendorKey(c.vendor) || Math.abs(hit.amount - c.amount) >= 0.005),
      party: hit?.party ?? c.party ?? null,
    };
  });
  // Arranged by hand wins; otherwise the previous pay app's order, then anything added.
  rows.forEach((r, i) => rank.set(r, mine.find((u) => u.id === r.id)?.sortOrder ?? 1e6 + i));
  for (const u of mine.filter((w) => !used.has(w.id))) {
    const row: UnconditionalRow = {
      id: u.id, vendor: u.vendor, amount: r2(u.amount), expectedVendor: null, expectedAmount: null, fromWaiverId: u.fromWaiverId,
      received: u.received, notNeeded: u.notNeeded, documentId: u.documentId, source: 'added', edited: false, party: u.party ?? null,
    };
    rank.set(row, u.sortOrder ?? 2e6 + u.id);
    rows.push(row);
  }
  rows.sort((a, b) => rank.get(a)! - rank.get(b)!);
  const missing = missingConditionals(app, apps, waivers, contractName);
  const outstanding = conditionals.filter((c) => !c.received && !c.notNeeded).length
    + rows.filter((r) => !r.received && !r.notNeeded).length + missing.length;
  return { conditionals, unconditionals: rows, previous: prev, outstanding, missing };
}

export interface WaiverLogRow {
  contractId: number;
  appId: number;
  appNumber: number;
  vendor: string;
  conditionalAmount: number;
  conditionalReceived: boolean;
  /** The pay app the unconditional is due with, or null if there isn't one yet. */
  unconditionalDueWith: number | null;
  unconditionalAmount: number | null;
  unconditionalReceived: boolean;
  status: 'complete' | 'unconditional outstanding' | 'conditional outstanding' | 'conditional missing' | 'not needed' | 'awaiting next pay app';
  edited: boolean;
  /** The conditional's id (null for a missing one). */
  conditionalId: number | null;
  /** Where the unconditional lives: the next pay app, and its saved row if any. */
  unconditionalAppId: number | null;
  unconditionalId: number | null;
  party: WaiverParty;
}

const isOutstanding = (s: WaiverLogRow['status']) => s === 'unconditional outstanding' || s === 'conditional outstanding' || s === 'conditional missing';
export { isOutstanding as waiverOutstanding };

/**
 * One row per conditional waiver: was it received, and has its
 * unconditional come in with the following pay app.
 */
export function waiverLog(apps: readonly AppRef[], waivers: readonly Waiver[], contractName?: (contractId: number) => string): WaiverLogRow[] {
  const out: WaiverLogRow[] = [];
  const sorted = [...apps].sort((a, b) => a.contractId - b.contractId || a.number - b.number);
  for (const app of sorted) {
    const next = nextApp(app, apps);
    const name = contractName?.(app.contractId);
    const nextList = next ? waiverChecklist(next.id, apps, waivers, name).unconditionals : [];
    for (const c of byOrder(waivers.filter((w) => w.applicationId === app.id && w.kind === 'conditional'))) {
      const u = nextList.find((r) => r.fromWaiverId === c.id);
      const status: WaiverLogRow['status'] = c.notNeeded || u?.notNeeded ? 'not needed'
        : !c.received ? 'conditional outstanding'
        : !next ? 'awaiting next pay app'
        : u?.received ? 'complete' : 'unconditional outstanding';
      out.push({
        contractId: app.contractId, appId: app.id, appNumber: app.docNumber || app.number, vendor: c.vendor,
        conditionalAmount: r2(c.amount), conditionalReceived: c.received,
        unconditionalDueWith: next ? (next.docNumber || next.number) : null, unconditionalAmount: u ? r2(u.amount) : null,
        unconditionalReceived: !!u?.received, status, edited: !!u?.edited,
        conditionalId: c.id, unconditionalAppId: next?.id ?? null, unconditionalId: u?.id ?? null,
        party: name ? partyOf(u ?? c, name) : (c.party ?? 'sub'),
      });
    }
    for (const m of missingConditionals(app, apps, waivers, name)) {
      out.push({
        contractId: app.contractId, appId: app.id, appNumber: app.docNumber || app.number, vendor: m.vendor,
        conditionalAmount: m.lastAmount ?? 0, conditionalReceived: false, unconditionalDueWith: null, unconditionalAmount: null,
        unconditionalReceived: false, status: 'conditional missing', edited: false,
        conditionalId: null, unconditionalAppId: null, unconditionalId: null, party: m.party,
      });
    }
  }
  return out;
}

/** Document types for a pay app package, in the order the zip folders take. */
export const DOC_TYPES: Array<[string, string]> = [
  ['g702', 'GC Pay App (G702 / G703)'],
  ['sub_pay_app', 'Sub Pay App'],
  ['conditional', 'Conditional Waiver'],
  ['unconditional', 'Unconditional Waiver'],
  ['invoice', 'Invoices & Backup'],
  ['other', 'Other'],
];

/** A pay app's vendors, in waiver order, the GC first if it has no conditional yet: one row each for their pay application. */
export function payAppVendors(conditionals: ReadonlyArray<{ vendor: string; party?: WaiverParty | null; notNeeded?: boolean }>, contractName: string) {
  const rows = conditionals.filter((c) => !c.notNeeded).map((c) => ({ vendor: c.vendor, party: partyOf(c, contractName) }));
  if (!rows.some((r) => r.party === 'gc')) rows.unshift({ vendor: contractName, party: 'gc' });
  return rows;
}

/** Is this file that vendor's pay application? The GC's also takes any G702 with no vendor on it. */
export function isPayAppOf(doc: { docType: string | null; vendor?: string | null }, row: { vendor: string; party: WaiverParty }): boolean {
  if (row.party === 'gc') return doc.docType === 'g702' && (!doc.vendor || sameVendor(doc.vendor, row.vendor));
  return doc.docType === 'sub_pay_app' && !!doc.vendor && sameVendor(doc.vendor, row.vendor);
}

export interface PayAppWaiverRow {
  kind: 'conditional' | 'unconditional';
  vendor: string;
  party: WaiverParty;
  /** For a missing conditional: what they released last pay app, if anything. */
  amount: number | null;
  status: 'received' | 'outstanding' | 'missing' | 'not needed';
  /** An unconditional: the pay app it releases (the one before), or null when added by hand with nothing before. */
  releases: number | null;
  edited: boolean;
}
export interface PayAppWaivers {
  contractId: number;
  appId: number;
  appNumber: number;
  rows: PayAppWaiverRow[];
  outstanding: number;
  /** Nothing outstanding — its conditionals in, and the unconditionals it owes for the pay app before. */
  compliant: boolean;
  totals: WaiverTotals;
}

/**
 * The log by pay app, the way a package is assembled: each pay app's
 * conditionals, then the unconditionals it carries for the pay app before.
 * A pay app is compliant once both are in — its own unconditionals are the
 * next pay app's to bring (Adolfo, 2026-10-22).
 */
export function waiversByPayApp(apps: readonly AppRef[], waivers: readonly Waiver[], contractName: (contractId: number) => string): PayAppWaivers[] {
  const sorted = [...apps].sort((a, b) => a.contractId - b.contractId || a.number - b.number);
  const out: PayAppWaivers[] = [];
  for (const app of sorted) {
    const name = contractName(app.contractId);
    const ck = waiverChecklist(app.id, apps, waivers, name);
    if (!ck.conditionals.length && !ck.unconditionals.length && !ck.missing.length) continue;
    const prevNo = ck.previous ? (ck.previous.docNumber || ck.previous.number) : null;
    const st = (w: { received: boolean; notNeeded: boolean }): PayAppWaiverRow['status'] => (w.notNeeded ? 'not needed' : w.received ? 'received' : 'outstanding');
    const rows: PayAppWaiverRow[] = [
      ...ck.conditionals.map((c) => ({ kind: 'conditional' as const, vendor: c.vendor, party: partyOf(c, name), amount: r2(c.amount), status: st(c), releases: null, edited: false })),
      ...ck.missing.map((m) => ({ kind: 'conditional' as const, vendor: m.vendor, party: m.party, amount: m.lastAmount, status: 'missing' as const, releases: null, edited: false })),
      ...ck.unconditionals.map((u) => ({ kind: 'unconditional' as const, vendor: u.vendor, party: partyOf(u, name), amount: r2(u.amount), status: st(u), releases: u.source === 'expected' ? prevNo : null, edited: u.edited })),
    ];
    const outstanding = rows.filter((r) => r.status === 'outstanding' || r.status === 'missing').length;
    out.push({ contractId: app.contractId, appId: app.id, appNumber: app.docNumber || app.number, rows, outstanding, compliant: outstanding === 0, totals: waiverTotals(ck.conditionals, name) });
  }
  return out;
}
