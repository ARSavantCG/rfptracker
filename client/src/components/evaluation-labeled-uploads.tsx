import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Upload, FileDown, Trash2, Building2, Ruler } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface EvaluationLabeledUploadsProps {
  rfpId?: number;
  projectFolder?: string;
}

interface ProjectFile {
  id: number;
  projectId: number;
  filePath: string;
  fileName: string;
  originalName: string;
  workflowStep: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  subfolder?: string | null;
}

export function EvaluationLabeledUploads({ rfpId, projectFolder }: EvaluationLabeledUploadsProps) {
  const [architectFiles, setArchitectFiles] = useState<File[]>([]);
  const [gcFiles, setGcFiles] = useState<File[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: projectFiles = [] } = useQuery<ProjectFile[]>({
    queryKey: ['/api/rfp-requests', rfpId, 'project-files', 4],
    queryFn: async () => {
      const res = await fetch(`/api/rfp-requests/${rfpId}/project-files/4`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
        },
      });
      if (!res.ok) throw new Error('Failed to fetch project files');
      return res.json();
    },
    enabled: !!rfpId,
  });

  const architectDocs = projectFiles.filter((f: ProjectFile) => f.subfolder === 'Architect_Docs');
  const gcDocs = projectFiles.filter((f: ProjectFile) => f.subfolder === 'GC_Docs');

  const uploadMutation = useMutation({
    mutationFn: async ({ files, subfolder }: { files: File[], subfolder: string }) => {
      if (!rfpId) throw new Error("RFP ID is required");

      const formData = new FormData();
      formData.append('rfpId', rfpId.toString());
      formData.append('workflowStep', '4');
      formData.append('subfolder', subfolder);
      files.forEach((file) => {
        formData.append('files', file);
      });

      const token = localStorage.getItem('auth-token');
      const response = await fetch('/api/project-files/upload', {
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
        queryKey: ['/api/rfp-requests', rfpId, 'project-files', 4]
      });
      setArchitectFiles([]);
      setGcFiles([]);
      toast({
        title: "Success",
        description: "Files uploaded successfully",
        duration: 4000,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to upload files",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (fileId: number) => {
      await apiRequest(`/api/project-files/${fileId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/rfp-requests', rfpId, 'project-files', 4]
      });
      toast({
        title: "Success",
        description: "File deleted successfully",
        duration: 4000,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete file",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const handleDownload = async (file: ProjectFile) => {
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/project-files/${file.id}/download`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to download file');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.originalName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
      toast({
        title: "Download Failed",
        description: "Could not download the file. Please try again.",
        variant: "destructive",
        duration: 6000,
      });
    }
  };

  const handleFileSelect = (
    event: React.ChangeEvent<HTMLInputElement>,
    setFiles: React.Dispatch<React.SetStateAction<File[]>>
  ) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      setFiles(prev => [...prev, ...fileArray]);
    }
    event.target.value = '';
  };

  const handleUpload = (files: File[], subfolder: string, setFiles: React.Dispatch<React.SetStateAction<File[]>>) => {
    if (files.length > 0) {
      uploadMutation.mutate({ files, subfolder });
    }
  };

  if (!rfpId) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Ruler className="h-4 w-4 text-blue-600" />
            Architect Documents
          </CardTitle>
          <p className="text-xs text-gray-600">
            Upload architectural drawings, specs, and design files
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            onClick={() => document.getElementById('architect-upload')?.click()}
            className="border-2 border-dashed border-blue-200 rounded-lg p-3 hover:border-blue-400 transition-colors cursor-pointer bg-blue-50/50"
          >
            <div className="text-center">
              <Upload className="mx-auto h-6 w-6 text-blue-400" />
              <span className="text-xs font-medium text-blue-600">Click to upload</span>
            </div>
          </div>
          <input
            id="architect-upload"
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFileSelect(e, setArchitectFiles)}
            accept=".pdf,.dwg,.dxf,.doc,.docx,.xls,.xlsx"
          />

          {architectFiles.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Files to Upload:</Label>
              {architectFiles.map((file, index) => (
                <div key={index} className="flex items-center justify-between bg-blue-50 p-2 rounded text-xs">
                  <span className="text-blue-700 truncate">{file.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setArchitectFiles(prev => prev.filter((_, i) => i !== index))}
                    className="h-5 w-5 p-0 text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button
                onClick={() => handleUpload(architectFiles, 'Architect_Docs', setArchitectFiles)}
                disabled={uploadMutation.isPending}
                size="sm"
                className="w-full"
              >
                {uploadMutation.isPending ? "Uploading..." : "Upload"}
              </Button>
            </div>
          )}

          {architectDocs.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Uploaded Files:</Label>
              {architectDocs.map((file: ProjectFile) => (
                <div key={file.id} className="flex items-center justify-between bg-green-50 p-2 rounded text-xs">
                  <span className="text-green-700 truncate">{file.originalName}</span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDownload(file)}
                      className="h-5 w-5 p-0 text-blue-500 hover:text-blue-700"
                    >
                      <FileDown className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(file.id)}
                      disabled={deleteMutation.isPending}
                      className="h-5 w-5 p-0 text-red-500 hover:text-red-700"
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-orange-600" />
            GC Documents
          </CardTitle>
          <p className="text-xs text-gray-600">
            Upload general contractor bids, estimates, and schedules
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            onClick={() => document.getElementById('gc-upload')?.click()}
            className="border-2 border-dashed border-orange-200 rounded-lg p-3 hover:border-orange-400 transition-colors cursor-pointer bg-orange-50/50"
          >
            <div className="text-center">
              <Upload className="mx-auto h-6 w-6 text-orange-400" />
              <span className="text-xs font-medium text-orange-600">Click to upload</span>
            </div>
          </div>
          <input
            id="gc-upload"
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFileSelect(e, setGcFiles)}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv"
          />

          {gcFiles.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Files to Upload:</Label>
              {gcFiles.map((file, index) => (
                <div key={index} className="flex items-center justify-between bg-orange-50 p-2 rounded text-xs">
                  <span className="text-orange-700 truncate">{file.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setGcFiles(prev => prev.filter((_, i) => i !== index))}
                    className="h-5 w-5 p-0 text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button
                onClick={() => handleUpload(gcFiles, 'GC_Docs', setGcFiles)}
                disabled={uploadMutation.isPending}
                size="sm"
                className="w-full bg-orange-600 hover:bg-orange-700"
              >
                {uploadMutation.isPending ? "Uploading..." : "Upload"}
              </Button>
            </div>
          )}

          {gcDocs.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Uploaded Files:</Label>
              {gcDocs.map((file: ProjectFile) => (
                <div key={file.id} className="flex items-center justify-between bg-green-50 p-2 rounded text-xs">
                  <span className="text-green-700 truncate">{file.originalName}</span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDownload(file)}
                      className="h-5 w-5 p-0 text-blue-500 hover:text-blue-700"
                    >
                      <FileDown className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(file.id)}
                      disabled={deleteMutation.isPending}
                      className="h-5 w-5 p-0 text-red-500 hover:text-red-700"
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
    </div>
  );
}
