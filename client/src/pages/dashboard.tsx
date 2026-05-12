import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StatsCards } from "@/components/stats-cards";
import AttentionRequired from "@/components/attention-required";
import DashboardPipeline from "@/components/dashboard-pipeline";
import DashboardPortfolioIntelligence from "@/components/dashboard-portfolio-intelligence";
import { RfpTable } from "@/components/rfp-table";
import { CreateRfpModal } from "@/components/create-rfp-modal";
import { EditRfpModal } from "@/components/edit-rfp-modal";
import { ContactManagementModal } from "@/components/contact-management-modal";
import { PropertyManagementModal } from "@/components/property-management-modal";
import { WorkflowStatus } from "@/components/workflow-status";
import { InvitationToBidModal } from "@/components/invitation-to-bid-modal";
import { RfpValidationModal } from "@/components/rfp-validation-modal";
import { RfpDetailModal } from "@/components/rfp-detail-modal";
import { BidCollectionTable } from "@/components/bid-collection-table";
import { EvaluationBudget } from "@/components/evaluation-budget";
import { BidLevelingView } from "@/components/bid-leveling-view";
import { FinancialSummary } from "@/components/financial-summary";
import { PublishSummary } from "@/components/publish-summary";
import { QuickActionsSidebar } from "@/components/quick-actions-sidebar";
import { LegalCompliancePanel } from "@/components/legal-compliance-panel";
import Navigation from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Users, Building2, X, Settings, Crown, ChevronDown, ChevronLeft, LayoutGrid } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { apiRequest } from "@/lib/queryClient";
import type { RfpRequest } from "@shared/schema";

