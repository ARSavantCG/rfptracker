/**
 * Turning an AI read of a G702/G703 into figures for the pay app dialog.
 *
 * The model reads the PDF and is asked which of our SOV lines each G703 row
 * is. It is not trusted on that: every match is checked here against the
 * contract's real lines, in this order — the id it proposed, then item #,
 * then description, then scheduled value. A row that matches nothing is
 * returned as unmatched so it is shown, never dropped. DB-free, tested.
 */

export type SovRef = { id: number; itemNo: string | null; description: string; scheduledValue: number };

export type ReadRow = {
  /** Position in PayAppRead.rows; survives JSON, unlike object identity. */
  rowIndex: number;
  itemNo: string | null;
  description: string;
  scheduledValue: number | null;
  previous: number | null;
  thisPeriod: number | null;
  stored: number | null;
  totalToDate: number | null;
  retainage: number | null;
  sovLineId: number | null;
  /** The change order the row belongs to, as printed ("CO #3"); null = base contract. */
  changeOrder?: string | null;
};

export type ReadG702 = Partial<Record<
  'originalContractSum' | 'netChangeOrders' | 'contractSumToDate' | 'completedAndStored' | 'retainage'
  | 'earnedLessRetainage' | 'previousCertificates' | 'currentPaymentDue' | 'balanceToFinish', number | null>>;

export type PayAppRead = {
  applicationNumber: number | null;
  invoiceNumber: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  contractor: string | null;
  g702: ReadG702;
  rows: ReadRow[];
  warnings: string[];
};

export type MatchedRow = {
  sovLineId: number;
  work: number;
  stored: number;
  /** null when the G703 has no retainage column — the dialog then uses the contract rate. */
  retainage: number | null;
  previous: number | null;
  matchedBy: 'id' | 'itemNo' | 'description' | 'value';
  row: ReadRow;
};

export type MatchResult = {
  matched: MatchedRow[];
  unmatched: ReadRow[];
  /** Our lines the G703 did not mention. */
  missing: number[];
  warnings: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[^0-9.]/g, '');
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
};

const isoOrNull = (v: unknown): string | null => {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${y}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }
  return null;
};

/** Clean whatever JSON the model returned into a PayAppRead. */
export function normalizeRead(raw: any): PayAppRead {
  const g = raw?.g702 ?? {};
  const g702: ReadG702 = {};
  for (const k of ['originalContractSum', 'netChangeOrders', 'contractSumToDate', 'completedAndStored', 'retainage',
    'earnedLessRetainage', 'previousCertificates', 'currentPaymentDue', 'balanceToFinish'] as const) {
    g702[k] = toNum(g[k]);
  }
  const rows: ReadRow[] = (Array.isArray(raw?.lines) ? raw.lines : [])
    .filter((r: any) => r && String(r.description ?? '').trim() && !r.isSubtotal)
    .map((r: any, i: number) => ({
      rowIndex: i,
      itemNo: r.itemNo != null && String(r.itemNo).trim() ? String(r.itemNo).trim() : null,
      description: String(r.description).trim(),
      scheduledValue: toNum(r.scheduledValue),
      previous: toNum(r.previous),
      thisPeriod: toNum(r.thisPeriod),
      stored: toNum(r.stored),
      totalToDate: toNum(r.totalToDate),
      retainage: toNum(r.retainage),
      sovLineId: Number.isInteger(Number(r.sovLineId)) && r.sovLineId !== null ? Number(r.sovLineId) : null,
      changeOrder: r.changeOrder != null && String(r.changeOrder).trim() ? String(r.changeOrder).trim() : null,
    }));
  const n = toNum(raw?.applicationNumber);
  return {
    applicationNumber: n && n > 0 ? Math.floor(n) : null,
    invoiceNumber: raw?.invoiceNumber ? String(raw.invoiceNumber).trim() : null,
    periodFrom: isoOrNull(raw?.periodFrom),
    periodTo: isoOrNull(raw?.periodTo),
    contractor: raw?.contractor ? String(raw.contractor).trim() : null,
    g702,
    rows,
    warnings: Array.isArray(raw?.warnings) ? raw.warnings.map(String) : [],
  };
}

