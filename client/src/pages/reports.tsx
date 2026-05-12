import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, FileText, Calendar, TrendingUp, Clock, CheckCircle, AlertTriangle, BarChart3, ChevronDown, Users } from "lucide-react";
import Navigation from "@/components/navigation";
import { CustomReportModal } from "@/components/custom-report-modal";
import { format, parseISO, isAfter, isBefore, addDays } from "date-fns";
import type { RfpRequest } from "@shared/schema";

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

  const generateReport = async (reportType: "executive" | "detailed" | "historical" | "custom" | "vendor-workload") => {
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

      const response = await fetch(`${url}?${params}`, { credentials: 'include' });
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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