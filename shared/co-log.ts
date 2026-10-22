/**
 * Vendor (contract) change orders for the lender: amount, the pay app each
 * was approved on, and whether the executed copy is on file.
 * Pure: the server and the screens both feed it the bundle's rows.
 */
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
}

export function coLog(
  cos: ReadonlyArray<{ id: number; contractId: number; number: string; title: string | null; status: string; startApp?: number | null; sortOrder?: number }>,
  lines: ReadonlyArray<{ changeOrderId: number | null; scheduledValue: number }>,
  docs: ReadonlyArray<{ id: number; changeOrderId: number | null; originalName: string }>,
): CoLogRow[] {
  return [...cos]
    .sort((a, b) => a.contractId - b.contractId || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
    .map((c) => {
      const files = docs.filter((d) => d.changeOrderId === c.id).map((d) => ({ id: d.id, originalName: d.originalName }));
      const status = (c.status === 'approved' || c.status === 'void' ? c.status : 'pending') as CoLogRow['status'];
      return {
        id: c.id, contractId: c.contractId, number: c.number, title: c.title ?? null, status,
        amount: r2(lines.filter((l) => l.changeOrderId === c.id).reduce((t, l) => t + (Number(l.scheduledValue) || 0), 0)),
        startApp: c.startApp ?? null, files, executed: status === 'approved' && files.length > 0,
      };
    });
}

/** The change orders a pay app carries: approved ones whose first pay app is this one (its G702 "this period"). */
export const cosOnPayApp = (rows: readonly CoLogRow[], contractId: number, appNumber: number) =>
  rows.filter((r) => r.contractId === contractId && r.status === 'approved' && r.startApp === appNumber);
