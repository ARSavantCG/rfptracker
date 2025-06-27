import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Upload, X, FileDown, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface EvaluationAttachmentsProps {
  rfpId?: number;
}

export function EvaluationAttachments({ rfpId }: EvaluationAttachmentsProps) {
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: attachments = [] } = useQuery({
    queryKey: [`/api/evaluation-budget-attachments/${rfpId}`],
    enabled: !!rfpId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      if (!rfpId) throw new Error("RFP ID is required");
      
      const formData = new FormData();
      formData.append('rfpId', rfpId.toString());
      files.forEach((file, index) => {
        formData.append(`attachment_${index}`, file);
      });

      const token = localStorage.getItem('auth-token');
      const response = await fetch('/api/evaluation-budget-attachments', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload files');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: [`/api/evaluation-budget-attachments/${rfpId}`] 
      });
      setAttachedFiles([]);
      toast({
        title: "Success",
        description: "Files uploaded successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to upload files",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (attachmentId: number) => {
      await apiRequest(`/api/evaluation-budget-attachments/${attachmentId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: [`/api/evaluation-budget-attachments/${rfpId}`] 
      });
      toast({
        title: "Success",
        description: "File deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete file",
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const fileArray = Array.from(files);
      setAttachedFiles(prev => [...prev, ...fileArray]);
    }
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = () => {
    if (attachedFiles.length > 0) {
      uploadMutation.mutate(attachedFiles);
    }
  };

  if (!rfpId) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Team Schedules & Documents</CardTitle>
        <p className="text-sm text-gray-600">
          Attach schedules and internal documents to share with your team alongside the evaluation budget report
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* File Upload Section */}
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
          <div className="text-center">
            <Upload className="mx-auto h-8 w-8 text-gray-400" />
            <div className="mt-2">
              <label htmlFor="schedule-upload" className="cursor-pointer">
                <span className="text-sm font-medium text-blue-600 hover:text-blue-500">
                  Click to upload files
                </span>
                <input
                  id="schedule-upload"
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={handleFileSelect}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.msg"
                />
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              PDF, Word, Excel, PowerPoint, Images, or Outlook files up to 10MB
            </p>
          </div>
        </div>

        {/* New Files to Upload */}
        {attachedFiles.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Files to Upload:</Label>
            {attachedFiles.map((file, index) => (
              <div key={index} className="flex items-center justify-between bg-blue-50 p-2 rounded">
                <span className="text-sm text-blue-700">{file.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeAttachedFile(index)}
                  className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button
              onClick={handleUpload}
              disabled={uploadMutation.isPending}
              className="w-full"
            >
              {uploadMutation.isPending ? "Uploading..." : "Upload Files"}
            </Button>
          </div>
        )}

        {/* Existing Attachments */}
        {Array.isArray(attachments) && attachments.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Attached Files:</Label>
            {attachments.map((attachment: any) => (
              <div key={attachment.id} className="flex items-center justify-between bg-green-50 p-2 rounded">
                <span className="text-sm text-green-700">{attachment.originalName}</span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.open(`/api/evaluation-budget-attachments/${attachment.id}/download`, '_blank')}
                    className="h-6 w-6 p-0 text-blue-500 hover:text-blue-700"
                  >
                    <FileDown className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(attachment.id)}
                    disabled={deleteMutation.isPending}
                    className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}