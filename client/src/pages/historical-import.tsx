import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Upload, Download, CheckCircle, AlertTriangle, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

interface Property {
  id: number;
  name: string;
}

const COMMON_CATEGORIES = [
  "Electrical",
  "Plumbing",
  "Mechanical/HVAC",
  "Drywall/Framing",
  "Finishes/Flooring",
  "Dock Equipment",
  "Site Work",
  "Structural",
  "Fire Protection",
  "Low Voltage/AV",
  "Permits & Fees",
  "General Conditions",
  "Design/Architecture",
  "Contingency",
];

interface LineItemRow {
  id: string;
  category: string;
  customCategory: string;
  areaType: string;
  totalCost: string;
  notes: string;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function parseMoney(s: string): number {
  return parseFloat(s.replace(/,/g, "")) || 0;
}

export default function HistoricalImport() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  // ── Tab 1 — Manual Entry ─────────────────────────────────────────────────
  const [form, setForm] = useState({
    projectName: "",
    tenantName: "",
    propertyName: "",
    completedDate: "",
    officeAreaSf: "",
    warehouseAreaSf: "",
    totalActualCost: "",
    notes: "",
  });

  const [lineItems, setLineItems] = useState<LineItemRow[]>([
    { id: "1", category: "", customCategory: "", areaType: "combined", totalCost: "", notes: "" },
  ]);

  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const officeSf = parseInt(form.officeAreaSf) || 0;
  const warehouseSf = parseInt(form.warehouseAreaSf) || 0;
  const totalSf = officeSf + warehouseSf;
  const totalCost = parseMoney(form.totalActualCost);
  const overallCostPerSf = totalSf > 0 ? totalCost / totalSf : 0;

