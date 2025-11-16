/**
 * RFP Templates Drop‑In Module
 * File: rfp_templates_dropin.ts
 * Purpose: Provide a self-contained templates system (schema, validation, persistence, seeds)
 * that Agent 3 can wire into your Admin → Templates UI and Import flow.
 *
 * Works in Node/TS (ts-node, Vite, Next.js API routes, Express, etc.).
 * If you don’t have TypeScript, you can rename to .js and remove types.
 *
 * Usage (quick):
 *   import Templates from "./rfp_templates_dropin";
 *   await Templates.init(); // creates data/templates.json if missing (with seeds)
 *   const list = await Templates.listTemplates({ search: "", includeArchived: false });
 *   console.log(list.items);
 *
 * Integration targets for Agent 3 (summarized):
 *   - Use `Templates` methods below to build Admin → Templates CRUD.
 *   - Extend your Import modal with a new "Templates" tab that calls `listTemplates` and `getTemplate`,
 *     then imports selected `items` with your conflict policy.
 */

import * as fs from "fs";
import * as path from "path";

// ---------- Types ----------

export type TemplateLineType = "cost" | "allowance" | "percent" | "note";
export type TemplateItemSource = "rom" | "custom";

export interface TemplateItem {
  code: string;                 // merge key
  label: string;
  type: TemplateLineType;
  uom?: string | null;
  qty?: number | null;
  unit_cost?: number | null;
  percent?: number | null;      // for type="percent"
  percent_of?: string | null;   // e.g., "subtotal_hard_costs"
  tags?: string[];
  notes?: string;
  
  // ROM Pilot Integration
  romScopeItemId?: number | null;  // Reference to ROM scope item
  sourceType?: TemplateItemSource; // 'rom' (from ROM pilot) or 'custom' (admin-added)
  
  // Snapshot fields (immutable copy for reliability)
  snapshot?: {
    label: string;
    unit: string;
    unitPrice: number;
    category: string;
    source: string;
    capturedAt: string;          // ISO timestamp when snapshot was taken
  };
  
  // Staleness indicator
  isStale?: boolean;              // True if ROM item has been updated since snapshot
}

export interface TemplateRecord {
  id: string;            // slug, unique
  name: string;
  description?: string;
  category?: string;
  version?: number;
  items: TemplateItem[];
  metadata: {
    createdBy: string;
    createdAt: string;   // ISO
    updatedAt: string;   // ISO
    isArchived: boolean;
    updatedBy?: string;
  };
}

export interface ListResult {
  items: TemplateRecord[];
  total: number;
}

export interface ListOptions {
  search?: string;
  includeArchived?: boolean;
}

// ---------- Config & Storage ----------

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "templates.json");

