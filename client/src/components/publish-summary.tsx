import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Calendar, Building, Users, CheckCircle, Eye, DollarSign } from "lucide-react";
import type { RfpRequest } from "@shared/schema";

interface PublishSummaryProps {
  rfp: RfpRequest | null;
}

export function PublishSummary({ rfp }: PublishSummaryProps) {

  // Fetch report histories for this RFP
  const { data: budgetHistory = [] } = useQuery({
    queryKey: [`/api/rfp-requests/${rfp?.id}/evaluation-budget-history`],
    enabled: !!rfp?.id,
  });

  const { data: generationHistory = [] } = useQuery({
    queryKey: [`/api/rfp-requests/${rfp?.id}/generation-history`],
    enabled: !!rfp?.id,
  });

  if (!rfp) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Select an RFP to view publish summary</p>
      </div>
    );
  }



  const viewReport = (reportType: string, reportId?: number) => {
    const token = localStorage.getItem('auth-token');
    let url = '';
    
    if (reportType === 'budget-evaluation' && reportId) {
      url = `/api/evaluation-budget-history/${reportId}/view?token=${encodeURIComponent(token || '')}`;
    } else if (reportType === 'invitation-to-bid' && reportId) {
      url = `/api/rfp-requests/${rfp.id}/generation-history/${reportId}?token=${encodeURIComponent(token || '')}`;
    } else if (reportType === 'executive-summary') {
      url = `/api/reports/executive?rfpId=${rfp.id}&token=${encodeURIComponent(token || '')}`;
    }
    
    if (url) {
      window.open(url, '_blank');
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
          <CardTitle className="text-xl flex items-center gap-2">
            <Building className="h-5 w-5" />
            Project Summary
          </CardTitle>
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
            Project-specific reports generated during the workflow process
          </p>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Generated Budget Evaluation Reports */}
          {Array.isArray(budgetHistory) && budgetHistory.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-gray-700">Budget Evaluation Reports</h4>
              {budgetHistory.map((report: any) => (
                <div key={report.id} className="flex items-center justify-between p-3 border rounded-lg bg-gray-50">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-green-600" />
                    <div>
                      <p className="text-sm font-medium">Budget Evaluation Report</p>
                      <p className="text-xs text-gray-500">
                        Generated {report.generatedAt ? formatDate(report.generatedAt) : 'Unknown date'}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => viewReport('budget-evaluation', report.id)}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    View
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Generated Invitation to Bid Reports */}
          {Array.isArray(generationHistory) && generationHistory.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-gray-700">Invitation to Bid Documents</h4>
              {generationHistory.map((report: any) => (
                <div key={report.id} className="flex items-center justify-between p-3 border rounded-lg bg-gray-50">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-600" />
                    <div>
                      <p className="text-sm font-medium">{report.title}</p>
                      <p className="text-xs text-gray-500">
                        Generated {report.generatedAt ? formatDate(report.generatedAt) : 'Unknown date'}
                        {report.notes && ` - ${report.notes}`}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => viewReport('invitation-to-bid', report.id)}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    View
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Executive Summary Option */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              <h4 className="font-medium">Executive Summary</h4>
            </div>
            <p className="text-sm text-gray-600">
              High-level project overview and key recommendations for leadership
            </p>
            <Button
              onClick={() => viewReport('executive-summary')}
              variant="outline"
              className="w-full"
            >
              <Eye className="h-4 w-4 mr-2" />
              View Executive Summary
            </Button>
          </div>

          {/* Show message if no reports generated yet */}
          {(!Array.isArray(budgetHistory) || budgetHistory.length === 0) && 
           (!Array.isArray(generationHistory) || generationHistory.length === 0) && (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500">
                No project-specific reports have been generated yet. Complete workflow phases to generate reports.
              </p>
            </div>
          )}
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