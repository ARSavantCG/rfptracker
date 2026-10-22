/**
 * Dashboard figures (Adolfo 2026-10-22): the CM fee, vendor billings and the
 * schedule, each split so the parts add to the whole — so each can be one donut.
 * Pure: the server feeds it a project bundle's numbers; the portfolio adds them up.
 */
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface FeeStreamIn {
  /** On work billed to date (the fee earned). */
  earned: number;
  /** On costs paid to date — the part of earned that's ready to invoice on a paid basis. */
  earnedOnPaid?: number;
  invoiced: number;
  /** Anticipated at completion (original + change orders). */
  anticipated: number;
}
export interface CmInvoiceIn { type?: 'fee' | 'reimbursable'; due: number; earned: number; suppFee?: number; paidAmount?: number | null }

/** Fee on each issued invoice (its running fee less the one before), and the fee part of what's been paid on it. */
export function feePaid(invoices: readonly CmInvoiceIn[]): { fee: number; tenant: number } {
  const last: Record<string, number> = { fee: 0, reimbursable: 0 };
  const out = { fee: 0, tenant: 0 };
  for (const i of invoices) {
    const s = i.type === 'reimbursable' ? 'reimbursable' : 'fee';
    const toDate = (Number(i.earned) || 0) + (Number(i.suppFee) || 0);
    const feeThis = toDate - last[s];
    last[s] = toDate;
    const paid = Number(i.paidAmount) || 0;
    if (!paid || !(i.due > 0)) continue;
    const share = Math.min(1, paid / i.due);
    if (s === 'fee') out.fee += feeThis * share; else out.tenant += feeThis * share;
  }
  return { fee: r2(out.fee), tenant: r2(out.tenant) };
}

/**
 * Earned, Not Invoiced is split by whether the costs behind it have been
 * paid: on costs paid it can be invoiced now; on costs billed but not yet
 * paid it waits for those payments (when invoices are figured on paid).
 * Worked out per stream (each is invoiced on its own), then added up.
 */
export type FeeDonut = {
  paid: number; invoicedUnpaid: number;
  /** Both parts together. */
  earnedNotInvoiced: number;
  earnedNotInvoicedPaid: number; earnedNotInvoicedBilled: number;
  notYetEarned: number; anticipated: number; earned: number; earnedOnPaid: number; invoiced: number;
};
export function feeDonut(streams: Array<FeeStreamIn & { paid: number }>): FeeDonut {
  const out: FeeDonut = { paid: 0, invoicedUnpaid: 0, earnedNotInvoiced: 0, earnedNotInvoicedPaid: 0, earnedNotInvoicedBilled: 0, notYetEarned: 0, anticipated: 0, earned: 0, earnedOnPaid: 0, invoiced: 0 };
  for (const s of streams) {
    const onPaid = Math.min(s.earnedOnPaid ?? s.earned, s.earned);
    const top = Math.max(s.anticipated, s.earned, s.invoiced);
    out.paid += s.paid;
    out.invoicedUnpaid += Math.max(0, s.invoiced - s.paid);
    out.earnedNotInvoicedPaid += Math.max(0, onPaid - s.invoiced);
    out.earnedNotInvoicedBilled += Math.max(0, s.earned - Math.max(s.invoiced, onPaid));
    out.notYetEarned += Math.max(0, top - Math.max(s.earned, s.invoiced));
    out.anticipated += top; out.earned += s.earned; out.earnedOnPaid += onPaid; out.invoiced += s.invoiced;
  }
  out.earnedNotInvoiced = out.earnedNotInvoicedPaid + out.earnedNotInvoicedBilled;
  for (const k of Object.keys(out) as Array<keyof FeeDonut>) out[k] = r2(out[k]);
  return out;
}

export type VendorDonut = { contractSum: number; earned: number; paid: number; owed: number; retainage: number; notBilled: number };
/** Contract sum = paid + approved-unpaid + retainage held + not yet billed. */
export function vendorDonut(t: { contractSum: number; billedToDate: number; paid: number; owed: number; retainageHeld: number }): VendorDonut {
  return {
    contractSum: r2(t.contractSum), earned: r2(t.billedToDate), paid: r2(t.paid), owed: r2(Math.max(0, t.owed)),
    retainage: r2(t.retainageHeld), notBilled: r2(Math.max(0, t.contractSum - t.billedToDate)),
  };
}

export type ScheduleStatus = 'done' | 'on-track' | 'behind' | 'late' | 'no-dates';
export interface ScheduleRow { contractId: number; name: string; start: string | null; finish: string | null; pctTime: number | null; pctBilled: number; status: ScheduleStatus; daysLeft: number | null }
const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

/**
 * Billing against the calendar, per contract: % of the time from start to
 * substantial completion that has passed, against % of the contract billed.
 * Behind = billed trails the time gone by more than 10 points; late = past
 * substantial completion and not fully billed.
 */
export function scheduleRows(contracts: ReadonlyArray<{ id: number; counterparty: string; startDate?: string | null; completionDate?: string | null }>,
  pct: (contractId: number) => number, today: string): ScheduleRow[] {
  const now = day(today);
  return contracts.map((c) => {
    const billed = Math.max(0, Math.min(100, pct(c.id)));
    const start = c.startDate && /^\d{4}-\d{2}-\d{2}/.test(c.startDate) ? c.startDate.slice(0, 10) : null;
    const finish = c.completionDate && /^\d{4}-\d{2}-\d{2}/.test(c.completionDate) ? c.completionDate.slice(0, 10) : null;
    const base = { contractId: c.id, name: c.counterparty, start, finish, pctBilled: r2(billed) };
    if (billed >= 99.5) return { ...base, pctTime: start && finish ? 100 : null, status: 'done' as const, daysLeft: finish ? Math.round((day(finish) - now) / 864e5) : null };
    if (!start || !finish || day(finish) <= day(start)) return { ...base, pctTime: null, status: 'no-dates' as const, daysLeft: finish ? Math.round((day(finish) - now) / 864e5) : null };
    const pctTime = Math.max(0, Math.min(100, ((now - day(start)) / (day(finish) - day(start))) * 100));
    const daysLeft = Math.round((day(finish) - now) / 864e5);
    const status: ScheduleStatus = daysLeft < 0 ? 'late' : billed + 10 < pctTime ? 'behind' : 'on-track';
    return { ...base, pctTime: r2(pctTime), status, daysLeft };
  });
}

export function scheduleCounts(rows: readonly ScheduleRow[]) {
  const c: Record<ScheduleStatus, number> = { 'done': 0, 'on-track': 0, 'behind': 0, 'late': 0, 'no-dates': 0 };
  for (const r of rows) c[r.status]++;
  return c;
}

export interface ProjectDashboard {
  fee: FeeDonut;
  feeByParty: { capital: FeeDonut; tenant: FeeDonut };
  vendor: VendorDonut;
  schedule: ScheduleRow[];
  spent: number; budget: number; committed: number;
}
