/**
 * Change order routing: where each contractor change order sits between
 * "received" and "approved", who has it, and for how long (Adolfo, 2026-10-23:
 * routing is slow and COs sit; the log has to say where each one is).
 *
 *   Under Review               received from the contractor; pending my review
 *   Returned to Contractor     sent back for revisions or backup
 *   Pending Internal Approval  recommended; over $250,000 or adds 30+ days: routed for approval
 *   Pending Signatures         recommended / approved internally; out for signatures
 *   Approved                   executed and returned; the contractor can bill it
 *   Rejected                   not going ahead
 *
 * The financial status (approved | pending | void) follows the stage.
 */
export type CoStage = 'review' | 'returned' | 'internal' | 'signatures' | 'approved' | 'rejected';
export const CO_STAGES: ReadonlyArray<{ key: CoStage; label: string; hint: string; tone: 'amber' | 'blue' | 'violet' | 'orange' | 'green' | 'gray' }> = [
  { key: 'review', label: 'Under Review', hint: 'Received from the contractor; pending review', tone: 'amber' },
  { key: 'returned', label: 'Returned to Contractor', hint: 'Sent back for revisions or backup', tone: 'orange' },
  { key: 'internal', label: 'Pending Internal Approval', hint: 'Recommended; over $250,000 or adds 30+ days, routed for approval', tone: 'violet' },
  { key: 'signatures', label: 'Pending Signatures', hint: 'Recommended; out for internal signatures', tone: 'blue' },
  { key: 'approved', label: 'Approved', hint: 'Executed and returned to the contractor; can be billed', tone: 'green' },
  { key: 'rejected', label: 'Rejected', hint: 'Not going ahead', tone: 'gray' },
];
export const DEFAULT_CO_THRESHOLD = 250000;
/** Schedule days at or above which a change order goes to the same approvers as the dollar threshold, even at $0. */
export const DEFAULT_CO_DAYS_THRESHOLD = 30;
/** Why it needs the higher-level routing ("Over $250,000.00", "Adds 30+ days"), or null. Tracking only, not enforced. */
export function needsHigherRouting(amount: number, daysAdded: number | null | undefined, threshold = DEFAULT_CO_THRESHOLD, daysThreshold = DEFAULT_CO_DAYS_THRESHOLD): string | null {
  const why = [
    amount > threshold + 0.005 ? `Over ${threshold.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}` : '',
    (daysAdded ?? 0) >= daysThreshold ? `Adds ${daysAdded} days` : '',
  ].filter(Boolean);
  return why.length ? why.join(' · ') : null;
}
export const isStage = (s: unknown): s is CoStage => CO_STAGES.some((x) => x.key === s);
export const stageLabel = (s: CoStage) => CO_STAGES.find((x) => x.key === s)!.label;
export const statusOfStage = (s: CoStage): 'approved' | 'pending' | 'void' => (s === 'approved' ? 'approved' : s === 'rejected' ? 'void' : 'pending');
/** Older change orders have no stage: it follows their status. */
export const stageOf = (co: { stage?: string | null; status: string }): CoStage =>
  isStage(co.stage) ? co.stage : co.status === 'approved' ? 'approved' : co.status === 'void' ? 'rejected' : 'review';
/** Still in someone's hands (not approved or rejected). */
export const isOpenStage = (s: CoStage) => s !== 'approved' && s !== 'rejected';

export type RoutingEntry = { stage: CoStage; at: string; by: string | null; to?: string | null; note?: string | null };
export const parseRouting = (raw: unknown): RoutingEntry[] => {
  if (Array.isArray(raw)) return raw as RoutingEntry[];
  try { const v = JSON.parse(String(raw || '[]')); return Array.isArray(v) ? v : []; } catch { return []; }
};

const day = (s: string | Date | null | undefined) => (s ? String(s instanceof Date ? s.toISOString() : s).slice(0, 10) : null);
const daysBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000));

export interface CoRoutingView {
  stage: CoStage;
  label: string;
  /** Who has it now ("Adolfo", "Camilo", "Nova"). */
  with: string | null;
  received: string | null;
  /** Date it entered its current stage. */
  since: string | null;
  daysInStage: number | null;
  /** Received to approved/rejected, or to today while open. */
  daysOpen: number | null;
  open: boolean;
  /** Needs the higher-level routing and went past review without internal approval. */
  skippedInternal: boolean;
  /** Why it needs the higher-level routing (amount or schedule days), or null. */
  higher: string | null;
  daysAdded: number | null;
  history: RoutingEntry[];
}

export function coRouting(
  co: { stage?: string | null; status: string; routedTo?: string | null; receivedDate?: string | Date | null; createdAt?: string | Date | null; approvedDate?: string | Date | null; routing?: unknown; daysAdded?: number | null },
  amount: number,
  today: string,
  threshold = DEFAULT_CO_THRESHOLD,
  daysThreshold = DEFAULT_CO_DAYS_THRESHOLD,
): CoRoutingView {
  const stage = stageOf(co);
  const history = parseRouting(co.routing);
  const received = day(co.receivedDate) ?? day(co.createdAt);
  const lastOfStage = [...history].reverse().find((h) => h.stage === stage);
  const since = day(lastOfStage?.at) ?? (stage === 'approved' ? day(co.approvedDate) : null) ?? received;
  const end = isOpenStage(stage) ? today : since ?? today;
  const higher = needsHigherRouting(amount, co.daysAdded, threshold, daysThreshold);
  return {
    stage, label: stageLabel(stage), with: co.routedTo ?? null, received, since,
    daysInStage: since && isOpenStage(stage) ? daysBetween(since, today) : null,
    daysOpen: received ? daysBetween(received, end) : null,
    open: isOpenStage(stage),
    skippedInternal: !!higher && (stage === 'signatures' || stage === 'approved') && history.some((h) => h.stage === 'review') && !history.some((h) => h.stage === 'internal'),
    higher, daysAdded: co.daysAdded ?? null,
    history,
  };
}

/** Where a change order goes after review: internal approval when it needs the higher routing, else straight to signatures. */
export const nextAfterReview = (amount: number, daysAdded: number | null | undefined): CoStage => (needsHigherRouting(amount, daysAdded) ? 'internal' : 'signatures');
