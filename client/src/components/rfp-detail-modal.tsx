import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
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

  // Get comprehensive file count from all workflow stages
  const { data: fileCountData } = useQuery({
    queryKey: [`/api/rfp-requests/${rfp?.id}/file-count`],
    enabled: !!rfp?.id,
  });

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
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-3">Request Information</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-start">
                      <span className="text-gray-500">Last Updated:</span>
                      <span className="ml-2 text-gray-900">{formatDate(rfp.updatedAt)}</span>
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
                        <span className="ml-2 text-gray-900">{formatDate(rfp.dueDate)}</span>
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
                      <div>Total: {fileCountData.totalFiles} files</div>
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
                      onClick={() => handleDownloadAllFiles(rfp.id, rfp.rfpNumber)}
                      className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 flex items-center gap-2"
                      title="Download all files from all workflow steps"
                    >
                      <i className="fas fa-download"></i>
                      Download All Files
                    </button>
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