function ensureDirSync(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function readJSON<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.promises.readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON(file: string, data: any): Promise<void> {
  ensureDirSync(path.dirname(file));
  await fs.promises.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

// ---------- Validation ----------

export function slugifyId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function validateItem(item: TemplateItem): string[] {
  const errors: string[] = [];
  if (!item.code || !/^[A-Za-z0-9\-\_\.]+$/.test(item.code)) {
    errors.push(`Invalid code "${item.code}". Use alphanumerics, - _ .`);
  }
  if (!item.label || item.label.trim().length === 0) {
    errors.push("Label is required");
  }
  if (!["cost", "allowance", "percent", "note"].includes(item.type)) {
    errors.push(`Invalid type "${item.type}"`);
  }
  if (item.type === "percent") {
    if (typeof item.percent !== "number" || isNaN(item.percent)) {
      errors.push("Percent lines require a numeric 'percent'");
    }
    if (!item.percent_of || typeof item.percent_of !== "string") {
      errors.push("Percent lines require 'percent_of' subtotal key");
    }
  }
  if (item.type === "cost" || item.type === "allowance") {
    if (typeof item.qty !== "number" || isNaN(item.qty!)) {
      errors.push("Cost/Allowance lines require numeric 'qty'");
    }
    if (typeof item.unit_cost !== "number" || isNaN(item.unit_cost!)) {
      errors.push("Cost/Allowance lines require numeric 'unit_cost'");
    }
  }
  return errors;
}

export function validateTemplate(tpl: TemplateRecord): string[] {
  const errors: string[] = [];
  if (!tpl.id || tpl.id.trim().length === 0) errors.push("id is required");
  if (!tpl.name || tpl.name.trim().length === 0) errors.push("name is required");
  if (!Array.isArray(tpl.items)) errors.push("items must be an array");
  (tpl.items || []).forEach((it, idx) => {
    const ie = validateItem(it);
    if (ie.length) errors.push(`Item[${idx}] ${ie.join("; ")}`);
  });
  return errors;
}

// ---------- Seeds ----------

function nowISO(): string {
  return new Date().toISOString();
}

const SEEDS: TemplateRecord[] = [
  {
    id: "tpl_ti_baseline_v1",
    name: "Baseline Industrial TI",
    description: "Design, permit fees, and owner soft costs starter.",
    category: "TI",
    version: 1,
    items: [
      { code: "DES-100", label: "Design", type: "cost", qty: 1, unit_cost: 45000, tags: ["soft_cost","precon"], notes: "" },
      { code: "PER-350", label: "Permit Fees", type: "percent", percent: 3.5, percent_of: "subtotal_hard_costs", qty: 1, tags: ["fees"], notes: "" },
      { code: "MAT-TEST", label: "Materials Testing", type: "cost", qty: 1, unit_cost: 30000, tags: ["quality"], notes: "" },
      { code: "BIRD-SP", label: "Bird Spikes", type: "cost", qty: 1, unit_cost: 25000, tags: ["façade"], notes: "" },
      { code: "STR-MOD", label: "Storefront Modifications", type: "cost", qty: 1, unit_cost: 40000, tags: ["façade"], notes: "" }
    ],
    metadata: { createdBy: "seed", createdAt: nowISO(), updatedAt: nowISO(), isArchived: false }
  },
  {
    id: "tpl_core_shell_utils_v1",
    name: "Core & Shell + Utilities",
    description: "Core/shell placeholders incl. switchgear, dock equipment, air curtain.",
    category: "Core/Shell",
    version: 1,
    items: [
      { code: "SWGR-PL", label: "Switchgear Placeholder", type: "allowance", qty: 1, unit_cost: 150000, tags: ["electrical"], notes: "" },
      { code: "DOCK-EQ", label: "Dock Equipment Allowance", type: "allowance", qty: 1, unit_cost: 120000, tags: ["dock"], notes: "" },
      { code: "AIR-CRT", label: "Air Curtain", type: "cost", qty: 1, unit_cost: 20000, tags: ["hvac"], notes: "" }
    ],
    metadata: { createdBy: "seed", createdAt: nowISO(), updatedAt: nowISO(), isArchived: false }
  }
];

// ---------- Core Store ----------

interface StoreShape {
  templates: TemplateRecord[];
}

async function loadStore(): Promise<StoreShape> {
  const data = await readJSON<StoreShape>(DATA_FILE, { templates: [] });
  return data;
}

async function saveStore(store: StoreShape): Promise<void> {
  await writeJSON(DATA_FILE, store);
}

// ---------- Public API ----------

async function init(): Promise<void> {
  ensureDirSync(DATA_DIR);
  if (!fs.existsSync(DATA_FILE)) {
    const validSeeds = SEEDS.filter(t => validateTemplate(t).length === 0);
    await writeJSON(DATA_FILE, { templates: validSeeds });
  }
}

function matchSearch(t: TemplateRecord, q: string): boolean {
  const needle = q.toLowerCase();
  const hay = [
    t.name, t.description || "", t.category || "", t.id,
    ...(t.items?.flatMap(i => [i.code, i.label, ...(i.tags || [])]) || [])
  ].join(" ").toLowerCase();
  return hay.includes(needle);
}

async function listTemplates(opts: ListOptions = {}): Promise<ListResult> {
  const store = await loadStore();
  let arr = store.templates.slice();
  if (!opts.includeArchived) arr = arr.filter(t => !t.metadata.isArchived);
  if (opts.search && opts.search.trim()) {
    arr = arr.filter(t => matchSearch(t, opts.search!.trim()));
  }
  // newest updated first
  arr.sort((a, b) => (b.metadata.updatedAt || "").localeCompare(a.metadata.updatedAt || ""));
  return { items: arr, total: arr.length };
}

async function getTemplate(id: string): Promise<TemplateRecord | null> {
  const store = await loadStore();
  return store.templates.find(t => t.id === id) || null;
}

interface CreateInput {
  name: string;
  description?: string;
  category?: string;
  version?: number;
  items?: TemplateItem[];
  createdBy?: string;
}

async function createTemplate(input: CreateInput): Promise<TemplateRecord> {
  const store = await loadStore();
  const id = "tpl_" + slugifyId(input.name) + "_" + Math.random().toString(36).slice(2, 6);
  const rec: TemplateRecord = {
    id,
    name: input.name,
    description: input.description || "",
    category: input.category || "",
    version: input.version ?? 1,
    items: input.items || [],
    metadata: {
      createdBy: input.createdBy || "admin",
      createdAt: nowISO(),
      updatedAt: nowISO(),
      isArchived: false
    }
  };
  const errs = validateTemplate(rec);
  if (errs.length) throw new Error("Template validation failed: " + errs.join(" | "));
  store.templates.push(rec);
  await saveStore(store);
  return rec;
}

type Patch = Partial<Omit<TemplateRecord, "id" | "metadata">> & {
  metadata?: Partial<TemplateRecord["metadata"]>;
};

async function updateTemplate(id: string, patch: Patch): Promise<TemplateRecord> {
  const store = await loadStore();
  const idx = store.templates.findIndex(t => t.id === id);
  if (idx === -1) throw new Error("Template not found");
  const prev = store.templates[idx];
  const next: TemplateRecord = {
    ...prev,
    ...patch,
    items: patch.items ?? prev.items,
    metadata: {
      ...prev.metadata,
      ...patch.metadata,
      updatedAt: nowISO(),
    }
  };
  const errs = validateTemplate(next);
  if (errs.length) throw new Error("Template validation failed: " + errs.join(" | "));
  store.templates[idx] = next;
  await saveStore(store);
  return next;
}

async function duplicateTemplate(id: string, createdBy: string = "admin"): Promise<TemplateRecord> {
  const orig = await getTemplate(id);
  if (!orig) throw new Error("Template not found");
  const name = orig.name + " (Copy)";
  return createTemplate({
    name,
    description: orig.description,
    category: orig.category,
    version: (orig.version ?? 1) + 1,
    items: JSON.parse(JSON.stringify(orig.items)),
    createdBy
  });
}

async function archiveTemplate(id: string, flag: boolean): Promise<TemplateRecord> {
  const store = await loadStore();
  const idx = store.templates.findIndex(t => t.id === id);
  if (idx === -1) throw new Error("Template not found");
  store.templates[idx].metadata.isArchived = flag;
  store.templates[idx].metadata.updatedAt = nowISO();
  await saveStore(store);
  return store.templates[idx];
}

// ---------- Helpers for Import Flow ----------

export type ConflictPolicy = "add_all" | "merge_by_code" | "skip_duplicates";

export interface ImportPreviewLine {
  code: string;
  label: string;
  type: TemplateLineType;
  computed_value: number | null; // for display only; your app will do the final calc
  source: "template";
  raw: TemplateItem;
}

export interface ImportPreview {
  templateId: string;
  templateName: string;
  count: number;
  lines: ImportPreviewLine[];
}

export interface SubtotalsContext {
  [key: string]: number; // e.g., { subtotal_hard_costs: 1500000 }
}

/**
 * Prepare a preview with naive computed values (qty*unit_cost or percent*context),
 * so the UI can display likely totals before confirming. Your app's calculator remains source of truth.
 */
export function buildImportPreview(tpl: TemplateRecord, ctx: SubtotalsContext = {}): ImportPreview {
  const lines: ImportPreviewLine[] = tpl.items.map((it) => {
    let computed: number | null = null;
    if (it.type === "cost" || it.type === "allowance") {
      if (typeof it.qty === "number" && typeof it.unit_cost === "number") {
        computed = it.qty * it.unit_cost;
      }
    } else if (it.type === "percent") {
      if (typeof it.percent === "number" && it.percent_of && typeof ctx[it.percent_of] === "number") {
        computed = (it.percent / 100) * ctx[it.percent_of];
      }
    }
    return {
      code: it.code,
      label: it.label,
      type: it.type,
      computed_value: computed,
      source: "template",
      raw: it
    };
  });
  return {
    templateId: tpl.id,
    templateName: tpl.name,
    count: lines.length,
    lines
  };
}

/**
 * Given existing "lines" in your evaluation table, apply conflict policy to produce a merged array.
 * This is framework-agnostic; your UI layer should call this and then persist the result as needed.
 */
export interface EvalLine {
  code: string;
  label: string;
  type: TemplateLineType;
  qty?: number | null;
  unit_cost?: number | null;
  percent?: number | null;
  percent_of?: string | null;
  tags?: string[];
  notes?: string;
  // any other fields your evaluation grid uses
}

export function importIntoEvaluation(
  existing: EvalLine[],
  tpl: TemplateRecord,
  policy: ConflictPolicy = "add_all",
  tagWithTemplateId: boolean = true
): EvalLine[] {
  const out = [...existing];
  for (const src of tpl.items) {
    const idx = out.findIndex((e) => e.code === src.code);
    if (policy === "skip_duplicates" && idx !== -1) continue;
    if (policy === "merge_by_code" && idx !== -1) {
      const merged: EvalLine = {
        ...out[idx],
        label: src.label ?? out[idx].label,
        type: src.type ?? out[idx].type,
        qty: src.qty ?? out[idx].qty ?? null,
        unit_cost: src.unit_cost ?? out[idx].unit_cost ?? null,
        percent: src.percent ?? out[idx].percent ?? null,
        percent_of: src.percent_of ?? out[idx].percent_of ?? null,
        tags: Array.from(new Set([...(out[idx].tags || []), ...(src.tags || []), ...(tagWithTemplateId ? [`template:${tpl.id}`] : [])])),
        notes: [out[idx].notes || "", src.notes || ""].filter(Boolean).join(" | ")
      };
      out[idx] = merged;
    } else {
      const fresh: EvalLine = {
        code: src.code,
        label: src.label,
        type: src.type,
        qty: src.qty ?? null,
        unit_cost: src.unit_cost ?? null,
        percent: src.percent ?? null,
        percent_of: src.percent_of ?? null,
        tags: Array.from(new Set([...(src.tags || []), ...(tagWithTemplateId ? [`template:${tpl.id}`] : [])])),
        notes: src.notes || ""
      };
      out.push(fresh);
    }
  }
  return out;
}

// ---------- Export Facade ----------

const Templates = {
  init,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  duplicateTemplate,
  archiveTemplate,
  buildImportPreview,
  importIntoEvaluation,
  validateTemplate,
  validateItem,
  slugifyId
};

export default Templates;

// ---------- CLI for quick smoke tests (optional) ----------
// Commented out for ES module compatibility
// Run directly with: ts-node -e "import('./rfp-templates').then(async (m) => { ... })"

/*
if (require.main === module) {
  (async () => {
    await init();
    const list = await listTemplates({});
    console.log("Seed templates:", list.total);
    const first = list.items[0];
    const preview = buildImportPreview(first, { subtotal_hard_costs: 1_500_000 });
    console.log("Preview of", preview.templateName, "first line:", preview.lines[0]);
    const merged = importIntoEvaluation([], first, "add_all", true);
    console.log("Imported lines:", merged.length);
  })().catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  });
}
*/
