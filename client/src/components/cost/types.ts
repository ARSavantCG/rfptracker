/**
 * The shapes the cost-tracking API returns, and the money formatting every
 * cost screen uses. Amounts arrive in DOLLARS; the API converts from cents.
 */
import type { BudgetVsActual, G702, BaselineLine, SovLine, ChangeOrder } from '@shared/cost-tracking';
import type { BudgetApproval } from '@shared/cost-budget-approval';
import type { positionAsOf, DatedApplication, Payment, LedgerEntry } from '@shared/cost-position';

export interface CostProjectRow {
  id: number;
  projectNumber: string;
  name: string;
  rfpId: number | null;
  propertyId: number | null;
  tenantName: string | null;
  status: 'active' | 'closed';
  baseline: BaselineLine[];
  notes: string | null;
  createdAt: string;
}

export interface ContractRow {
  id: number;
  projectId: number;
  counterparty: string;
  bucket: string;
  contractNumber: string | null;
  retainagePct: number;
}

export interface ChangeOrderRow {
  id: number;
  contractId: number;
  number: string;
  title: string | null;
  status: 'approved' | 'pending' | 'void';
}

export interface SovLineRow {
  id: number;
  contractId: number;
  changeOrderId: number | null;
  itemNo: string | null;
  code: string | null;
  description: string;
  scheduledValue: number;
  allocationMode: 'direct' | 'spread' | 'unallocated';
  allocations: { baselineKey: string; pct: number }[];
}

export interface ApplicationRow {
  id: number;
  contractId: number;
  number: number;
  kind: 'pay_app' | 'invoice';
  invoiceNumber: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  notes: string | null;
  lines: { id: number; sovLineId: number; workThisPeriod: number; storedToDate: number; retainageToDate: number }[];
  g702: G702;
}

export interface DocumentRow {
  id: number;
  projectId: number;
  applicationId: number | null;
  contractId: number | null;
  changeOrderId: number | null;
  directCostId: number | null;
  originalName: string;
  sizeBytes: number | null;
  storage: 'object' | 'local';
  createdAt: string;
}

export interface ProjectBundle {
  project: CostProjectRow;
  contracts: ContractRow[];
  changeOrders: ChangeOrderRow[];
  sovLines: SovLineRow[];
  applications: ApplicationRow[];
  documents: DocumentRow[];
  summary: BudgetVsActual & { rows: Array<BudgetVsActual['rows'][number] & { priced: number | null; originalBudget: number | null }> };
  g702ByContract: Record<number, G702>;
  approval: ApprovalView;
  payments: PaymentRow[];
  position: ReturnType<typeof positionAsOf>;
  positionInput: {
    contractIds: number[]; lines: SovLine[]; changeOrders: ChangeOrder[];
    applications: DatedApplication[]; payments: Payment[];
    directCosts: { date: string; amount: number }[];
  };
  cmFee: CmFee | null;
  directCosts: DirectCostRow[];
  ledger: { entries: LedgerEntry[]; total: number; unreconciled: number; unreconciledCount: number };
}

export interface DirectCostRow {
  id: number;
  date: string;
  vendor: string;
  description: string;
  amount: number;
  method: string | null;
  reference: string | null;
  key: string | null;
  reconciled: boolean;
  notes: string | null;
}

export const PAY_METHODS: Array<[string, string]> = [
  ['card', 'Card'], ['check', 'Check'], ['ach', 'ACH'], ['wire', 'Wire'], ['other', 'Other'],
];

export type ApprovalView = BudgetApproval & {
  priced: number;
  distributed: number;
  undistributed: number;
  approvedTotal: number;
  orphaned: { key: string; amount: number }[];
};

export interface PaymentRow {
  id: number;
  contractId: number;
  applicationId: number | null;
  amount: number;
  paidDate: string;
  reference: string | null;
  method: string | null;
  reconciled: boolean;
}

export interface CmFee {
  pct: number;
  key: string | null;
  base: number;
  earned: number;
  paidBase: number;
  earnedOnPaid: number;
  budget: number;
  remaining: number;
}

/** "Oct 20, 2026" from an ISO date or timestamp. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(String(iso).length === 10 ? `${iso}T12:00:00Z` : String(iso));
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
}

/** Today in Eastern time: "2026-10-20". */
export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** Open a server-rendered report in a new tab, carrying the auth token. */
export async function openReport(url: string): Promise<boolean> {
  const { AUTH_TOKEN_KEY } = await import('@/lib/auth-constants');
  const win = window.open('', '_blank');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` } });
  if (!res.ok) { if (win) win.close(); return false; }
  const blobUrl = URL.createObjectURL(await res.blob());
  if (win) win.location.href = blobUrl; else window.location.href = blobUrl;
  return true;
}

export const BUCKET_LABEL: Record<string, string> = {
  contractor: 'Contractor',
  design: 'Design',
  cm: 'CM',
  misc: 'Miscellaneous',
};

/** $1,234.56 — cents always, so lines visibly add up. */
export function money(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/** Variance reads as accountants write it: under budget plain, over in parentheses. */
export function signedMoney(n: number): string {
  return n < 0 ? `(${money(-n)})` : money(n);
}

export function pct(part: number, whole: number): string {
  if (!whole) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export const projectKey = (id: number) => `/api/cost-projects/${id}`;
