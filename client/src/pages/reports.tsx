import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    if (filters.status && rfp.status !== filters.status) return false;
    if (filters.property && rfp.property !== filters.property) return false;
    if (filters.dueInDays) {
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
      const sevenDaysFromNow = addDays(new Date(), 7);
      return isBefore(dueDate, sevenDaysFromNow) && rfp.status !== "completed";
    }).length,
    overdue: filteredRfps.filter((rfp: RfpRequest) => {
      const dueDate = parseISO(rfp.internalDueDate.toString());
      return isBefore(dueDate, new Date()) && rfp.status !== "completed";
    }).length
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "received": return "bg-purple-100 text-purple-800 border-purple-200";
      case "in-progress": return "bg-orange-100 text-orange-800 border-orange-200";
      case "completed": return "bg-green-100 text-green-800 border-green-200";
      case "on-hold": return "bg-red-100 text-red-800 border-red-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getPriorityLabel = (dueDate: string, status: string) => {
    if (status === "completed") return "Completed";
    
    const due = parseISO(dueDate);
    const now = new Date();
    const threeDaysFromNow = addDays(now, 3);
    const sevenDaysFromNow = addDays(now, 7);

    if (isBefore(due, now)) return "Overdue";
    if (isBefore(due, threeDaysFromNow)) return "Critical";
    if (isBefore(due, sevenDaysFromNow)) return "High";
    return "Normal";
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "Overdue": return "bg-red-500 text-white";
      case "Critical": return "bg-red-100 text-red-800 border-red-200";
      case "High": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "Normal": return "bg-green-100 text-green-800 border-green-200";
      case "Completed": return "bg-green-100 text-green-800 border-green-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const handleExport = async (type: "detailed") => {
    try {
      const response = await fetch('/api/reports/detailed-report-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filters }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rfp-${type}-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading PDF:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-lg">Loading reports...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="flex items-center space-x-2">
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Dashboard</span>
              </Button>
            </Link>
            <div className="h-6 w-px bg-gray-300" />
            <BarChart3 className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
              <p className="text-gray-600">Detailed project reports and analytics</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div></div>
          <div className="flex items-center space-x-4">
            <Select value={exportFormat} onValueChange={(value: "pdf" | "excel") => setExportFormat(value)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="excel">Excel</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Report Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="status-filter">Status</Label>
              <Select value={filters.status || "all"} onValueChange={(value) => 
                setFilters({...filters, status: value === "all" ? undefined : value})
              }>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="received">Received</SelectItem>
                  <SelectItem value="in-progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="on-hold">On Hold</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="property-filter">Property</Label>
              <Select value={filters.property || "all"} onValueChange={(value) => 
                setFilters({...filters, property: value === "all" ? undefined : value})
              }>
                <SelectTrigger>
                  <SelectValue placeholder="All properties" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Properties</SelectItem>
                  {properties.map((property: any) => (
                    <SelectItem key={property.id} value={property.propertyName}>
                      {property.propertyName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="due-filter">Due Within</Label>
              <Select value={filters.dueInDays?.toString() || "all"} onValueChange={(value) => 
                setFilters({...filters, dueInDays: value === "all" ? undefined : parseInt(value)})
              }>
                <SelectTrigger>
                  <SelectValue placeholder="All dates" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Dates</SelectItem>
                  <SelectItem value="3">3 Days</SelectItem>
                  <SelectItem value="7">7 Days</SelectItem>
                  <SelectItem value="14">14 Days</SelectItem>
                  <SelectItem value="30">30 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button 
                variant="outline" 
                onClick={() => setFilters({})}
                className="w-full"
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="detailed" className="space-y-6">
        <TabsList className="grid w-full grid-cols-1">
          <TabsTrigger value="detailed">Detailed Report</TabsTrigger>
        </TabsList>

        <TabsContent value="detailed" className="space-y-6">
          {/* Detailed Report Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Detailed Report - Current RFP Status</CardTitle>
              <Button onClick={() => handleExport("detailed")} className="flex items-center space-x-2">
                <Download className="h-4 w-4" />
                <span>Export Report</span>
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-2 font-medium">RFP Number</th>
                      <th className="text-left py-3 px-2 font-medium">Project Name</th>
                      <th className="text-left py-3 px-2 font-medium">Due Date</th>
                      <th className="text-left py-3 px-2 font-medium">Status</th>
                      <th className="text-left py-3 px-2 font-medium">Days Until Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRfps.map((rfp: RfpRequest) => {
                      const dueDate = parseISO(rfp.internalDueDate.toString());
                      const daysUntilDue = Math.ceil((dueDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                      const priority = getPriorityLabel(rfp.internalDueDate.toString(), rfp.status);
                      
                      return (
                        <tr key={rfp.id} className="border-b hover:bg-gray-50">
                          <td className="py-3 px-2 font-medium whitespace-nowrap">{rfp.rfpNumber}</td>
                          <td className="py-3 px-2 whitespace-nowrap">{rfp.projectName}</td>
                          <td className="py-3 px-2 whitespace-nowrap">{format(dueDate, 'MMM dd, yyyy')}</td>
                          <td className="py-3 px-2">
                            <Badge className={`${getStatusBadgeColor(rfp.status)} text-xs whitespace-nowrap`}>
                              {rfp.status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </Badge>
                          </td>
                          <td className="py-3 px-2">
                            {rfp.status === "completed" ? (
                              <span className="text-gray-400">—</span>
                            ) : (
                              <span className={daysUntilDue < 0 ? "text-red-600 font-semibold" : daysUntilDue <= 3 ? "text-yellow-600 font-semibold" : ""}>
                                {daysUntilDue < 0 ? `${Math.abs(daysUntilDue)} days overdue` : `${daysUntilDue} days`}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredRfps.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    No RFPs found matching the current filters.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>


        </Tabs>
      </div>
    </div>
  );
}