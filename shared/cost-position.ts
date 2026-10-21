/**
 * Where every contract stands, as of a date: billed, retainage held, paid,
 * owed, and what is left. For the morning check, and for the refinance that
 * lands halfway through a job and wants it all on one page.
 *
 *   billed to date       work completed and stored (G702 line 4), on the
 *                        applications dated on or before the as-of date
 *   retainage held       G702 line 5, on the latest of those
 *   net billed           billed less retainage (line 6): what has been earned
 *                        and is payable
 *   paid                 payments dated on or before the as-of date
 *   owed                 net billed less paid: billed and not yet paid
 *   left to bill         contract sum less billed to date
 *   left to pay          contract sum less paid: owed + retainage + left to bill
 *
 * An application's date is its period end, or when it was entered if it has
 * none. A payment's date is the day it went out.
 *
 * Pure: no database import.
 */
import { g702For, lineStatus, allocate, type SovLine, type ChangeOrder, type Application } from './cost-tracking';

export interface DatedApplication extends Application {
  /** ISO date: period end, or the date entered. */
  date: string;
  kind?: string;
  invoiceNumber?: string | null;
  /** Printed number (Pay App 7, Invoice 2); falls back to `number`. */
  docNumber?: number;
}

export interface Payment {
  id: number;
  contractId: number;
  applicationId: number | null;
  amount: number;
  /** ISO date the payment went out. */
  paidDate: string;
  reference?: string | null;
}

export interface ContractPosition {
  contractId: number;
  contractSum: number;
  /** Change orders still marked pending — not in the contract sum, shown beside it. */
  pendingChanges: number;
  billedToDate: number;
  pctComplete: number;
  retainageHeld: number;
  netBilled: number;
  paid: number;
  owed: number;
  leftToBill: number;
  leftToPay: number;
  /** Number of the latest application counted, or null. */
  lastApplication: number | null;
  /** Payments not tied to any application. Counted in paid. */
  unappliedPayments: number;
}

