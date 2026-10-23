/**
 * Vendor (contract) change orders for the lender: amount, the pay app each
 * was approved on, and whether the executed copy is on file.
 * Pure: the server and the screens both feed it the bundle's rows.
 */
import { coRouting, type CoRoutingView } from './co-routing';
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface CoLogRow {
  id: number;
  contractId: number;
  number: string;
  title: string | null;
  status: 'approved' | 'pending' | 'void';
  amount: number;
  /** Pay app number it was approved on (its G702 "this period"); null = none yet. */
  startApp: number | null;
  files: Array<{ id: number; originalName: string }>;
  /** Approved with its executed copy attached. */
  executed: boolean;
  /** Amount from its lines, or as submitted when no lines are entered yet. */
  amountSource: 'lines' | 'proposed' | 'none';
  /** Where it is in routing, who has it, how long. */
  routing: CoRoutingView;
}

export function coLog(
  cos: ReadonlyArray<{ id: number; contractId: number; number: string; title: string | null; status: string; startApp?: number | null; sortOrder?: number;
    stage?: string | null; routedTo?: string | null; receivedDate?: string | Date | null; createdAt?: string | Date | null; approvedDate?: string | Date | null; routing?: unknown; proposedAmount?: number | null; daysAdded?: number | null }>,
  lines: ReadonlyArray<{ changeOrderId: number | null; scheduledValue: number }>,
  docs: ReadonlyArray<{ id: number; changeOrderId: number | null; originalName: string }>,
  today: string = new Date().toISOString().slice(0, 10),
): CoLogRow[] {
  return [...cos]
    .sort((a, b) => a.contractId - b.contractId || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
    .map((c) => {
      const files = docs.filter((d) => d.changeOrderId === c.id).map((d) => ({ id: d.id, originalName: d.originalName }));
      const status = (c.status === 'approved' || c.status === 'void' ? c.status : 'pending') as CoLogRow['status'];
      const own = lines.filter((l) => l.changeOrderId === c.id);
      const fromLines = r2(own.reduce((t, l) => t + (Number(l.scheduledValue) || 0), 0));
      const amountSource: CoLogRow['amountSource'] = own.length ? 'lines' : c.proposedAmount != null ? 'proposed' : 'none';
      const amount = amountSource === 'proposed' ? r2(Number(c.proposedAmount)) : fromLines;
      return {
        id: c.id, contractId: c.contractId, number: c.number, title: c.title ?? null, status,
        amount, amountSource,
        startApp: c.startApp ?? null, files, executed: status === 'approved' && files.length > 0,
        routing: coRouting(c, amount, today),
      };
    });
}

/** The change orders a pay app carries: approved ones whose first pay app is this one (its G702 "this period"). */
export const cosOnPayApp = (rows: readonly CoLogRow[], contractId: number, appNumber: number) =>
  rows.filter((r) => r.contractId === contractId && r.status === 'approved' && r.startApp === appNumber);
