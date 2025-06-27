import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatDate, formatFileSize, getFileIcon, getStatusColor } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { InvitationWorkflowModal } from "./invitation-workflow-modal";
import type { RfpRequest } from "@shared/schema";

interface RfpDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfp: RfpRequest | null;
}

export function RfpDetailModal({ isOpen, onClose, rfp }: RfpDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editStatus, setEditStatus] = useState("");
  const [showInvitationModal, setShowInvitationModal] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      if (!rfp) return;
      const response = await apiRequest("PATCH", `/api/rfp-requests/${rfp.id}`, {
        status: newStatus,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Success",
        description: "RFP status updated successfully",
      });
      setIsEditing(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update status",
        variant: "destructive",
      });
    },
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (fileId: string) => {
      if (!rfp) return;
      const response = await apiRequest(`/api/rfp-requests/${rfp.id}/files/${fileId}`, "DELETE");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      toast({
        title: "Success",
        description: "File deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete file",
        variant: "destructive",
      });
    },
  });

  if (!isOpen || !rfp) return null;

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
      const token = localStorage.getItem('auth-token');
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
      link.download = `RFP-${rfpNumber}-All-Files.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Success",
        description: "All files downloaded successfully",
      });
    } catch (error) {
      console.error('Download all files error:', error);
      toast({
        title: "Download Failed",
        description: "Could not download all files. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleStatusUpdate = () => {
    if (editStatus && editStatus !== rfp.status) {
      updateStatusMutation.mutate(editStatus);
    } else {
      setIsEditing(false);
    }
  };

  const startEditingStatus = () => {
    setEditStatus(rfp.status);
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
                <h3 className="text-lg font-semibold text-gray-900">{rfp.rfpNumber} Details</h3>
                <p className="text-sm text-gray-600">{rfp.client} - {rfp.project}</p>
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
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-3">Request Information</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Client:</span>
                      <span className="ml-2 text-gray-900">{rfp.client}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Project:</span>
                      <span className="ml-2 text-gray-900">{rfp.project}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Status:</span>
                      {isEditing ? (
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value)}
                          className="ml-2 text-sm border border-gray-300 rounded px-2 py-1"
                        >
                          <option value="received">Received</option>
                          <option value="in-progress">In Progress</option>
                          <option value="completed">Completed</option>
                          <option value="on-hold">On Hold</option>
                        </select>
                      ) : (
                        <span className={`ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(rfp.status)}`}>
                          {rfp.status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-gray-500">Received:</span>
                      <span className="ml-2 text-gray-900">{formatDate(rfp.dateReceived)}</span>
                    </div>
                    {rfp.dueDate && (
                      <div>
                        <span className="text-gray-500">Due Date:</span>
                        <span className="ml-2 text-gray-900">{formatDate(rfp.dueDate)}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-500">Last Updated:</span>
                      <span className="ml-2 text-gray-900">{formatDate(rfp.updatedAt)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Request Type:</span>
                      <span className="ml-2 text-gray-900">
                        {rfp.requestTypes.map(type => 
                          type.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())
                        ).join(', ')}
                      </span>
                    </div>
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
              </div>
              
              {/* Files Section */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-gray-900">
                    Attached Files ({rfp.files.length})
                  </h4>
                  <button
                    onClick={() => handleDownloadAllFiles(rfp.id, rfp.rfpNumber)}
                    className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-1"
                    title="Download all files from all workflow steps"
                  >
                    <i className="fas fa-download"></i>
                    Download All Files
                  </button>
                </div>
                <div className="space-y-2">
                  {rfp.files.map((file) => (
                    <div key={file.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <i className={getFileIcon(file.type)}></i>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{file.name}</p>
                          <p className="text-xs text-gray-500">
                            {formatFileSize(file.size)} • {formatDate(file.uploadedAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button 
                          onClick={() => handleDownloadFile(file.id, file.name)}
                          className="text-blue-600 hover:text-blue-700"
                          title="Download"
                        >
                          <i className="fas fa-download"></i>
                        </button>
                        <button 
                          onClick={() => handleDeleteFile(file.id, file.name)}
                          className="text-red-600 hover:text-red-700"
                          title="Delete"
                          disabled={deleteFileMutation.isPending}
                        >
                          <i className="fas fa-trash"></i>
                        </button>
                      </div>
                    </div>
                  ))}
                  
                  {rfp.files.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <i className="fas fa-folder-open text-2xl mb-2"></i>
                      <p className="text-sm">No files attached</p>
                    </div>
                  )}
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
                      onClick={() => setShowInvitationModal(true)}
                      className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 flex items-center gap-2"
                    >
                      <i className="fas fa-envelope"></i>
                      Send Invitations
                    </button>
                    <button
                      onClick={startEditingStatus}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                    >
                      Update Status
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <InvitationWorkflowModal
        isOpen={showInvitationModal}
        onClose={() => setShowInvitationModal(false)}
        rfp={rfp}
      />
    </div>
  );
}
