/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { 
  Trash2, 
  RefreshCw, 
  HardDrive, 
  FileX, 
  AlertTriangle,
  CheckCircle,
  Info
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface CleanupStats {
  totalFiles: number;
  referencedFiles: number;
  orphanedFiles: number;
  totalSizeBytes: number;
  orphanedSizeBytes: number;
}

interface CleanupResult {
  orphanedFiles: string[];
  deletedFiles: string[];
  errors: string[];
  totalSize: number;
}

export function FileCleanupPanel() {
  const [showOrphanedFiles, setShowOrphanedFiles] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get cleanup statistics
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<CleanupStats>({
    queryKey: ['/api/admin/file-cleanup/stats'],
    refetchInterval: false,
  });

  // Get orphaned files list
  const { data: orphanedData, isLoading: orphanedLoading } = useQuery<{ orphanedFiles: string[] }>({
    queryKey: ['/api/admin/file-cleanup/orphaned'],
    enabled: showOrphanedFiles,
  });

  // Cleanup mutation
  const cleanupMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('/api/admin/file-cleanup/clean', 'POST');
    },
    onSuccess: (result: CleanupResult) => {
      toast({
        title: "Cleanup Completed",
        description: `Deleted ${result.deletedFiles.length} files (${formatBytes(result.totalSize)}). ${result.errors.length} errors.`,
        duration: 5000,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/file-cleanup/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/file-cleanup/orphaned'] });
      refetchStats();
    },
    onError: () => {
      toast({
        title: "Cleanup Failed",
        description: "Failed to cleanup orphaned files",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStorageStatus = (orphanedFiles: number, orphanedSize: number) => {
    if (orphanedFiles === 0) {
      return { color: "bg-green-100 text-green-800", text: "Optimal" };
    } else if (orphanedSize < 10 * 1024 * 1024) { // Less than 10MB
      return { color: "bg-yellow-100 text-yellow-800", text: "Good" };
    } else {
      return { color: "bg-red-100 text-red-800", text: "Needs Cleanup" };
    }
  };

  if (statsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            File Storage Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading storage statistics...
          </div>
        </CardContent>
      </Card>
    );
  }

  const storageStatus = stats ? getStorageStatus(stats.orphanedFiles, stats.orphanedSizeBytes) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          File Storage Management
          {storageStatus && (
            <Badge className={storageStatus.color}>
              {storageStatus.text}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Storage Statistics */}
        {stats && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Total Files:</span>
                <span className="font-medium">{stats.totalFiles}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Referenced Files:</span>
                <span className="font-medium text-green-600">{stats.referencedFiles}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Orphaned Files:</span>
                <span className={`font-medium ${stats.orphanedFiles > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                  {stats.orphanedFiles}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Total Size:</span>
                <span className="font-medium">{formatBytes(stats.totalSizeBytes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Orphaned Size:</span>
                <span className={`font-medium ${stats.orphanedSizeBytes > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                  {formatBytes(stats.orphanedSizeBytes)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Storage Health:</span>
                <Badge className={storageStatus?.color}>
                  {storageStatus?.text}
                </Badge>
              </div>
            </div>
          </div>
        )}

        {/* Status Alerts */}
        {stats && stats.orphanedFiles === 0 && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              All files are properly referenced. No cleanup needed.
            </AlertDescription>
          </Alert>
        )}

        {stats && stats.orphanedFiles > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Found {stats.orphanedFiles} orphaned files taking up {formatBytes(stats.orphanedSizeBytes)} of storage space.
              These files are not referenced in the database and can be safely removed.
            </AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={() => refetchStats()}
            variant="outline"
            size="sm"
            disabled={statsLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${statsLoading ? 'animate-spin' : ''}`} />
            Refresh Stats
          </Button>

          <Button
            onClick={() => setShowOrphanedFiles(!showOrphanedFiles)}
            variant="outline"
            size="sm"
            disabled={!stats || stats.orphanedFiles === 0}
          >
            <FileX className="h-4 w-4 mr-2" />
            {showOrphanedFiles ? 'Hide' : 'Show'} Orphaned Files
          </Button>

          <Button
            onClick={() => cleanupMutation.mutate()}
            variant="destructive"
            size="sm"
            disabled={cleanupMutation.isPending || !stats || stats.orphanedFiles === 0}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {cleanupMutation.isPending ? 'Cleaning...' : 'Cleanup Orphaned Files'}
          </Button>
        </div>

        {/* Orphaned Files List */}
        {showOrphanedFiles && (
          <div className="space-y-2">
            <h4 className="font-medium flex items-center gap-2">
              <FileX className="h-4 w-4" />
              Orphaned Files
            </h4>
            {orphanedLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Loading orphaned files...
              </div>
            ) : orphanedData && orphanedData.orphanedFiles.length > 0 ? (
              <div className="bg-muted rounded-lg p-3 max-h-48 overflow-y-auto">
                <div className="space-y-1">
                  {orphanedData.orphanedFiles.map((filename, index) => (
                    <div key={index} className="text-sm font-mono text-muted-foreground">
                      {filename}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No orphaned files found.</div>
            )}
          </div>
        )}

        {/* Information */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            File cleanup automatically runs when deleting RFPs, bids, and other entities. 
            Use this panel to cleanup any remaining orphaned files manually.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}