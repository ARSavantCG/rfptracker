import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatFileSize, getFileIcon, getStatusColor } from "@/lib/utils";
import { formatDateForInput, formatDateForDisplay } from "@shared/date-utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarIcon, Edit, Check, X, RefreshCw } from "lucide-react";
import type { RfpRequest } from "@shared/schema";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";
import { parseRfpVariant } from "@shared/rfp-variant";
import { RfpActualsSection } from "@/components/rfp-actuals-section";
import { ProjectTeamSection } from "@/components/project-team-section";
import { computeAreaSummary } from "@shared/area-utils";

interface RfpDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfp: RfpRequest | null;
  onRfpUpdated?: (updatedRfp: RfpRequest) => void;
}

export function RfpDetailModal({ isOpen, onClose, rfp, onRfpUpdated }: RfpDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editStatus, setEditStatus] = useState("");
  const [editWorkflowPhase, setEditWorkflowPhase] = useState("");
  const [isEditingDates, setIsEditingDates] = useState(false);
  const [editCompletedDate, setEditCompletedDate] = useState("");
  const [editPublishedDate, setEditPublishedDate] = useState("");
  const [isTogglingLeased, setIsTogglingLeased] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Fetch the specific RFP to get live data (bypasses prop caching)
  const { data: liveRfp } = useQuery<RfpRequest>({
    queryKey: [`/api/rfp-requests/${rfp?.id}`],
    enabled: !!rfp?.id,
  });

  // Use live RFP data if available, fallback to prop
  const displayRfp = liveRfp || rfp;

  // Get comprehensive file count from all workflow stages
  const { data: fileCountData } = useQuery<{
    totalFiles: number;
    filesByStage: {
      rfpEntry: number;
      bidCollection: number;
      evaluationBudget: number;
      publishedFiles: number;
    };
  }>({
    queryKey: [`/api/rfp-requests/${rfp?.id}/file-count`],
    enabled: !!rfp?.id,
  });

  // Get property information for project summary
  const { data: property } = useQuery<{
    id: number;
    propertyName: string;
    building: string;
    // Needed for the rentable-area badge: mechanical is prorated against the
    // building's full bay list, so both must be fetched, not just the name.
    bayConfigurations?: any[];
    mechanicalRoomSquareFootage?: number;
  }>({
    queryKey: [`/api/properties/${displayRfp?.property}`],
    enabled: !!displayRfp?.property,
  });

  // Project alternates (Enhanced RFP — returns [] if none exist)
  const { data: projectAlternates = [] } = useQuery<Array<{
    id: string;
    description: string;
    optionA: string | null;
    optionB: string | null;
    categoryName: string | null;
    displayOrder: number;
  }>>({
    queryKey: [`/api/rfp-requests/${rfp?.id}/project-alternates`],
    enabled: !!rfp?.id,
  });

  // Invitation data for bidder panel (returns null on 404 — no invitation yet)
  const { data: invitationData } = useQuery<{
    selectedContractor: string | null;
    selectedArchitect: string | null;
    rfpVariant: string;
  } | null>({
    queryKey: ["/api/rfp-requests", rfp?.id, "invitation-to-bid"],
    queryFn: async () => {
      if (!rfp?.id) return null;
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const res = await fetch(`/api/rfp-requests/${rfp.id}/invitation-to-bid`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!rfp?.id,
    retry: false,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (updates: { status?: string; workflowPhase?: string }) => {
      if (!rfp) return;
      return await apiRequest(`/api/rfp-requests/${rfp.id}`, "PATCH", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Success",
        description: "RFP status updated successfully",
        duration: 4000,
      });
      setIsEditing(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update status",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const updateDatesMutation = useMutation({
    mutationFn: async (dates: { completedDate?: string | null; publishedDate?: string | null }) => {
      if (!rfp) return;
      const updateData: any = {};
      if (dates.completedDate !== undefined) {
        updateData.completedDate = dates.completedDate ? new Date(dates.completedDate) : null;
      }
      if (dates.publishedDate !== undefined) {
        updateData.publishedDate = dates.publishedDate ? new Date(dates.publishedDate) : null;
      }

      return await apiRequest(`/api/rfp-requests/${rfp.id}`, "PATCH", updateData);
    },
    onSuccess: (updatedRfp: RfpRequest) => {
      // Invalidate all RFP-related queries to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      // Update the parent component with fresh RFP data
      if (onRfpUpdated && updatedRfp) {
        onRfpUpdated(updatedRfp);
      }
      toast({
        title: "Success",
        description: "Project completion dates updated successfully",
        duration: 4000,
      });
      setIsEditingDates(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update completion dates",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const leasedMutation = useMutation({
    mutationFn: async (newValue: boolean) => {
      if (!rfp) return;
      return await apiRequest(`/api/rfp-requests/${rfp.id}`, "PATCH", { isLeased: newValue });
    },
    onSuccess: (updatedRfp: RfpRequest) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      if (onRfpUpdated && updatedRfp) onRfpUpdated(updatedRfp);
      setIsTogglingLeased(false);
    },
    onError: (error) => {
      setIsTogglingLeased(false);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update leased status",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (fileId: string) => {
      if (!rfp) return;
      const response = await apiRequest(`/api/rfp-requests/${rfp.id}/files/${fileId}`, "DELETE");
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      toast({
        title: "Success",
        description: "File deleted successfully",
        duration: 4000,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete file",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  // Initialize edit dates when modal opens or RFP changes
  useEffect(() => {
    if (rfp) {
      setEditCompletedDate(formatDateForInput(rfp.completedDate));
      setEditPublishedDate(formatDateForInput(rfp.publishedDate));
    }
  }, [rfp?.id]);

  // Check if user has admin permissions
  const isAdmin = user?.permissions?.includes('admin.access') || user?.isAdmin;

  // Refresh handler to force fresh data from server
  const handleRefresh = async () => {
    if (!rfp) return;
    
    toast({
      title: "Refreshing...",
      description: "Loading latest bay configuration data",
      duration: 2000,
    });
    
    // Force invalidate and refetch the specific RFP to bypass HTTP cache
    await queryClient.invalidateQueries({ queryKey: [`/api/rfp-requests/${rfp.id}`] });
    await queryClient.refetchQueries({ 
      queryKey: [`/api/rfp-requests/${rfp.id}`],
      type: 'active'
    });
    
    // Also invalidate the list queries
    await queryClient.invalidateQueries({ queryKey: ['/api/rfp-requests'] });
    
    toast({
      title: "Refreshed",
      description: "Bay configuration data updated",
      duration: 2000,
    });
  };

  if (!isOpen || !rfp) return null;

  const handleSaveDates = () => {
    updateDatesMutation.mutate({
      completedDate: editCompletedDate || null,
      publishedDate: editPublishedDate || null,
    });
  };

  const handleCancelDatesEdit = () => {
    setEditCompletedDate(formatDateForInput(rfp?.completedDate));
    setEditPublishedDate(formatDateForInput(rfp?.publishedDate));
    setIsEditingDates(false);
  };

  const handleDownloadFile = (fileId: string, fileName: string) => {
    const link = document.createElement('a');
    link.href = `/api/rfp-requests/${rfp.id}/files/${fileId}`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDeleteFile = (fileId: string, fileName: string) => {
    if (confirm(`Are you sure you want to delete "${fileName}"?`)) {
      deleteFileMutation.mutate(fileId);
    }
  };

  const handleDownloadAllFiles = async (rfpId: number, rfpNumber: string) => {
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const response = await fetch(`/api/rfp-requests/${rfpId}/download-all-files`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to download files');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // Use project name for filename instead of RFP number
      const projectName = rfp?.projectName || `RFP-${rfpNumber}`;
      const cacheBuster = Date.now();
      const safeFileName = projectName
        .replace(/[@]/g, '_at_')
        .replace(/[^\w\s\-\.]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
      const uniqueFilename = `${safeFileName}_All_Files_${cacheBuster}.zip`;
      
      link.download = uniqueFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Download Complete",
        description: `All files for RFP ${rfpNumber} have been downloaded as a ZIP file`,
        duration: 5000,
      });
    } catch (error) {
      console.error('Download all files error:', error);
      toast({
        title: "Download Failed",
        description: `Could not download files for RFP ${rfpNumber}. Please check your connection and try again.`,
        variant: "destructive",
        duration: 6000,
      });
    }
  };

  const handleOpenSummaryReport = async (rfpId: number) => {
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const response = await fetch(`/api/rfp-requests/${rfpId}/summary-report`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to load report');
      const html = await response.text();
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(html);
        newWindow.document.close();
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Could not load report",
        variant: "destructive",
      });
    }
  };

  // Define available workflow phases
  const workflowPhases = [
    { key: "rfp-entry", label: "RFP Entry" },
    { key: "rfp-validation", label: "RFP Validation" },
    { key: "invitation-to-bid", label: "Invitation to Bid" },
    { key: "bid-collection", label: "Bid Collection" },
    { key: "evaluation", label: "Evaluation" },
    { key: "publish", label: "Publish" },
  ];

  const statusOptions = [
    "received",
    "in-progress", 
    "completed",
    "on-hold",
    "archived"
  ];

  const handleStatusUpdate = () => {
    const updates: { status?: string; workflowPhase?: string } = {};
    
    if (editStatus && editStatus !== rfp?.status) {
      updates.status = editStatus;
    }
    
    if (editWorkflowPhase && editWorkflowPhase !== rfp?.workflowPhase) {
      updates.workflowPhase = editWorkflowPhase;
    }
    
    if (Object.keys(updates).length > 0) {
      updateStatusMutation.mutate(updates);
    } else {
      setIsEditing(false);
    }
  };

  const startEditingStatus = () => {
    setEditStatus(rfp?.status || "");
    setEditWorkflowPhase(rfp?.workflowPhase || "");
    setIsEditing(true);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div 
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={onClose}
        ></div>
        
        <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
        
        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
          <div className="bg-white px-6 pt-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{displayRfp?.rfpNumber} Details</h3>
                <p className="text-sm text-gray-600">{rfp.projectName}</p>
              </div>
              <button 
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Request Details */}
              <div className="lg:col-span-2 space-y-6">
                {/* Project Summary Section */}
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-blue-900">
                      RFP Entry Summary
                      {isAdmin && <span className="text-xs text-blue-600 ml-2">(Admin Mode)</span>}
                    </h4>
                    <button
                      onClick={() => handleOpenSummaryReport(rfp.id)}
                      className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-300 rounded-md hover:bg-blue-100 flex items-center gap-1.5"
                      title="View RFP Entry Summary Report"
                      data-testid="button-print-rfp-entry"
                    >
                      <i className="fas fa-print"></i>
                      Print
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-start">
                      <span className="text-blue-700 font-medium">Property:</span>
                      <span className="ml-2 text-blue-900">
                        {property ? (
                          property.building && property.building.trim() !== ''
                            ? `${property.propertyName} - Bldg. ${property.building}`
                            : property.propertyName
                        ) : 'Loading...'}
                      </span>
                    </div>
                    <div className="flex items-start">
                      <span className="text-blue-700 font-medium">Tenant:</span>
                      <span className="ml-2 text-blue-900">{displayRfp?.tenantName}</span>
                    </div>
                    <div className="flex items-start">
                      <span className="text-blue-700 font-medium">Rentable Area:</span>
                      <span className="ml-2 text-blue-900">
                        {(() => {
                          // Use live-fetched bay configs; fall back to prop rfp bay configs (handles split-bay ID mismatch in live fetch)
                          const bays =
                            displayRfp?.selectedBayConfigurations && displayRfp.selectedBayConfigurations.length > 0
                              ? displayRfp.selectedBayConfigurations
                              : rfp?.selectedBayConfigurations;

                          if (bays && bays.length > 0) {
                            // shared/area-utils, not an inline reduce.
                            //
                            // This badge summed the raw array and preferred
                            // rentableSquareFootage, which on split halves already
                            // includes that half's mechanical allocation - so it
                            // double-counted mechanical AND could not drop a parent
                            // bay stored alongside its own halves. It was the last
                            // surface still reporting 397,164 after the workflow
                            // screens were corrected.
                            const summary = computeAreaSummary(
                              bays,
                              property?.bayConfigurations,
                              property?.mechanicalRoomSquareFootage,
                            );
                            return summary.totalRentableSf > 0
                              ? `${summary.totalRentableSf.toLocaleString()} SF`
                              : 'Not specified';
                          }

                          // Fallback to stored warehouseArea only if no bay configurations available
                          if (rfp?.warehouseArea) {
                            return `${parseFloat(rfp.warehouseArea.toString().replace(/[^0-9.]/g, '')).toLocaleString()} SF`;
                          }

                          return 'Not specified';
                        })()}
                      </span>
                    </div>
                    <div className="flex items-start">
                      <span className="text-blue-700 font-medium">Bay Count:</span>
                      <span className="ml-2 text-blue-900">
                        {displayRfp?.selectedBayConfigurations && displayRfp.selectedBayConfigurations.length > 0
                          ? `${displayRfp.selectedBayConfigurations.length} bays`
                          : (displayRfp?.selectedBayIds && Array.isArray(displayRfp.selectedBayIds) && displayRfp.selectedBayIds.length > 0
                            ? `${displayRfp.selectedBayIds.length} bays`
                            : 'Not specified')}
                      </span>
                    </div>

                    {/* Selected bay breakdown.
                        Rentable area is derived from this array, so when the total
                        looks wrong the answer is almost always visible here: whole
                        bays stored where halves were intended, a parent bay sitting
                        beside its own halves, or entries missing parentBayId (written
                        before provenance was carried, and therefore not deduplicable).
                        Showing the raw entries beats guessing at the total. */}
                    {(() => {
                      const bays: any[] = (displayRfp?.selectedBayConfigurations as any[]) || [];
                      if (bays.length === 0) return null;
                      const halves = bays.filter((b) => b?.parentBayId || b?.isSplitBay).length;
                      const noProvenance = bays.filter((b) => !b?.parentBayId && !b?.isSplitBay && String(b?.id || '').match(/_(north|south)$/)).length;
                      return (
                        <details className="col-span-2 mt-1">
                          <summary className="cursor-pointer text-xs text-blue-700 hover:underline">
                            Show selected bays ({bays.length}
                            {halves > 0 ? `, ${halves} split half${halves === 1 ? '' : 'ves'}` : ', all whole bays'})
                          </summary>
                          <div className="mt-1 max-h-44 overflow-y-auto border rounded bg-white">
                            <table className="w-full text-[11px]">
                              <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                  <th className="text-left p-1">Bay</th>
                                  <th className="text-right p-1">SF</th>
                                  <th className="text-left p-1">Type</th>
                                </tr>
                              </thead>
                              <tbody>
                                {bays.map((b, i) => (
                                  <tr key={b?.id ?? i} className="border-t">
                                    <td className="p-1">{b?.bayName || b?.id || `#${i + 1}`}</td>
                                    <td className="p-1 text-right tabular-nums">
                                      {Number(b?.squareFootage || 0).toLocaleString()}
                                    </td>
                                    <td className="p-1 text-gray-600">
                                      {b?.parentBayId || b?.isSplitBay
                                        ? `half of ${b?.parentBayId ?? '?'}`
                                        : 'whole bay'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {noProvenance > 0 && (
                            <p className="text-[11px] text-amber-700 mt-1">
                              {noProvenance} entr{noProvenance === 1 ? 'y is' : 'ies are'} named like a split half but
                              carry no parentBayId — saved before split provenance was recorded. Re-select the bays on
                              this RFP and save to rewrite the selection.
                            </p>
                          )}
                        </details>
                      );
                    })()}

                    <div className="flex items-start">
                      <span className="text-blue-700 font-medium">Received Date:</span>
                      <span className="ml-2 text-blue-900">
                        {(() => {
                          // FORCE DIRECT DATE PARSING - NO TIMEZONE CONVERSION
                          const dateStr = rfp.receivedOn as string | Date | null | undefined;
                          
                          if (typeof dateStr === 'string' && dateStr.includes('T')) {
                            const datePart = dateStr.split('T')[0];
                            const [year, month, day] = datePart.split('-').map(Number);
                            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                            return `${monthNames[month - 1]} ${day}, ${year}`;
                          }
                          
                          return 'Date Error';
                        })()}
                      </span>
                    </div>
                    <div className="flex items-start">
                      <span className="text-blue-700 font-medium">Internal Due Date:</span>
                      <span className="ml-2 text-blue-900">
                        {(() => {
                          // FORCE DIRECT DATE PARSING - NO TIMEZONE CONVERSION  
                          const dateStr = rfp.internalDueDate as string | Date | null | undefined;
                          
                          if (typeof dateStr === 'string' && dateStr.includes('T')) {
                            const datePart = dateStr.split('T')[0];
                            const [year, month, day] = datePart.split('-').map(Number);
                            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                            return `${monthNames[month - 1]} ${day}, ${year}`;
                          }
                          
                          return 'Date Error';
                        })()}
                      </span>
                    </div>
                    {rfp.estimatedValue && (
                      <div className="flex items-start">
                        <span className="text-blue-700 font-medium">Est. Value:</span>
                        <span className="ml-2 text-blue-900">{rfp.estimatedValue}</span>
                      </div>
                    )}
                    {rfp.timelineRequirements && (
                      <div className="flex items-start">
                        <span className="text-blue-700 font-medium">Timeline:</span>
                        <span className="ml-2 text-blue-900">{rfp.timelineRequirements}</span>
                      </div>
                    )}
                    
                    {/* Status and Workflow Phase Fields - Admin Only */}
                    {isAdmin && (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-blue-700 font-medium">Status:</span>
                          {isEditing ? (
                            <select
                              value={editStatus}
                              onChange={(e) => setEditStatus(e.target.value)}
                              className="px-2 py-1 text-xs border border-gray-300 rounded"
                            >
                              {statusOptions.map(status => (
                                <option key={status} value={status}>
                                  {status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ')}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-blue-900">
                              {rfp.status?.charAt(0).toUpperCase() + rfp.status?.slice(1).replace('-', ' ')}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-blue-700 font-medium">Workflow Phase:</span>
                          {isEditing ? (
                            <select
                              value={editWorkflowPhase}
                              onChange={(e) => setEditWorkflowPhase(e.target.value)}
                              className="px-2 py-1 text-xs border border-gray-300 rounded"
                            >
                              {workflowPhases.map(phase => (
                                <option key={phase.key} value={phase.key}>
                                  {phase.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-blue-900">
                              {workflowPhases.find(p => p.key === rfp.workflowPhase)?.label || rfp.workflowPhase}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                    
                    {/* Completed date: shown only once the RFP IS completed.
                        Adolfo: "the completion date might be excessive". It is
                        redundant with Status on an RFP that is not finished -
                        "Completed: Not completed" beside "Status: In Progress"
                        says the same thing twice - and nothing outside this modal
                        reads it. Kept for completed records, where the date is
                        real information; hidden otherwise. */}
                    {(rfp.status === 'completed' || rfp.completedDate) && (
                    <div className="flex items-center gap-2">
                      <span className="text-blue-700 font-medium">Completed:</span>
                      {isAdmin && isEditingDates ? (
                        <div className="relative">
                          <Input
                            type="date"
                            value={editCompletedDate}
                            onChange={(e) => setEditCompletedDate(e.target.value)}
                            className="h-8 text-xs w-36 pr-8"
                          />
                          <CalendarIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
                        </div>
                      ) : (
                        <span className="text-blue-900">
                          {rfp.completedDate ? formatDateForDisplay(rfp.completedDate) : "Not completed"}
                        </span>
                      )}
                      {isAdmin && !isEditingDates && (
                        <button
                          onClick={() => setIsEditingDates(true)}
                          className="text-blue-600 hover:text-blue-800 ml-2"
                          title="Edit completion date"
                        >
                          <Edit className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    )}

                    <div className="flex items-center gap-2">
                      <span className="text-blue-700 font-medium">Published:</span>
                      {isAdmin && isEditingDates ? (
                        <div className="relative">
                          <Input
                            type="date"
                            value={editPublishedDate}
                            onChange={(e) => setEditPublishedDate(e.target.value)}
                            className="h-8 text-xs w-36 pr-8"
                          />
                          <CalendarIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
                        </div>
                      ) : (
                        <span className="text-blue-900">
                          {rfp.publishedDate
                            ? formatDateForDisplay(rfp.publishedDate)
                            : "— set automatically when published"}
                        </span>
                      )}
                      {isAdmin && !isEditingDates && (
                        <button
                          onClick={() => setIsEditingDates(true)}
                          className="text-blue-600 hover:text-blue-800 ml-2"
                          title="Edit published date"
                        >
                          <Edit className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    {/* Leased toggle */}
                    <div className="flex items-center gap-2">
                      <span className="text-blue-700 font-medium">Leased:</span>
                      <input
                        type="checkbox"
                        id="leased-toggle"
                        checked={!!rfp.isLeased}
                        disabled={leasedMutation.isPending}
                        onChange={() => {
                          setIsTogglingLeased(true);
                          leasedMutation.mutate(!rfp.isLeased);
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      {rfp.isLeased && rfp.leasedAt && (
                        <span className="text-blue-900 text-xs">
                          since {formatDateForDisplay(rfp.leasedAt)}
                        </span>
                      )}
                      {leasedMutation.isPending && (
                        <span className="text-xs text-gray-400">Saving…</span>
                      )}
                    </div>
                  </div>
                  
                  {/* Edit Actions */}
                  {isAdmin && isEditingDates && (
                    <div className="flex justify-end gap-2 mt-4">
                      <button
                        onClick={() => {
                          setIsEditingDates(false);
                          setEditCompletedDate(formatDateForInput(rfp?.completedDate));
                          setEditPublishedDate(formatDateForInput(rfp?.publishedDate));
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-800"
                      >
                        <X className="h-3 w-3" />
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveDates}
                        disabled={updateDatesMutation.isPending}
                        className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        <Check className="h-3 w-3" />
                        Save
                      </button>
                    </div>
                  )}
                </div>

                {/* ── Building Context (Enhanced RFP only — hidden when all fields empty) ── */}
                {(() => {
                  const dr = displayRfp as any;
                  const rows = [
                    { label: 'Bay Dimensions', value: dr?.bayDimensions },
                    { label: 'Dock Doors', value: dr?.dockDoorCount != null ? String(dr.dockDoorCount) : null },
                    { label: 'Clear Height', value: dr?.clearHeight },
                    { label: 'Sprinkler System', value: dr?.sprinklerSpec },
                    { label: 'Existing Power', value: dr?.existingPower },
                    { label: 'Parking Ratio', value: dr?.parkingRatio },
                    { label: 'Tenant Program', value: dr?.tenantProgramSummary },
                  ].filter(r => r.value != null && r.value !== '');
                  if (rows.length === 0) return null;
                  return (
                    <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-200">
                      <h4 className="font-medium text-indigo-900 mb-3">Building Context</h4>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        {rows.map(r => (
                          <div key={r.label} className="flex items-start">
                            <span className="text-indigo-700 font-medium whitespace-nowrap">{r.label}:</span>
                            <span className="ml-2 text-indigo-900">{r.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* ── Alternates (Enhanced RFP only — hidden when none exist) ── */}
                {projectAlternates.length > 0 && (
                  <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
                    <h4 className="font-medium text-amber-900 mb-3">Project Alternates</h4>
                    <div className="space-y-3">
                      {projectAlternates.map(alt => (
                        <div key={alt.id} className="text-sm">
                          <div className="font-medium text-amber-900">{alt.description}</div>
                          {alt.categoryName && (
                            <div className="text-xs text-amber-600 mb-1">Category: {alt.categoryName}</div>
                          )}
                          <div className="grid grid-cols-2 gap-2 mt-1">
                            {alt.optionA && (
                              <div>
                                <span className="text-amber-700 font-medium">Option A:</span>
                                <span className="ml-1 text-amber-800">{alt.optionA}</span>
                              </div>
                            )}
                            {alt.optionB && (
                              <div>
                                <span className="text-amber-700 font-medium">Option B:</span>
                                <span className="ml-1 text-amber-800">{alt.optionB}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Invitation Recipients — Enhanced badge when applicable ── */}
                {((displayRfp as any)?.generalContractor || (displayRfp as any)?.architect) && (
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <h4 className="font-medium text-gray-900 mb-3">Invitation Recipients</h4>
                    <div className="space-y-2 text-sm">
                      {(displayRfp as any)?.generalContractor && (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 w-24 shrink-0">Contractor:</span>
                          <span className="text-gray-900">{(displayRfp as any).generalContractor}</span>
                          {invitationData && parseRfpVariant(invitationData.rfpVariant).gc === 'enhanced' && (
                            <span className="px-1.5 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded">Enhanced</span>
                          )}
                        </div>
                      )}
                      {(displayRfp as any)?.architect && (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 w-24 shrink-0">Architect:</span>
                          <span className="text-gray-900">{(displayRfp as any).architect}</span>
                          {invitationData && parseRfpVariant(invitationData.rfpVariant).architect === 'enhanced' && (
                            <span className="px-1.5 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded">Enhanced</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-3">Request Information</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-start">
                      <span className="text-gray-500">Last Updated:</span>
                      <span className="ml-2 text-gray-900">{formatDateForDisplay(rfp.updatedAt)}</span>
                    </div>
                    <div className="flex items-start">
                      <span className="text-gray-500">Request Type:</span>
                      <span className="ml-2 text-gray-900">
                        {rfp.requestTypes.map(type => 
                          type.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())
                        ).join(', ')}
                      </span>
                    </div>
                    {rfp.dueDate && (
                      <div>
                        <span className="text-gray-500">Due Date:</span>
                        <span className="ml-2 text-gray-900">{formatDateForDisplay(rfp.dueDate)}</span>
                      </div>
                    )}
                    {rfp.contactPerson && (
                      <div>
                        <span className="text-gray-500">Contact:</span>
                        <span className="ml-2 text-gray-900">{rfp.contactPerson}</span>
                      </div>
                    )}
                    {rfp.contactEmail && (
                      <div>
                        <span className="text-gray-500">Email:</span>
                        <span className="ml-2 text-gray-900">{rfp.contactEmail}</span>
                      </div>
                    )}
                  </div>
                </div>
                
                {rfp.notes && (
                  <div>
                    <h4 className="font-medium text-gray-900 mb-3">Notes</h4>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-700">{rfp.notes}</p>
                    </div>
                  </div>
                )}

                {/* ── Project Team ── */}
                <ProjectTeamSection rfpId={rfp.id} />

                {/* ── Contract Actuals ── */}
                <RfpActualsSection
                  rfpId={rfp.id}
                  rfpIsLeased={!!displayRfp?.isLeased}
                />
              </div>
              
              {/* Files Section */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">
                  Attached Files ({fileCountData?.totalFiles || rfp.files.length})
                  {fileCountData && fileCountData.totalFiles > rfp.files.length && (
                    <span className="text-xs text-gray-500 ml-2">
                      ({rfp.files.length} initial + {fileCountData.totalFiles - rfp.files.length} from workflow stages)
                    </span>
                  )}
                </h4>
                {fileCountData && fileCountData.totalFiles > rfp.files.length && (
                  <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                    <h5 className="text-sm font-medium text-blue-900 mb-2">File Distribution Across Workflow Stages:</h5>
                    <div className="grid grid-cols-2 gap-2 text-xs text-blue-800">
                      <div>RFP Entry: {fileCountData.filesByStage.rfpEntry}</div>
                      <div>Bid Collection: {fileCountData.filesByStage.bidCollection}</div>
                      <div>Evaluation Budget: {fileCountData.filesByStage.evaluationBudget}</div>
                      <div>Published Files: {fileCountData.filesByStage.publishedFiles || 0}</div>
                      <div className="col-span-2 font-medium">Total: {fileCountData.totalFiles} files</div>
                    </div>
                  </div>
                )}
                
                <div className="text-center py-6 text-gray-600">
                  <i className="fas fa-folder-open text-3xl mb-3 text-gray-400"></i>
                  <p className="text-sm mb-2">Use "Download All Files" button below to access all {fileCountData?.totalFiles || rfp.files.length} files</p>
                  <p className="text-xs text-gray-500">Files are organized by workflow stage for easy navigation</p>
                </div>
              </div>
            </div>
            
            <div className="flex justify-between space-x-3 pt-6 pb-6 mt-6 border-t border-gray-200">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
              <div className="flex space-x-3">
                {isEditing ? (
                  <>
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleStatusUpdate}
                      disabled={updateStatusMutation.isPending}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {updateStatusMutation.isPending ? "Updating..." : "Save Status"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleRefresh}
                      className="px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-300 rounded-lg hover:bg-green-100 flex items-center gap-2"
                      title="Refresh bay configuration data from properties"
                      data-testid="button-refresh-rfp"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Refresh Data
                    </button>
                    {isAdmin && (
                      <button
                        onClick={startEditingStatus}
                        className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-300 rounded-lg hover:bg-blue-100"
                      >
                        Update Status
                      </button>
                    )}
                    <button
                      onClick={() => handleDownloadAllFiles(rfp.id, rfp.rfpNumber)}
                      className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 flex items-center gap-2"
                      title="Download all files from all workflow steps"
                    >
                      <i className="fas fa-download"></i>
                      Download All Files
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      
    </div>
  );
}
