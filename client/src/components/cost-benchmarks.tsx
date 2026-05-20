import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Benchmark {
  category: string;
  areaType: string;
  projectsSampled: number;
  avgCostPerSf: string;
  minCostPerSf: string;
  maxCostPerSf: string;
  spreadPercent: string;
  lastProjectDate: string;
}

interface RomScopeItem {
  id: number;
  name: string;
  category: string;
  unitPrice: string;
  activePrice: string | null;
  unit: string;
}

interface ProjectActual {
  id: number;
  completedDate: string;
}

export function CostBenchmarks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filterCategory, setFilterCategory] = useState("all");
  const [filterAreaType, setFilterAreaType] = useState("all");
  const [updateModal, setUpdateModal] = useState<{ open: boolean; benchmark: Benchmark | null; romItem: RomScopeItem | null }>({
    open: false,
    benchmark: null,
    romItem: null,
  });

  const { data: benchmarks = [], isLoading: benchmarksLoading } = useQuery<Benchmark[]>({
    queryKey: ["/api/project-actuals/benchmarks"],
  });

  const { data: romItems = [] } = useQuery<RomScopeItem[]>({
    queryKey: ["/api/rom-scope-items"],
  });

  const { data: actuals = [] } = useQuery<ProjectActual[]>({
    queryKey: ["/api/project-actuals"],
  });

  const updatePriceMutation = useMutation({
    mutationFn: ({ id, avgPrice }: { id: number; avgPrice: string }) =>
      apiRequest(`/api/scope-items/${id}/pricing-mode`, "PATCH", {
        pricingMode: "manual",
        manualOverridePrice: avgPrice,
        manualOverrideReason: "Updated from historical benchmarks",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rom-scope-items"] });
      setUpdateModal({ open: false, benchmark: null, romItem: null });
      toast({ title: "ROM price updated to historical average" });
    },
    onError: () => toast({ title: "Failed to update ROM price", variant: "destructive" }),
  });

  const categories = useMemo(() => {
    const cats = [...new Set(benchmarks.map((b) => b.category))].sort();
    return cats;
  }, [benchmarks]);

  const areaTypes = ["all", "office", "warehouse", "combined"];

  const filtered = benchmarks.filter((b) => {
    if (filterCategory !== "all" && b.category !== filterCategory) return false;
    if (filterAreaType !== "all" && b.areaType !== filterAreaType) return false;
    return true;
  });

  const totalProjects = actuals.length;
  const totalLineItems = benchmarks.reduce((acc, b) => acc + b.projectsSampled, 0);
  const allDates = actuals.map((a) => new Date(a.completedDate)).filter((d) => !isNaN(d.getTime()));
  const minDate = allDates.length ? new Date(Math.min(...allDates.map((d) => d.getTime()))) : null;
  const maxDate = allDates.length ? new Date(Math.max(...allDates.map((d) => d.getTime()))) : null;
  const lastUpdated = benchmarks.length
    ? new Date(Math.max(...benchmarks.map((b) => new Date(b.lastProjectDate).getTime()))).toLocaleDateString()
    : "—";

  function spreadColor(pct: string) {
    const n = parseFloat(pct);
    if (n < 10) return "text-green-600 bg-green-50";
    if (n < 20) return "text-yellow-700 bg-yellow-50";
    return "text-red-600 bg-red-50";
  }

  function findRomMatch(b: Benchmark): RomScopeItem | null {
    return romItems.find((r) => r.category?.toLowerCase() === b.category.toLowerCase()) || null;
  }

  function romDiff(b: Benchmark, romItem: RomScopeItem | null) {
    if (!romItem) return null;
    const histAvg = parseFloat(b.avgCostPerSf);
    const romPrice = parseFloat(romItem.activePrice || romItem.unitPrice || "0");
    if (!histAvg || !romPrice) return null;
    const pctDiff = ((romPrice - histAvg) / histAvg) * 100;
    return { pctDiff, romPrice, histAvg };
  }

  function RomDiffBadge({ diff }: { diff: { pctDiff: number; romPrice: number; histAvg: number } | null }) {
    if (!diff) return <span className="text-gray-400 text-xs">No ROM match</span>;
    const abs = Math.abs(diff.pctDiff);
    const color = abs < 10 ? "text-green-600" : abs < 25 ? "text-yellow-700" : "text-red-600";
    const Icon = diff.pctDiff > 1 ? TrendingUp : diff.pctDiff < -1 ? TrendingDown : Minus;
    return (
      <span className={`flex items-center gap-1 font-medium text-xs ${color}`}>
        <Icon className="h-3 w-3" />
        {diff.pctDiff > 0 ? "+" : ""}{diff.pctDiff.toFixed(1)}%
        <span className="text-gray-400 font-normal">(${diff.romPrice.toFixed(2)}/SF)</span>
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{totalProjects}</div>
          <div className="text-xs text-gray-500 mt-1">Projects in Database</div>
        </div>
        <div className="bg-white rounded-lg border p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{totalLineItems}</div>
          <div className="text-xs text-gray-500 mt-1">Data Points</div>
        </div>
        <div className="bg-white rounded-lg border p-4 text-center">
          <div className="text-sm font-bold text-gray-900">
            {minDate && maxDate ? `${minDate.getFullYear()} – ${maxDate.getFullYear()}` : "—"}
          </div>
          <div className="text-xs text-gray-500 mt-1">Date Range</div>
        </div>
        <div className="bg-white rounded-lg border p-4 text-center">
          <div className="text-sm font-bold text-gray-900">{lastUpdated}</div>
          <div className="text-xs text-gray-500 mt-1">Last Project</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterAreaType} onValueChange={setFilterAreaType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Area Types" />
          </SelectTrigger>
          <SelectContent>
            {areaTypes.map((t) => <SelectItem key={t} value={t}>{t === "all" ? "All Area Types" : t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-gray-500">{filtered.length} benchmark{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Benchmarks table */}
      {benchmarksLoading ? (
        <div className="text-center py-12 text-gray-400">Loading benchmarks…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-white">
          <div className="text-gray-400 mb-2">No benchmark data yet</div>
          <p className="text-sm text-gray-500">Import historical projects to start building your intelligence database.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-3 py-2 text-left font-medium text-gray-600">Category</th>
                <th className="px-3 py-2 text-center font-medium text-gray-600">Area Type</th>
                <th className="px-3 py-2 text-center font-medium text-gray-600">Projects</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Low $/SF</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Avg $/SF</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">High $/SF</th>
                <th className="px-3 py-2 text-center font-medium text-gray-600">Spread</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">vs. ROM Price</th>
                <th className="px-3 py-2 text-center font-medium text-gray-600">Last Project</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => {
                const romItem = findRomMatch(b);
                const diff = romDiff(b, romItem);
                return (
                  <tr key={`${b.category}-${b.areaType}-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="px-3 py-2 font-medium">{b.category}</td>
                    <td className="px-3 py-2 text-center">
                      <Badge variant="outline" className="text-xs capitalize">{b.areaType || "combined"}</Badge>
                    </td>
                    <td className="px-3 py-2 text-center text-gray-600">{b.projectsSampled}</td>
                    <td className="px-3 py-2 text-right text-green-700 font-medium">${parseFloat(b.minCostPerSf).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-semibold">${parseFloat(b.avgCostPerSf).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-red-700 font-medium">${parseFloat(b.maxCostPerSf).toFixed(2)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${spreadColor(b.spreadPercent)}`}>
                        {parseFloat(b.spreadPercent).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <RomDiffBadge diff={diff} />
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-gray-500">
                      {new Date(b.lastProjectDate).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {romItem && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          title="Update ROM price to historical average"
                          onClick={() => setUpdateModal({ open: true, benchmark: b, romItem })}
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Update ROM Price Modal */}
      <Dialog open={updateModal.open} onOpenChange={(open) => !open && setUpdateModal({ open: false, benchmark: null, romItem: null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update ROM Price</DialogTitle>
          </DialogHeader>
          {updateModal.benchmark && updateModal.romItem && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm space-y-2">
                <div className="font-semibold text-blue-900">{updateModal.benchmark.category}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-500">Historical Average:</span>
                    <span className="ml-1 font-semibold">${parseFloat(updateModal.benchmark.avgCostPerSf).toFixed(2)}/SF</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Projects Sampled:</span>
                    <span className="ml-1 font-semibold">{updateModal.benchmark.projectsSampled}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Range:</span>
                    <span className="ml-1 font-semibold">
                      ${parseFloat(updateModal.benchmark.minCostPerSf).toFixed(2)} – ${parseFloat(updateModal.benchmark.maxCostPerSf).toFixed(2)}/SF
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">ROM Item:</span>
                    <span className="ml-1 font-semibold">{updateModal.romItem.name}</span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-gray-600">
                This will update the active ROM price for <strong>{updateModal.romItem.name}</strong> to{" "}
                <strong>${parseFloat(updateModal.benchmark.avgCostPerSf).toFixed(2)}</strong> (historical average) and set the pricing mode to manual override.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateModal({ open: false, benchmark: null, romItem: null })}>Cancel</Button>
            <Button
              onClick={() =>
                updateModal.romItem && updateModal.benchmark &&
                updatePriceMutation.mutate({ id: updateModal.romItem.id, avgPrice: updateModal.benchmark.avgCostPerSf })
              }
              disabled={updatePriceMutation.isPending}
            >
              {updatePriceMutation.isPending ? "Updating…" : "Update ROM Price"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