export interface ApplicationPosition {
  applicationId: number;
  contractId: number;
  number: number;
  docNumber: number;
  kind: string;
  date: string;
  due: number;
  paid: number;
  open: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const day = (iso: string | null | undefined) => String(iso ?? '').slice(0, 10);

export function positionAsOf(asOf: string, input: {
  contractIds: readonly number[];
  lines: readonly SovLine[];
  changeOrders: readonly ChangeOrder[];
  applications: readonly DatedApplication[];
  payments: readonly Payment[];
  /** Card charges and other costs with no contract. Paid when dated. */
  directCosts?: ReadonlyArray<{ date: string; amount: number }>;
}) {
  const cutoff = day(asOf);
  // An application counts once its date has passed — and so does every
  // earlier-numbered one on the same contract, whatever its date says. Pay
  // apps are cumulative; App 7 cannot exist without App 6, and an App 6
  // entered without a period end would otherwise date itself to the day it
  // was typed in and fall out of every earlier position.
  const lastByContract = new Map<number, number>();
  for (const a of input.applications || []) {
    if (day(a.date) <= cutoff) lastByContract.set(a.contractId, Math.max(lastByContract.get(a.contractId) ?? -Infinity, a.number));
  }
  const apps = (input.applications || []).filter((a) => a.number <= (lastByContract.get(a.contractId) ?? -Infinity));
  const pays = (input.payments || []).filter((p) => day(p.paidDate) <= cutoff);
  const cos = new Map((input.changeOrders || []).map((c) => [c.id, c]));

  const contracts: ContractPosition[] = input.contractIds.map((contractId) => {
    const mine = apps.filter((a) => a.contractId === contractId);
    const last = mine.length ? Math.max(...mine.map((a) => a.number)) : null;
    const g = g702For(contractId, last ?? 0, { lines: input.lines, changeOrders: input.changeOrders, applications: mine });
    // Contract sum from the lines directly, so a contract with no application yet still shows it.
    const contractSum = r2((input.lines || [])
      .filter((l) => l.contractId === contractId && lineStatus(l, cos) === 'approved')
      .reduce((s, l) => s + (Number(l.scheduledValue) || 0), 0));
    const billed = last == null ? 0 : g.completedAndStored;
    const held = last == null ? 0 : g.retainage;
    const myPays = pays.filter((p) => p.contractId === contractId);
    const paid = r2(myPays.reduce((s, p) => s + p.amount, 0));
    const net = r2(billed - held);
    const pendingChanges = r2((input.lines || [])
      .filter((l) => l.contractId === contractId && lineStatus(l, cos) === 'pending')
      .reduce((s, l) => s + (Number(l.scheduledValue) || 0), 0));
    return {
      contractId,
      contractSum,
      pendingChanges,
      billedToDate: r2(billed),
      pctComplete: contractSum ? r2((billed / contractSum) * 100) : 0,
      retainageHeld: r2(held),
      netBilled: net,
      paid,
      owed: r2(net - paid),
      leftToBill: r2(contractSum - billed),
      leftToPay: r2(contractSum - paid),
      lastApplication: last,
      unappliedPayments: r2(myPays.filter((p) => p.applicationId == null).reduce((s, p) => s + p.amount, 0)),
    };
  });

  const applications: ApplicationPosition[] = apps.map((a) => {
    const g = g702For(a.contractId, a.number, {
      lines: input.lines, changeOrders: input.changeOrders,
      applications: apps.filter((x) => x.contractId === a.contractId),
    });
    const paid = r2(pays.filter((p) => p.applicationId === a.id).reduce((s, p) => s + p.amount, 0));
    return {
      applicationId: a.id, contractId: a.contractId, number: a.number, docNumber: a.docNumber ?? a.number, kind: a.kind ?? 'pay_app', date: day(a.date),
      due: g.currentPaymentDue, paid, open: r2(g.currentPaymentDue - paid),
    };
  }).sort((x, y) => x.contractId - y.contractId || x.number - y.number);

  const directRows = (input.directCosts || []).filter((d) => day(d.date) <= cutoff);
  const direct = { total: r2(directRows.reduce((s, d) => s + (Number(d.amount) || 0), 0)), count: directRows.length };

  const sum = (k: keyof ContractPosition) => r2(contracts.reduce((s, c) => s + (c[k] as number), 0));
  // A direct cost is billed and paid in one go: it adds to the sum, the
  // billed and the paid, and leaves nothing owed or left to pay.
  const totals = {
    contractSum: r2(sum('contractSum') + direct.total), billedToDate: r2(sum('billedToDate') + direct.total),
    retainageHeld: sum('retainageHeld'),
    netBilled: r2(sum('netBilled') + direct.total), paid: r2(sum('paid') + direct.total), owed: sum('owed'),
    leftToBill: sum('leftToBill'), leftToPay: sum('leftToPay'),
    pctComplete: 0,
  };
  totals.pctComplete = totals.contractSum ? r2((totals.billedToDate / totals.contractSum) * 100) : 0;
  return { asOf: cutoff, contracts, applications, direct, totals };
}

// ------------------------------------------------------------- CM fee

/**
 * The CM fee is a percentage of the work, so it is earned as the work is
 * billed: rate × what has been spent to date on every other budget line.
 * Also shown on what has been paid, which is when it can be drawn in cash.
 */
export interface CmFeeSettings {
  /** Percent, e.g. 3. */
  pct: number;
  /** The budget line the fee sits on; excluded from its own base. */
  key: string | null;
}

/** "Construction Management Fee (3%)" → the line and 3. */
export function detectCmFee(baseline: ReadonlyArray<{ key: string; description: string; bucket: string }>): CmFeeSettings | null {
  const line = baseline.find((b) => b.bucket === 'cm') || baseline.find((b) => /\b(cm|construction management)\b.*fee|fee.*\bcm\b/i.test(b.description));
  if (!line) return null;
  const m = String(line.description).match(/(\d+(?:\.\d+)?)\s*%/);
  return { key: line.key, pct: m ? Number(m[1]) : 3 };
}

export function cmFeeEarned(settings: CmFeeSettings, input: {
  rows: ReadonlyArray<{ key: string; budget: number; toDate: number }>;
  /** Paid to date on contracts other than the CM's own. */
  paidBase: number;
}) {
  const pct = Number.isFinite(settings.pct) ? settings.pct : 0;
  const base = r2(input.rows.filter((r) => r.key !== settings.key).reduce((s, r) => s + r.toDate, 0));
  const budget = r2(input.rows.find((r) => r.key === settings.key)?.budget ?? 0);
  const earned = r2((base * pct) / 100);
  const earnedOnPaid = r2((input.paidBase * pct) / 100);
  return { pct, key: settings.key, base, earned, paidBase: r2(input.paidBase), earnedOnPaid, budget, remaining: r2(budget - earned) };
}

// ------------------------------------------------------------- the ledger

export interface LedgerEntry {
  kind: 'payment' | 'direct';
  id: number;
  date: string;
  vendor: string;
  description: string;
  method: string | null;
  reference: string | null;
  /** Budget line name; for a pay app payment, "Per pay app". */
  budgetLine: string;
  amount: number;
  reconciled: boolean;
  notes?: string | null;
  running: number;
}

/**
 * Every dollar out, in date order, with a running total: payments to the
 * contractors and the architect, and the card charges with no contract. The
 * page someone means when they ask for the job cost ledger.
 */
export function buildLedger(input: {
  payments: ReadonlyArray<{ id: number; contractId: number; applicationId: number | null; amount: number; paidDate: string; reference?: string | null; method?: string | null; reconciled?: boolean }>;
  directCosts: ReadonlyArray<{ id: number; date: string; vendor: string; description: string; amount: number; method?: string | null; reference?: string | null; key?: string | null; reconciled?: boolean; notes?: string | null }>;
  contractName: (id: number) => string;
  applicationLabel: (id: number | null) => string;
  budgetLineName: (key: string | null | undefined) => string;
  from?: string | null;
  to?: string | null;
}): { entries: LedgerEntry[]; total: number; unreconciled: number; unreconciledCount: number } {
  const rows: Omit<LedgerEntry, 'running'>[] = [
    ...input.payments.map((p) => ({
      kind: 'payment' as const, id: p.id, date: day(p.paidDate), vendor: input.contractName(p.contractId),
      description: input.applicationLabel(p.applicationId), method: p.method ?? null, reference: p.reference ?? null,
      budgetLine: 'Per pay app', amount: r2(p.amount), reconciled: !!p.reconciled,
    })),
    ...input.directCosts.map((d) => ({
      kind: 'direct' as const, id: d.id, date: day(d.date), vendor: d.vendor, description: d.description,
      method: d.method ?? null, reference: d.reference ?? null, budgetLine: input.budgetLineName(d.key),
      amount: r2(d.amount), reconciled: !!d.reconciled, notes: d.notes ?? null,
    })),
  ]
    .filter((e) => (!input.from || e.date >= day(input.from)) && (!input.to || e.date <= day(input.to)))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? a.id - b.id : a.kind === 'payment' ? -1 : 1));
  let running = 0;
  const entries = rows.map((e) => { running = r2(running + e.amount); return { ...e, running }; });
  const open = entries.filter((e) => !e.reconciled);
  return {
    entries,
    total: running,
    unreconciled: r2(open.reduce((s, e) => s + e.amount, 0)),
    unreconciledCount: open.length,
  };
}

