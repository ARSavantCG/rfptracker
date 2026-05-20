import { useState, useMemo, useRef, useEffect, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import Navigation from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import * as XLSX from "xlsx";
import {
  ArrowLeft, Download, Search, ChevronUp, ChevronDown,
  ChevronsUpDown, X, Check, TableIcon, Filter
} from "lucide-react";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MasterCategory { id: number; name: string; description?: string }
interface ScopeItem { id: number; name: string; description?: string; category: string }
interface Property { id: number; propertyName: string; building: string }

interface PickerItem { type: "category" | "scopeItem"; id: number; label: string }

interface ProjectRow {
  rfpId: number;
  rfpNumber: string;
  tenantName: string;
  property: string;
  status: string;
  receivedOn: string;
  grandTotal: number | null;
  itemAmounts: Record<string, number | null>;
  contingencyAmount: number | null;
}
interface ColDef { key: string; label: string; type: "category" | "scopeItem" }
interface ReportData { projects: ProjectRow[]; columns: ColDef[] }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_LIST = [
  { value: "received",    label: "Received",    color: "bg-purple-100 text-purple-800" },
  { value: "in-progress", label: "In Progress", color: "bg-orange-100 text-orange-800" },
  { value: "completed",   label: "Completed",   color: "bg-green-100 text-green-800" },
  { value: "archived",    label: "Archived",    color: "bg-gray-100 text-gray-700" },
];

function fmtDollar(n: number | null): string {
  if (n === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(1)}%`;
}
function pct(amount: number | null, total: number | null): number | null {
  if (amount === null || total === null || total === 0) return null;
  return (amount / total) * 100;
}
// CM fee % uses base-backout: CM / (Total − CM − Contingency)
// because CM is a markup ON the base, not a direct cost.
// ROM build order: Base → CM (2.75% of Base) → Contingency (5% of Base+CM) → Total
function pctCMBase(
  cmAmt: number | null,
  grandTotal: number | null,
  contingencyAmt: number | null
): number | null {
  if (cmAmt === null || grandTotal === null) return null;
  const base = grandTotal - cmAmt - (contingencyAmt ?? 0);
  if (base <= 0) return null;
  return (cmAmt / base) * 100;
}
function isCmColumn(label: string): boolean {
  return label.toLowerCase().includes("construction management");
}
function statusColor(s: string) {
  switch (s) {
    case "received":    return "bg-purple-100 text-purple-800";
    case "in-progress": return "bg-orange-100 text-orange-800";
    case "completed":   return "bg-green-100 text-green-800";
    case "archived":    return "bg-gray-100 text-gray-700";
    default:            return "bg-gray-100 text-gray-700";
  }
}
function statusLabel(s: string) {
  return STATUS_LIST.find(x => x.value === s)?.label ?? s;
}

// ─── Sortable column header ───────────────────────────────────────────────────

function SortHeader({
  col, label, sortCol, sortDir, onSort
}: { col: string; label: string; sortCol: string; sortDir: "asc"|"desc"; onSort: (c: string) => void }) {
  const active = sortCol === col;
  return (
    <button
      onClick={() => onSort(col)}
      className="flex items-center gap-1 text-left w-full hover:text-gray-900 font-medium whitespace-nowrap"
    >
      {label}
      {active
        ? sortDir === "asc" ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />
        : <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-30" />}
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CategoryCostBreakdownReport() {
  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["completed", "in-progress"]);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<number[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedItems, setSelectedItems] = useState<PickerItem[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Table
  const [tableSearch, setTableSearch] = useState("");
  const [sortCol, setSortCol] = useState("rfpNumber");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Report state
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Close picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Data for picker
  const { data: masterCategories = [] } = useQuery<MasterCategory[]>({
    queryKey: ["/api/master-categories"],
  });
  const { data: rawScopeItems = [] } = useQuery<ScopeItem[]>({
    queryKey: ["/api/rom-scope-items"],
  });
  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  // Sort properties by name then building number for display
  const sortedProperties = useMemo(() => {
    return [...properties].sort((a, b) => {
      const nameCompare = a.propertyName.localeCompare(b.propertyName);
      if (nameCompare !== 0) return nameCompare;
      return a.building.localeCompare(b.building, undefined, { numeric: true });
    });
  }, [properties]);

  // Build grouped picker options
  const pickerGroups = useMemo(() => {
    const q = pickerSearch.toLowerCase();
    const cats = masterCategories.filter(c =>
      !q || c.name.toLowerCase().includes(q)
    ).map(c => ({ type: "category" as const, id: c.id, label: c.name }));

    // Group scope items by their category field
    const byCat: Record<string, typeof rawScopeItems> = {};
    rawScopeItems.forEach(si => {
      if (!q || si.name.toLowerCase().includes(q) || (si.description || "").toLowerCase().includes(q)) {
        const k = si.category || "Other";
        byCat[k] = byCat[k] || [];
        byCat[k].push(si);
      }
    });

    return { cats, byCat };
  }, [masterCategories, rawScopeItems, pickerSearch]);

  const selectedKeys = useMemo(() => new Set(selectedItems.map(i => `${i.type}_${i.id}`)), [selectedItems]);

  function toggleItem(item: PickerItem) {
    const k = `${item.type}_${item.id}`;
    setSelectedItems(prev =>
      selectedKeys.has(k) ? prev.filter(i => `${i.type}_${i.id}` !== k) : [...prev, item]
    );
  }
  function removeItem(item: PickerItem) {
    const k = `${item.type}_${item.id}`;
    setSelectedItems(prev => prev.filter(i => `${i.type}_${i.id}` !== k));
  }

  function toggleStatus(s: string) {
    setSelectedStatuses(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
  }
  function toggleProperty(id: number) {
    setSelectedPropertyIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function handleSort(col: string) {
    setSortCol(c => {
      if (c === col) { setSortDir(d => d === "asc" ? "desc" : "asc"); return col; }
      setSortDir("asc");
      return col;
    });
  }

  // Run report
  async function runReport() {
    if (selectedItems.length === 0) return;
    setLoading(true);
    setReportError(null);
    setReportData(null);
    try {
      const params = new URLSearchParams({
        statuses: selectedStatuses.join(","),
        propertyIds: selectedPropertyIds.join(","),
        dateFrom,
        dateTo,
        items: JSON.stringify(selectedItems.map(i => ({ type: i.type, id: i.id, label: i.label }))),
      });
      const data = await apiRequest(`/api/reports/category-cost-breakdown?${params}`, "GET");
      setReportData(data as ReportData);
    } catch (err) {
      setReportError("Failed to generate report. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Filtered + sorted rows
  const displayRows = useMemo(() => {
    if (!reportData) return [];
    let rows = reportData.projects;
    if (tableSearch) {
      const q = tableSearch.toLowerCase();
      rows = rows.filter(r =>
        r.tenantName.toLowerCase().includes(q) || r.rfpNumber.toLowerCase().includes(q)
      );
    }
    rows = [...rows].sort((a, b) => {
      let va: any, vb: any;
      if (sortCol === "rfpNumber")   { va = a.rfpNumber; vb = b.rfpNumber; }
      else if (sortCol === "tenant") { va = a.tenantName; vb = b.tenantName; }
      else if (sortCol === "property") { va = a.property; vb = b.property; }
      else if (sortCol === "status") { va = a.status; vb = b.status; }
      else if (sortCol === "receivedOn") { va = new Date(a.receivedOn).getTime(); vb = new Date(b.receivedOn).getTime(); }
      else if (sortCol === "grandTotal") { va = a.grandTotal ?? -1; vb = b.grandTotal ?? -1; }
      else {
        // Dynamic column — sort by dollar amount
        va = a.itemAmounts[sortCol] ?? -1;
        vb = b.itemAmounts[sortCol] ?? -1;
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [reportData, tableSearch, sortCol, sortDir]);

  // Footer totals
  const footerTotals = useMemo(() => {
    if (!reportData) return {};
    const totals: Record<string, number | null> = {
      grandTotal: displayRows.reduce((s, r) => r.grandTotal != null ? s + r.grandTotal : s, 0),
    };
    reportData.columns.forEach(col => {
      const sum = displayRows.reduce((s, r) => {
        const v = r.itemAmounts[col.key];
        return v != null ? s + v : s;
      }, 0);
      totals[col.key] = sum;
      // For CM columns also compute sum of bases for a correct weighted-average %
      if (isCmColumn(col.label)) {
        const baseSum = displayRows.reduce((s, r) => {
          const cmAmt = r.itemAmounts[col.key];
          if (cmAmt === null || r.grandTotal === null) return s;
          const base = r.grandTotal - cmAmt - (r.contingencyAmount ?? 0);
          return base > 0 ? s + base : s;
        }, 0);
        totals[`${col.key}_base`] = baseSum > 0 ? baseSum : null;
      }
    });
    return totals;
  }, [reportData, displayRows]);

  // Weighted average pct for footer
  function footerPct(colKey: string): number | null {
    const col = reportData?.columns.find(c => c.key === colKey);
    if (col && isCmColumn(col.label)) {
      return pct(footerTotals[colKey] ?? null, footerTotals[`${colKey}_base`] ?? null);
    }
    const colAmt = footerTotals[colKey];
    const colGrand = footerTotals["grandTotal"];
    return pct(colAmt ?? null, colGrand ?? null);
  }

  // Export to Excel
  function exportToExcel() {
    if (!reportData) return;
    const cols = reportData.columns;
    const header: string[] = [
      "Project ID", "Tenant", "Property", "Status", "Received Date", "Total Project Cost",
      ...cols.flatMap(c => [`${c.label} $`, `${c.label} %`]),
    ];
    const dataRows = displayRows.map(r => [
      r.rfpNumber,
      r.tenantName,
      r.property,
      statusLabel(r.status),
      r.receivedOn ? format(new Date(r.receivedOn), "yyyy-MM-dd") : "",
      r.grandTotal ?? "",
      ...cols.flatMap(c => {
        const amt = r.itemAmounts[c.key];
        const p = pct(amt, r.grandTotal);
        return [amt ?? "", p != null ? p / 100 : ""];
      }),
    ]);
    const footerRow: any[] = [
      "TOTALS", "", "", "", "", footerTotals["grandTotal"] ?? "",
      ...cols.flatMap(c => {
        const amt = footerTotals[c.key];
        const p = footerPct(c.key);
        return [amt ?? "", p != null ? p / 100 : ""];
      }),
    ];

    const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows, footerRow]);
    // Format currency columns
    const currencyCols = [5, ...cols.flatMap((_, i) => [6 + i * 2])];
    currencyCols.forEach(ci => {
      for (let ri = 1; ri <= dataRows.length + 1; ri++) {
        const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
        if (ws[addr] && typeof ws[addr].v === "number") {
          ws[addr].z = '$#,##0';
        }
      }
    });
    const pctCols = cols.flatMap((_, i) => [7 + i * 2]);
    pctCols.forEach(ci => {
      for (let ri = 1; ri <= dataRows.length + 1; ri++) {
        const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
        if (ws[addr] && typeof ws[addr].v === "number") {
          ws[addr].z = '0.0%';
        }
      }
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Category Cost Breakdown");
    XLSX.writeFile(wb, `category-cost-breakdown-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  }

  const canRun = selectedItems.length > 0 && !loading;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <div className="max-w-screen-2xl mx-auto px-6 py-5 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/reports">
            <button className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
              <ArrowLeft className="h-4 w-4" />
              Reports
            </button>
          </Link>
          <div className="h-4 border-l border-gray-300" />
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <TableIcon className="h-5 w-5 text-blue-600" />
              Category Cost Breakdown
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Project-level cost data sliced by master category or specific scope item
            </p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">Filters</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Status multi-select */}
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Status</label>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_LIST.map(s => (
                  <button
                    key={s.value}
                    onClick={() => toggleStatus(s.value)}
                    className={`px-2.5 py-1 rounded text-xs border transition-all ${
                      selectedStatuses.includes(s.value)
                        ? `${s.color} border-transparent font-medium`
                        : "bg-white text-gray-500 border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Property multi-select */}
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Property</label>
              <div className="flex flex-wrap gap-1 max-h-[72px] overflow-y-auto">
                {sortedProperties.length === 0 && (
                  <span className="text-xs text-gray-400 italic">Loading…</span>
                )}
                {sortedProperties.map((p: Property) => (
                  <button
                    key={p.id}
                    onClick={() => toggleProperty(p.id)}
                    className={`px-2 py-0.5 rounded text-xs border transition-all ${
                      selectedPropertyIds.includes(p.id)
                        ? "bg-blue-600 text-white border-transparent font-medium"
                        : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                    }`}
                  >
                    {p.propertyName} - Bldg. {p.building}
                  </button>
                ))}
                {sortedProperties.length > 0 && (
                  <button
                    onClick={() => setSelectedPropertyIds(sortedProperties.map(p => p.id))}
                    className="text-xs text-gray-400 hover:text-gray-600 px-1 shrink-0"
                  >
                    Select All
                  </button>
                )}
                {selectedPropertyIds.length > 0 && (
                  <button onClick={() => setSelectedPropertyIds([])} className="text-xs text-gray-400 hover:text-gray-600 px-1 shrink-0">
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Date range */}
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">
                Received Date Range
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-full"
                />
                <span className="text-gray-400 text-xs shrink-0">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-full"
                />
              </div>
            </div>

            {/* Category / Scope Item picker */}
            <div ref={pickerRef} className="relative">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">
                Categories / Scope Items <span className="text-red-400">*</span>
              </label>
              <button
                onClick={() => setPickerOpen(o => !o)}
                className={`w-full flex items-center justify-between border rounded px-2.5 py-1.5 text-xs bg-white transition-colors ${
                  pickerOpen ? "border-blue-500 ring-1 ring-blue-500" : "border-gray-300 hover:border-gray-400"
                }`}
              >
                <span className={selectedItems.length ? "text-gray-800" : "text-gray-400"}>
                  {selectedItems.length
                    ? `${selectedItems.length} selected`
                    : "Select categories or scope items…"}
                </span>
                <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Selected tags */}
              {selectedItems.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {selectedItems.map(item => (
                    <span
                      key={`${item.type}_${item.id}`}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                        item.type === "category"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-teal-100 text-teal-800"
                      }`}
                    >
                      {item.label}
                      <button onClick={() => removeItem(item)} className="hover:opacity-70">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Dropdown */}
              {pickerOpen && (
                <div className="absolute z-50 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                  <div className="p-2 border-b">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                      <input
                        autoFocus
                        type="text"
                        placeholder="Search categories or scope items…"
                        value={pickerSearch}
                        onChange={e => setPickerSearch(e.target.value)}
                        className="w-full pl-6 pr-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {/* Master Categories section */}
                    {pickerGroups.cats.length > 0 && (
                      <div>
                        <div className="px-3 py-1.5 bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wide sticky top-0">
                          Master Categories
                        </div>
                        {pickerGroups.cats.map(item => {
                          const k = `${item.type}_${item.id}`;
                          const checked = selectedKeys.has(k);
                          return (
                            <button
                              key={k}
                              onClick={() => toggleItem(item)}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-blue-50 transition-colors ${
                                checked ? "bg-blue-50" : ""
                              }`}
                            >
                              <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                                checked ? "bg-blue-600 border-blue-600" : "border-gray-300"
                              }`}>
                                {checked && <Check className="h-2.5 w-2.5 text-white" />}
                              </div>
                              <span className={checked ? "font-medium text-blue-800" : "text-gray-700"}>
                                {item.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Scope Items sections grouped by category — soft costs group always first */}
                    {Object.entries(pickerGroups.byCat).sort(([a], [b]) => {
                      const SOFT = "Design / Soft Costs / Other Fees";
                      if (a === SOFT) return -1;
                      if (b === SOFT) return 1;
                      return a.localeCompare(b);
                    }).map(([cat, items]) => (
                      <div key={cat}>
                        <div className="px-3 py-1.5 bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wide sticky top-0">
                          Scope: {cat}
                        </div>
                        {items.map(si => {
                          const item: PickerItem = { type: "scopeItem", id: si.id, label: si.name };
                          const k = `scopeItem_${si.id}`;
                          const checked = selectedKeys.has(k);
                          return (
                            <button
                              key={k}
                              onClick={() => toggleItem(item)}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-teal-50 transition-colors ${
                                checked ? "bg-teal-50" : ""
                              }`}
                            >
                              <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                                checked ? "bg-teal-600 border-teal-600" : "border-gray-300"
                              }`}>
                                {checked && <Check className="h-2.5 w-2.5 text-white" />}
                              </div>
                              <div className="min-w-0">
                                <p className={`${checked ? "font-medium text-teal-800" : "text-gray-700"} truncate`}>
                                  {si.name}
                                </p>
                                {si.description && (
                                  <p className="text-[10px] text-gray-400 truncate">{si.description}</p>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ))}

                    {pickerGroups.cats.length === 0 && Object.keys(pickerGroups.byCat).length === 0 && (
                      <div className="px-3 py-6 text-center text-xs text-gray-400">
                        No matches for "{pickerSearch}"
                      </div>
                    )}
                  </div>
                  <div className="p-2 border-t flex justify-end">
                    <button onClick={() => setPickerOpen(false)} className="text-xs text-blue-600 hover:underline">
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Run report button */}
          <div className="flex items-center gap-3 pt-1">
            <Button onClick={runReport} disabled={!canRun} className="h-8 text-sm">
              {loading ? "Running…" : "Run Report"}
            </Button>
            {selectedItems.length === 0 && (
              <span className="text-xs text-amber-600">
                Select at least one category or scope item to run the report.
              </span>
            )}
            {reportError && (
              <span className="text-xs text-red-600">{reportError}</span>
            )}
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {/* Empty state — no items selected */}
        {!loading && !reportData && selectedItems.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-10 text-center text-gray-400">
            <TableIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Select at least one category or scope item above, then click Run Report.</p>
            <p className="text-xs mt-1 opacity-70">
              Use the picker to choose master categories (aggregated by tagged bid items) or specific scope items
              (matched from evaluation budgets by library reference).
            </p>
          </div>
        )}

        {/* Results */}
        {!loading && reportData && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {/* Table toolbar */}
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-gray-700">
                {displayRows.length} project{displayRows.length !== 1 ? "s" : ""}
                {tableSearch && ` matching "${tableSearch}"`}
                {displayRows.length !== reportData.projects.length && ` (${reportData.projects.length} total)`}
              </span>
              <div className="relative ml-2">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search by tenant or RFP#…"
                  value={tableSearch}
                  onChange={e => setTableSearch(e.target.value)}
                  className="pl-6 pr-2 py-1.5 border border-gray-300 rounded text-xs w-52 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {tableSearch && (
                  <button onClick={() => setTableSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7 text-xs gap-1"
                onClick={exportToExcel}
                disabled={displayRows.length === 0}
              >
                <Download className="h-3 w-3" />
                Export Excel
              </Button>
            </div>

            {/* No results after filtering */}
            {displayRows.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">
                No projects match the selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2.5 text-left text-gray-500 font-medium min-w-[100px]">
                        <SortHeader col="rfpNumber" label="Project ID" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="px-3 py-2.5 text-left text-gray-500 font-medium min-w-[120px]">
                        <SortHeader col="tenant" label="Tenant" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="px-3 py-2.5 text-left text-gray-500 font-medium min-w-[120px]">
                        <SortHeader col="property" label="Property" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="px-3 py-2.5 text-left text-gray-500 font-medium">
                        <SortHeader col="status" label="Status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="px-3 py-2.5 text-left text-gray-500 font-medium min-w-[90px]">
                        <SortHeader col="receivedOn" label="Received" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="px-3 py-2.5 text-right text-gray-500 font-medium min-w-[110px]">
                        <SortHeader col="grandTotal" label="Total Cost" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      </th>
                      {reportData.columns.map(col => (
                        <Fragment key={col.key}>
                          <th className="px-3 py-2.5 text-right text-gray-500 font-medium min-w-[110px]">
                            <SortHeader
                              col={col.key}
                              label={`${col.label} $`}
                              sortCol={sortCol}
                              sortDir={sortDir}
                              onSort={handleSort}
                            />
                          </th>
                          <th className="px-3 py-2.5 text-right text-gray-500 font-medium min-w-[70px]">
                            <span className="text-gray-400 text-[10px]">{col.label} %</span>
                          </th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {displayRows.map(row => (
                      <tr key={row.rfpId} className="hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-2 font-medium text-blue-700">
                          {row.rfpNumber}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{row.tenantName}</td>
                        <td className="px-3 py-2 text-gray-600 max-w-[140px] truncate" title={row.property}>
                          {row.property}
                        </td>
                        <td className="px-3 py-2">
                          <Badge className={`text-[10px] px-1.5 py-0 border-0 ${statusColor(row.status)}`}>
                            {statusLabel(row.status)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                          {row.receivedOn ? format(new Date(row.receivedOn), "MM/dd/yy") : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-gray-800 tabular-nums">
                          {fmtDollar(row.grandTotal)}
                        </td>
                        {reportData.columns.map(col => {
                          const amt = row.itemAmounts[col.key];
                          const p = isCmColumn(col.label)
                            ? pctCMBase(amt, row.grandTotal, row.contingencyAmount)
                            : pct(amt, row.grandTotal);
                          return (
                            <Fragment key={col.key}>
                              <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                {fmtDollar(amt)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                                {fmtPct(p)}
                              </td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  {/* Footer totals */}
                  <tfoot>
                    <tr className="bg-gray-50 border-t-2 border-gray-300 font-semibold">
                      <td className="px-3 py-2 text-gray-700" colSpan={5}>Totals / Weighted Avg</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                        {fmtDollar(footerTotals["grandTotal"] ?? null)}
                      </td>
                      {reportData.columns.map(col => (
                        <Fragment key={col.key}>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-800">
                            {fmtDollar(footerTotals[col.key] ?? null)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                            {fmtPct(footerPct(col.key))}
                          </td>
                        </Fragment>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
