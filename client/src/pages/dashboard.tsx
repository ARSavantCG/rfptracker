import { useState } from "react";
import { StatsCards } from "@/components/stats-cards";
import { RfpTable } from "@/components/rfp-table";
import { CreateRfpModal } from "@/components/create-rfp-modal";
import { RfpDetailModal } from "@/components/rfp-detail-modal";
import type { RfpRequest } from "@shared/schema";

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedRfp, setSelectedRfp] = useState<RfpRequest | null>(null);

  const handleViewRfp = (rfp: RfpRequest) => {
    setSelectedRfp(rfp);
    setIsDetailModalOpen(true);
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
              <button 
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex items-center px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors"
              >
                <i className="fas fa-plus mr-1 text-xs"></i>
                New RFP
              </button>
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
        <StatsCards />

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

        {/* RFP Table */}
        <RfpTable 
          searchQuery={searchQuery}
          statusFilter={statusFilter}
          onViewRfp={handleViewRfp}
        />
      </div>

      {/* Modals */}
      <CreateRfpModal 
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />

      <RfpDetailModal 
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        rfp={selectedRfp}
      />
    </div>
  );
}
