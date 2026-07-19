import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
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
import { RomWorkflowPanel } from "@/components/rom-workflow-panel";
import { BidLevelingView } from "@/components/bid-leveling-view";
import { FinancialSummary } from "@/components/financial-summary";
import { PublishSummary } from "@/components/publish-summary";
import { QuickActionsSidebar } from "@/components/quick-actions-sidebar";
import { LegalCompliancePanel } from "@/components/legal-compliance-panel";
import { TopOutstandingRfpsPanel } from "@/components/top-rfps-by-cost";
import Navigation from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, Users, Building2, X, Settings, Crown, ChevronDown, ChevronLeft, LayoutGrid, TrendingUp, TrendingDown, AlertCircle, Clock, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { apiRequest } from "@/lib/queryClient";
import type { RfpRequest } from "@shared/schema";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";

interface DashboardMetrics {
  attentionRequired: {
    overdueRfps: Array<{ id: number; rfpNumber: string; tenantName: string; daysOverdue: number }>;
    bidsAwaitingEvaluation: Array<{ bidCollectionId: number; rfpId: number; rfpNumber: string; contractorName: string; daysWaiting: number }>;
    upcomingDeadlines: Array<{ id: number; rfpNumber: string; tenantName: string; daysUntilDue: number }>;
  };
  pipeline: {
    totalActiveTiValue: number;
    activeRfpCount: number;
    byProperty: Array<{ propertyId: number | null; propertyName: string | null; activeRfpCount: number; totalTiValue: number }>;
    largestActiveDeal: { id: number; rfpNumber: string; tenantName: string; totalTiValue: number } | null;
  };
  portfolioIntelligence: {
    avgCostPerSfCurrentYear: number | null;
    avgCostPerSfPriorYear: number | null;
    yoyDeltaPct: number | null;
    velocity: { avgDaysReceivedToCompleted: number | null; sampleSize: number; note: string };
    mostActiveProperty: { propertyId: number | null; propertyName: string | null; activeRfpCount: number } | null;
  };
}

