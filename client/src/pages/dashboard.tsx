import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Users, Building2, X } from "lucide-react";
import type { RfpRequest } from "@shared/schema";

export default function Dashboard() {
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

  // Auto-refresh selected RFP when data changes
  useEffect(() => {
    if (selectedRfp && allRfps.length > 0) {
      const updatedRfp = allRfps.find(rfp => rfp.id === selectedRfp.id);
      if (updatedRfp && JSON.stringify(updatedRfp) !== JSON.stringify(selectedRfp)) {
        setSelectedRfp(updatedRfp);
      }
    }
  }, [allRfps, selectedRfp]);

  // Auto-open bid collection/evaluation when RFP is selected based on workflow phase
  useEffect(() => {
    if (selectedRfp) {
      if (selectedRfp.workflowPhase === 'bid-collection' || selectedRfp.workflowPhase === 'evaluation') {
        setShowBidCollection(true);
      } else {
        setShowBidCollection(false);
      }
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

  const handleValidateRfp = (rfp: RfpRequest) => {
    setValidationRfp(rfp);
    setIsValidationModalOpen(true);
  };

  const handleOpenBidCollection = (rfp: RfpRequest) => {
    setSelectedRfp(rfp);
    setShowBidCollection(true);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Compact Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex justify-between items-center h-12">
            <div className="flex items-center space-x-2">
              <i className="fas fa-clipboard-list text-blue-600 text-sm"></i>
              <h1 className="text-lg font-semibold text-gray-900">RFP Tracker</h1>
            </div>
            <div className="flex items-center space-x-3">
              <Button
                onClick={() => setIsContactModalOpen(true)}
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
              >
                <Users className="h-3 w-3 mr-1" />
                Contacts
              </Button>
              <Button
                onClick={() => setIsPropertyModalOpen(true)}
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
              >
                <Building2 className="h-3 w-3 mr-1" />
                Properties
              </Button>
              <Button 
                onClick={() => setIsCreateModalOpen(true)}
                size="sm"
                className="h-8 px-3 text-xs"
              >
                <Plus className="h-3 w-3 mr-1" />
                New RFP
              </Button>
              <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center">
                <span className="text-white text-xs font-medium">AU</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Compact Page Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Request for Proposals</h2>
            <p className="text-xs text-gray-600">Track and manage RFP requests</p>
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* RFP Table or Bid Collection - Takes up 2/3 of the space */}
          <div className="lg:col-span-2">
            {showBidCollection && selectedRfp?.workflowPhase === 'bid-collection' ? (
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
            ) : selectedRfp?.workflowPhase === 'evaluation' ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    onClick={() => setSelectedRfp(null)}
                    className="mb-4"
                  >
                    ← Back to RFP List
                  </Button>
                </div>
                <EvaluationBudget rfp={selectedRfp} />
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

          {/* Workflow Status Sidebar - Takes up 1/3 of the space */}
          <div className="lg:col-span-1">
            {selectedRfp && (
              <WorkflowStatus 
                rfp={selectedRfp}
                onAdvanceToInvitation={handleAdvanceToInvitation}
                onValidateRfp={handleValidateRfp}
                onOpenInvitationModal={handleAdvanceToInvitation}
                onOpenBidCollection={handleOpenBidCollection}
              />
            )}
            {!selectedRfp && (
              <div className="bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 p-6 text-center">
                <div className="text-gray-400 mb-2">
                  <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-sm text-gray-600">Select an RFP to view workflow status</p>
              </div>
            )}
          </div>
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
  );
}