export default function Dashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = usePermissions();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);
  const [isInvitationModalOpen, setIsInvitationModalOpen] = useState(false);
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [isRfpDetailModalOpen, setIsRfpDetailModalOpen] = useState(false);
  const [showBidCollection, setShowBidCollection] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [selectedRfp, setSelectedRfp] = useState<RfpRequest | null>(null);
  const [workflowRfp, setWorkflowRfp] = useState<RfpRequest | null>(null);
  const [validationRfp, setValidationRfp] = useState<RfpRequest | null>(null);
  const [detailRfp, setDetailRfp] = useState<RfpRequest | null>(null);
  const [isWorkflowCollapsed, setIsWorkflowCollapsed] = useState(false);
  const [showMobileWorkflow, setShowMobileWorkflow] = useState(false);

  // Fetch all RFPs to keep selected RFP data fresh - include archived for selection tracking
  const { data: allRfps = [] } = useQuery<RfpRequest[]>({
    queryKey: ["/api/rfp-requests", "all-including-archived"],
    queryFn: async () => {
      const response = await fetch("/api/rfp-requests?include_archived=true");
      if (!response.ok) throw new Error("Failed to fetch RFP requests");
      return response.json();
    },
  });

  // Auth and admin setup
  const { data: currentUser } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  // Auto-refresh selected RFP when data changes
  useEffect(() => {
    if (selectedRfp && allRfps.length > 0) {
      // Skip auto-refresh for template RFPs (id: 0 used for unsaved alternates)
      if (selectedRfp.id === 0) {
        return;
      }
      
      const updatedRfp = allRfps.find(rfp => rfp.id === selectedRfp.id);
      if (updatedRfp) {
        // Update the selected RFP if data has changed
        if (JSON.stringify(updatedRfp) !== JSON.stringify(selectedRfp)) {
          setSelectedRfp(updatedRfp);
        }
      } else {
        // Clear selected RFP if it no longer exists (was deleted)
        setSelectedRfp(null);
      }
    } else if (selectedRfp && selectedRfp.id !== 0 && allRfps.length === 0) {
      // Clear selected RFP if all RFPs were deleted (but not for templates)
      setSelectedRfp(null);
    }
  }, [allRfps, selectedRfp]);

  // Reset workflow views when selecting a new RFP
  useEffect(() => {
    if (selectedRfp) {
      setShowBidCollection(false);
      setShowEvaluation(false);
      setShowPublish(false);
      setIsWorkflowCollapsed(false); // Reset workflow to expanded state when switching RFPs
    }
  }, [selectedRfp]);

  const handleEditRfp = (rfp: RfpRequest) => {
    setSelectedRfp(rfp);
    setIsEditModalOpen(true);
  };

  const handleCreateAlternate = (parentRfp: RfpRequest) => {
    // Create a template alternate RFP for the modal (not saved to database yet)
    const alternateTemplate: RfpRequest = {
      ...parentRfp,
      id: 0, // Temporary ID to indicate unsaved
      rfpNumber: `${parentRfp.rfpNumber}.A`, // Template RFP number
      projectName: "", // Will be auto-generated from tenant + property + alternate description
      property: "Select property...", // Reset for selection
      receivedOn: new Date(),
      internalDueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      selectedBayConfigurations: [],
      projectArea: null,
      files: [], // Clear files for new alternate
      isOption: true,
      parentRfpId: parentRfp.id,
      optionType: "alternate",
      notes: "RFP alternate - configure independently",
    };
    
    setSelectedRfp(alternateTemplate);
    setIsEditModalOpen(true);
  };

  const handleSelectRfp = (rfp: RfpRequest | null) => {
    if (!rfp) {
      setSelectedRfp(null);
      return;
    }
    
    // If clicking the same RFP that's already selected, unselect it
    if (selectedRfp && selectedRfp.id === rfp.id) {
      setSelectedRfp(null);
    } else {
      setSelectedRfp(rfp);
    }
  };

  const handleOpenRfpById = (rfpId: number) => {
    const rfp = allRfps.find((r) => r.id === rfpId) ?? null;
    handleSelectRfp(rfp);
  };

  const handleAdvanceToInvitation = (rfp: RfpRequest) => {
    setWorkflowRfp(rfp);
    setIsInvitationModalOpen(true);
    setIsWorkflowCollapsed(true); // Auto-minimize workflow when opening invitation modal
  };

  const handleOpenInvitationModal = (rfp: RfpRequest) => {
    setWorkflowRfp(rfp);
    setIsInvitationModalOpen(true);
    setIsWorkflowCollapsed(true); // Auto-minimize workflow when opening invitation modal
  };

  const handleValidateRfp = (rfp: RfpRequest) => {
    setValidationRfp(rfp);
    setIsValidationModalOpen(true);
    setIsWorkflowCollapsed(true); // Auto-minimize workflow when opening validation modal
  };

  const handleOpenBidCollection = (rfp: RfpRequest) => {
    setShowBidCollection(true);
    setIsWorkflowCollapsed(true); // Auto-minimize workflow when entering bid collection
  };

  const handleOpenEvaluation = (rfp: RfpRequest) => {
    setShowBidCollection(false);
    setShowEvaluation(true);
    setShowPublish(false);
    setIsWorkflowCollapsed(true); // Auto-minimize workflow when entering evaluation
  };

  const handleOpenPublish = (rfp: RfpRequest) => {
    setShowBidCollection(false);
    setShowEvaluation(false);
    setShowPublish(true);
    setIsWorkflowCollapsed(true); // Auto-minimize workflow when entering publish
  };

  const handleViewDetails = (rfp: RfpRequest) => {
    setDetailRfp(rfp);
    setIsRfpDetailModalOpen(true);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      <Navigation />

      <div className="flex w-full max-w-full">
        {/* Quick Actions Sidebar */}
        <QuickActionsSidebar
          onCreateRfp={() => setIsCreateModalOpen(true)}
          onCreateContact={() => setIsContactModalOpen(true)}
          onCreateProperty={() => setIsPropertyModalOpen(true)}
          onStatusFilter={setStatusFilter}
          onSearch={setSearchQuery}
          className="flex-shrink-0"
        />

        {/* Main Content */}
        <div className="flex-1 overflow-x-hidden overflow-y-auto min-w-0">
          <div className="mx-auto px-4 py-4 max-w-full">
            {/* Compact Page Header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Request for Proposals</h2>
                <p className="text-xs text-gray-600">Track and manage RFP requests</p>
              </div>
              <div className="flex space-x-2">

              </div>
            </div>

        {/* Attention Required */}
        <AttentionRequired onRfpClick={handleOpenRfpById} />

        {/* Pipeline */}
        <DashboardPipeline onRfpClick={handleOpenRfpById} />

        {/* Portfolio Intelligence */}
        <DashboardPortfolioIntelligence />

        {/* Filter by status heading */}
        <div className="flex items-center justify-between mt-8 mb-2">
          <h2 className="text-sm font-medium text-muted-foreground">Filter by status</h2>
          {statusFilter && (
            <button
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
              onClick={() => setStatusFilter("")}
            >
              <X className="h-3 w-3" />
              Clear filter
            </button>
          )}
        </div>

        {/* Stats Cards — demoted to filter row */}
        <StatsCards onStatusFilter={setStatusFilter} />

        {/* Compact Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 mb-4">
          <div className="flex flex-col lg:flex-row lg:items-center space-y-3 lg:space-y-0 lg:space-x-4">
            {/* Compact Search */}
            <div className="flex-1 max-w-sm">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <i className="fas fa-search text-gray-400 text-xs"></i>
                </div>
                <input 
                  type="text" 
                  placeholder="Search RFPs..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="block w-full pl-8 pr-3 py-2 border border-gray-300 rounded text-xs placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Compact Status Filters */}
            <div className="flex items-center space-x-1">
              <span className="text-xs text-gray-600 mr-2">Status:</span>
              <button
                onClick={() => setStatusFilter("")}
                className={`px-2 py-1 text-xs rounded transition-all ${
                  statusFilter === "" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setStatusFilter("received")}
                className={`px-2 py-1 text-xs rounded transition-all ${
                  statusFilter === "received" ? "bg-purple-600 text-white" : "bg-purple-100 text-purple-600 hover:bg-purple-200"
                }`}
              >
                Received
              </button>
              <button
                onClick={() => setStatusFilter("in-progress")}
                className={`px-2 py-1 text-xs rounded transition-all ${
                  statusFilter === "in-progress" ? "bg-orange-600 text-white" : "bg-orange-100 text-orange-600 hover:bg-orange-200"
                }`}
              >
                In Progress
              </button>
              <button
                onClick={() => setStatusFilter("completed")}
                className={`px-2 py-1 text-xs rounded transition-all ${
                  statusFilter === "completed" ? "bg-green-600 text-white" : "bg-green-100 text-green-600 hover:bg-green-200"
                }`}
              >
                Completed
              </button>
              <button
                onClick={() => setStatusFilter("archived")}
                className={`px-2 py-1 text-xs rounded transition-all ${
                  statusFilter === "archived" ? "bg-gray-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                Archived
              </button>

            </div>

            {/* Compact Date Range */}
            <div className="flex items-center space-x-2">
              <span className="text-xs text-gray-600">From:</span>
              <input 
                type="date" 
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-600">To:</span>
              <input 
                type="date" 
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {(searchQuery || statusFilter || dateFrom || dateTo) && (
                <button
                  onClick={clearFilters}
                  className="px-2 py-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded text-xs"
                  title="Clear filters"
                >
                  <i className="fas fa-times"></i>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Main Content Layout */}
        <div className={`${selectedRfp && !isWorkflowCollapsed ? 'grid grid-cols-1 lg:grid-cols-7 gap-6' : 'block'}`}>
          {/* RFP Table or Workflow Content - Full width when no RFP selected, 5/7 when selected, full width when workflow collapsed */}
          <div className={selectedRfp && !isWorkflowCollapsed ? "lg:col-span-5 min-w-0 main-content-area" : "w-full"}>
            {showBidCollection && selectedRfp ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    onClick={() => setShowBidCollection(false)}
                    className="mb-4"
                  >
                    ← Back to RFP List
                  </Button>
                </div>
                <BidCollectionTable 
                  rfp={selectedRfp} 
                  onComplete={() => {
                    // Auto-advance: Open Evaluation after Bid Collection completes
                    setShowBidCollection(false);
                    setShowEvaluation(true);
                  }}
                />
              </div>
            ) : showEvaluation && selectedRfp ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    onClick={() => setShowEvaluation(false)}
                    className="mb-4"
                  >
                    ← Back to RFP List
                  </Button>
                </div>
                <div className="space-y-6">
                  <BidLevelingView 
                    rfpId={selectedRfp.id}
                    onSelectPrimaryBidder={() => {
                      // Refresh evaluation data when primary bidder is selected
                    }}
                  />
                  <EvaluationBudget 
                    rfp={selectedRfp} 
                    isWorkflowCollapsed={isWorkflowCollapsed}
                    onComplete={() => {
                      // Auto-advance: Open Publish after Evaluation completes
                      setShowEvaluation(false);
                      setShowPublish(true);
                    }}
                  />
                </div>
              </div>
            ) : showPublish && selectedRfp ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    onClick={() => setShowPublish(false)}
                    className="mb-4"
                  >
                    ← Back to RFP List
                  </Button>
                </div>
                <PublishSummary rfp={selectedRfp} />
              </div>
            ) : selectedRfp && selectedRfp.workflowPhase === 'publish' && showBidCollection ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    onClick={() => setShowBidCollection(false)}
                    className="mb-4"
                  >
                    ← Back to RFP List
                  </Button>
                </div>
                <FinancialSummary rfp={selectedRfp} />
              </div>
            ) : (
              <RfpTable 
                searchQuery={searchQuery}
                statusFilter={statusFilter}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onEditRfp={handleEditRfp}
                onValidateRfp={handleValidateRfp}
                onSelectRfp={handleSelectRfp}
                onCreateAlternate={handleCreateAlternate}
                selectedRfpId={selectedRfp?.id}
                hideHeaders={false}
              />
            )}
          </div>

          {/* Workflow Status Sidebar - Only show when RFP is selected and not collapsed */}
          {selectedRfp && !isWorkflowCollapsed && (
            <div className="lg:col-span-2 min-w-0">
              <div className="sticky top-4">
                <WorkflowStatus 
                  rfp={selectedRfp}
                  onAdvanceToInvitation={handleAdvanceToInvitation}
                  onEditRfp={handleEditRfp}
                  onValidateRfp={handleValidateRfp}
                  onOpenInvitationModal={handleOpenInvitationModal}
                  onOpenBidCollection={handleOpenBidCollection}
                  onOpenEvaluation={handleOpenEvaluation}
                  onOpenPublish={handleOpenPublish}
                  onViewDetails={handleViewDetails}
                  isCollapsed={isWorkflowCollapsed}
                  onWorkflowToggle={(isCollapsed) => {
                    setIsWorkflowCollapsed(isCollapsed);
                  }}
                />
              </div>
            </div>
          )}
        </div>
        
        {/* Floating workflow button when collapsed - desktop only */}
        {selectedRfp && isWorkflowCollapsed && (
          <div className="fixed top-16 right-4 z-50 hidden lg:block">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsWorkflowCollapsed(false)}
              className="bg-white shadow-lg border-2 border-blue-300 hover:bg-blue-50"
              title="Show workflow panel"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Workflow
            </Button>
          </div>
        )}

        {/* Mobile workflow button - shows on small screens when RFP is selected */}
        {selectedRfp && (
          <div className="fixed bottom-4 right-4 z-50 lg:hidden">
            <Button
              variant="default"
              size="lg"
              onClick={() => setShowMobileWorkflow(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg rounded-full h-14 w-14 p-0"
              title="View workflow"
            >
              <LayoutGrid className="h-6 w-6" />
            </Button>
          </div>
        )}

        {/* Mobile workflow overlay */}
        {showMobileWorkflow && selectedRfp && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div 
              className="absolute inset-0 bg-black/50"
              onClick={() => setShowMobileWorkflow(false)}
            />
            <div className="absolute inset-x-0 bottom-0 bg-white rounded-t-xl max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-300">
              <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
                <h3 className="font-semibold text-lg">Workflow Status</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowMobileWorkflow(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <div className="p-4">
                <WorkflowStatus 
                  rfp={selectedRfp}
                  onAdvanceToInvitation={(rfp) => {
                    setShowMobileWorkflow(false);
                    handleAdvanceToInvitation(rfp);
                  }}
                  onEditRfp={(rfp) => {
                    setShowMobileWorkflow(false);
                    handleEditRfp(rfp);
                  }}
                  onValidateRfp={(rfp) => {
                    setShowMobileWorkflow(false);
                    handleValidateRfp(rfp);
                  }}
                  onOpenInvitationModal={(rfp) => {
                    setShowMobileWorkflow(false);
                    handleOpenInvitationModal(rfp);
                  }}
                  onOpenBidCollection={(rfp) => {
                    setShowMobileWorkflow(false);
                    handleOpenBidCollection(rfp);
                  }}
                  onOpenEvaluation={(rfp) => {
                    setShowMobileWorkflow(false);
                    handleOpenEvaluation(rfp);
                  }}
                  onOpenPublish={(rfp) => {
                    setShowMobileWorkflow(false);
                    handleOpenPublish(rfp);
                  }}
                  onViewDetails={(rfp) => {
                    setShowMobileWorkflow(false);
                    handleViewDetails(rfp);
                  }}
                  isCollapsed={false}
                  onWorkflowToggle={() => {}}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateRfpModal 
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />

      <EditRfpModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        rfp={selectedRfp}
      />

      <ContactManagementModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
      />

      <PropertyManagementModal
        isOpen={isPropertyModalOpen}
        onClose={() => setIsPropertyModalOpen(false)}
      />

      <InvitationToBidModal
        isOpen={isInvitationModalOpen}
        onClose={() => setIsInvitationModalOpen(false)}
        rfp={workflowRfp}
        onComplete={() => {
          // Auto-advance: Open Bid Collection after ITB completes
          if (workflowRfp) {
            setSelectedRfp(workflowRfp);
            setShowBidCollection(true);
          }
          setWorkflowRfp(null);
        }}
      />

      <RfpValidationModal
        isOpen={isValidationModalOpen}
        onClose={() => setIsValidationModalOpen(false)}
        rfp={validationRfp}
        onValidationComplete={() => {
          setIsValidationModalOpen(false);
          // Auto-advance: Open Invitation to Bid modal after validation completes
          if (validationRfp) {
            setWorkflowRfp(validationRfp);
            setIsInvitationModalOpen(true);
          }
          setValidationRfp(null);
        }}
      />

      <RfpDetailModal
        isOpen={isRfpDetailModalOpen}
        onClose={() => {
          setIsRfpDetailModalOpen(false);
          setDetailRfp(null);
        }}
        rfp={detailRfp}
        onRfpUpdated={(updatedRfp) => {
          setDetailRfp(updatedRfp);
        }}
      />

      {/* Bid Collection View */}
      {showBidCollection && selectedRfp && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  Bid Collection - {selectedRfp.projectName}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  RFP #{selectedRfp.rfpNumber} • Phase: {selectedRfp.workflowPhase.replace('-', ' ').toUpperCase()}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setShowBidCollection(false)}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
              <BidCollectionTable 
                rfp={selectedRfp}
                onComplete={() => {
                  // Auto-advance: Open Evaluation after Bid Collection completes
                  setShowBidCollection(false);
                  setShowEvaluation(true);
                }}
              />
            </div>
          </div>
        </div>
      )}
          </div>
        </div>
      </div>
  );
}