const normItem = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9.]/g, '').replace(/^0+(?=\d)/, '');
const normText = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s: string) => new Set(normText(s).split(' ').filter((w) => w.length > 2));
const overlap = (a: string, b: string) => {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((w) => { if (B.has(w)) n++; });
  return n / Math.min(A.size, B.size);
};

/** This-period work for a row: column E, or G − D − F when only the total is given. */
export function workOfRow(r: ReadRow): number {
  if (r.thisPeriod != null) return r2(r.thisPeriod);
  if (r.totalToDate != null) return r2(r.totalToDate - (r.previous ?? 0) - (r.stored ?? 0));
  return 0;
}

export function matchRows(read: PayAppRead, lines: SovRef[]): MatchResult {
  const used = new Set<number>();
  const byId = new Map(lines.map((l) => [l.id, l]));
  const matched: MatchedRow[] = [];
  const unmatched: ReadRow[] = [];
  const warnings: string[] = [];

  const take = (row: ReadRow, l: SovRef, by: MatchedRow['matchedBy']) => {
    used.add(l.id);
    matched.push({
      sovLineId: l.id, work: workOfRow(row), stored: r2(row.stored ?? 0),
      retainage: row.retainage == null ? null : r2(row.retainage),
      previous: row.previous == null ? null : r2(row.previous), matchedBy: by, row,
    });
    if (row.scheduledValue != null && Math.abs(row.scheduledValue - l.scheduledValue) > 0.005) {
      warnings.push(`"${row.description}": their scheduled value ${row.scheduledValue.toFixed(2)} vs ours ${l.scheduledValue.toFixed(2)}.`);
    }
  };

  // Several passes so a strong match (item #) is never stolen by a weak one.
  const pending = [...read.rows];
  const pass = (find: (row: ReadRow, free: SovRef[]) => SovRef | undefined, by: MatchedRow['matchedBy']) => {
    for (let i = 0; i < pending.length; i++) {
      const row = pending[i];
      const free = lines.filter((l) => !used.has(l.id));
      const hit = find(row, free);
      if (hit) { take(row, hit, by); pending.splice(i--, 1); }
    }
  };
  pass((row, free) => {
    const l = row.sovLineId != null ? byId.get(row.sovLineId) : undefined;
    if (!l || !free.includes(l)) return undefined;
    // The model's pick must look like the row: same item #, or similar words, or same value.
    const ok = (row.itemNo && normItem(row.itemNo) === normItem(l.itemNo))
      || overlap(row.description, l.description) >= 0.5
      || (row.scheduledValue != null && Math.abs(row.scheduledValue - l.scheduledValue) < 0.005);
    return ok ? l : undefined;
  }, 'id');
  pass((row, free) => {
    if (!row.itemNo) return undefined;
    const hits = free.filter((l) => l.itemNo && normItem(l.itemNo) === normItem(row.itemNo));
    return hits.length === 1 ? hits[0] : undefined;
  }, 'itemNo');
  pass((row, free) => {
    const hits = free.filter((l) => normText(l.description) === normText(row.description));
    return hits.length === 1 ? hits[0] : undefined;
  }, 'description');
  pass((row, free) => {
    if (row.scheduledValue == null) return undefined;
    const hits = free.filter((l) => Math.abs(l.scheduledValue - row.scheduledValue!) < 0.005 && overlap(row.description, l.description) > 0);
    return hits.length === 1 ? hits[0] : undefined;
  }, 'value');
  unmatched.push(...pending);

  const money = (n: number) => n.toFixed(2);
  for (const u of unmatched) {
    const amt = workOfRow(u) + (u.stored ?? 0);
    if (Math.abs(amt) > 0.005) warnings.push(`"${u.description}" (${money(amt)} this period) did not match a line on this contract — enter it by hand or add the line.`);
  }
  return {
    matched,
    unmatched,
    missing: lines.filter((l) => !used.has(l.id)).map((l) => l.id),
    warnings: [...read.warnings, ...warnings],
  };
}

