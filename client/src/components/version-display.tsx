import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Info, RefreshCw, GitBranch, Clock, Server } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface VersionInfo {
  version: string;
  buildDate: string;
  gitCommit: string;
  environment: string;
  features: string[];
  nodeVersion?: string;
  uptime?: number;
  timestamp?: string;
}

export function VersionDisplay() {
  const [isOpen, setIsOpen] = useState(false);
  
  const { data: versionInfo, isLoading, refetch } = useQuery<VersionInfo>({
    queryKey: ['/api/version'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const formatBuildDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  const getEnvironmentColor = (env: string) => {
    switch (env) {
      case 'production': return 'bg-green-600';
      case 'staging': return 'bg-yellow-600';
      case 'development': return 'bg-blue-600';
      default: return 'bg-gray-600';
    }
  };

  if (isLoading || !versionInfo) {
    return (
      <Badge variant="outline" className="text-xs">
        v...
      </Badge>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <button 
          className="text-xs font-mono text-blue-600 hover:text-blue-800 cursor-pointer underline-offset-2 hover:underline"
          title="Click to view version details"
        >
          v{versionInfo.version}
        </button>
      </DialogTrigger>
      
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            RFP Tracker Version Information
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetch()}
              className="ml-auto mr-8"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Main Version Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Application Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-500">Version</div>
                  <div className="font-mono text-lg font-bold">{versionInfo.version}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Environment</div>
                  <Badge className={`${getEnvironmentColor(versionInfo.environment)} text-white`}>
                    {versionInfo.environment}
                  </Badge>
                </div>
                <div>
                  <div className="text-sm text-gray-500 flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />
                    Git Commit
                  </div>
                  <div className="font-mono text-sm">{versionInfo.gitCommit}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Build Date
                  </div>
                  <div className="text-sm">{formatBuildDate(versionInfo.buildDate)}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Runtime Info */}
          {(versionInfo.nodeVersion || versionInfo.uptime) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  Runtime Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  {versionInfo.nodeVersion && (
                    <div>
                      <div className="text-sm text-gray-500">Node.js Version</div>
                      <div className="font-mono">{versionInfo.nodeVersion}</div>
                    </div>
                  )}
                  {versionInfo.uptime && (
                    <div>
                      <div className="text-sm text-gray-500">Server Uptime</div>
                      <div>{formatUptime(versionInfo.uptime)}</div>
                    </div>
                  )}
                  {versionInfo.timestamp && (
                    <div className="col-span-2">
                      <div className="text-sm text-gray-500">Last Updated</div>
                      <div className="text-sm">{new Date(versionInfo.timestamp).toLocaleString()}</div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Features */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Current Features</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {versionInfo.features.map((feature, index) => (
                  <Badge key={index} variant="secondary" className="text-xs">
                    {feature}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}