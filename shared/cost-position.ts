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
import { g702For, lineStatus, type SovLine, type ChangeOrder, type Application } from './cost-tracking';

export interface DatedApplication extends Application {
  /** ISO date: period end, or the date entered. */
  date: string;
  kind?: string;
  invoiceNumber?: string | null;
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
    return {
      contractId,
      contractSum,
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
      applicationId: a.id, contractId: a.contractId, number: a.number, date: day(a.date),
      due: g.currentPaymentDue, paid, open: r2(g.currentPaymentDue - paid),
    };
  }).sort((x, y) => x.contractId - y.contractId || x.number - y.number);

  const sum = (k: keyof ContractPosition) => r2(contracts.reduce((s, c) => s + (c[k] as number), 0));
  const totals = {
    contractSum: sum('contractSum'), billedToDate: sum('billedToDate'), retainageHeld: sum('retainageHeld'),
    netBilled: sum('netBilled'), paid: sum('paid'), owed: sum('owed'),
    leftToBill: sum('leftToBill'), leftToPay: sum('leftToPay'),
    pctComplete: 0,
  };
  totals.pctComplete = totals.contractSum ? r2((totals.billedToDate / totals.contractSum) * 100) : 0;
  return { asOf: cutoff, contracts, applications, totals };
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