/** The prompt. Lines are listed so the model can propose an id for each row. */
export function payAppPrompt(contractor: string, lines: SovRef[]): string {
  const list = lines.map((l) => `${l.id}\t${l.itemNo ?? ''}\t${l.description}\t${l.scheduledValue.toFixed(2)}`).join('\n');
  return `This PDF is a contractor's pay application from ${contractor}: an AIA G702 (Application and Certificate for Payment) and G703 (Continuation Sheet), or an equivalent invoice.

Read it and return ONLY a JSON object, no preamble and no markdown fences:
{"applicationNumber":number|null,"invoiceNumber":string|null,"periodFrom":"YYYY-MM-DD"|null,"periodTo":"YYYY-MM-DD"|null,"contractor":string|null,
 "g702":{"originalContractSum":number|null,"netChangeOrders":number|null,"contractSumToDate":number|null,"completedAndStored":number|null,"retainage":number|null,"earnedLessRetainage":number|null,"previousCertificates":number|null,"currentPaymentDue":number|null,"balanceToFinish":number|null},
 "lines":[{"itemNo":string|null,"description":string,"scheduledValue":number|null,"previous":number|null,"thisPeriod":number|null,"stored":number|null,"totalToDate":number|null,"retainage":number|null,"sovLineId":number|null,"changeOrder":string|null,"isSubtotal":boolean}],
 "warnings":string[]}

G703 columns: A item no., B description, C scheduled value, D work completed from previous application, E work completed this period, F materials presently stored (not in D or E), G total completed and stored to date, H % (G/C), I balance to finish, J retainage.
- One entry in "lines" per G703 row, including change order rows. Mark subtotal, page total and grand total rows "isSubtotal": true.
- Numbers are plain dollars: no $ or commas; a figure in parentheses is negative. Use null for a blank cell, 0 for a cell showing 0 or "-".
- periodTo is the "period to" date on the G702.
- "changeOrder": for a change order row, the change order number as printed (e.g. "CO #3", "PCCO 001"); null for base contract rows.
- "sovLineId": which of OUR lines below the row is, by its id, or null if none fits. Each of our ids at most once.
- Copy figures exactly as printed. Do not compute or correct anything; if the contractor's math looks wrong, say so in "warnings".

Our schedule of values for this contract (id, item #, description, scheduled value):
${list}`;
}

/* ------------------------------------------------------------------ setup */

export type SetupLine = { rowIndex: number; itemNo: string | null; description: string; scheduledValue: number; changeOrder: string | null };
export type OpeningLine = { rowIndex: number; sovLineId: number | null; work: number; retainage: number | null };
export type SetupPlan = {
  /** New SOV lines to create from G703 rows our contract does not have. */
  lines: SetupLine[];
  /** Change orders those lines need, by the number printed on the G703. */
  changeOrders: string[];
  /** Everything billed before tracking, as one application numbered just before this one. */
  opening: { number: number; label: string; lines: OpeningLine[]; total: number } | null;
  /** Retainage % their G702 implies (line 5 ÷ line 4), offered when it differs from the contract's. */
  retainagePct: number | null;
};

