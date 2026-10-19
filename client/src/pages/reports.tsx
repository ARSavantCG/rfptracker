/**
 * Reports.
 *
 * The page used to carry eleven hand-written report cards. Every one of them is
 * now an entry in shared/report-catalog.ts and renders through <PinnedReports>,
 * so a report is declared once and appears wherever the catalog is read.
 *
 * Four reports — Property Summary, Property Data Audit, Project Reports and the
 * Portfolio Report — existed on the server and were never on this page at all.
 * They are in the catalog, which is the point of having one.
 *
 * What stays here is what the catalog cannot own: the pipeline counts, and the
 * filters that feed the custom report builder.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { BarChart3, Calendar, ChevronDown } from "lucide-react";
import Navigation from "@/components/navigation";
import { CustomReportModal } from "@/components/custom-report-modal";
import { PinnedReports } from "@/components/pinned-reports";
import { parseISO, isAfter, addDays } from "date-fns";
import type { RfpRequest } from "@shared/schema";

interface ReportFilters {
  status?: string;
  property?: string;
  dateRange?: string;
  dueInDays?: number;
}

export default function Reports() {
  const [filters, setFilters] = useState<ReportFilters>({});
  const [customReportModalOpen, setCustomReportModalOpen] = useState(false);

  const { data: rfpRequests = [], isLoading } = useQuery<RfpRequest[]>({
    queryKey: ["/api/rfp-requests"],
  });
  const { data: properties = [] } = useQuery<any[]>({
    queryKey: ["/api/properties"],
  });

  const filteredRfps = rfpRequests.filter((rfp) => {
    if (filters.status && filters.status !== "all" && rfp.status !== filters.status) return false;
    if (filters.property && filters.property !== "all" && rfp.property !== filters.property) return false;
    if (filters.dueInDays && filters.dueInDays.toString() !== "all") {
      const dueDate = parseISO(rfp.internalDueDate.toString());
      const targetDate = addDays(new Date(), filters.dueInDays);
      if (isAfter(dueDate, targetDate)) return false;
    }
    return true;
  });

  const daysUntilDue = (rfp: RfpRequest) => {
    const due = parseISO(rfp.internalDueDate.toString());
    return Math.ceil((due.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  };

  // These counts used to be scattered across three report cards. Gathered into
  // one row so removing the cards did not remove the numbers with them.
  const metrics = {
    total: filteredRfps.length,
    inProgress: filteredRfps.filter((r) => r.status === "in-progress").length,
    completed: filteredRfps.filter((r) => r.status === "completed").length,
    dueSoon: filteredRfps.filter((r) => {
      const d = daysUntilDue(r);
      return d >= 0 && d <= 3 && r.status !== "completed";
    }).length,
    overdue: filteredRfps.filter((r) => daysUntilDue(r) < 0 && r.status !== "completed").length,
  };

  const clearFilters = () => setFilters({});
  const hasFilters = Boolean(filters.status || filters.property || filters.dueInDays);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <div className="max-w-7xl mx-auto p-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-lg">Loading reports...</div>
          </div>
        </div>
      </div>
    );
  }

  const tile = (label: string, value: number, tone = "text-gray-900") => (
    <div className="bg-gray-50 rounded-md p-3 text-center">
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      <p className="text-xs text-gray-600 uppercase font-medium">{label}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-blue-600" />
            Reports
          </h1>
          <p className="text-gray-600 mt-2">
            Pin the ones you use. Everything else is under Browse all reports.
          </p>
        </div>

        {/* Pinned reports and the full catalog. */}
        <PinnedReports onOpenCustomReport={() => setCustomReportModalOpen(true)} />

        {/* Pipeline counts. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Pipeline{hasFilters ? " (filtered)" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {tile("Total", metrics.total)}
              {tile("Active", metrics.inProgress, "text-yellow-900")}
              {tile("Complete", metrics.completed, "text-green-900")}
              {tile("Due in 3 days", metrics.dueSoon, "text-orange-900")}
              {tile("Overdue", metrics.overdue, metrics.overdue ? "text-red-900" : "text-gray-900")}
            </div>
          </CardContent>
        </Card>

        {/* Filters.
            These drive the counts above and the Custom Report builder. They no
            longer feed the Executive Summary: that report now carries its own
            status / property / due-within pickers in the catalog, where the
            scope is visible on the report itself and can be pinned with it. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center space-x-2 text-base">
              <Calendar className="h-5 w-5" />
              <span>Filters</span>
            </CardTitle>
            <p className="text-xs text-gray-600">
              Applies to the counts above and to the Custom Report.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="status-filter">Status</Label>
                <div className="relative">
                  <select
                    id="status-filter"
                    value={filters.status || ""}
                    onChange={(e) => setFilters({ ...filters, status: e.target.value || undefined })}
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring appearance-none"
                  >
                    <option value="">All statuses</option>
                    <option value="received">Received</option>
                    <option value="in-progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="on-hold">On Hold</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="property-filter">Property</Label>
                <div className="relative">
                  <select
                    id="property-filter"
                    value={filters.property || ""}
                    onChange={(e) => setFilters({ ...filters, property: e.target.value || undefined })}
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring appearance-none"
                  >
                    <option value="">All properties</option>
                    {properties.map((property: any) => (
                      <option key={property.id} value={property.propertyName}>
                        {property.propertyName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="due-filter">Due Within</Label>
                <div className="relative">
                  <select
                    id="due-filter"
                    value={filters.dueInDays?.toString() || ""}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        dueInDays: e.target.value ? parseInt(e.target.value) : undefined,
                      })
                    }
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring appearance-none"
                  >
                    <option value="">Any time</option>
                    <option value="1">1 day</option>
                    <option value="3">3 days</option>
                    <option value="7">1 week</option>
                    <option value="30">1 month</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Actions</Label>
                <Button variant="outline" onClick={clearFilters} className="w-full" disabled={!hasFilters}>
                  Clear Filters
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <CustomReportModal
        isOpen={customReportModalOpen}
        onClose={() => setCustomReportModalOpen(false)}
        filters={filters}
      />
    </div>
  );
}