// ------------------------------------------------------------ CM invoice

/**
 * What the tenant owes in CM fee, to date: the rate on the work the tenant
 * pays for (each budget line's spent to date × its tenant share, leaving out
 * the CM line itself), less what has already been invoiced.
 */
export interface CmInvoiceLine {
  key: string;
  description: string;
  spent: number;
  tenantSharePct: number;
  billable: number;
}

export function cmInvoiceCalc(input: {
  rows: ReadonlyArray<{ key: string; description: string; toDate: number; tenantSharePct: number }>;
  cmKey: string | null;
  pct: number;
  previouslyInvoiced: number;
}) {
  const lines: CmInvoiceLine[] = input.rows
    .filter((r) => r.key !== input.cmKey && Math.abs(r.toDate) >= 0.005)
    .map((r) => ({
      key: r.key, description: r.description, spent: r2(r.toDate), tenantSharePct: r.tenantSharePct,
      billable: r2((r.toDate * r.tenantSharePct) / 100),
    }));
  const base = r2(lines.reduce((s, l) => s + l.billable, 0));
  const earned = r2((base * input.pct) / 100);
  const previous = r2(input.previouslyInvoiced);
  return { lines, base, pct: input.pct, earned, previous, due: r2(earned - previous) };
}

// ------------------------------------------------------- billable items

/**
 * Every item the CM fee is figured on, one row each: each pay app or invoice
 * (its work this period plus the change in stored material) and each direct
 * charge. Each is split across budget lines the way its SOV lines are
 * mapped, and each line's tenant share applied, so the billable column adds
 * to exactly the figure the fee is figured on. Anything on the CM line itself
 * is left out — the fee isn't charged on the fee.
 */
export interface BillableItem {
  /** Stable: "app-12", "direct-7". Lets an issued invoice record which items it covered. */
  ref: string;
  date: string;
  vendor: string;
  item: string;
  amount: number;
  billable: number;
}

