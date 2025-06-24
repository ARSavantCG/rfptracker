import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StatsCards } from "@/components/stats-cards";
import { RfpTable } from "@/components/rfp-table";
import { CreateRfpModal } from "@/components/create-rfp-modal";
import { EditRfpModal } from "@/components/edit-rfp-modal";
import { ContactManagementModal } from "@/components/contact-management-modal";
import { PropertyManagementModal } from "@/components/property-management-modal";
import { WorkflowStatus } from "@/components/workflow-status";
import { InvitationToBidModal } from "@/components/invitation-to-bid-modal";
import { RfpValidationModal } from "@/components/rfp-validation-modal";
import { BidCollectionTable } from "@/components/bid-collection-table";
import { EvaluationBudget } from "@/components/evaluation-budget";
import { FinancialSummary } from "@/components/financial-summary";
import { QuickActionsSidebar } from "@/components/quick-actions-sidebar";
import Navigation from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Users, Building2, X, Settings, Crown } from "lucide-react";
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
  const [showBidCollection, setShowBidCollection] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [selectedRfp, setSelectedRfp] = useState<RfpRequest | null>(null);
  const [workflowRfp, setWorkflowRfp] = useState<RfpRequest | null>(null);
  const [validationRfp, setValidationRfp] = useState<RfpRequest | null>(null);

  // Fetch all RFPs to keep selected RFP data fresh
  const { data: allRfps = [] } = useQuery<RfpRequest[]>({
    queryKey: ["/api/rfp-requests"],
    queryFn: async () => {
      const response = await fetch("/api/rfp-requests");
      if (!response.ok) throw new Error("Failed to fetch RFP requests");
      return response.json();
    },
  });

  // Auth and admin setup
  const { data: currentUser } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const makeAdminMutation = useMutation({
    mutationFn: () => apiRequest("/api/dev/make-admin", "POST", { userId: currentUser?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Success",
        description: "You now have administrator privileges! The Admin Panel will appear in navigation.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to assign admin privileges",
        variant: "destructive",
      });
    },
  });

  // Auto-refresh selected RFP when data changes
  useEffect(() => {
    if (selectedRfp && allRfps.length > 0) {
      const updatedRfp = allRfps.find(rfp => rfp.id === selectedRfp.id);
      if (updatedRfp && JSON.stringify(updatedRfp) !== JSON.stringify(selectedRfp)) {
        setSelectedRfp(updatedRfp);
      }
    }
  }, [allRfps, selectedRfp]);

  // Reset workflow views when selecting a new RFP
  useEffect(() => {
    if (selectedRfp) {
      setShowBidCollection(false);
      setShowEvaluation(false);
    }
  }, [selectedRfp]);

  const handleEditRfp = (rfp: RfpRequest) => {
    setSelectedRfp(rfp);
    setIsEditModalOpen(true);
  };

  const handleAdvanceToInvitation = (rfp: RfpRequest) => {
    setWorkflowRfp(rfp);
    setIsInvitationModalOpen(true);
  };

  const handleOpenInvitationModal = (rfp: RfpRequest) => {
    setWorkflowRfp(rfp);
    setIsInvitationModalOpen(true);
  };

  const handleValidateRfp = (rfp: RfpRequest) => {
    setValidationRfp(rfp);
    setIsValidationModalOpen(true);
  };

  const handleOpenBidCollection = (rfp: RfpRequest) => {
    setShowBidCollection(true);
  };

  const handleOpenEvaluation = (rfp: RfpRequest) => {
    setShowBidCollection(false);
    setShowEvaluation(true);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <div className="flex">
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
        <div className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto px-4 py-4">
            {/* Compact Page Header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Request for Proposals</h2>
                <p className="text-xs text-gray-600">Track and manage RFP requests</p>
              </div>
              <div className="flex space-x-2">
                {currentUser && !isAdmin() && (
                  <Button 
                    onClick={() => makeAdminMutation.mutate()}
                    disabled={makeAdminMutation.isPending}
                    className="bg-yellow-500 hover:bg-yellow-600 text-white"
                  >
                    <Crown className="h-4 w-4 mr-2" />
                    {makeAdminMutation.isPending ? "Setting up..." : "Become Admin"}
                  </Button>
                )}
                
                {currentUser && (
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                        <span className="text-white font-medium text-sm">
                          {currentUser.firstName?.[0] || currentUser.email?.[0]?.toUpperCase() || 'U'}
                        </span>
                      </div>
                      <div className="text-sm">
                        <div className="font-medium text-gray-900">
                          {currentUser.firstName || currentUser.email?.split('@')[0] || 'User'}
                        </div>
                        {isAdmin() && (
                          <div className="text-xs text-green-600 font-medium">Administrator</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

        {/* Stats Cards */}
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
                onClick={() => setStatusFilter("on-hold")}
                className={`px-2 py-1 text-xs rounded transition-all ${
                  statusFilter === "on-hold" ? "bg-red-600 text-white" : "bg-red-100 text-red-600 hover:bg-red-200"
                }`}
              >
                On Hold
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
        <div className={`grid gap-6 ${selectedRfp ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1'}`}>
          {/* RFP Table or Workflow Content - Full width when no RFP selected, 2/3 when selected */}
          <div className={selectedRfp ? "lg:col-span-2" : "col-span-1"}>
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
                <BidCollectionTable rfp={selectedRfp} />
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
                <EvaluationBudget rfp={selectedRfp} />
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
                onEditRfp={handleEditRfp}
                onSelectRfp={setSelectedRfp}
                selectedRfpId={selectedRfp?.id}
              />
            )}
          </div>

          {/* Workflow Status Sidebar - Only show when RFP is selected */}
          {selectedRfp && (
            <div className="lg:col-span-1">
              <WorkflowStatus 
                rfp={selectedRfp}
                onAdvanceToInvitation={handleAdvanceToInvitation}
                onEditRfp={handleEditRfp}
                onValidateRfp={handleValidateRfp}
                onOpenInvitationModal={handleOpenInvitationModal}
                onOpenBidCollection={handleOpenBidCollection}
                onOpenEvaluation={handleOpenEvaluation}
              />
            </div>
          )}
        </div>
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
      />

      <RfpValidationModal
        isOpen={isValidationModalOpen}
        onClose={() => setIsValidationModalOpen(false)}
        rfp={validationRfp}
        onValidationComplete={() => {
          setIsValidationModalOpen(false);
          // Automatically open invitation modal after validation
          if (validationRfp) {
            setWorkflowRfp(validationRfp);
            setIsInvitationModalOpen(true);
          }
          setValidationRfp(null);
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
              <BidCollectionTable rfp={selectedRfp} />
            </div>
          </div>
        </div>
      )}
          </div>
        </div>
      </div>
  );
}