export const coKey = (s: string) => s.toLowerCase().replace(/change\s*order|pcco|co|#|no\.?/g, '').replace(/[^a-z0-9]/g, '').replace(/^0+(?=\d)/, '');

/**
 * What it takes to make our contract match this pay app: lines for the rows
 * that matched nothing, and — when nothing has been recorded before this app —
 * one opening application carrying column D, so "previous" and G702 line 7
 * agree from the first app tracked.
 */
export function setupPlan(read: PayAppRead, m: MatchResult, ctx: {
  thisNumber: number; priorAppCount: number; retainagePct: number;
}): SetupPlan {
  const rowIndex = (r: ReadRow) => r.rowIndex;
  const lines: SetupLine[] = m.unmatched
    .filter((r) => (r.scheduledValue ?? 0) !== 0 || workOfRow(r) !== 0 || (r.previous ?? 0) !== 0)
    .map((r) => ({ rowIndex: rowIndex(r), itemNo: r.itemNo, description: r.description, scheduledValue: r2(r.scheduledValue ?? 0), changeOrder: r.changeOrder ?? null }));
  const changeOrders: string[] = [];
  for (const l of lines) if (l.changeOrder && !changeOrders.some((c) => coKey(c) === coKey(l.changeOrder!))) changeOrders.push(l.changeOrder);

  let opening: SetupPlan['opening'] = null;
  if (ctx.priorAppCount === 0 && ctx.thisNumber > 1) {
    const newIdx = new Set(lines.map((l) => l.rowIndex));
    const ol: OpeningLine[] = [];
    const add = (r: ReadRow, sovLineId: number | null) => {
      const prev = r2(r.previous ?? 0);
      if (!prev) return;
      // Their column J is retainage to date; the share held on earlier work is pro rata.
      const toDate = prev + workOfRow(r) + (r.stored ?? 0);
      const ret = r.retainage != null && toDate ? r2(r.retainage * prev / toDate) : null;
      ol.push({ rowIndex: rowIndex(r), sovLineId, work: prev, retainage: ret });
    };
    for (const x of m.matched) add(x.row, x.sovLineId);
    for (const r of m.unmatched) if (newIdx.has(rowIndex(r))) add(r, null);
    if (ol.length) {
      const n = ctx.thisNumber - 1;
      opening = { number: n, label: n === 1 ? 'App 1 (before tracking)' : `Apps 1–${n} (before tracking)`, lines: ol, total: r2(ol.reduce((s, l) => s + l.work, 0)) };
    }
  }

  const g = read.g702;
  const implied = g.retainage != null && g.completedAndStored ? Math.round((g.retainage / g.completedAndStored) * 10000) / 100 : null;
  const retainagePct = implied != null && Math.abs(implied - ctx.retainagePct) >= 0.01 ? implied : null;
  return { lines, changeOrders, opening, retainagePct };
}

/**
 * The contractor's own G703, kept on the pay app once AI has read it, so the
 * G702 / G703 Comparison can put their figures beside ours line by line.
 * Each row keeps the line it was matched to when read (or null); the report
 * matches again against the lines as they are then.
 */
export type ContractorG703 = { readAt: string; fileName: string | null; rows: ReadRow[] };

/** From an AI read and its match (plus lines just added from it: row index → line id). */
export function contractorG703From(read: PayAppRead, match: MatchResult, fileName: string | null, added?: Record<string | number, number>): ContractorG703 {
  const byRow = new Map<number, number>(match.matched.map((m) => [m.row.rowIndex, m.sovLineId]));
  return {
    readAt: new Date().toISOString(),
    fileName,
    rows: read.rows.map((r) => ({ ...r, sovLineId: byRow.get(r.rowIndex) ?? (added?.[r.rowIndex] != null ? Number(added[r.rowIndex]) : null) })),
  };
}

/** Accepts what the client sends; null clears it, anything unreadable is dropped. */
export function normalizeContractorG703(raw: any): ContractorG703 | null {
  if (!raw || !Array.isArray(raw.rows)) return null;
  const n = (v: unknown) => toNum(v);
  const rows: ReadRow[] = raw.rows.slice(0, 2000).map((r: any, i: number) => ({
    rowIndex: Number.isFinite(Number(r?.rowIndex)) ? Number(r.rowIndex) : i,
    itemNo: r?.itemNo == null || r.itemNo === '' ? null : String(r.itemNo).slice(0, 40),
    description: String(r?.description ?? '').slice(0, 300),
    scheduledValue: n(r?.scheduledValue), previous: n(r?.previous), thisPeriod: n(r?.thisPeriod),
    stored: n(r?.stored), totalToDate: n(r?.totalToDate), retainage: n(r?.retainage),
    sovLineId: Number.isFinite(Number(r?.sovLineId)) && r?.sovLineId != null ? Number(r.sovLineId) : null,
    changeOrder: r?.changeOrder ? String(r.changeOrder).slice(0, 60) : null,
  }));
  return { readAt: typeof raw.readAt === 'string' ? raw.readAt : new Date().toISOString(), fileName: raw.fileName ? String(raw.fileName).slice(0, 200) : null, rows };
}