  const addLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      { id: String(Date.now()), category: "", customCategory: "", areaType: "combined", totalCost: "", notes: "" },
    ]);
  };

  const removeLineItem = (id: string) => {
    setLineItems((prev) => prev.filter((li) => li.id !== id));
  };

  const updateLineItem = (id: string, field: keyof LineItemRow, value: string) => {
    setLineItems((prev) => prev.map((li) => (li.id === id ? { ...li, [field]: value } : li)));
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/project-actuals", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/project-actuals"] });
      toast({ title: "Project actual saved successfully" });
      setForm({ projectName: "", tenantName: "", propertyName: "", completedDate: "", officeAreaSf: "", warehouseAreaSf: "", totalActualCost: "", notes: "" });
      setLineItems([{ id: "1", category: "", customCategory: "", areaType: "combined", totalCost: "", notes: "" }]);
    },
    onError: () => toast({ title: "Failed to save project actual", variant: "destructive" }),
  });

  const handleSave = () => {
    if (!form.projectName || !form.tenantName || !form.propertyName || !form.completedDate || !form.totalActualCost) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    const validLineItems = lineItems
      .filter((li) => (li.category || li.customCategory) && li.totalCost)
      .map((li) => ({
        category: li.category === "__custom__" ? li.customCategory : li.category,
        areaType: li.areaType,
        totalCost: parseMoney(li.totalCost),
        notes: li.notes || null,
        areaSf: li.areaType === "office" ? officeSf : li.areaType === "warehouse" ? warehouseSf : totalSf,
      }));

    createMutation.mutate({
      ...form,
      officeAreaSf: officeSf,
      warehouseAreaSf: warehouseSf,
      source: "historical_import",
      lineItems: validLineItems,
    });
  };

  // ── Tab 2 — CSV Import ───────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvPreview, setCsvPreview] = useState<any[] | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; errors: string[] } | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const headers = lines[0].split(",").map((h) => h.trim());
      const rows = lines.slice(1, 6).map((l) => {
        const vals = l.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        const row: any = {};
        headers.forEach((h, i) => { row[h] = vals[i] || ""; });
        return row;
      });
      setCsvPreview(rows);
    };
    reader.readAsText(file);
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!csvFile) throw new Error("No file");
      const formData = new FormData();
      formData.append("file", csvFile);
      const resp = await fetch("/api/project-actuals/import-csv", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: { "auth-token": localStorage.getItem("auth-token") || "" },
      });
      if (!resp.ok) throw new Error("Import failed");
      return resp.json();
    },
    onSuccess: (data) => {
      setImportResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/project-actuals"] });
      setCsvPreview(null);
      setCsvFile(null);
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: () => toast({ title: "CSV import failed", variant: "destructive" }),
  });

  const downloadTemplate = () => {
    const header = "project_name,tenant_name,property_name,completed_date,office_sf,warehouse_sf,total_cost,category_1_name,category_1_cost,category_2_name,category_2_cost";
    const sample = "Sample Warehouse TI,ACME Corp,Industrial Park A,2024-06-01,2000,20000,450000,Electrical,95000,Plumbing,32000";
    const blob = new Blob([header + "\n" + sample], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "project_actuals_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Admin
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Historical Project Import</h1>
            <p className="text-sm text-gray-500">Build your cost intelligence database with historical project data</p>
          </div>
        </div>

        <Tabs defaultValue="manual">
          <TabsList className="mb-6">
            <TabsTrigger value="manual">Manual Entry</TabsTrigger>
            <TabsTrigger value="csv">CSV Import</TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Manual Entry ─────────────────────────────────────── */}
          <TabsContent value="manual">
            <div className="space-y-6">
              {/* Project Info */}
              <Card>
                <CardHeader><CardTitle className="text-base">Project Information</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Project Name *</Label>
                    <Input value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} placeholder="e.g., ACME Corp TI" />
                  </div>
                  <div>
                    <Label>Tenant Name *</Label>
                    <Input value={form.tenantName} onChange={(e) => setForm({ ...form, tenantName: e.target.value })} placeholder="e.g., ACME Corp" />
                  </div>
                  <div>
                    <Label>Property *</Label>
                    <Select value={form.propertyName} onValueChange={(v) => setForm({ ...form, propertyName: v })}>
                      <SelectTrigger><SelectValue placeholder="Select property" /></SelectTrigger>
                      <SelectContent>
                        {properties.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}
                        <SelectItem value="__other__">Other / Not Listed</SelectItem>
                      </SelectContent>
                    </Select>
                    {form.propertyName === "__other__" && (
                      <Input className="mt-2" placeholder="Enter property name" onChange={(e) => setForm({ ...form, propertyName: e.target.value })} />
                    )}
                  </div>
                  <div>
                    <Label>Completion Date *</Label>
                    <Input type="date" value={form.completedDate} onChange={(e) => setForm({ ...form, completedDate: e.target.value })} />
                  </div>
                  <div>
                    <Label>Office Area (SF)</Label>
                    <Input type="number" value={form.officeAreaSf} onChange={(e) => setForm({ ...form, officeAreaSf: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <Label>Warehouse Area (SF)</Label>
                    <Input type="number" value={form.warehouseAreaSf} onChange={(e) => setForm({ ...form, warehouseAreaSf: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <Label>Total Actual Cost ($) *</Label>
                    <Input value={form.totalActualCost} onChange={(e) => setForm({ ...form, totalActualCost: e.target.value })} placeholder="e.g., 450000" />
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any relevant context" />
                  </div>
                </CardContent>
              </Card>

              {/* Auto-calculated Summary */}
              {totalSf > 0 && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
                    <div className="text-xl font-bold text-blue-900">{totalSf.toLocaleString()} SF</div>
                    <div className="text-xs text-blue-600">Total Area</div>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                    <div className="text-xl font-bold text-green-900">{formatCurrency(totalCost)}</div>
                    <div className="text-xs text-green-600">Total Cost</div>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
                    <div className="text-xl font-bold text-amber-900">${overallCostPerSf.toFixed(2)}/SF</div>
                    <div className="text-xs text-amber-600">Overall Cost/SF</div>
                  </div>
                </div>
              )}

              {/* Cost Breakdown */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Cost Breakdown</CardTitle>
                    <Button size="sm" variant="outline" onClick={addLineItem}><Plus className="h-3 w-3 mr-1" /> Add Row</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="border px-2 py-2 text-left">Category</th>
                          <th className="border px-2 py-2 text-center">Area Type</th>
                          <th className="border px-2 py-2 text-right">Total Cost ($)</th>
                          <th className="border px-2 py-2 text-right">$/SF</th>
                          <th className="border px-2 py-2 text-left">Notes</th>
                          <th className="border px-2 py-2 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lineItems.map((li) => {
                          const liCost = parseMoney(li.totalCost);
                          const liSf = li.areaType === "office" ? officeSf : li.areaType === "warehouse" ? warehouseSf : totalSf;
                          const liCpsf = liSf > 0 && liCost > 0 ? liCost / liSf : 0;
                          return (
                            <tr key={li.id}>
                              <td className="border px-2 py-1">
                                <select
                                  value={li.category}
                                  onChange={(e) => updateLineItem(li.id, "category", e.target.value)}
                                  className="w-full h-8 px-1 text-sm bg-background border border-input rounded text-ellipsis"
                                >
                                  <option value="">Select category</option>
                                  {COMMON_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                                  <option value="__custom__">Other…</option>
                                </select>
                                {li.category === "__custom__" && (
                                  <Input
                                    className="mt-1 h-7 text-xs"
                                    value={li.customCategory}
                                    onChange={(e) => updateLineItem(li.id, "customCategory", e.target.value)}
                                    placeholder="Category name"
                                  />
                                )}
                              </td>
                              <td className="border px-2 py-1 text-center">
                                <select
                                  value={li.areaType}
                                  onChange={(e) => updateLineItem(li.id, "areaType", e.target.value)}
                                  className="h-8 px-1 text-sm bg-background border border-input rounded"
                                >
                                  <option value="combined">Combined</option>
                                  <option value="office">Office</option>
                                  <option value="warehouse">Warehouse</option>
                                </select>
                              </td>
                              <td className="border px-2 py-1">
                                <Input
                                  className="h-8 text-sm text-right"
                                  value={li.totalCost}
                                  onChange={(e) => updateLineItem(li.id, "totalCost", e.target.value)}
                                  placeholder="0"
                                />
                              </td>
                              <td className="border px-2 py-1 text-right text-gray-500 text-xs">
                                {liCpsf > 0 ? `$${liCpsf.toFixed(2)}` : "—"}
                              </td>
                              <td className="border px-2 py-1">
                                <Input
                                  className="h-8 text-sm"
                                  value={li.notes}
                                  onChange={(e) => updateLineItem(li.id, "notes", e.target.value)}
                                  placeholder="Optional"
                                />
                              </td>
                              <td className="border px-2 py-1 text-center">
                                <button onClick={() => removeLineItem(li.id)} className="text-red-400 hover:text-red-600">
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Button className="w-full" onClick={handleSave} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Saving…" : "Save Project Actual"}
              </Button>
            </div>
          </TabsContent>

          {/* ── Tab 2: CSV Import ───────────────────────────────────────── */}
          <TabsContent value="csv">
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle className="text-base">CSV File Import</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      Upload a CSV file with historical project data. Download the template to see the required format.
                    </p>
                    <Button size="sm" variant="outline" onClick={downloadTemplate}>
                      <Download className="h-3 w-3 mr-1" /> Download Template
                    </Button>
                  </div>

                  <div
                    className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm font-medium text-gray-700">
                      {csvFile ? csvFile.name : "Click to select a CSV file"}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Max 10MB</p>
                    <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
                  </div>

                  {csvPreview && csvPreview.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">Preview (first {csvPreview.length} rows):</h4>
                      <div className="overflow-x-auto rounded border">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="bg-gray-50">
                              {Object.keys(csvPreview[0]).map((h) => (
                                <th key={h} className="border-b px-2 py-1 text-left text-gray-600">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {csvPreview.map((row, i) => (
                              <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                                {Object.values(row).map((v: any, j) => (
                                  <td key={j} className="border-b px-2 py-1 max-w-xs truncate">{v}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <Button
                        className="w-full mt-4"
                        onClick={() => importMutation.mutate()}
                        disabled={importMutation.isPending}
                      >
                        {importMutation.isPending ? "Importing…" : `Confirm Import — ${csvFile?.name}`}
                      </Button>
                    </div>
                  )}

                  {importResult && (
                    <div className={`p-4 rounded-lg border ${importResult.errors.length === 0 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
                      <div className="flex items-center gap-2 mb-2">
                        {importResult.errors.length === 0 ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-amber-600" />
                        )}
                        <span className="font-semibold">
                          {importResult.created} record{importResult.created !== 1 ? "s" : ""} imported
                          {importResult.errors.length > 0 ? `, ${importResult.errors.length} error${importResult.errors.length !== 1 ? "s" : ""}` : " successfully"}
                        </span>
                      </div>
                      {importResult.errors.length > 0 && (
                        <ul className="text-xs text-amber-700 list-disc list-inside space-y-1">
                          {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Column reference */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Expected CSV Columns</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-1 text-xs text-gray-600">
                    {["project_name", "tenant_name", "property_name", "completed_date", "office_sf", "warehouse_sf", "total_cost", "notes", "category_1_name", "category_1_cost", "category_2_name", "category_2_cost", "…up to category_10_name / category_10_cost"].map((col) => (
                      <div key={col} className="flex items-center gap-1">
                        <Badge variant="outline" className="font-mono text-[10px] px-1">{col}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
