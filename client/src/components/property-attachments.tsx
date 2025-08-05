/*
 * Copyright © 2025 Savant Consulting Group LLC. All rights reserved.
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, FileText, Download, Upload, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface PropertyAttachment {
  id: number;
  propertyId: number;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  fileType: string;
  description?: string;
  uploadedAt: string;
}

interface PropertyAttachmentsProps {
  propertyId: number;
  propertyName: string;
}

export function PropertyAttachments({ propertyId, propertyName }: PropertyAttachmentsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: attachments = [], isLoading } = useQuery<PropertyAttachment[]>({
    queryKey: [`/api/properties/${propertyId}/attachments`],
    enabled: !!propertyId
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: { files: FileList; description: string }) => {
      const formData = new FormData();
      Array.from(data.files).forEach(file => {
        formData.append('files', file);
      });
      if (data.description) {
        formData.append('description', data.description);
      }

      const response = await fetch(`/api/properties/${propertyId}/attachments`, {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }
      
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Files uploaded successfully",
        description: `${selectedFiles?.length} file(s) uploaded to ${propertyName}`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/attachments`] });
      setSelectedFiles(null);
      setDescription("");
      setIsOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload files",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (attachmentId: number) => {
      return await apiRequest(`/api/properties/${propertyId}/attachments/${attachmentId}`, 'DELETE');
    },
    onSuccess: () => {
      toast({
        title: "File deleted",
        description: "Attachment removed successfully",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/attachments`] });
    },
    onError: (error: any) => {
      toast({
        title: "Delete failed",
        description: error.message || "Failed to delete attachment",
        variant: "destructive",
      });
    },
  });

  const handleUpload = async () => {
    if (!selectedFiles || selectedFiles.length === 0) {
      toast({
        title: "No files selected",
        description: "Please select files to upload",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    try {
      await uploadMutation.mutateAsync({ files: selectedFiles, description });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownload = async (attachment: PropertyAttachment) => {
    try {
      const token = localStorage.getItem('auth-token');
      if (!token) {
        toast({
          title: "Authentication required",
          description: "Please log in again to download files",
          variant: "destructive",
        });
        return;
      }

      const response = await fetch(`/api/properties/${propertyId}/attachments/${attachment.id}/download`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.status === 401) {
        toast({
          title: "Authentication expired",
          description: "Please log in again to download files",
          variant: "destructive",
        });
        return;
      }

      if (response.status === 404) {
        toast({
          title: "File not found",
          description: "The requested file could not be found",
          variant: "destructive",
        });
        return;
      }

      if (!response.ok) {
        const errorData = await response.text().catch(() => 'Unknown error');
        toast({
          title: "Download failed",
          description: `Error ${response.status}: ${errorData}`,
          variant: "destructive",
        });
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.originalName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Download started",
        description: `Downloading ${attachment.originalName}`,
      });
    } catch (error) {
      console.error('Download error:', error);
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Failed to download file",
        variant: "destructive",
      });
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileTypeIcon = (fileType: string) => {
    switch (fileType) {
      case 'pdf':
        return <FileText className="h-4 w-4 text-red-500" />;
      case 'dwg':
        return <FileText className="h-4 w-4 text-blue-500" />;
      default:
        return <FileText className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-9 px-3 flex items-center justify-center border border-input bg-background hover:bg-accent hover:text-accent-foreground">
          <Download className="h-4 w-4 mr-2" />
          ({attachments.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Property Attachments - {propertyName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Upload Section */}
          <div className="border rounded-lg p-4 bg-gray-50">
            <h3 className="font-medium mb-3">Upload New Files</h3>
            <div className="space-y-3">
              <div>
                <Label htmlFor="file-upload">Files (PDF, DWG supported)</Label>
                <Input
                  id="file-upload"
                  type="file"
                  multiple
                  accept=".pdf,.dwg,.PDF,.DWG"
                  onChange={(e) => setSelectedFiles(e.target.files)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of the files..."
                  className="mt-1"
                  rows={2}
                />
              </div>
              <Button 
                onClick={handleUpload} 
                disabled={!selectedFiles || isUploading || uploadMutation.isPending}
                className="w-full"
              >
                <Upload className="h-4 w-4 mr-2" />
                {isUploading ? "Uploading..." : `Upload ${selectedFiles?.length || 0} File(s)`}
              </Button>
            </div>
          </div>

          {/* Existing Attachments */}
          <div>
            <h3 className="font-medium mb-3">Existing Attachments ({attachments.length})</h3>
            
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">Loading attachments...</div>
            ) : attachments.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No attachments uploaded yet. Upload PDFs and DWG files above.
              </div>
            ) : (
              <div className="space-y-2">
                {attachments.map((attachment: PropertyAttachment) => (
                  <div
                    key={attachment.id}
                    className="flex items-center justify-between p-3 border rounded-lg bg-white"
                  >
                    <div className="flex items-center space-x-3 flex-1">
                      {getFileTypeIcon(attachment.fileType)}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {attachment.originalName}
                        </div>
                        <div className="text-xs text-gray-500">
                          {formatFileSize(attachment.size)} • {attachment.fileType.toUpperCase()} • 
                          {new Date(attachment.uploadedAt).toLocaleDateString()}
                        </div>
                        {attachment.description && (
                          <div className="text-xs text-gray-600 mt-1 truncate">
                            {attachment.description}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownload(attachment)}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deleteMutation.mutate(attachment.id)}
                        disabled={deleteMutation.isPending}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}