function formatTiValue(n: number): string {
  if (n === 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function renderYoyPill(pct: number | null) {
  if (pct === null) return <span className="text-xs text-gray-400">No prior year data</span>;
  if (pct === 0) return <span className="inline-flex items-center gap-1 text-xs text-gray-500 px-2 py-0.5 rounded-full bg-gray-100">Flat vs prior year</span>;
  if (pct > 0) return <span className="inline-flex items-center gap-1 text-xs text-red-600 font-medium px-2 py-0.5 rounded-full bg-red-50"><TrendingUp className="h-3 w-3" />+{pct}% vs prior year</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium px-2 py-0.5 rounded-full bg-green-50"><TrendingDown className="h-3 w-3" />{pct}% vs prior year</span>;
}

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

  // KPI / accordion state
  const [expandedKpiTile, setExpandedKpiTile] = useState<'overdue' | 'bids' | 'upcoming' | null>(null);
  const [portfolioIntelOpen, setPortfolioIntelOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);

  // Fetch all RFPs to keep selected RFP data fresh - include archived for selection tracking
  const { data: allRfps = [] } = useQuery<RfpRequest[]>({
    queryKey: ["/api/rfp-requests", "all-including-archived"],
    queryFn: async () => {
      const response = await fetch("/api/rfp-requests?include_archived=true", {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` }
      });
      if (!response.ok) throw new Error("Failed to fetch RFP requests");
      return response.json();
    },
  });

  // Auth and admin setup
  const { data: currentUser } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  // Dashboard metrics (shared queryKey — already cached by sub-components, no extra network request)
  const { data: metricsData, isLoading: metricsLoading } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
    staleTime: 60_000,
  });

  // Derived KPI values
  const overdueRfps    = metricsData?.attentionRequired?.overdueRfps ?? [];
  const bidsAwaiting   = metricsData?.attentionRequired?.bidsAwaitingEvaluation ?? [];
  const upcomingDeadlines = metricsData?.attentionRequired?.upcomingDeadlines ?? [];
  const activeRfpCount = metricsData?.pipeline?.activeRfpCount ?? 0;
  const totalActiveTiValue = metricsData?.pipeline?.totalActiveTiValue ?? 0;
  const byProperty     = metricsData?.pipeline?.byProperty ?? [];
  const byPropertyHasValues = byProperty.some(p => p.totalTiValue > 0);
  const avgCostPerSf   = metricsData?.portfolioIntelligence?.avgCostPerSfCurrentYear ?? null;
  const avgCostPerSfPriorYear = metricsData?.portfolioIntelligence?.avgCostPerSfPriorYear ?? null;
  const yoyDeltaPct    = metricsData?.portfolioIntelligence?.yoyDeltaPct ?? null;
  const velocity       = metricsData?.portfolioIntelligence?.velocity ?? { avgDaysReceivedToCompleted: null, sampleSize: 0, note: "" };

  const overdueCount  = overdueRfps.length;
  const bidsCount     = bidsAwaiting.length;
  const upcomingCount = upcomingDeadlines.length;

  function toggleKpiTile(tile: 'overdue' | 'bids' | 'upcoming') {
    setExpandedKpiTile(prev => prev === tile ? null : tile);
  }

  // Auto-refresh selected RFP when data changes
  useEffect(() => {
    if (selectedRfp && allRfps.length > 0) {
      if (selectedRfp.id === 0) return;
      const updatedRfp = allRfps.find(rfp => rfp.id === selectedRfp.id);
      if (updatedRfp) {
        if (JSON.stringify(updatedRfp) !== JSON.stringify(selectedRfp)) {
          setSelectedRfp(updatedRfp);
        }
      } else {
        setSelectedRfp(null);
      }
    } else if (selectedRfp && selectedRfp.id !== 0 && allRfps.length === 0) {
      setSelectedRfp(null);
    }
  }, [allRfps, selectedRfp]);

  // Reset workflow views when selecting a new RFP
  useEffect(() => {
    if (selectedRfp) {
      setShowBidCollection(false);
      setShowEvaluation(false);
      setShowPublish(false);
      setIsWorkflowCollapsed(false);
    }
  }, [selectedRfp]);

  const handleEditRfp = (rfp: RfpRequest) => {
    setSelectedRfp(rfp);
    setIsEditModalOpen(true);
  };

  const handleCreateAlternate = (parentRfp: RfpRequest) => {
    const alternateTemplate: RfpRequest = {
      ...parentRfp,
      id: 0,
      rfpNumber: `${parentRfp.rfpNumber}.A`,
      projectName: "",
      property: "Select property...",
      receivedOn: new Date(),
      internalDueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      selectedBayConfigurations: [],
      projectArea: null,
      files: [],
      isOption: true,
      parentRfpId: parentRfp.id,
      optionType: "alternate",
      notes: "RFP alternate - configure independently",
    };
    setSelectedRfp(alternateTemplate);
    setIsEditModalOpen(true);
  };

  const handleSelectRfp = (rfp: RfpRequest | null) => {
    if (!rfp) { setSelectedRfp(null); return; }
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
    setIsWorkflowCollapsed(true);
  };

  const handleOpenInvitationModal = (rfp: RfpRequest) => {
    setWorkflowRfp(rfp);
    setIsInvitationModalOpen(true);
    setIsWorkflowCollapsed(true);
  };

  const handleValidateRfp = (rfp: RfpRequest) => {
    setValidationRfp(rfp);
    setIsValidationModalOpen(true);
    setIsWorkflowCollapsed(true);
  };

  const handleOpenBidCollection = (rfp: RfpRequest) => {
    setShowBidCollection(true);
    setIsWorkflowCollapsed(true);
  };

  const handleOpenEvaluation = (rfp: RfpRequest) => {
    setShowBidCollection(false);
    setShowEvaluation(true);
    setShowPublish(false);
    setIsWorkflowCollapsed(true);
  };

  const handleOpenPublish = (rfp: RfpRequest) => {
    setShowBidCollection(false);
    setShowEvaluation(false);
    setShowPublish(true);
    setIsWorkflowCollapsed(true);
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
          <div className="mx-auto px-4 py-3 max-w-full">

            {/* 1. Page Header — compact */}
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Request for Proposals</h2>
                <p className="text-xs text-gray-600">Track and manage RFP requests</p>
              </div>
            </div>

            {/* 2. KPI Row */}
            {metricsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-3">
                  {/* Active RFPs — static tile */}
                  <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-4 py-3">
                    <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">Active RFPs</p>
                    <p className="text-2xl font-bold tabular-nums text-gray-900">{activeRfpCount}</p>
                  </div>

                  {/* Overdue — clickable, red accent when > 0 */}
                  <button
                    onClick={() => toggleKpiTile('overdue')}
                    className={`text-left bg-white rounded-lg border shadow-sm px-4 py-3 transition-colors ${
                      overdueCount > 0 ? 'border-red-200 hover:bg-red-50' : 'border-gray-200 hover:bg-gray-50'
                    } ${expandedKpiTile === 'overdue' ? 'ring-2 ring-red-300 bg-red-50' : ''}`}
                  >
                    <p className={`text-[10px] font-medium uppercase tracking-wide mb-1 ${overdueCount > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                      Overdue
                    </p>
                    <p className={`text-2xl font-bold tabular-nums ${overdueCount > 0 ? 'text-red-700' : 'text-gray-900'}`}>
                      {overdueCount}
                    </p>
                  </button>

                  {/* Bids Awaiting Evaluation — clickable, amber accent when > 0 */}
                  <button
                    onClick={() => toggleKpiTile('bids')}
                    className={`text-left bg-white rounded-lg border shadow-sm px-4 py-3 transition-colors ${
                      bidsCount > 0 ? 'border-amber-200 hover:bg-amber-50' : 'border-gray-200 hover:bg-gray-50'
                    } ${expandedKpiTile === 'bids' ? 'ring-2 ring-amber-300 bg-amber-50' : ''}`}
                  >
                    <p className={`text-[10px] font-medium uppercase tracking-wide mb-1 ${bidsCount > 0 ? 'text-amber-600' : 'text-gray-500'}`}>
                      Bids Awaiting
                    </p>
                    <p className={`text-2xl font-bold tabular-nums ${bidsCount > 0 ? 'text-amber-700' : 'text-gray-900'}`}>
                      {bidsCount}
                    </p>
                  </button>

                  {/* Upcoming Deadlines 7d — clickable, blue accent when > 0 */}
                  <button
                    onClick={() => toggleKpiTile('upcoming')}
                    className={`text-left bg-white rounded-lg border shadow-sm px-4 py-3 transition-colors ${
                      upcomingCount > 0 ? 'border-blue-200 hover:bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                    } ${expandedKpiTile === 'upcoming' ? 'ring-2 ring-blue-300 bg-blue-50' : ''}`}
                  >
                    <p className={`text-[10px] font-medium uppercase tracking-wide mb-1 ${upcomingCount > 0 ? 'text-blue-600' : 'text-gray-500'}`}>
                      Upcoming 7d
                    </p>
                    <p className={`text-2xl font-bold tabular-nums ${upcomingCount > 0 ? 'text-blue-700' : 'text-gray-900'}`}>
                      {upcomingCount}
                    </p>
                  </button>

                  {/* Total Active TI Value — static tile, gray accent when $0 */}
                  <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-4 py-3">
                    <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">Active TI Value</p>
                    <p className={`text-2xl font-bold tabular-nums ${totalActiveTiValue === 0 ? 'text-gray-400' : 'text-gray-900'}`}>
                      {formatTiValue(totalActiveTiValue)}
                    </p>
                  </div>
                </div>

                {/* Expandable KPI detail list */}
                {expandedKpiTile && (
                  <div className="bg-white border border-gray-200 rounded-lg mb-3 overflow-hidden">

                    {expandedKpiTile === 'overdue' && (
                      <>
                        <div className="px-4 py-2 bg-red-50 border-b border-red-100 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-red-500" />
                          <span className="text-sm font-medium text-red-800">Overdue RFPs</span>
                          <span className="ml-auto text-xs text-red-500">{overdueCount} total</span>
                        </div>
                        {overdueCount === 0 ? (
                          <p className="px-4 py-3 text-sm text-gray-500">No overdue RFPs — great shape!</p>
                        ) : (
                          <div className="divide-y divide-gray-100">
                            {overdueRfps.map(rfp => (
                              <div
                                key={rfp.id}
                                onClick={() => handleOpenRfpById(rfp.id)}
                                className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-900">{rfp.rfpNumber}</p>
                                  <p className="text-xs text-gray-500 truncate">{rfp.tenantName}</p>
                                </div>
                                <span className="text-xs text-red-600 whitespace-nowrap ml-4">{rfp.daysOverdue}d overdue</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {expandedKpiTile === 'bids' && (
                      <>
                        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
                          <Clock className="h-4 w-4 text-amber-500" />
                          <span className="text-sm font-medium text-amber-800">Bids Awaiting Evaluation</span>
                          <span className="ml-auto text-xs text-amber-500">{bidsCount} total</span>
                        </div>
                        {bidsCount === 0 ? (
                          <p className="px-4 py-3 text-sm text-gray-500">No bids awaiting evaluation</p>
                        ) : (
                          <div className="divide-y divide-gray-100">
                            {bidsAwaiting.map(bid => (
                              <div
                                key={bid.bidCollectionId}
                                onClick={() => handleOpenRfpById(bid.rfpId)}
                                className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-900">{bid.rfpNumber}</p>
                                  <p className="text-xs text-gray-500 truncate">{bid.contractorName}</p>
                                </div>
                                <span className="text-xs text-amber-600 whitespace-nowrap ml-4">{bid.daysWaiting}d waiting</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {expandedKpiTile === 'upcoming' && (
                      <>
                        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-blue-500" />
                          <span className="text-sm font-medium text-blue-800">Upcoming Deadlines (7 days)</span>
                          <span className="ml-auto text-xs text-blue-500">{upcomingCount} total</span>
                        </div>
                        {upcomingCount === 0 ? (
                          <p className="px-4 py-3 text-sm text-gray-500">No deadlines in the next 7 days</p>
                        ) : (
                          <div className="divide-y divide-gray-100">
                            {upcomingDeadlines.map(rfp => (
                              <div
                                key={rfp.id}
                                onClick={() => handleOpenRfpById(rfp.id)}
                                className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-900">{rfp.rfpNumber}</p>
                                  <p className="text-xs text-gray-500 truncate">{rfp.tenantName}</p>
                                </div>
                                <span className={`text-xs whitespace-nowrap ml-4 ${
                                  rfp.daysUntilDue <= 2 ? 'text-red-600' :
                                  rfp.daysUntilDue <= 5 ? 'text-amber-600' : 'text-blue-600'
                                }`}>in {rfp.daysUntilDue}d</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                  </div>
                )}
              </>
            )}

            {/* 3. Portfolio Intelligence accordion — collapsed by default */}
            <div className="bg-white border border-gray-200 rounded-lg mb-3">
              <button
                onClick={() => setPortfolioIntelOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
              >
                <span className="text-sm font-medium text-gray-900">
                  Portfolio Intelligence {portfolioIntelOpen ? '▾' : '▸'}
                </span>
              </button>
              {portfolioIntelOpen && (
                <div className="border-t border-gray-100 px-4 pt-4 pb-4">
                  {metricsLoading ? (
                    <Skeleton className="h-20 w-full" />
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* Avg TI Cost per SF */}
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Avg TI Cost per SF</p>
                        <p className="text-2xl font-bold tabular-nums leading-tight mb-2">
                          {avgCostPerSf != null ? `$${avgCostPerSf.toFixed(2)}/SF` : "—"}
                        </p>
                        <div className="mb-1">{renderYoyPill(yoyDeltaPct)}</div>
                        <p className="text-xs text-gray-500 mb-2">
                          {avgCostPerSfPriorYear != null
                            ? `Prior year: $${avgCostPerSfPriorYear.toFixed(2)}/SF`
                            : "Prior year: no data"}
                        </p>
                        <p className="text-xs text-gray-500">
                          Based on recorded project actuals ·{" "}
                          <Link href="/historical-import" className="text-blue-600 hover:underline underline-offset-2">
                            Add historical data →
                          </Link>
                        </p>
                      </div>

                      {/* Avg RFP Cycle Time */}
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Avg RFP Cycle Time</p>
                        <p className="text-2xl font-bold tabular-nums leading-tight mb-2">
                          {velocity.avgDaysReceivedToCompleted != null ? `${velocity.avgDaysReceivedToCompleted} days` : "—"}
                        </p>
                        {velocity.sampleSize === 0 ? (
                          <p className="text-sm text-gray-500 italic">Not enough recent data</p>
                        ) : (
                          <p className="text-sm text-gray-500">
                            {velocity.sampleSize} completed RFP{velocity.sampleSize !== 1 ? "s" : ""} in last 90 days
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-2">{velocity.note}</p>
                      </div>

                      {/* Top 3 RFPs by Cost */}
                      <div>
                        <TopOutstandingRfpsPanel
                          limit={3}
                          onRowClick={(id) => handleOpenRfpById(parseInt(id))}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Pipeline by Property accordion — only shown when at least one property has TI value > 0 */}
            {byPropertyHasValues && (
              <div className="bg-white border border-gray-200 rounded-lg mb-3">
                <button
                  onClick={() => setPipelineOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <span className="text-sm font-medium text-gray-900">
                    Pipeline by Property {pipelineOpen ? '▾' : '▸'}
                  </span>
                </button>
                {pipelineOpen && (
                  <div className="border-t border-gray-100 px-4 pt-4 pb-4 space-y-2">
                    {(() => {
                      const maxTi = Math.max(...byProperty.map(p => p.totalTiValue), 1);
                      return byProperty.slice(0, 8).map((prop, idx) => {
                        const barPct = (prop.totalTiValue / maxTi) * 100;
                        const label = prop.propertyName ?? "Unassigned";
                        return (
                          <div key={prop.propertyId ?? `u-${idx}`}>
                            <div className="flex items-center gap-2">
                              <span className="text-xs truncate shrink-0" style={{ maxWidth: "38%" }} title={label}>
                                {label}
                              </span>
                              <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
                                <div className="h-full bg-blue-400 rounded" style={{ width: `${Math.max(barPct, 0.5)}%` }} />
                              </div>
                              <span className="text-xs tabular-nums shrink-0 text-right" style={{ minWidth: "3.5rem" }}>
                                {formatTiValue(prop.totalTiValue)}
                              </span>
                            </div>
                            <p className="text-xs text-gray-400 ml-1 mt-0.5">
                              {prop.activeRfpCount} RFP{prop.activeRfpCount !== 1 ? "s" : ""}
                            </p>
                          </div>
                        );
                      });
                    })()}
                    {byProperty.length > 8 && (
                      <p className="text-xs text-gray-400 mt-1">+{byProperty.length - 8} more properties</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 4. Filter row — search + status pills + date pickers on one line */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search RFPs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-7 pr-3 py-1.5 border border-gray-300 rounded text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-44"
                />
              </div>

              {/* Status pills */}
              <button
                onClick={() => setStatusFilter("")}
                className={`px-2.5 py-1 text-xs rounded transition-all ${statusFilter === "" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >All</button>
              <button
                onClick={() => setStatusFilter("received")}
                className={`px-2.5 py-1 text-xs rounded transition-all ${statusFilter === "received" ? "bg-purple-600 text-white" : "bg-purple-50 text-purple-700 hover:bg-purple-100"}`}
              >Received</button>
              <button
                onClick={() => setStatusFilter("in-progress")}
                className={`px-2.5 py-1 text-xs rounded transition-all ${statusFilter === "in-progress" ? "bg-orange-600 text-white" : "bg-orange-50 text-orange-700 hover:bg-orange-100"}`}
              >In Progress</button>
              <button
                onClick={() => setStatusFilter("completed")}
                className={`px-2.5 py-1 text-xs rounded transition-all ${statusFilter === "completed" ? "bg-green-600 text-white" : "bg-green-50 text-green-700 hover:bg-green-100"}`}
              >Completed</button>
              <button
                onClick={() => setStatusFilter("archived")}
                className={`px-2.5 py-1 text-xs rounded transition-all ${statusFilter === "archived" ? "bg-gray-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >Archived</button>
              <button
                onClick={() => setStatusFilter("cancelled")}
                className={`px-2.5 py-1 text-xs rounded transition-all ${statusFilter === "cancelled" ? "bg-rose-600 text-white" : "bg-rose-50 text-rose-700 hover:bg-rose-100"}`}
              >Cancelled</button>

              {/* Date range — pushed to the right */}
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-xs text-gray-500">From:</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-500">To:</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {(searchQuery || statusFilter || dateFrom || dateTo) && (
                  <button
                    onClick={clearFilters}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                    title="Clear all filters"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* 5. Main Content Layout — RFP Table + optional workflow sidebar */}
            <div className={`${selectedRfp && !isWorkflowCollapsed ? 'grid grid-cols-1 lg:grid-cols-7 gap-6' : 'block'}`}>
              <div className={selectedRfp && !isWorkflowCollapsed ? "lg:col-span-5 min-w-0 main-content-area" : "w-full"}>
                {showBidCollection && selectedRfp ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Button variant="outline" onClick={() => setShowBidCollection(false)} className="mb-4">
                        ← Back to RFP List
                      </Button>
                    </div>
                    <BidCollectionTable
                      rfp={selectedRfp}
                      onComplete={() => {
                        setShowBidCollection(false);
                        setShowEvaluation(true);
                      }}
                    />
                  </div>
                ) : showEvaluation && selectedRfp ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Button variant="outline" onClick={() => setShowEvaluation(false)} className="mb-4">
                        ← Back to RFP List
                      </Button>
                    </div>
                    {(selectedRfp as any).pricingPath === "rom_pilot" ? (
                      /* Dual-entry: ROM-path RFPs get the ROM pricing form here,
                         in the same workflow shell, instead of the bid-based
                         evaluation (DESIGN-rom-pilot-convergence.md). */
                      <RomWorkflowPanel rfp={selectedRfp} />
                    ) : (
                    <div className="space-y-6">
                      <BidLevelingView
                        rfpId={selectedRfp.id}
                        onSelectPrimaryBidder={() => {}}
                      />
                      <EvaluationBudget
                        rfp={selectedRfp}
                        isWorkflowCollapsed={isWorkflowCollapsed}
                        onComplete={() => {
                          setShowEvaluation(false);
                          setShowPublish(true);
                        }}
                      />
                    </div>
                    )}
                  </div>
                ) : showPublish && selectedRfp ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Button variant="outline" onClick={() => setShowPublish(false)} className="mb-4">
                        ← Back to RFP List
                      </Button>
                    </div>
                    <PublishSummary rfp={selectedRfp} />
                  </div>
                ) : selectedRfp && selectedRfp.workflowPhase === 'publish' && showBidCollection ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Button variant="outline" onClick={() => setShowBidCollection(false)} className="mb-4">
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

              {/* Workflow Status Sidebar */}
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
                      onWorkflowToggle={(isCollapsed) => setIsWorkflowCollapsed(isCollapsed)}
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

            {/* Mobile workflow button */}
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
                <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileWorkflow(false)} />
                <div className="absolute inset-x-0 bottom-0 bg-white rounded-t-xl max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-300">
                  <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
                    <h3 className="font-semibold text-lg">Workflow Status</h3>
                    <Button variant="ghost" size="sm" onClick={() => setShowMobileWorkflow(false)}>
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                  <div className="p-4">
                    <WorkflowStatus
                      rfp={selectedRfp}
                      onAdvanceToInvitation={(rfp) => { setShowMobileWorkflow(false); handleAdvanceToInvitation(rfp); }}
                      onEditRfp={(rfp) => { setShowMobileWorkflow(false); handleEditRfp(rfp); }}
                      onValidateRfp={(rfp) => { setShowMobileWorkflow(false); handleValidateRfp(rfp); }}
                      onOpenInvitationModal={(rfp) => { setShowMobileWorkflow(false); handleOpenInvitationModal(rfp); }}
                      onOpenBidCollection={(rfp) => { setShowMobileWorkflow(false); handleOpenBidCollection(rfp); }}
                      onOpenEvaluation={(rfp) => { setShowMobileWorkflow(false); handleOpenEvaluation(rfp); }}
                      onOpenPublish={(rfp) => { setShowMobileWorkflow(false); handleOpenPublish(rfp); }}
                      onViewDetails={(rfp) => { setShowMobileWorkflow(false); handleViewDetails(rfp); }}
                      isCollapsed={false}
                      onWorkflowToggle={() => {}}
                    />
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Modals */}
      <CreateRfpModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />

      <EditRfpModal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} rfp={selectedRfp} />

      <ContactManagementModal isOpen={isContactModalOpen} onClose={() => setIsContactModalOpen(false)} />

      <PropertyManagementModal isOpen={isPropertyModalOpen} onClose={() => setIsPropertyModalOpen(false)} />

      <InvitationToBidModal
        isOpen={isInvitationModalOpen}
        onClose={() => setIsInvitationModalOpen(false)}
        rfp={workflowRfp}
        onComplete={() => {
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
          if (validationRfp) {
            setWorkflowRfp(validationRfp);
            setIsInvitationModalOpen(true);
          }
          setValidationRfp(null);
        }}
      />

      <RfpDetailModal
        isOpen={isRfpDetailModalOpen}
        onClose={() => { setIsRfpDetailModalOpen(false); setDetailRfp(null); }}
        rfp={detailRfp}
        onRfpUpdated={(updatedRfp) => setDetailRfp(updatedRfp)}
      />

      {/* Bid Collection View - modal overlay */}
      {showBidCollection && selectedRfp && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  Bid Collection - {selectedRfp.projectName}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  RFP #{selectedRfp.rfpNumber} · Phase: {selectedRfp.workflowPhase.replace('-', ' ').toUpperCase()}
                </p>
              </div>
              <Button variant="outline" onClick={() => setShowBidCollection(false)} className="h-8 w-8 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
              <BidCollectionTable
                rfp={selectedRfp}
                onComplete={() => {
                  setShowBidCollection(false);
                  setShowEvaluation(true);
                }}
              />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
