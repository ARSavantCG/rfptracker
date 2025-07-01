import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, Calendar, Building, MapPin, DollarSign, Users, CheckCircle } from "lucide-react";
import type { RfpRequest } from "@shared/schema";

interface PublishSummaryProps {
  rfp: RfpRequest | null;
}

export function PublishSummary({ rfp }: PublishSummaryProps) {
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  if (!rfp) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Select an RFP to view publish summary</p>
      </div>
    );
  }

  const generateFinancialSummary = async () => {
    setIsGeneratingReport(true);
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/rfp-requests/${rfp.id}/financial-summary`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to generate financial summary');
      }

      // Create download link
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Financial_Summary_${rfp.rfpNumber}_${rfp.projectName?.replace(/[^a-zA-Z0-9]/g, '_') || 'Report'}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error generating financial summary:', error);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const formatDate = (dateString: string | Date) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getRentableArea = () => {
    if (rfp.selectedBayConfigurations && rfp.selectedBayConfigurations.length > 0) {
      const totalArea = rfp.selectedBayConfigurations.reduce((sum: number, bay: any) => 
        sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
      return totalArea.toLocaleString();
    }
    return 'N/A';
  };

  return (
    <div className="space-y-6">
      {/* Project Overview */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl flex items-center gap-2">
              <Building className="h-5 w-5" />
              Project Summary
            </CardTitle>
            <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-200">
              <CheckCircle className="h-3 w-3 mr-1" />
              Ready to Publish
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-600">RFP Number</label>
                <p className="text-lg font-semibold text-gray-900">{rfp.rfpNumber}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Project Name</label>
                <p className="text-lg text-gray-900">{rfp.projectName}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Property</label>
                <p className="text-gray-900 flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {rfp.property}
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-600">Rentable Area</label>
                <p className="text-lg text-gray-900">{getRentableArea()} SF</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Received Date</label>
                <p className="text-gray-900 flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {formatDate(rfp.receivedOn)}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Internal Due Date</label>
                <p className="text-gray-900 flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {formatDate(rfp.internalDueDate)}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Workflow Status Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Workflow Completion Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-3 p-3 border rounded-lg bg-green-50">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-800">RFP Processing</p>
                <p className="text-xs text-green-600">Entry & Validation Complete</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 border rounded-lg bg-green-50">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-800">Bid Collection</p>
                <p className="text-xs text-green-600">All Bids Received</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 border rounded-lg bg-green-50">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-800">Evaluation</p>
                <p className="text-xs text-green-600">Budget Analysis Complete</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reports & Documentation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Final Reports & Documentation
          </CardTitle>
          <p className="text-sm text-gray-600 mt-2">
            Generate comprehensive project reports for stakeholders and record keeping
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-green-600" />
                <h4 className="font-medium">Financial Summary Report</h4>
              </div>
              <p className="text-sm text-gray-600">
                Complete budget breakdown, cost analysis, and financial recommendations
              </p>
              <Button
                onClick={generateFinancialSummary}
                disabled={isGeneratingReport}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                {isGeneratingReport ? "Generating..." : "Generate Financial Summary"}
              </Button>
            </div>
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                <h4 className="font-medium">Executive Summary</h4>
              </div>
              <p className="text-sm text-gray-600">
                High-level project overview and key recommendations for leadership
              </p>
              <Button
                onClick={() => window.open('/api/reports/executive', '_blank')}
                variant="outline"
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                View Executive Summary
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Project Completion */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg text-center">Project Completion</CardTitle>
          <p className="text-sm text-gray-600 text-center">
            Once all stakeholder reviews are complete, mark this project as finished
          </p>
        </CardHeader>
        <CardContent>
          <div className="text-center">
            <p className="text-sm text-gray-500 mb-4">
              This action will finalize the RFP process and archive the project
            </p>
            <p className="text-xs text-gray-400">
              Use the "Mark as Complete" button in the Workflow Status panel when ready
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}