import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatDate, getStatusColor, getStatusIcon } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { handleAuthError } from "@/lib/authHelper";
import { useAuth } from "@/hooks/useAuth";
import type { RfpRequest, Property } from "@shared/schema";

interface RfpTableProps {
  searchQuery: string;
  statusFilter: string;
  onEditRfp: (rfp: RfpRequest) => void;
  onSelectRfp?: (rfp: RfpRequest | null) => void;
  selectedRfpId?: number | null;
}

type SortField = "id" | "rfpNumber" | "tenantName" | "property" | "status" | "receivedOn" | "internalDueDate";
type SortDirection = "asc" | "desc";

export function RfpTable({ searchQuery, statusFilter, onEditRfp, onSelectRfp, selectedRfpId }: RfpTableProps) {
  const [sortField, setSortField] = useState<SortField>("id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
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
      });
    },
  });

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
      });
    },
    onError: (error) => {
      console.error(`Frontend: Delete mutation error:`, error);
      toast({
        title: "Error", 
        description: "Failed to delete RFP",
        variant: "destructive",
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

  // Sort the data
  const sortedRequests = [...rfpRequests].sort((a, b) => {
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
            {sortedRequests.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  <i className="fas fa-inbox text-xl mb-2"></i>
                  <p className="text-sm font-medium">No RFP requests found</p>
                  <p className="text-xs">Create your first RFP request to get started</p>
                </td>
              </tr>
            ) : (
              sortedRequests.map((request) => (
                <tr 
                  key={request.id} 
                  className={`hover:bg-gray-50 transition-colors ${
                    selectedRfpId === request.id ? 'bg-blue-50 border-l-4 border-blue-500' : 'border-l-4 border-transparent'
                  }`}
                  style={{
                    height: '48px',
                    minHeight: '48px',
                    maxHeight: '48px'
                  }}
                >
                  <td 
                    className="px-3 py-3 whitespace-nowrap text-xs font-medium text-gray-900 cursor-pointer"
                    onClick={() => onSelectRfp?.(request)}
                  >
                    {request.rfpNumber}
                  </td>
                  <td 
                    className="px-3 py-3 whitespace-nowrap text-xs text-gray-900 cursor-pointer"
                    onClick={() => onSelectRfp?.(request)}
                  >
                    {request.tenantName}
                  </td>
                  <td 
                    className="px-3 py-3 whitespace-nowrap text-xs text-gray-900 cursor-pointer"
                    onClick={() => onSelectRfp?.(request)}
                  >
                    {getPropertyDisplayName(request.property)}
                  </td>
                  <td 
                    className="px-3 py-3 whitespace-nowrap cursor-pointer"
                    onClick={() => onSelectRfp?.(request)}
                  >
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                        request.status === "received" 
                          ? "bg-purple-100 text-purple-700" 
                          : request.status === "in-progress"
                          ? "bg-orange-100 text-orange-700"
                          : request.status === "completed"
                          ? "bg-green-100 text-green-700"
                          : request.status === "archived"
                          ? "bg-gray-100 text-gray-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      <div 
                        className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                          request.status === "received" 
                            ? "bg-purple-500" 
                            : request.status === "in-progress"
                            ? "bg-orange-500"
                            : request.status === "completed"
                            ? "bg-green-500"
                            : request.status === "archived"
                            ? "bg-gray-500"
                            : "bg-red-500"
                        }`}
                      ></div>
                      {request.status === "in-progress" ? "In Progress" : 
                       request.status === "on-hold" ? "On Hold" :
                       request.status === "archived" ? "Archived" :
                       request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                    </span>
                  </td>
                  <td 
                    className="px-3 py-3 whitespace-nowrap text-xs text-gray-500 cursor-pointer"
                    onClick={() => onSelectRfp?.(request)}
                  >
                    {formatDate(request.receivedOn)}
                  </td>
                  <td 
                    className="px-3 py-3 whitespace-nowrap text-xs text-gray-500 cursor-pointer"
                    onClick={() => onSelectRfp?.(request)}
                  >
                    {request.internalDueDate ? formatDate(request.internalDueDate) : '—'}
                  </td>
                  <td 
                    className="px-3 py-3 whitespace-nowrap text-xs text-gray-500 cursor-pointer"
                    onClick={() => onSelectRfp?.(request)}
                  >
                    <div className="flex items-center space-x-1">
                      <i className="fas fa-paperclip text-gray-400 text-xs"></i>
                      <span>{fileCounts[request.id] || request.files.length}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs">
                    <div className="flex items-center space-x-1">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditRfp(request);
                        }}
                        className="text-green-600 hover:text-green-700 p-1"
                        title="Edit project"
                      >
                        <i className="fas fa-edit text-xs"></i>
                      </button>
                      
                      {/* Archive button - only for completed RFPs */}
                      {request.status === 'completed' && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            archiveMutation.mutate(request.id);
                          }}
                          disabled={archiveMutation.isPending}
                          className="text-gray-600 hover:text-gray-700 disabled:opacity-50 p-1"
                          title="Archive completed project"
                        >
                          <i className="fas fa-archive text-xs"></i>
                        </button>
                      )}
                      
                      {/* Reopen button - for both completed and archived RFPs */}
                      {(request.status === 'completed' || request.status === 'archived') && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            reopenMutation.mutate(request.id);
                          }}
                          disabled={reopenMutation.isPending}
                          className="text-blue-600 hover:text-blue-700 disabled:opacity-50 p-1"
                          title="Reopen for counter offer"
                        >
                          <i className="fas fa-undo text-xs"></i>
                        </button>
                      )}
                      
                      {canDeleteRfp && (
                        <button 
                          onClick={(e) => {
                            console.log("DELETE BUTTON CLICKED!");
                            console.log("RFP ID:", request.id);
                            console.log("RFP Name:", request.projectName);
                            e.stopPropagation();
                            handleDelete(request);
                          }}
                          disabled={deleteMutation.isPending}
                          className="text-red-600 hover:text-red-700 disabled:opacity-50 p-1"
                          title="Delete"
                        >
                          <i className="fas fa-trash text-xs"></i>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      
      {/* Pagination - Basic implementation */}
      {sortedRequests.length > 0 && (
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
                Showing <span className="font-medium">1</span> to <span className="font-medium">{sortedRequests.length}</span> of{" "}
                <span className="font-medium">{sortedRequests.length}</span> results
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
