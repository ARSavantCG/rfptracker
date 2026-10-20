/**
 * THE SINGLE RULE for what archiving does to a report.
 *
 * Archiving means "I am done with this; stop showing it to me." An archived
 * RFP therefore drops out of every report, count and filter by default —
 * including the budget reconciliation, where a long-settled project from the
 * app's first weeks would otherwise sit in the results forever with nothing
 * anyone intends to do about it.
 *
 * ARCHIVED IS NOT CANCELLED, and an RFP can be BOTH. They answer different
 * questions. A cancelled deal is a real outcome worth counting — it tells you
 * how many pursuits died. Archiving is a filing decision: it says nothing
 * about the deal, only that it is off the desk.
 *
 * Which is why archiving is a TIMESTAMP on the record and not a status.
 * Writing status='archived' erased whatever the record used to say, so a
 * cancelled RFP could not be archived for the record without destroying the
 * record. Status says what happened; archivedAt says whether you still want
 * to see it. Rows archived under the old scheme carry status='archived' with
 * no timestamp, and are still recognised here.
 *
 * Every report that can be scoped this way accepts ?includeArchived=true, so
 * the history is one parameter away rather than gone. Each one states how many
 * records it left out, because a silently shorter list is how a number ends up
 * being wrong without anyone noticing — which is the fault this codebase has
 * now been bitten by twice.
 */

export const ARCHIVED_STATUS = 'archived';

/** The query parameter every report reads. */
export const INCLUDE_ARCHIVED_PARAM = 'includeArchived';

export interface ArchivableRecord {
  status?: string | null;
  archivedAt?: Date | string | null;
}

/**
 * Is this record archived?
 *
 * Either the timestamp is set, or it is a legacy row still carrying
 * status='archived'. Case and padding tolerated; the column is free text.
 * A bare string argument can only be a status, which is how the older call
 * sites pass it.
 */
export function isArchivedRfp(record: ArchivableRecord | string | null | undefined): boolean {
  if (record && typeof record !== 'string' && record.archivedAt) return true;
  const status = typeof record === 'string' ? record : record?.status;
  return String(status ?? '').trim().toLowerCase() === ARCHIVED_STATUS;
}

/**
 * The statuses that count as live work.
 *
 * Completed is in here on purpose: a finished project is still on the desk
 * until someone files it. Cancelled is not — a dead pursuit is not work.
 */
export const ACTIVE_RFP_STATUSES = ['received', 'in-progress', 'completed'] as const;

/**
 * Is this RFP live work?
 *
 * Both halves matter. A completed RFP that has been archived is no longer
 * active, which is the whole reason for archiving it, and a cancelled one
 * never was.
 */
export function isActiveRfp(record: ArchivableRecord | null | undefined): boolean {
  if (!record || isArchivedRfp(record)) return false;
  const status = String(record.status ?? '').trim().toLowerCase();
  return (ACTIVE_RFP_STATUSES as readonly string[]).includes(status);
}

/**
 * Can this RFP be archived?
 *
 * Only something finished. Archiving live work hides it from the very lists
 * that exist to stop it being forgotten. Completed and cancelled both qualify
 * — cancelled especially, since keeping the record is the reason for filing it.
 */
export function canArchiveRfp(record: ArchivableRecord | null | undefined): boolean {
  if (!record || isArchivedRfp(record)) return false;
  const status = String(record.status ?? '').trim().toLowerCase();
  return status === 'completed' || status === 'cancelled';
}

/**
 * Did the caller ask for archived records?
 *
 * Absent means NO. Archiving is a decision to stop seeing something, so the
 * default has to honour it without being asked each time.
 */
export function parseIncludeArchived(
  query: Record<string, any> | null | undefined,
): boolean {
  const raw = query?.[INCLUDE_ARCHIVED_PARAM];
  if (raw === undefined || raw === null) return false;
  const value = String(Array.isArray(raw) ? raw[0] : raw).trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

export interface ArchiveFilterResult<T> {
  /** What the report should actually use. */
  rows: T[];
  /** How many archived records were left out. Zero when they were included. */
  excludedCount: number;
  /** True when archived records were deliberately kept. */
  included: boolean;
  /**
   * A line for the report header, or '' when there is nothing to say.
   * Reports state this rather than quietly returning a shorter list.
   */
  note: string;
}

/**
 * Drop archived records unless the caller asked for them.
 *
 * Returns the count alongside the rows so the report can say what it did. A
 * filter that silently removes rows is indistinguishable from a bug.
 */
export function applyArchiveFilter<T extends ArchivableRecord>(
  rows: readonly T[] | null | undefined,
  includeArchived: boolean,
): ArchiveFilterResult<T> {
  const all = Array.isArray(rows) ? [...rows] : [];
  if (includeArchived) {
    const archived = all.filter(isArchivedRfp).length;
    return {
      rows: all,
      excludedCount: 0,
      included: true,
      note: archived > 0
        ? `Including ${archived} archived record${archived === 1 ? '' : 's'}.`
        : '',
    };
  }
  const kept = all.filter((r) => !isArchivedRfp(r));
  const excludedCount = all.length - kept.length;
  return {
    rows: kept,
    excludedCount,
    included: false,
    note: excludedCount > 0
      ? `${excludedCount} archived record${excludedCount === 1 ? '' : 's'} excluded.`
      : '',
  };
}
