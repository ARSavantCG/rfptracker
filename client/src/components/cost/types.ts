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
  contractDate: string | null;
  startDate: string | null;
  completionDate: string | null;
  notes: string | null;
}

export interface ChangeOrderRow {
  id: number;
  contractId: number;
  number: string;
  title: string | null;
  status: 'approved' | 'pending' | 'void';
  /** Set by hand; null = worked out. */
  startAppNumber: number | null;
  /** The pay app it actually starts on, set or worked out (null = no apps yet). */
  startApp: number | null;
  startSource: 'set' | 'billed' | 'recorded' | 'next' | 'none';
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
  /** Order within the contract — drives "previous". Not shown. */
  number: number;
  /** The number shown and printed: Pay App 7, Invoice 2 (each kind counts on its own). */
  docNumber: number;
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
  budgetCoId?: string | null;
  docType: string | null;
  originalName: string;
  sizeBytes: number | null;
  storage: 'object' | 'local';
  createdAt: string;
}

import type { BudgetBreakdownRow, fundingSources } from '@shared/cost-budget-approval';

export interface ProjectBundle {
  project: CostProjectRow;
  contracts: ContractRow[];
  changeOrders: ChangeOrderRow[];
  sovLines: SovLineRow[];
  applications: ApplicationRow[];
  documents: DocumentRow[];
  summary: BudgetVsActual & { rows: Array<BudgetVsActual['rows'][number] & {
    priced: number | null; originalBudget: number | null;
    original: number; revisions: number; transfers: number; changeOrders: number;
  }> };
  breakdown: BudgetBreakdownRow[];
  funding: ReturnType<typeof fundingSources> & { label: string; confirmed: boolean };
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
  cmSettings: { pct: number; key: string | null; source: 'project' | 'line' | 'none' };
  cmInvoices: CmInvoiceRow[];
  cmInvoiceDraft: { type: 'fee' | 'reimbursable'; basis: 'paid' | 'billed'; billTo: string; toDate: number; items: { ref: string; date: string; vendor: string; item: string; amount: number; billable: number; thisInvoice: boolean }[];
    base: number; pct: number; earned: number; previous: number; due: number; lines: { key: string; description: string; spent: number; tenantSharePct: number; billable: number }[] };
  directCosts: DirectCostRow[];
  waivers: Array<import('@shared/cost-waivers').Waiver & { notes: string | null }>;
  ledger: { entries: LedgerEntry[]; total: number; unreconciled: number; unreconciledCount: number };
}

export interface CmInvoiceRow {
  number: string; date: string; base: number; pct: number; earned: number; previous: number; due: number;
  issuedBy: string | null; issuedAt: string;
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
  /** Priced less the deal discount: the LAF budget. */
  approvedTotal: number;
  orphaned: { key: string; amount: number }[];
  changeOrderTotals: { id: string; work: number; cm: number; total: number }[];
  coSummary: { approved: number; approvedBillable: number; approvedAbsorbed: number; pending: number };
  /** LAF budget plus approved change orders. */
  currentTotal: number;
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
  notes?: string | null;
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
  return `${((part / whole) * 100).toFixed(2)}%`;
}

export const projectKey = (id: number) => `/api/cost-projects/${id}`;
