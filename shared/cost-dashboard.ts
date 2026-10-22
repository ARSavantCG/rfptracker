/**
 * Dashboard figures (Adolfo 2026-10-22): the CM fee, vendor billings and the
 * schedule, each split so the parts add to the whole — so each can be one donut.
 * Pure: the server feeds it a project bundle's numbers; the portfolio adds them up.
 */
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface FeeStreamIn {
  /** On work billed to date (the fee earned). */
  earned: number;
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

export type FeeDonut = { paid: number; invoicedUnpaid: number; earnedNotInvoiced: number; notYetEarned: number; anticipated: number; earned: number; invoiced: number };
export function feeDonut(streams: Array<FeeStreamIn & { paid: number }>): FeeDonut {
  const sum = (f: (s: FeeStreamIn & { paid: number }) => number) => r2(streams.reduce((t, s) => t + f(s), 0));
  const paid = sum((s) => s.paid);
  const invoiced = sum((s) => s.invoiced);
  const earned = sum((s) => s.earned);
  const anticipated = sum((s) => Math.max(s.anticipated, s.earned, s.invoiced));
  return {
    paid,
    invoicedUnpaid: r2(Math.max(0, invoiced - paid)),
    earnedNotInvoiced: r2(Math.max(0, earned - invoiced)),
    notYetEarned: r2(Math.max(0, anticipated - Math.max(earned, invoiced))),
    anticipated, earned, invoiced,
  };
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
