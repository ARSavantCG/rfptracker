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
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <i className="fas fa-clipboard-list text-blue-600 text-xl"></i>
                <h1 className="text-xl font-semibold text-gray-900">RFP Tracker</h1>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">Admin User</span>
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">AU</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Request for Proposals</h2>
            <p className="mt-1 text-sm text-gray-600">Track and manage incoming RFP requests from your leasing team</p>
          </div>
          <div className="mt-4 sm:mt-0">
            <button 
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
            >
              <i className="fas fa-plus mr-2"></i>
              New RFP Request
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <StatsCards />

        {/* Filters and Search */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex flex-col space-y-6">
            {/* Search Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
              <div className="flex-1 max-w-lg">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <i className="fas fa-search text-gray-400 text-sm"></i>
                  </div>
                  <input 
                    type="text" 
                    placeholder="Search by client, project, or RFP number..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="block w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <button className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                  <i className="fas fa-download mr-2"></i>
                  Export
                </button>
                <button className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                  <i className="fas fa-bell mr-2"></i>
                  Alerts
                </button>
              </div>
            </div>

            {/* Status Filter Pills */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-700">Filter by status:</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setStatusFilter("")}
                    className={`px-4 py-2 text-xs font-medium rounded-full transition-all ${
                      statusFilter === "" 
                        ? "bg-gray-900 text-white" 
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setStatusFilter("received")}
                    className={`px-4 py-2 text-xs font-medium rounded-full transition-all ${
                      statusFilter === "received" 
                        ? "bg-purple-600 text-white" 
                        : "bg-purple-100 text-purple-600 hover:bg-purple-200"
                    }`}
                  >
                    <div className="w-2 h-2 bg-current rounded-full inline-block mr-2"></div>
                    Received
                  </button>
                  <button
                    onClick={() => setStatusFilter("in-progress")}
                    className={`px-4 py-2 text-xs font-medium rounded-full transition-all ${
                      statusFilter === "in-progress" 
                        ? "bg-orange-600 text-white" 
                        : "bg-orange-100 text-orange-600 hover:bg-orange-200"
                    }`}
                  >
                    <div className="w-2 h-2 bg-current rounded-full inline-block mr-2"></div>
                    In Progress
                  </button>
                  <button
                    onClick={() => setStatusFilter("completed")}
                    className={`px-4 py-2 text-xs font-medium rounded-full transition-all ${
                      statusFilter === "completed" 
                        ? "bg-green-600 text-white" 
                        : "bg-green-100 text-green-600 hover:bg-green-200"
                    }`}
                  >
                    <div className="w-2 h-2 bg-current rounded-full inline-block mr-2"></div>
                    Completed
                  </button>
                  <button
                    onClick={() => setStatusFilter("on-hold")}
                    className={`px-4 py-2 text-xs font-medium rounded-full transition-all ${
                      statusFilter === "on-hold" 
                        ? "bg-red-600 text-white" 
                        : "bg-red-100 text-red-600 hover:bg-red-200"
                    }`}
                  >
                    <div className="w-2 h-2 bg-current rounded-full inline-block mr-2"></div>
                    On Hold
                  </button>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-700">Date range:</span>
                <input 
                  type="date" 
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-gray-400 text-sm">to</span>
                <input 
                  type="date" 
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {(searchQuery || statusFilter || dateFrom || dateTo) && (
                  <button
                    onClick={clearFilters}
                    className="px-3 py-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors text-sm"
                    title="Clear all filters"
                  >
                    <i className="fas fa-times"></i>
                  </button>
                )}
              </div>
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