export function billableItems(input: {
  lines: readonly SovLine[];
  changeOrders: readonly ChangeOrder[];
  applications: ReadonlyArray<DatedApplication & { kind?: string; invoiceNumber?: string | null }>;
  directCosts: ReadonlyArray<{ id: number; date: string; vendor: string; description: string; amount: number; key: string | null; method?: string | null; reference?: string | null }>;
  /** Tenant share by budget line (effective, after change orders). */
  tenantPct: Map<string, number>;
  validKeys: Set<string>;
  cmKey: string | null;
  contractName: (id: number) => string;
}): BillableItem[] {
  const cos = new Map((input.changeOrders || []).map((c) => [c.id, c]));
  const live = (input.lines || []).filter((l) => lineStatus(l, cos) !== 'void');
  const pctOf = (k: string) => input.tenantPct.get(k) ?? 0;
  const out: BillableItem[] = [];

  const byContract = new Map<number, (typeof input.applications)[number][]>();
  for (const a of input.applications) byContract.set(a.contractId, [...(byContract.get(a.contractId) ?? []), a]);
  for (const [contractId, apps] of Array.from(byContract)) {
    const sorted = [...apps].sort((x, y) => x.number - y.number);
    const storedBefore = new Map<number, number>();
    for (const a of sorted) {
      const amounts = new Map<number, number>();
      for (const l of a.lines) {
        const stored = Number(l.storedToDate) || 0;
        const delta = (Number(l.workThisPeriod) || 0) + stored - (storedBefore.get(l.sovLineId) ?? 0);
        storedBefore.set(l.sovLineId, stored);
        if (delta) amounts.set(l.sovLineId, (amounts.get(l.sovLineId) ?? 0) + delta);
      }
      const split = allocate(live, amounts, input.validKeys);
      let amount = 0, billable = 0;
      for (const [k, v] of Array.from(split)) {
        if (k === input.cmKey) continue;
        amount += v;
        billable += (v * pctOf(k)) / 100;
      }
      if (Math.abs(amount) < 0.005) continue;
      const label = a.kind === 'invoice' ? 'Invoice' : 'Pay App';
      out.push({
        ref: `app-${a.id}`, date: a.date, vendor: input.contractName(contractId),
        item: `${label} ${a.docNumber ?? a.number}${a.invoiceNumber ? ` (${a.invoiceNumber})` : ''}`,
        amount: r2(amount), billable: r2(billable),
      });
    }
  }
  for (const d of input.directCosts) {
    if (d.key && d.key === input.cmKey) continue;
    const pct = d.key && input.validKeys.has(d.key) ? pctOf(d.key) : 0;
    const how = [d.method === 'card' ? 'CC' : d.method ? d.method.toUpperCase() : '', d.reference || ''].filter(Boolean).join(' ');
    out.push({
      ref: `direct-${d.id}`, date: d.date, vendor: d.vendor,
      item: `${d.description || 'Charge'}${how ? ` (${how})` : ''}`,
      amount: r2(d.amount), billable: r2((d.amount * pct) / 100),
    });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.vendor.localeCompare(y.vendor));
}

// ------------------------------------------------------ invoice by type

export type InvoiceType = 'fee' | 'reimbursable';
export type InvoiceBasis = 'paid' | 'billed';

/**
 * Billable items on a PAID basis: what has actually gone out. Each payment
 * against a pay app carries that pay app's billable share (billable ÷
 * amount, from its billed item); direct charges are paid when entered.
 */
export function paidItems(billed: readonly BillableItem[], payments: ReadonlyArray<{ id: number; applicationId: number | null; amount: number; paidDate: string; reference?: string | null }>,
  appInfo: (id: number | null) => { vendor: string; item: string } | null): BillableItem[] {
  const ratio = new Map<string, number>();
  for (const b of billed) if (b.ref.startsWith('app-') && Math.abs(b.amount) >= 0.005) ratio.set(b.ref, b.billable / b.amount);
  const out: BillableItem[] = billed.filter((b) => b.ref.startsWith('direct-')).map((b) => ({ ...b }));
  for (const p of payments) {
    const info = appInfo(p.applicationId);
    const k = `app-${p.applicationId}`;
    out.push({
      ref: `pay-${p.id}`, date: String(p.paidDate).slice(0, 10), vendor: info?.vendor ?? 'Payment',
      item: `Payment — ${info?.item ?? 'pay app'}${p.reference ? ` (${p.reference})` : ''}`,
      amount: r2(p.amount), billable: r2(p.amount * (ratio.get(k) ?? 0)),
    });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.vendor.localeCompare(y.vendor));
}

/**
 * What an invoice asks for.
 *   fee           the CM fee on the billable costs (to a capital partner,
 *                 when the improvement is in the rent)
 *   reimbursable  the billable costs themselves plus the CM fee on them
 *                 (to the tenant, when we pay and are reimbursed)
 * Less whatever earlier invoices already asked for.
 */
export function invoiceCalc(input: { type: InvoiceType; items: readonly BillableItem[]; pct: number; previouslyInvoiced: number }) {
  const costs = r2(input.items.reduce((s, i) => s + i.billable, 0));
  const fee = r2((costs * input.pct) / 100);
  const toDate = input.type === 'reimbursable' ? r2(costs + fee) : fee;
  const previous = r2(input.previouslyInvoiced);
  return { type: input.type, costs, pct: input.pct, fee, toDate, previous, due: r2(toDate - previous) };
}
