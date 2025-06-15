import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileText, Calendar, TrendingUp, Clock, CheckCircle, AlertTriangle, BarChart3, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
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
      const threeDaysFromNow = addDays(new Date(), 3);
      return isBefore(dueDate, threeDaysFromNow) && rfp.status !== "completed";
    }).length,
    overdue: filteredRfps.filter((rfp: RfpRequest) => {
      const dueDate = parseISO(rfp.internalDueDate.toString());
      return isBefore(dueDate, new Date()) && rfp.status !== "completed";
    }).length,
  };

  const handleExport = async (reportType: "detailed" | "historical-pricing") => {
    try {
      const endpoint = reportType === "detailed" ? "/api/reports/detailed" : "/api/reports/historical-pricing";
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filters,
          rfps: filteredRfps,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate report");
      }

      const contentType = response.headers.get("content-type");
      const blob = await response.blob();
      
      if (contentType?.includes("text/html")) {
        // Open HTML report in new window for viewing/printing as PDF
        const url = window.URL.createObjectURL(blob);
        const newWindow = window.open(url, '_blank');
        if (newWindow) {
          newWindow.onload = () => {
            setTimeout(() => {
              window.URL.revokeObjectURL(url);
            }, 1000);
          };
        }
      } else {
        // Download as PDF file
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = `${reportType}-report-${format(new Date(), "yyyy-MM-dd")}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error("Error generating report:", error);
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
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading reports...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Reports</h1>
            <p className="text-gray-600">Generate comprehensive reports for executive review</p>
          </div>
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
              <Select
                value={filters.status || ""}
                onValueChange={(value) => setFilters({ ...filters, status: value || undefined })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="received">Received</SelectItem>
                  <SelectItem value="in-progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="on-hold">On Hold</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="property-filter">Property</Label>
              <Select
                value={filters.property || ""}
                onValueChange={(value) => setFilters({ ...filters, property: value || undefined })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All properties" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All properties</SelectItem>
                  {properties.map((property) => (
                    <SelectItem key={property.id} value={property.propertyName}>
                      {property.propertyName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="due-filter">Due Within</Label>
              <Select
                value={filters.dueInDays?.toString() || ""}
                onValueChange={(value) => setFilters({ ...filters, dueInDays: value ? parseInt(value) : undefined })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any time</SelectItem>
                  <SelectItem value="1">1 day</SelectItem>
                  <SelectItem value="3">3 days</SelectItem>
                  <SelectItem value="7">1 week</SelectItem>
                  <SelectItem value="30">1 month</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="clear-filters">Actions</Label>
              <Button
                variant="outline"
                onClick={() => setFilters({})}
                className="w-full"
              >
                Clear Filters
              </Button>
            </div>
          </div>

          {/* Metrics Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mt-6 pt-6 border-t">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{metrics.total}</p>
              <p className="text-xs text-gray-600 uppercase font-medium">Total</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">{metrics.received}</p>
              <p className="text-xs text-blue-600 uppercase font-medium">Received</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-yellow-600">{metrics.inProgress}</p>
              <p className="text-xs text-yellow-600 uppercase font-medium">In Progress</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{metrics.completed}</p>
              <p className="text-xs text-green-600 uppercase font-medium">Completed</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-600">{metrics.onHold}</p>
              <p className="text-xs text-gray-600 uppercase font-medium">On Hold</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-orange-600">{metrics.dueSoon}</p>
              <p className="text-xs text-orange-600 uppercase font-medium">Due Soon</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600">{metrics.overdue}</p>
              <p className="text-xs text-red-600 uppercase font-medium">Overdue</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Executive Summary Report */}
        <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleExport("detailed")}>
          <CardHeader>
            <CardTitle className="flex items-center space-x-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
              <span>Executive Summary</span>
            </CardTitle>
            <p className="text-sm text-gray-600">
              Comprehensive status overview of all active RFP projects
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-2xl font-bold text-gray-900">{metrics.total}</p>
                  <p className="text-xs text-gray-600 uppercase font-medium">Total RFPs</p>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-2xl font-bold text-blue-900">{metrics.inProgress}</p>
                  <p className="text-xs text-blue-600 uppercase font-medium">In Progress</p>
                </div>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="font-medium text-gray-900 mb-2">Report Contents</h4>
                <ul className="space-y-1 text-sm text-gray-600">
                  <li>• Current RFP status breakdown</li>
                  <li>• Due date analysis and priorities</li>
                  <li>• Project timeline overview</li>
                  <li>• Performance metrics</li>
                </ul>
              </div>
              
              <Button className="w-full flex items-center justify-center space-x-2">
                <Download className="h-4 w-4" />
                <span>Generate Executive Summary</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Historical Pricing Report */}
        <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleExport("historical-pricing")}>
          <CardHeader>
            <CardTitle className="flex items-center space-x-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <TrendingUp className="h-6 w-6 text-green-600" />
              </div>
              <span>Historical Pricing</span>
            </CardTitle>
            <p className="text-sm text-gray-600">
              Pricing analysis from completed RFP projects with detailed breakdowns
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-2xl font-bold text-gray-900">{metrics.completed}</p>
                  <p className="text-xs text-gray-600 uppercase font-medium">Completed</p>
                </div>
                <div className="bg-green-50 p-3 rounded-lg">
                  <p className="text-lg font-bold text-green-900">PDF</p>
                  <p className="text-xs text-green-600 uppercase font-medium">Format</p>
                </div>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="font-medium text-gray-900 mb-2">Report Contents</h4>
                <ul className="space-y-1 text-sm text-gray-600">
                  <li>• Project-by-project pricing breakdown</li>
                  <li>• Contractor bid comparisons</li>
                  <li>• Line items by category</li>
                  <li>• Unit pricing analysis</li>
                </ul>
              </div>
              
              <Button className="w-full flex items-center justify-center space-x-2" disabled={metrics.completed === 0}>
                <Download className="h-4 w-4" />
                <span>Generate Pricing Report</span>
              </Button>
              
              {metrics.completed === 0 && (
                <p className="text-xs text-gray-500 text-center">
                  No completed projects available for pricing analysis
                </p>
              )}
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}