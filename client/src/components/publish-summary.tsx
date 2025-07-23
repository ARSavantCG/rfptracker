import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Calendar, Building, Users, CheckCircle, Eye, DollarSign, ChevronDown, ChevronUp, Check, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { RfpRequest } from "@shared/schema";

interface PublishSummaryProps {
  rfp: RfpRequest | null;
}

export function PublishSummary({ rfp }: PublishSummaryProps) {
  const [budgetReportsCollapsed, setBudgetReportsCollapsed] = useState(true);
  const [bidDocumentsCollapsed, setBidDocumentsCollapsed] = useState(true);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch report histories for this RFP
  const { data: budgetHistory = [] } = useQuery({
    queryKey: [`/api/rfp-requests/${rfp?.id}/evaluation-budget-history`],
    enabled: !!rfp?.id,
  });

  const { data: generationHistory = [] } = useQuery({
    queryKey: [`/api/rfp-requests/${rfp?.id}/generation-history`],
    enabled: !!rfp?.id,
  });

  // Mutation for completing the project
  const publishAndCompleteMutation = useMutation({
    mutationFn: async () => {
      if (!rfp) throw new Error("No RFP selected");
      return apiRequest(`/api/rfp-requests/${rfp.id}`, "PATCH", { status: "completed" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Project Published & Completed",
        description: "RFP has been published and marked as completed successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to publish and complete project",
        variant: "destructive",
      });
    },
  });

  if (!rfp) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Select an RFP to view publish summary</p>
      </div>
    );
  }



  const viewReport = async (reportType: string, reportId?: number) => {
    const token = localStorage.getItem('auth-token');
    
    try {
      let url = '';
      
      if (reportType === 'budget-evaluation' && reportId) {
        url = `/api/evaluation-budget-history/${reportId}/view`;
      } else if (reportType === 'invitation-to-bid' && reportId) {
        url = `/api/generation-history/${reportId}/view`;
      }
      
      if (url) {
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
        
        if (response.ok) {
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          window.open(objectUrl, '_blank');
        } else {
          console.error('Failed to fetch report:', response.statusText);
        }
      }
    } catch (error) {
      console.error('Error viewing report:', error);
    }
  };

  const formatDate = (dateString: string | Date) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York'
    });
  };

  const getRentableArea = () => {
    if (rfp.selectedBayConfigurations && rfp.selectedBayConfigurations.length > 0) {
      // Use warehouse area + proportional mechanical allocation (bay.squareFootage + bay.mechanicalRoomAllocation)
      const totalArea = rfp.selectedBayConfigurations.reduce((sum: number, bay: any) => 
        sum + (bay.squareFootage || 0) + (bay.mechanicalRoomAllocation || 0), 0);
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
              <div 
                className="flex items-center justify-between cursor-pointer hover:bg-gray-50 p-2 rounded-lg transition-colors"
                onClick={() => setBudgetReportsCollapsed(!budgetReportsCollapsed)}
              >
                <h4 className="font-medium text-sm text-gray-700">Budget Evaluation Reports</h4>
                {budgetReportsCollapsed ? (
                  <ChevronDown className="h-4 w-4 text-gray-500" />
                ) : (
                  <ChevronUp className="h-4 w-4 text-gray-500" />
                )}
              </div>
              {!budgetReportsCollapsed && (
                <div className="space-y-2">
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
            </div>
          )}

          {/* Generated Invitation to Bid Reports */}
          {Array.isArray(generationHistory) && generationHistory.length > 0 && (
            <div className="space-y-2">
              <div 
                className="flex items-center justify-between cursor-pointer hover:bg-gray-50 p-2 rounded-lg transition-colors"
                onClick={() => setBidDocumentsCollapsed(!bidDocumentsCollapsed)}
              >
                <h4 className="font-medium text-sm text-gray-700">Invitation to Bid Documents</h4>
                {bidDocumentsCollapsed ? (
                  <ChevronDown className="h-4 w-4 text-gray-500" />
                ) : (
                  <ChevronUp className="h-4 w-4 text-gray-500" />
                )}
              </div>
              {!bidDocumentsCollapsed && (
                <div className="space-y-2">
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
            </div>
          )}



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
          <CardTitle className="text-lg text-center flex items-center justify-center gap-2">
            {rfp.status === "completed" ? (
              <>
                <Lock className="h-5 w-5 text-gray-500" />
                Project Completed
              </>
            ) : (
              <>
                <Check className="h-5 w-5 text-green-600" />
                Mark Project Complete
              </>
            )}
          </CardTitle>
          <p className="text-sm text-gray-600 text-center">
            {rfp.status === "completed" 
              ? "This project has been finalized and archived"
              : "Once all stakeholder reviews are complete, mark this project as finished"
            }
          </p>
        </CardHeader>
        <CardContent>
          <div className="text-center">
            {rfp.status === "completed" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 p-3 bg-gray-100 border border-gray-300 rounded-lg">
                  <CheckCircle className="h-5 w-5 text-gray-500" />
                  <span className="text-gray-600 font-medium">Project Completed</span>
                </div>
                <p className="text-xs text-gray-500">
                  This RFP has been finalized and archived. All workflow phases are complete.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-500 mb-4">
                  This action will finalize the RFP process and change the status to completed
                </p>
                <Button
                  onClick={() => rfp && publishAndCompleteMutation.mutate()}
                  disabled={publishAndCompleteMutation.isPending || !rfp}
                  className="w-full bg-green-600 hover:bg-green-700"
                  size="lg"
                >
                  {publishAndCompleteMutation.isPending ? (
                    "Publishing & Completing..."
                  ) : (
                    <>
                      <CheckCircle className="h-5 w-5 mr-2" />
                      Publish & Mark Complete
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}