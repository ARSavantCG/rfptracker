import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus, CheckCircle, X, ExternalLink } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

interface LineItemRow {
  category: string;
  totalCost: string;
  areaType: string;
  notes: string;
}

interface RecordProjectActualsProps {
  rfpId: number;
  projectName: string;
  tenantName: string;
  propertyName: string;
  totalCostDollars: number;
  rentableAreaSf: number;
  prePopulatedLineItems?: { category: string; totalCost: number }[];
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

function parseMoney(s: string | number): number {
  if (typeof s === "number") return s;
  return parseFloat(String(s).replace(/,/g, "")) || 0;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

export function RecordProjectActuals({
  rfpId,
  projectName,
  tenantName,
  propertyName,
  totalCostDollars,
  rentableAreaSf,
  prePopulatedLineItems = [],
}: RecordProjectActualsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const [saved, setSaved] = useState(false);

  const today = new Date().toISOString().split("T")[0];

  const [form, setForm] = useState({
    projectName,
    tenantName,
    propertyName,
    completedDate: today,
    officeAreaSf: "",
    warehouseAreaSf: String(rentableAreaSf || ""),
    totalActualCost: totalCostDollars > 0 ? totalCostDollars.toFixed(2) : "",
    notes: "",
  });

  const [lineItems, setLineItems] = useState<LineItemRow[]>(
    prePopulatedLineItems.length > 0
      ? prePopulatedLineItems.map((li) => ({
          category: li.category,
          totalCost: (li.totalCost / 100).toFixed(2),
          areaType: "combined",
          notes: "",
        }))
      : [{ category: "", totalCost: "", areaType: "combined", notes: "" }]
  );

  const officeSf = parseInt(form.officeAreaSf) || 0;
  const warehouseSf = parseInt(form.warehouseAreaSf) || 0;
  const totalSf = officeSf + warehouseSf;
  const totalCost = parseMoney(form.totalActualCost);
  const overallCostPerSf = totalSf > 0 ? totalCost / totalSf : 0;

  const addLineItem = () => {
    setLineItems((prev) => [...prev, { category: "", totalCost: "", areaType: "combined", notes: "" }]);
  };

  const removeLineItem = (idx: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLineItem = (idx: number, field: keyof LineItemRow, value: string) => {
    setLineItems((prev) => prev.map((li, i) => (i === idx ? { ...li, [field]: value } : li)));
  };

  const saveMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/project-actuals", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/project-actuals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/project-actuals/benchmarks"] });
      setSaved(true);
      toast({ title: "Project actuals recorded successfully" });
    },
    onError: () => toast({ title: "Failed to save project actuals", variant: "destructive" }),
  });

  const handleSave = () => {
    if (!form.projectName || !form.tenantName || !form.propertyName || !form.completedDate || !form.totalActualCost) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    const validLineItems = lineItems
      .filter((li) => li.category && li.totalCost)
      .map((li) => ({
        category: li.category,
        totalCost: parseMoney(li.totalCost),
        areaType: li.areaType,
        notes: li.notes || null,
        areaSf: li.areaType === "office" ? officeSf : li.areaType === "warehouse" ? warehouseSf : totalSf,
      }));

    saveMutation.mutate({
      rfpId,
      ...form,
      officeAreaSf: officeSf,
      warehouseAreaSf: warehouseSf,
      source: "rfp_tracker",
      lineItems: validLineItems,
    });
  };

  if (dismissed) return null;

  if (saved) {
    return (
      <Card className="border-green-300 bg-green-50">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-6 w-6 text-green-600" />
              <div>
                <div className="font-semibold text-green-900">Project actuals recorded</div>
                <div className="text-sm text-green-700">This project's cost data is now part of your pricing intelligence database.</div>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-green-700 border-green-400 hover:bg-green-100"
              onClick={() => window.open("/rom-pilot", "_blank")}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              View Benchmarks
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base text-blue-900">Record Project Actuals</CardTitle>
            <p className="text-sm text-blue-700 mt-1">
              Optionally save this project's final costs to the pricing intelligence database.
              This helps improve ROM estimates for future projects.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-gray-400 hover:text-gray-600"
            onClick={() => setDismissed(true)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Project Info */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Project Name *</Label>
            <Input
              className="h-8 text-sm"
              value={form.projectName}
              onChange={(e) => setForm({ ...form, projectName: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Tenant Name *</Label>
            <Input
              className="h-8 text-sm"
              value={form.tenantName}
              onChange={(e) => setForm({ ...form, tenantName: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Property *</Label>
            <Input
              className="h-8 text-sm"
              value={form.propertyName}
              onChange={(e) => setForm({ ...form, propertyName: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Completion Date *</Label>
            <Input
              className="h-8 text-sm"
              type="date"
              value={form.completedDate}
              onChange={(e) => setForm({ ...form, completedDate: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Office Area (SF)</Label>
            <Input
              className="h-8 text-sm"
              type="number"
              value={form.officeAreaSf}
              onChange={(e) => setForm({ ...form, officeAreaSf: e.target.value })}
              placeholder="0"
            />
          </div>
          <div>
            <Label className="text-xs">Warehouse Area (SF)</Label>
            <Input
              className="h-8 text-sm"
              type="number"
              value={form.warehouseAreaSf}
              onChange={(e) => setForm({ ...form, warehouseAreaSf: e.target.value })}
              placeholder="0"
            />
          </div>
          <div>
            <Label className="text-xs">Total Actual Cost ($) *</Label>
            <Input
              className="h-8 text-sm"
              value={form.totalActualCost}
              onChange={(e) => setForm({ ...form, totalActualCost: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Input
              className="h-8 text-sm"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Optional context"
            />
          </div>
        </div>

        {/* Auto-calculated */}
        {totalSf > 0 && totalCost > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-md border p-2 text-center">
              <div className="text-sm font-bold text-gray-900">{totalSf.toLocaleString()} SF</div>
              <div className="text-xs text-gray-500">Total Area</div>
            </div>
            <div className="bg-white rounded-md border p-2 text-center">
              <div className="text-sm font-bold text-gray-900">{formatCurrency(totalCost)}</div>
              <div className="text-xs text-gray-500">Total Cost</div>
            </div>
            <div className="bg-white rounded-md border p-2 text-center">
              <div className="text-sm font-bold text-blue-700">${overallCostPerSf.toFixed(2)}/SF</div>
              <div className="text-xs text-gray-500">Cost per SF</div>
            </div>
          </div>
        )}

        {/* Cost Breakdown */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs font-semibold">Cost Breakdown by Category</Label>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addLineItem}>
              <Plus className="h-3 w-3 mr-1" /> Add Row
            </Button>
          </div>
          <div className="overflow-x-auto rounded border bg-white">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border-b px-2 py-1 text-left">Category</th>
                  <th className="border-b px-2 py-1 text-center">Area Type</th>
                  <th className="border-b px-2 py-1 text-right">Total Cost ($)</th>
                  <th className="border-b px-2 py-1 text-right">$/SF</th>
                  <th className="border-b px-2 py-1 text-left">Notes</th>
                  <th className="border-b px-2 py-1 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li, idx) => {
                  const liCost = parseMoney(li.totalCost);
                  const liSf = li.areaType === "office" ? officeSf : li.areaType === "warehouse" ? warehouseSf : totalSf;
                  const liCpsf = liSf > 0 && liCost > 0 ? liCost / liSf : 0;
                  return (
                    <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      <td className="border-b px-1 py-0.5">
                        <select
                          value={li.category}
                          onChange={(e) => updateLineItem(idx, "category", e.target.value)}
                          className="w-full h-7 px-1 text-xs bg-background border border-input rounded"
                        >
                          <option value="">Select…</option>
                          {COMMON_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          {li.category && !COMMON_CATEGORIES.includes(li.category) && (
                            <option value={li.category}>{li.category}</option>
                          )}
                        </select>
                      </td>
                      <td className="border-b px-1 py-0.5 text-center">
                        <select
                          value={li.areaType}
                          onChange={(e) => updateLineItem(idx, "areaType", e.target.value)}
                          className="h-7 px-1 text-xs bg-background border border-input rounded"
                        >
                          <option value="combined">Combined</option>
                          <option value="office">Office</option>
                          <option value="warehouse">Warehouse</option>
                        </select>
                      </td>
                      <td className="border-b px-1 py-0.5">
                        <Input
                          className="h-7 text-xs text-right"
                          value={li.totalCost}
                          onChange={(e) => updateLineItem(idx, "totalCost", e.target.value)}
                          placeholder="0"
                        />
                      </td>
                      <td className="border-b px-1 py-0.5 text-right text-gray-500">
                        {liCpsf > 0 ? `$${liCpsf.toFixed(2)}` : "—"}
                      </td>
                      <td className="border-b px-1 py-0.5">
                        <Input
                          className="h-7 text-xs"
                          value={li.notes}
                          onChange={(e) => updateLineItem(idx, "notes", e.target.value)}
                          placeholder="Optional"
                        />
                      </td>
                      <td className="border-b px-1 py-0.5 text-center">
                        <button
                          onClick={() => removeLineItem(idx)}
                          className="text-red-400 hover:text-red-600"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            className="flex-1 bg-blue-600 hover:bg-blue-700"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? "Saving…" : "Save to Project Actuals"}
          </Button>
          <Button
            variant="ghost"
            className="text-gray-500"
            onClick={() => setDismissed(true)}
          >
            Skip for now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
