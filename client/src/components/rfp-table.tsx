import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getStatusColor, getStatusIcon } from "@/lib/utils";
import { formatDateForDisplay } from "@shared/date-utils";
import { useToast } from "@/hooks/use-toast";
import { handleAuthError } from "@/lib/authHelper";
import { useAuth } from "@/hooks/useAuth";

import type { RfpRequest, Property } from "@shared/schema";

interface RfpTableProps {
  searchQuery: string;
  statusFilter: string;
  dateFrom: string;
  dateTo: string;
  onEditRfp?: (rfp: RfpRequest) => void;
  onValidateRfp?: (rfp: RfpRequest) => void;
  onSelectRfp?: (rfp: RfpRequest) => void;
  onCreateAlternate?: (parentRfp: RfpRequest) => void;
  selectedRfpId?: number | null;
  hideHeaders?: boolean;
}

type SortField = "id" | "rfpNumber" | "tenantName" | "property" | "status" | "receivedOn" | "internalDueDate";
type SortDirection = "asc" | "desc";

export function RfpTable({ searchQuery, statusFilter, dateFrom, dateTo, onEditRfp, onValidateRfp, onSelectRfp, onCreateAlternate, selectedRfpId, hideHeaders }: RfpTableProps) {
  const [sortField, setSortField] = useState<SortField>("id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [expandedRfps, setExpandedRfps] = useState<Set<number>>(new Set());
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Check if user has delete permissions
  const canDeleteRfp = user?.permissions?.includes('rfp.delete') || false;

  // Archive mutation
  const archiveMutation = useMutation({
    mutationFn: async (rfpId: number) => {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/rfp-requests/${rfpId}/archive`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to archive RFP');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Success",
        description: "RFP has been archived successfully",
        duration: 4000,
      });
    },
    onError: (error: Error) => {
      if (error.message.includes('401')) {
        handleAuthError(error);
        return;
      }
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  // Reopen mutation
  const reopenMutation = useMutation({
    mutationFn: async (rfpId: number) => {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/rfp-requests/${rfpId}/reopen`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to reopen RFP');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Success",
        description: "RFP has been reopened and moved back to in-progress",
        duration: 4000,
      });
    },
    onError: (error: Error) => {
      if (error.message.includes('401')) {
        handleAuthError(error);
        return;
      }
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  // Counter offer mutation
  const counterOfferMutation = useMutation({
    mutationFn: async (rfpId: number) => {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/rfp-requests/${rfpId}/counter-offer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create counter offer');
      }

      return response.json();
    },
    onSuccess: (counterOffer) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Success",
        description: `Counter offer ${counterOffer.rfpNumber} created successfully`,
        duration: 4000,
      });
    },
    onError: (error: Error) => {
      if (error.message.includes('401')) {
        handleAuthError(error);
        return;
      }
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  // RFP Alternate modal state


  const { data: rfpRequests = [], isLoading } = useQuery<RfpRequest[]>({
    queryKey: ["/api/rfp-requests", { search: searchQuery, status: statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      if (statusFilter) params.append("status", statusFilter);
      
      const response = await fetch(`/api/rfp-requests?${params}`);
      if (!response.ok) throw new Error("Failed to fetch RFP requests");
      return response.json();
    },
  });

  // Fetch properties to display property names instead of IDs
  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  // Fetch file counts for all RFPs
  const { data: fileCounts = {} } = useQuery({
    queryKey: ["/api/rfp-file-counts"],
    queryFn: async () => {
      if (rfpRequests.length === 0) return {};
      
      const counts: Record<number, number> = {};
      await Promise.all(
        rfpRequests.map(async (rfp) => {
          try {
            const response = await fetch(`/api/rfp-requests/${rfp.id}/file-count`, {
              credentials: 'include',
            });
            if (response.ok) {
              const data = await response.json();
              counts[rfp.id] = data.totalFiles;
            } else {
              counts[rfp.id] = rfp.files.length; // fallback
            }
          } catch {
            counts[rfp.id] = rfp.files.length; // fallback
          }
        })
      );
      return counts;
    },
    enabled: rfpRequests.length > 0,
  });

  // Helper function to get property name with building
  const getPropertyDisplayName = (propertyId: string) => {
    const property = properties.find(p => p.id.toString() === propertyId);
    if (!property) return propertyId;
    
    // Format property name with building using "Bldg." prefix for multi-building properties
    if (property.building && property.building.trim() !== '') {
      return `${property.propertyName} - Bldg. ${property.building}`;
    } else {
      return property.propertyName;
    }
  };

  // Organize RFPs hierarchically (parent RFPs with their counter offers and options)
  const organizedRfps = () => {
    const parentRfps = rfpRequests.filter(rfp => !rfp.isCounterOffer && !rfp.isOption);
    const counterOffers = rfpRequests.filter(rfp => rfp.isCounterOffer);
    const options = rfpRequests.filter(rfp => rfp.isOption);
    
    return parentRfps.map(parent => ({
      ...parent,
      counterOffers: counterOffers.filter(co => co.parentRfpId === parent.id),
      options: options.filter(opt => opt.parentRfpId === parent.id)
    }));
  };

  // Toggle expansion for RFP with counter offers
  const toggleExpansion = (rfpId: number) => {
    const newExpanded = new Set(expandedRfps);
    if (newExpanded.has(rfpId)) {
      newExpanded.delete(rfpId);
    } else {
      newExpanded.add(rfpId);
    }
    setExpandedRfps(newExpanded);
  };

  // Clear selected RFP if it no longer exists in the list
  useEffect(() => {
    if (onSelectRfp && selectedRfpId && rfpRequests.length > 0) {
      const selectedExists = rfpRequests.some(rfp => rfp.id === selectedRfpId);
      if (!selectedExists) {
        onSelectRfp(null);
      }
    } else if (onSelectRfp && rfpRequests.length === 0) {
      // Clear selection if no RFPs exist
      onSelectRfp(null);
    }
  }, [rfpRequests, selectedRfpId, onSelectRfp]);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      console.log(`Frontend: Attempting to delete RFP ${id}`);
      try {
        const result = await apiRequest(`/api/rfp-requests/${id}`, "DELETE");
        console.log(`Frontend: Delete result:`, result);
        return result;
      } catch (error) {
        console.error(`Frontend: Delete error:`, error);
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log(`Frontend: Delete successful:`, data);
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Success",
        description: "RFP deleted successfully",
        duration: 4000,
      });
    },
    onError: (error) => {
      console.error(`Frontend: Delete mutation error:`, error);
      toast({
        title: "Error", 
        description: "Failed to delete RFP",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleDelete = async (rfp: RfpRequest) => {
    console.log(`=== DIRECT DELETE TEST START ===`);
    console.log(`Attempting to delete RFP ${rfp.id} - ${rfp.projectName}`);
    
    if (!rfp?.id) {
      console.log(`No RFP ID provided`);
      alert("RFP ID is missing");
      return;
    }
    
    if (!confirm(`Are you sure you want to delete RFP ${rfp.rfpNumber || rfp.id}?`)) {
      console.log(`Delete cancelled by user`);
      return;
    }
    
    try {
      console.log(`Making direct fetch request to DELETE /api/rfp-requests/${rfp.id}`);
      
      // Get auth token from localStorage
      const token = localStorage.getItem('auth-token');
      if (!token) {
        console.error('No auth token found');
        alert('Authentication required. Please log in again.');
        return;
      }
      
      const response = await fetch(`/api/rfp-requests/${rfp.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      
      console.log(`Response status: ${response.status}`);
      console.log(`Response ok: ${response.ok}`);
      
      const responseData = await response.json();
      console.log(`Response data:`, responseData);
      
      if (response.ok) {
        console.log(`=== DIRECT DELETE SUCCESS ===`);
        alert("RFP deleted successfully!");
        window.location.reload(); // Simple page reload to see changes
      } else {
        console.error(`=== DIRECT DELETE FAILED ===`);
        if (response.status === 401) {
          alert('Authentication required. Please log in again.');
          window.location.href = '/';
        } else if (response.status === 403) {
          alert('You do not have permission to delete RFPs.');
        } else {
          alert(`Delete failed: ${responseData.message || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error(`=== DIRECT DELETE ERROR ===`, error);
      alert(`Delete error: ${error}`);
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return "fas fa-sort";
    return sortDirection === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
  };

  // Sort the organized hierarchical data
  const sortedOrganizedRequests = organizedRfps().sort((a, b) => {
    let aValue: any = a[sortField];
    let bValue: any = b[sortField];

    // Handle date sorting
    if (sortField === "receivedOn" || sortField === "internalDueDate") {
      aValue = aValue ? new Date(aValue).getTime() : 0;
      bValue = bValue ? new Date(bValue).getTime() : 0;
    }

    // Handle string sorting
    if (typeof aValue === "string") {
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
    }

    if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
    if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="animate-pulse">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="h-6 bg-gray-200 rounded w-32"></div>
          </div>
          <div className="divide-y divide-gray-200">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-6 py-4">
                <div className="flex space-x-4">
                  <div className="h-4 bg-gray-200 rounded w-24"></div>
                  <div className="h-4 bg-gray-200 rounded w-32"></div>
                  <div className="h-4 bg-gray-200 rounded w-28"></div>
                  <div className="h-4 bg-gray-200 rounded w-20"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">RFP Requests</h2>
      </div>
      <div className="overflow-x-auto max-w-full">
        <table className="rfp-table w-full divide-y divide-gray-200" style={{ minWidth: '800px' }}>
          <thead className="bg-gray-50">
            <tr>
              <th 
                className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                onClick={() => handleSort("rfpNumber")}
                style={{ width: '120px' }}
              >
                RFP ID <i className={`${getSortIcon("rfpNumber")} ml-1`}></i>
              </th>
              <th 
                className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                onClick={() => handleSort("tenantName")}
                style={{ width: '140px' }}
              >
                Tenant <i className={`${getSortIcon("tenantName")} ml-1`}></i>
              </th>
              <th 
                className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                onClick={() => handleSort("property")}
                style={{ width: '160px' }}
              >
                Property <i className={`${getSortIcon("property")} ml-1`}></i>
              </th>
              <th 
                className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                onClick={() => handleSort("status")}
                style={{ width: '120px' }}
              >
                Status <i className={`${getSortIcon("status")} ml-1`}></i>
              </th>
              <th 
                className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                onClick={() => handleSort("receivedOn")}
                style={{ width: '110px' }}
              >
                Received On <i className={`${getSortIcon("receivedOn")} ml-1`}></i>
              </th>
              <th 
                className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                onClick={() => handleSort("internalDueDate")}
                style={{ width: '120px' }}
              >
                Internal Due Date <i className={`${getSortIcon("internalDueDate")} ml-1`}></i>
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '70px' }}>
                Files
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '80px' }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedOrganizedRequests.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  <i className="fas fa-inbox text-xl mb-2"></i>
                  <p className="text-sm font-medium">No RFP requests found</p>
                  <p className="text-xs">Create your first RFP request to get started</p>
                </td>
              </tr>
            ) : (
              sortedOrganizedRequests.map((parentRfp) => [
                // Render parent RFP
                <tr 
                  key={parentRfp.id} 
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                  style={{
                    height: '48px',
                    minHeight: '48px',
                    maxHeight: '48px',
                    backgroundColor: selectedRfpId === parentRfp.id ? '#eff6ff' : 'transparent',
                    borderLeft: selectedRfpId === parentRfp.id ? '4px solid #3b82f6' : '4px solid transparent'
                  }}
                  onClick={() => onSelectRfp && onSelectRfp(parentRfp)}
                >
                  <td 
                    className="px-3 py-3 whitespace-nowrap text-xs font-medium text-gray-900"
                  >
                    <div className="flex items-center">
                      {(parentRfp.counterOffers.length > 0 || parentRfp.options.length > 0) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpansion(parentRfp.id);
                          }}
                          className="mr-2 text-gray-400 hover:text-gray-600"
                        >
                          <i className={`fas ${expandedRfps.has(parentRfp.id) ? 'fa-chevron-down' : 'fa-chevron-right'} text-xs`}></i>
                        </button>
                      )}
                      {parentRfp.rfpNumber}
                      {parentRfp.counterOffers.length > 0 && (
                        <span className={`ml-2 px-1.5 py-0.5 text-xs rounded ${
                          // Determine badge color based on counter offer statuses, not parent status
                          (() => {
                            const counterStatuses = parentRfp.counterOffers.map(co => co.status);
                            // If any counter offer is in-progress, show orange
                            if (counterStatuses.some(status => status === "in-progress")) {
                              return "bg-orange-100 text-orange-700";
                            }
                            // If any counter offer is received, show purple  
                            if (counterStatuses.some(status => status === "received")) {
                              return "bg-purple-100 text-purple-700";
                            }
                            // If all counter offers are completed, show green
                            if (counterStatuses.every(status => status === "completed")) {
                              return "bg-green-100 text-green-700";
                            }
                            // If any are archived, show gray
                            if (counterStatuses.some(status => status === "archived")) {
                              return "bg-gray-100 text-gray-700";
                            }
                            // Default fallback
                            return "bg-red-100 text-red-700";
                          })()
                        }`}>
                          {parentRfp.counterOffers.length} counter{parentRfp.counterOffers.length > 1 ? 's' : ''}
                        </span>
                      )}
                      {parentRfp.options.length > 0 && (
                        <span className={`ml-2 px-1.5 py-0.5 text-xs rounded ${
                          // Determine badge color based on alternate statuses, not parent status
                          (() => {
                            const alternateStatuses = parentRfp.options.map(opt => opt.status);
                            // If any alternate is in-progress, show orange
                            if (alternateStatuses.some(status => status === "in-progress")) {
                              return "bg-orange-100 text-orange-700";
                            }
                            // If any alternate is received, show purple  
                            if (alternateStatuses.some(status => status === "received")) {
                              return "bg-purple-100 text-purple-700";
                            }
                            // If all alternates are completed, show green
                            if (alternateStatuses.every(status => status === "completed")) {
                              return "bg-green-100 text-green-700";
                            }
                            // If any are archived, show gray
                            if (alternateStatuses.some(status => status === "archived")) {
                              return "bg-gray-100 text-gray-700";
                            }
                            // Default fallback
                            return "bg-red-100 text-red-700";
                          })()
                        }`}>
                          {parentRfp.options.length} alternate{parentRfp.options.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </td>
                  <td 
                    className="px-3 py-3 whitespace-nowrap text-xs text-gray-900"
                  >
                    {parentRfp.tenantName}
                  </td>
                  <td 
                    className="px-3 py-3 whitespace-nowrap text-xs text-gray-900"
                  >
                    {getPropertyDisplayName(parentRfp.property)}
                  </td>
                  <td 
                    className="px-3 py-3 whitespace-nowrap"
                  >
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                        parentRfp.status === "received" 
                          ? "bg-purple-100 text-purple-700" 
                          : parentRfp.status === "in-progress"
                          ? "bg-orange-100 text-orange-700"
                          : parentRfp.status === "completed"
                          ? "bg-green-100 text-green-700"
                          : parentRfp.status === "archived"
                          ? "bg-gray-100 text-gray-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      <div 
                        className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                          parentRfp.status === "received" 
                            ? "bg-purple-500" 
                            : parentRfp.status === "in-progress"
                            ? "bg-orange-500"
                            : parentRfp.status === "completed"
                            ? "bg-green-500"
                            : parentRfp.status === "archived"
                            ? "bg-gray-500"
                            : "bg-red-500"
                        }`}
                      ></div>
                      {parentRfp.status === "in-progress" ? "In Progress" : 
                       parentRfp.status === "on-hold" ? "On Hold" :
                       parentRfp.status === "archived" ? "Archived" :
                       parentRfp.status.charAt(0).toUpperCase() + parentRfp.status.slice(1)}
                    </span>
                  </td>
                  <td 
                    className="px-3 py-3 whitespace-nowrap text-xs text-gray-500"
                  >
                    {formatDateForDisplay(parentRfp.receivedOn)}
                  </td>
                  <td 
                    className="px-3 py-3 whitespace-nowrap text-xs text-gray-500"
                  >
                    {parentRfp.internalDueDate ? formatDateForDisplay(parentRfp.internalDueDate) : '—'}
                  </td>
                  <td 
                    className="px-3 py-3 whitespace-nowrap text-xs text-gray-500"
                  >
                    <div className="flex items-center space-x-1">
                      <i className="fas fa-paperclip text-gray-400 text-xs"></i>
                      <span>{fileCounts[parentRfp.id] || parentRfp.files.length}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs">
                    <div className="flex items-center space-x-1">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditRfp(parentRfp);
                        }}
                        className="text-green-600 hover:text-green-700 p-1"
                        title="Edit project"
                      >
                        <i className="fas fa-edit text-xs"></i>
                      </button>
                      
                      {/* Archive button - only for completed RFPs */}
                      {parentRfp.status === 'completed' && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            archiveMutation.mutate(parentRfp.id);
                          }}
                          disabled={archiveMutation.isPending}
                          className="text-gray-600 hover:text-gray-700 p-1"
                          title="Archive project"
                        >
                          <i className="fas fa-archive text-xs"></i>
                        </button>
                      )}
                      
                      {/* Reopen button - only for archived RFPs */}
                      {parentRfp.status === 'archived' && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            reopenMutation.mutate(parentRfp.id);
                          }}
                          disabled={reopenMutation.isPending}
                          className="text-blue-600 hover:text-blue-700 p-1"
                          title="Reopen project"
                        >
                          <i className="fas fa-undo text-xs"></i>
                        </button>
                      )}
                      
                      {/* Counter offer button - only for completed RFPs */}
                      {parentRfp.status === 'completed' && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            counterOfferMutation.mutate(parentRfp.id);
                          }}
                          disabled={counterOfferMutation.isPending}
                          className="text-blue-600 hover:text-blue-700 p-1"
                          title="Create counter offer"
                        >
                          <i className="fas fa-reply text-xs"></i>
                        </button>
                      )}
                      
                      {/* RFP Options button - available during any active phase */}
                      {parentRfp.status !== 'archived' && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            // Open workflow modal immediately for data entry - no database creation yet
                            onCreateAlternate?.(parentRfp);
                          }}
                          className="text-purple-600 hover:text-purple-700 p-1"
                          title="Create RFP alternate"
                        >
                          <i className="fas fa-code-branch text-xs"></i>
                        </button>
                      )}
                      
                      {/* Delete button - for users with delete permissions */}
                      {canDeleteRfp && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(parentRfp);
                          }}
                          className="text-red-600 hover:text-red-700 p-1"
                          title="Delete project"
                        >
                          <i className="fas fa-trash text-xs"></i>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>,
                
                // Render counter offers if expanded
                ...(expandedRfps.has(parentRfp.id) ? parentRfp.counterOffers.map((counterOffer) => (
                  <tr 
                    key={counterOffer.id} 
                    className="hover:bg-gray-100 transition-colors cursor-pointer"
                    style={{
                      height: '48px',
                      minHeight: '48px',
                      maxHeight: '48px',
                      backgroundColor: selectedRfpId === counterOffer.id ? '#eff6ff' : '#f9fafb',
                      borderLeft: selectedRfpId === counterOffer.id ? '4px solid #3b82f6' : '4px solid transparent'
                    }}
                    onClick={() => onSelectRfp && onSelectRfp(counterOffer)}
                  >
                    <td 
                      className="px-3 py-3 whitespace-nowrap text-xs font-medium text-gray-700"
                    >
                      <div className="flex items-center pl-6">
                        <i className="fas fa-reply mr-2 text-gray-400 text-xs"></i>
                        {counterOffer.rfpNumber}
                      </div>
                    </td>
                    <td 
                      className="px-3 py-3 whitespace-nowrap text-xs text-gray-700"
                    >
                      {counterOffer.tenantName}
                    </td>
                    <td 
                      className="px-3 py-3 whitespace-nowrap text-xs text-gray-700"
                    >
                      {getPropertyDisplayName(counterOffer.property)}
                    </td>
                    <td 
                      className="px-3 py-3 whitespace-nowrap"
                    >
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                          counterOffer.status === "received" 
                            ? "bg-purple-100 text-purple-700" 
                            : counterOffer.status === "in-progress"
                            ? "bg-orange-100 text-orange-700"
                            : counterOffer.status === "completed"
                            ? "bg-green-100 text-green-700"
                            : counterOffer.status === "archived"
                            ? "bg-gray-100 text-gray-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        <div 
                          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                            counterOffer.status === "received" 
                              ? "bg-purple-500" 
                              : counterOffer.status === "in-progress"
                              ? "bg-orange-500"
                              : counterOffer.status === "completed"
                              ? "bg-green-500"
                              : counterOffer.status === "archived"
                              ? "bg-gray-500"
                              : "bg-red-500"
                          }`}
                        ></div>
                        {counterOffer.status === "in-progress" ? "In Progress" : 
                         counterOffer.status === "on-hold" ? "On Hold" :
                         counterOffer.status === "archived" ? "Archived" :
                         counterOffer.status.charAt(0).toUpperCase() + counterOffer.status.slice(1)}
                      </span>
                    </td>
                    <td 
                      className="px-3 py-3 whitespace-nowrap text-xs text-gray-500"
                    >
                      {formatDateForDisplay(counterOffer.receivedOn)}
                    </td>
                    <td 
                      className="px-3 py-3 whitespace-nowrap text-xs text-gray-500"
                    >
                      {counterOffer.internalDueDate ? formatDateForDisplay(counterOffer.internalDueDate) : '—'}
                    </td>
                    <td 
                      className="px-3 py-3 whitespace-nowrap text-xs text-gray-500"
                    >
                      <div className="flex items-center space-x-1">
                        <i className="fas fa-paperclip text-gray-400 text-xs"></i>
                        <span>{fileCounts[counterOffer.id] || counterOffer.files.length}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs">
                      <div className="flex items-center space-x-1">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditRfp(counterOffer);
                          }}
                          className="text-green-600 hover:text-green-700 p-1"
                          title="Edit counter offer"
                        >
                          <i className="fas fa-edit text-xs"></i>
                        </button>
                        
                        {/* Delete button for counter offers */}
                        {canDeleteRfp && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(counterOffer);
                            }}
                            className="text-red-600 hover:text-red-700 p-1"
                            title="Delete counter offer"
                          >
                            <i className="fas fa-trash text-xs"></i>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )) : []),
                
                // Render options if expanded
                ...(expandedRfps.has(parentRfp.id) ? parentRfp.options.map((option) => (
                  <tr 
                    key={option.id} 
                    className="hover:bg-purple-100 transition-colors cursor-pointer"
                    style={{
                      height: '48px',
                      minHeight: '48px',
                      maxHeight: '48px',
                      backgroundColor: selectedRfpId === option.id ? '#eff6ff' : '#faf5ff',
                      borderLeft: selectedRfpId === option.id ? '4px solid #3b82f6' : '4px solid transparent'
                    }}
                    onClick={() => onSelectRfp && onSelectRfp(option)}
                  >
                    <td 
                      className="px-3 py-3 whitespace-nowrap text-xs font-medium text-gray-700"
                    >
                      <div className="flex items-center pl-6">
                        <i className="fas fa-code-branch mr-2 text-purple-400 text-xs"></i>
                        {option.rfpNumber}
                      </div>
                    </td>
                    <td 
                      className="px-3 py-3 whitespace-nowrap text-xs text-gray-700"
                    >
                      <div className="flex flex-col">
                        <span>{option.tenantName}</span>
                        <span className="text-purple-600 font-medium text-xs italic">
                          {(() => {
                            const match = option.projectName.match(/\(([^)]*)\)$/);
                            return match ? match[1] : 'Alternate';
                          })()}
                        </span>
                      </div>
                    </td>
                    <td 
                      className="px-3 py-3 whitespace-nowrap text-xs text-gray-700"
                    >
                      {getPropertyDisplayName(option.property)}
                    </td>
                    <td 
                      className="px-3 py-3 whitespace-nowrap"
                    >
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                          option.status === "received" 
                            ? "bg-purple-100 text-purple-700" 
                            : option.status === "in-progress"
                            ? "bg-orange-100 text-orange-700"
                            : option.status === "completed"
                            ? "bg-green-100 text-green-700"
                            : option.status === "archived"
                            ? "bg-gray-100 text-gray-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        <div 
                          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                            option.status === "received" 
                              ? "bg-purple-500" 
                              : option.status === "in-progress"
                              ? "bg-orange-500"
                              : option.status === "completed"
                              ? "bg-green-500"
                              : option.status === "archived"
                              ? "bg-gray-500"
                              : "bg-red-500"
                          }`}
                        ></div>
                        {option.status === "in-progress" ? "In Progress" : 
                         option.status === "on-hold" ? "On Hold" :
                         option.status === "archived" ? "Archived" :
                         option.status.charAt(0).toUpperCase() + option.status.slice(1)}
                      </span>
                    </td>
                    <td 
                      className="px-3 py-3 whitespace-nowrap text-xs text-gray-500"
                    >
                      {formatDateForDisplay(option.receivedOn)}
                    </td>
                    <td 
                      className="px-3 py-3 whitespace-nowrap text-xs text-gray-500"
                    >
                      {option.internalDueDate ? formatDateForDisplay(option.internalDueDate) : '—'}
                    </td>
                    <td 
                      className="px-3 py-3 whitespace-nowrap text-xs text-gray-500"
                    >
                      <div className="flex items-center space-x-1">
                        <i className="fas fa-paperclip text-gray-400 text-xs"></i>
                        <span>{fileCounts[option.id] || option.files.length}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs">
                      <div className="flex items-center space-x-1">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditRfp(option);
                          }}
                          className="text-green-600 hover:text-green-700 p-1"
                          title="Edit option"
                        >
                          <i className="fas fa-edit text-xs"></i>
                        </button>
                        
                        {/* Delete button for options */}
                        {canDeleteRfp && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(option);
                            }}
                            className="text-red-600 hover:text-red-700 p-1"
                            title="Delete option"
                          >
                            <i className="fas fa-trash text-xs"></i>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )) : [])
              ].flat())
            )}
          </tbody>
        </table>
      </div>
      
      {/* Pagination - Basic implementation */}
      {sortedOrganizedRequests.length > 0 && (
        <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
          <div className="flex-1 flex justify-between sm:hidden">
            <button className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
              Previous
            </button>
            <button className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
              Next
            </button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700">
                Showing <span className="font-medium">1</span> to <span className="font-medium">{sortedOrganizedRequests.length}</span> of{" "}
                <span className="font-medium">{sortedOrganizedRequests.length}</span> results
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                <button className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50">
                  <i className="fas fa-chevron-left"></i>
                </button>
                <button className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-blue-50 text-sm font-medium text-blue-600">
                  1
                </button>
                <button className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50">
                  <i className="fas fa-chevron-right"></i>
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}
      

    </div>
  );
}


