import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, FileText, Calendar, TrendingUp, Clock, CheckCircle, AlertTriangle, BarChart3, ChevronDown, Users, TableIcon, DollarSign, Building2 } from "lucide-react";
import { Link } from "wouter";
import Navigation from "@/components/navigation";
import { CustomReportModal } from "@/components/custom-report-modal";
import { format, parseISO, isAfter, isBefore, addDays } from "date-fns";
import type { RfpRequest } from "@shared/schema";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";

interface ReportFilters {
  status?: string;
  property?: string;
  dateRange?: string;
  dueInDays?: number;
}

export default function Reports() {
  const [filters, setFilters] = useState<ReportFilters>({});
  const [exportFormat, setExportFormat] = useState<"pdf" | "excel">("pdf");
  const [customReportModalOpen, setCustomReportModalOpen] = useState(false);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [costsInPlacePropertyId, setCostsInPlacePropertyId] = useState<string>("");
  const [budgetBucketRfpId, setBudgetBucketRfpId] = useState<string>("");

  const { data: rfpRequests = [], isLoading } = useQuery<RfpRequest[]>({
    queryKey: ["/api/rfp-requests"],
  });

  const { data: properties = [] } = useQuery<any[]>({
    queryKey: ["/api/properties"],
  });

  // Filter RFPs based on current filters
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

  // Calculate metrics for executive summary
  const metrics = {
    total: filteredRfps.length,
    received: filteredRfps.filter((rfp: RfpRequest) => rfp.status === "received").length,
    inProgress: filteredRfps.filter((rfp: RfpRequest) => rfp.status === "in-progress").length,
    completed: filteredRfps.filter((rfp: RfpRequest) => rfp.status === "completed").length,
    onHold: filteredRfps.filter((rfp: RfpRequest) => rfp.status === "on-hold").length,
    dueSoon: filteredRfps.filter((rfp: RfpRequest) => {
      const dueDate = parseISO(rfp.internalDueDate.toString());
      const daysUntil = Math.ceil((dueDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      return daysUntil >= 0 && daysUntil <= 3 && rfp.status !== "completed";
    }).length,
    overdue: filteredRfps.filter((rfp: RfpRequest) => {
      const dueDate = parseISO(rfp.internalDueDate.toString());
      const daysUntil = Math.ceil((dueDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      return daysUntil < 0 && rfp.status !== "completed";
    }).length,
  };

  const clearFilters = () => {
    setFilters({});
  };

  const generateReport = async (reportType: "executive" | "detailed" | "historical" | "custom" | "vendor-workload" | "project-team") => {
    if (reportType === "custom") {
      setCustomReportModalOpen(true);
      return;
    }

    try {
      let url = `/api/reports/${reportType}`;
      const params = new URLSearchParams({
        filters: JSON.stringify(filters),
        format: exportFormat
      });

      if (reportType === "vendor-workload") {
        url = `/api/reports/vendor-workload/html`;
        if (incompleteOnly) params.append('incompleteOnly', 'true');
      }

      // Project team ignores the date/status filters — it is a directory of who
      // is on what, not a period report.
      if (reportType === "project-team") {
        url = `/api/reports/project-team`;
      }

      const response = await fetch(`${url}?${params}`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` },
      });
      if (!response.ok) throw new Error(`Failed to generate report (${response.status})`);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    } catch (error) {
      console.error("Error generating report:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to generate report: ${errorMessage}`);
    }
  };

  const generateBudgetBucketReport = async () => {
    if (!budgetBucketRfpId) { alert("Select an RFP first."); return; }
    try {
      const response = await fetch(`/api/reports/budget-buckets/${budgetBucketRfpId}`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` },
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || `Failed to generate report (${response.status})`);
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to generate report: ${errorMessage}`);
    }
  };

  const generateCostsInPlaceReport = async () => {
    try {
      const url = costsInPlacePropertyId
        ? `/api/reports/costs-in-place?propertyId=${costsInPlacePropertyId}`
        : `/api/reports/costs-in-place`;
      const response = await fetch(url, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` },
      });
      if (!response.ok) throw new Error(`Failed to generate report (${response.status})`);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    } catch (error) {
      console.error("Error generating Costs-in-Place report:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to generate report: ${errorMessage}`);
    }
  };

  const generateOccupancyReport = async () => {
    try {
      const response = await fetch(`/api/reports/occupancy`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` },
      });
      if (!response.ok) throw new Error(`Failed to generate report (${response.status})`);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    } catch (error) {
      console.error("Error generating Occupancy report:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to generate report: ${errorMessage}`);
    }
  };

  function getStatusBadgeColor(status: string) {
    switch (status) {
      case "received": return "bg-blue-100 text-blue-800 border-blue-200";
      case "in-progress": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "completed": return "bg-green-100 text-green-800 border-green-200";
      case "on-hold": return "bg-gray-100 text-gray-800 border-gray-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  }

  function getPriorityLabel(dueDate: string | Date, status: string) {
    if (status === "completed") return "Completed";
    
    const due = parseISO(dueDate.toString());
    const now = new Date();
    const daysUntil = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntil < 0) return "Overdue";
    if (daysUntil <= 1) return "Due Today";
    if (daysUntil <= 3) return "Due Soon";
    return "On Track";
  }

  function getPriorityColor(priority: string) {
    switch (priority) {
      case "Overdue": return "bg-red-100 text-red-800 border-red-200";
      case "Due Today": return "bg-orange-100 text-orange-800 border-orange-200";
      case "Due Soon": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "Completed": return "bg-green-100 text-green-800 border-green-200";
      default: return "bg-blue-100 text-blue-800 border-blue-200";
    }
  }

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

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <BarChart3 className="h-8 w-8 text-blue-600" />
              Reports
            </h1>
            <p className="text-gray-600 mt-2">
              Generate comprehensive reports for executive review
            </p>
          </div>
        </div>

        {/* Filters Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Calendar className="h-5 w-5" />
              <span>Report Filters</span>
            </CardTitle>
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
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
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
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                  >
                    <option value="">All properties</option>
                    {properties.map((property) => (
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
                    onChange={(e) => setFilters({ ...filters, dueInDays: e.target.value === "all" ? undefined : parseInt(e.target.value) })}
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
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
                <Button variant="outline" onClick={clearFilters} className="w-full">
                  Clear Filters
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Report Generation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center space-x-2 text-base">
                <FileText className="h-4 w-4" />
                <span>Executive Summary</span>
              </CardTitle>
              <p className="text-xs text-gray-600">
                Status overview of all RFP projects
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-1">
                <div className="bg-gray-50 p-1.5 rounded text-center">
                  <p className="text-lg font-bold text-gray-900">{metrics.total}</p>
                  <p className="text-xs text-gray-600 uppercase font-medium">Total</p>
                </div>
                <div className="bg-yellow-50 p-1.5 rounded text-center">
                  <p className="text-lg font-bold text-yellow-900">{metrics.inProgress}</p>
                  <p className="text-xs text-yellow-600 uppercase font-medium">Active</p>
                </div>
              </div>
              
              <div className="bg-gray-50 p-2 rounded">
                <h4 className="font-medium text-gray-900 mb-1 text-xs">Includes</h4>
                <ul className="space-y-0 text-xs text-gray-600">
                  <li>• Status breakdown & timelines</li>
                  <li>• Due dates & priorities</li>
                  <li>• Performance metrics</li>
                </ul>
              </div>
              
              <Button 
                className="w-full h-8 text-xs" 
                onClick={() => generateReport("executive")}
              >
                <Download className="h-3 w-3 mr-1" />
                Generate Report
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center space-x-2 text-base">
                <TrendingUp className="h-4 w-4" />
                <span>Historical Pricing</span>
              </CardTitle>
              <p className="text-xs text-gray-600">
                Pricing analysis from completed projects
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-1">
                <div className="bg-gray-50 p-1.5 rounded text-center">
                  <p className="text-lg font-bold text-gray-900">{metrics.completed}</p>
                  <p className="text-xs text-gray-600 uppercase font-medium">Complete</p>
                </div>
                <div className="bg-green-50 p-1.5 rounded text-center">
                  <p className="text-lg font-bold text-green-900">PDF</p>
                  <p className="text-xs text-green-600 uppercase font-medium">Format</p>
                </div>
              </div>
              
              <div className="bg-gray-50 p-2 rounded">
                <h4 className="font-medium text-gray-900 mb-1 text-xs">Includes</h4>
                <ul className="space-y-0 text-xs text-gray-600">
                  <li>• Project pricing breakdown</li>
                  <li>• Contractor bid comparisons</li>
                  <li>• Line items by category</li>
                </ul>
              </div>
              
              <Button 
                className="w-full h-8 text-xs" 
                disabled={metrics.completed === 0}
                onClick={() => generateReport("historical")}
              >
                <Download className="h-3 w-3 mr-1" />
                Generate Report
              </Button>
              
              {metrics.completed === 0 && (
                <p className="text-xs text-gray-500 text-center mt-1">
                  No completed projects available
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center space-x-2 text-base">
                <Users className="h-4 w-4" />
                <span>Vendor Workload</span>
              </CardTitle>
              <p className="text-xs text-gray-600">
                Architect & contractor workload analysis
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-1">
                <div className="bg-gray-50 p-1.5 rounded text-center">
                  <p className="text-lg font-bold text-gray-900">
                    {rfpRequests.filter(rfp => rfp.architect || rfp.generalContractor).length}
                  </p>
                  <p className="text-xs text-gray-600 uppercase font-medium">Vendor RFPs</p>
                </div>
                <div className="bg-blue-50 p-1.5 rounded text-center">
                  <p className="text-lg font-bold text-blue-900">PDF</p>
                  <p className="text-xs text-blue-600 uppercase font-medium">Format</p>
                </div>
              </div>
              
              <div className="bg-gray-50 p-2 rounded">
                <h4 className="font-medium text-gray-900 mb-1 text-xs">Includes</h4>
                <ul className="space-y-0 text-xs text-gray-600">
                  <li>• RFPs grouped by vendor</li>
                  <li>• Project details & timelines</li>
                  <li>• Workload summary metrics</li>
                </ul>
              </div>

              <div className="flex items-center space-x-2 mt-2 p-2 bg-yellow-50 rounded">
                <input
                  type="checkbox"
                  id="incomplete-only"
                  className="w-3 h-3 rounded"
                  onChange={(e) => setIncompleteOnly(e.target.checked)}
                />
                <label htmlFor="incomplete-only" className="text-xs text-gray-700 cursor-pointer">
                  Show only incomplete projects
                </label>
              </div>
              
              <Button 
                className="w-full h-8 text-xs" 
                onClick={() => generateReport("vendor-workload")}
              >
                <Download className="h-3 w-3 mr-1" />
                Generate Report
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center space-x-2 text-sm">
                <Users className="h-4 w-4" />
                <span>Project Team Directory</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-xs text-gray-600">
                <p className="mb-1">Who is working on each project:</p>
                <ul className="space-y-0.5">
                  <li>• Architect, MEP, structural, civil</li>
                  <li>• GC, expediter, landlord &amp; tenant reps</li>
                  <li>• Firm, person, email and phone</li>
                </ul>
              </div>
              <p className="text-[11px] text-gray-500">
                Assign people on each RFP under Project Team. Projects with nobody assigned
                will not appear.
              </p>
              <Button
                className="w-full h-8 text-xs"
                onClick={() => generateReport("project-team")}
              >
                <Download className="h-3 w-3 mr-1" />
                Generate Report
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center space-x-2 text-base">
                <BarChart3 className="h-4 w-4" />
                <span>Custom Report</span>
              </CardTitle>
              <p className="text-xs text-gray-600">
                Build your own report with selected data fields
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="bg-gray-50 p-2 rounded">
                <h4 className="font-medium text-gray-900 mb-1 text-xs">Customizable Fields</h4>
                <ul className="space-y-0 text-xs text-gray-600">
                  <li>• Choose any combination of data fields</li>
                  <li>• Control column order and visibility</li>
                  <li>• Apply current filters to data</li>
                  <li>• Export in your preferred format</li>
                </ul>
              </div>
              
              <Button 
                className="w-full h-8 text-xs" 
                onClick={() => generateReport("custom")}
              >
                <Download className="h-3 w-3 mr-1" />
                Build Custom Report
              </Button>
            </CardContent>
          </Card>

          {/* Category Cost Breakdown — interactive table report */}
          <Card className="border-blue-200 bg-blue-50/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center space-x-2 text-base text-blue-800">
                <TableIcon className="h-4 w-4 text-blue-600" />
                <span>Category Cost Breakdown</span>
              </CardTitle>
              <p className="text-xs text-gray-600">
                Project cost data sliced by category or scope item
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-1">
                <div className="bg-white p-1.5 rounded text-center border border-blue-100">
                  <p className="text-lg font-bold text-blue-700">Live</p>
                  <p className="text-xs text-blue-600 uppercase font-medium">Interactive</p>
                </div>
                <div className="bg-white p-1.5 rounded text-center border border-blue-100">
                  <p className="text-lg font-bold text-green-700">XLSX</p>
                  <p className="text-xs text-green-600 uppercase font-medium">Export</p>
                </div>
              </div>

              <div className="bg-white p-2 rounded border border-blue-100">
                <h4 className="font-medium text-gray-900 mb-1 text-xs">Features</h4>
                <ul className="space-y-0 text-xs text-gray-600">
                  <li>• Pick any master categories or scope items</li>
                  <li>• Per-project $ amount and % of total</li>
                  <li>• Filter by status, property, date range</li>
                  <li>• Footer totals + weighted averages</li>
                </ul>
              </div>

              <Link href="/reports/category-cost-breakdown">
                <Button className="w-full h-8 text-xs bg-blue-600 hover:bg-blue-700">
                  <TableIcon className="h-3 w-3 mr-1" />
                  Open Report
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Costs-in-Place — $/SF of existing improvements, per property or portfolio */}
          <Card className="border-emerald-200 bg-emerald-50/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center space-x-2 text-base text-emerald-800">
                <DollarSign className="h-4 w-4 text-emerald-600" />
                <span>Costs-in-Place</span>
              </CardTitle>
              <p className="text-xs text-gray-600">
                Existing improvement costs and $/SF, per property or portfolio roll-up
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-1">
                <div className="bg-white p-1.5 rounded text-center border border-emerald-100">
                  <p className="text-lg font-bold text-emerald-700">$/SF</p>
                  <p className="text-xs text-emerald-600 uppercase font-medium">Per SF</p>
                </div>
                <div className="bg-white p-1.5 rounded text-center border border-emerald-100">
                  <p className="text-lg font-bold text-gray-900">Print</p>
                  <p className="text-xs text-gray-600 uppercase font-medium">Format</p>
                </div>
              </div>

              <div>
                <Label className="text-xs">Property</Label>
                <select
                  value={costsInPlacePropertyId}
                  onChange={(e) => setCostsInPlacePropertyId(e.target.value)}
                  className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md"
                >
                  <option value="">All properties (portfolio roll-up)</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName || p.propertyName}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                className="w-full h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                onClick={generateCostsInPlaceReport}
              >
                <DollarSign className="h-3 w-3 mr-1" />
                Generate Report
              </Button>
            </CardContent>
          </Card>

          {/* Budget by Contract — four buckets: contractor / design / CM / balance */}
          <Card className="border-purple-200 bg-purple-50/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center space-x-2 text-sm">
                <DollarSign className="h-4 w-4 text-purple-600" />
                <span>Budget by Contract</span>
              </CardTitle>
              <p className="text-xs text-gray-600">
                Four buckets — Contractor, Design, CM Fees, Balance — for evaluations and ROM allowances
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <Label className="text-xs">RFP</Label>
                <select
                  value={budgetBucketRfpId}
                  onChange={(e) => setBudgetBucketRfpId(e.target.value)}
                  className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md"
                >
                  <option value="">Select an RFP…</option>
                  {rfpRequests
                    .filter((r: any) => ["evaluation", "publish"].includes(r.workflowPhase) || r.status === "completed")
                    .map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.rfpNumber} — {r.projectName}{(r as any).pricingPath === "rom_pilot" ? " (ROM)" : ""}
                      </option>
                    ))}
                </select>
              </div>
              <Button
                className="w-full h-8 text-xs bg-purple-600 hover:bg-purple-700"
                onClick={generateBudgetBucketReport}
              >
                <DollarSign className="h-3 w-3 mr-1" />
                Generate Report
              </Button>
            </CardContent>
          </Card>

          {/* Occupancy — leased vs rentable SF, per property + portfolio */}
          <Card className="border-indigo-200 bg-indigo-50/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center space-x-2 text-base text-indigo-800">
                <Building2 className="h-4 w-4 text-indigo-600" />
                <span>Occupancy</span>
              </CardTitle>
              <p className="text-xs text-gray-600">
                Occupancy & vacancy rates from signed leases vs. rentable SF
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-1">
                <div className="bg-white p-1.5 rounded text-center border border-indigo-100">
                  <p className="text-lg font-bold text-indigo-700">%</p>
                  <p className="text-xs text-indigo-600 uppercase font-medium">Occupancy</p>
                </div>
                <div className="bg-white p-1.5 rounded text-center border border-indigo-100">
                  <p className="text-lg font-bold text-gray-900">Print</p>
                  <p className="text-xs text-gray-600 uppercase font-medium">Format</p>
                </div>
              </div>
              <div className="bg-white p-2 rounded border border-indigo-100">
                <ul className="space-y-0 text-xs text-gray-600">
                  <li>• Per-property + portfolio roll-up</li>
                  <li>• Leased / vacant SF and rates</li>
                  <li>• Tenant count per property</li>
                </ul>
              </div>
              <Button
                className="w-full h-8 text-xs bg-indigo-600 hover:bg-indigo-700"
                onClick={generateOccupancyReport}
              >
                <Building2 className="h-3 w-3 mr-1" />
                Generate Report
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <CustomReportModal
        isOpen={customReportModalOpen}
        onClose={() => setCustomReportModalOpen(false)}
        filters={filters}
      />
    </div>
  );
}