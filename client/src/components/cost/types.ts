/**
 * The shapes the cost-tracking API returns, and the money formatting every
 * cost screen uses. Amounts arrive in DOLLARS; the API converts from cents.
 */
import type { BudgetVsActual, G702, BaselineLine } from '@shared/cost-tracking';

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
  summary: BudgetVsActual;
  g702ByContract: Record<number, G702>;
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
