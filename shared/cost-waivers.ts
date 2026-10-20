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
}

export interface AppRef {
  id: number;
  contractId: number;
  number: number;
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

/**
 * The checklist for one pay app: its conditionals as entered, and the
 * unconditionals it should carry for the previous pay app — every
 * conditional from that one (not marked not needed), matched to what has
 * been saved here by link first, then by vendor name; plus any added by hand.
 */
export function waiverChecklist(appId: number, apps: readonly AppRef[], waivers: readonly Waiver[]) {
  const app = apps.find((a) => a.id === appId);
  if (!app) return { conditionals: [], unconditionals: [] as UnconditionalRow[], previous: null as AppRef | null, outstanding: 0 };
  const prev = previousApp(app, apps);
  const conditionals = waivers.filter((w) => w.applicationId === appId && w.kind === 'conditional');
  const mine = waivers.filter((w) => w.applicationId === appId && w.kind === 'unconditional');
  const expected = prev ? waivers.filter((w) => w.applicationId === prev.id && w.kind === 'conditional' && !w.notNeeded) : [];

  const used = new Set<number>();
  const rows: UnconditionalRow[] = expected.map((c) => {
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
    };
  });
  for (const u of mine.filter((w) => !used.has(w.id))) {
    rows.push({
      id: u.id, vendor: u.vendor, amount: r2(u.amount), expectedVendor: null, expectedAmount: null, fromWaiverId: u.fromWaiverId,
      received: u.received, notNeeded: u.notNeeded, documentId: u.documentId, source: 'added', edited: false,
    });
  }
  const outstanding = conditionals.filter((c) => !c.received && !c.notNeeded).length
    + rows.filter((r) => !r.received && !r.notNeeded).length;
  return { conditionals, unconditionals: rows, previous: prev, outstanding };
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
  status: 'complete' | 'unconditional outstanding' | 'conditional outstanding' | 'not needed' | 'awaiting next pay app';
  edited: boolean;
}

/**
 * One row per conditional waiver: was it received, and has its
 * unconditional come in with the following pay app.
 */
export function waiverLog(apps: readonly AppRef[], waivers: readonly Waiver[]): WaiverLogRow[] {
  const out: WaiverLogRow[] = [];
  const sorted = [...apps].sort((a, b) => a.contractId - b.contractId || a.number - b.number);
  for (const app of sorted) {
    const next = nextApp(app, apps);
    const nextList = next ? waiverChecklist(next.id, apps, waivers).unconditionals : [];
    for (const c of waivers.filter((w) => w.applicationId === app.id && w.kind === 'conditional')) {
      const u = nextList.find((r) => r.fromWaiverId === c.id);
      const status: WaiverLogRow['status'] = c.notNeeded || u?.notNeeded ? 'not needed'
        : !c.received ? 'conditional outstanding'
        : !next ? 'awaiting next pay app'
        : u?.received ? 'complete' : 'unconditional outstanding';
      out.push({
        contractId: app.contractId, appId: app.id, appNumber: app.number, vendor: c.vendor,
        conditionalAmount: r2(c.amount), conditionalReceived: c.received,
        unconditionalDueWith: next?.number ?? null, unconditionalAmount: u ? r2(u.amount) : null,
        unconditionalReceived: !!u?.received, status, edited: !!u?.edited,
      });
    }
  }
  return out;
}

/** Document types for a pay app package, in the order the zip folders take. */
export const DOC_TYPES: Array<[string, string]> = [
  ['g702', 'G702 / G703'],
  ['conditional', 'Conditional waivers'],
  ['unconditional', 'Unconditional waivers'],
  ['invoice', 'Invoices & backup'],
  ['other', 'Other'],
];
