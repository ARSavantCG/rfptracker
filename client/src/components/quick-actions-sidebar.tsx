import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Plus, 
  FileText, 
  Users, 
  Building2, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  PauseCircle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Calendar,
  Download,
  Settings,
  BarChart3
} from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { RfpRequest, Contact, Property } from "@shared/schema";

interface QuickActionsSidebarProps {
  onCreateRfp?: () => void;
  onCreateContact?: () => void;
  onCreateProperty?: () => void;
  onStatusFilter?: (status: string) => void;
  onSearch?: (query: string) => void;
  className?: string;
}

export function QuickActionsSidebar({ 
  onCreateRfp,
  onCreateContact,
  onCreateProperty,
  onStatusFilter,
  onSearch,
  className = ""
}: QuickActionsSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Fetch recent data for quick access
  const { data: rfpRequests = [] } = useQuery<RfpRequest[]>({
    queryKey: ["/api/rfp-requests"],
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const { data: stats } = useQuery<{
    total: number;
    received: number;
    inProgress: number;
    completed: number;
    onHold: number;
  }>({
    queryKey: ["/api/rfp-requests/stats"],
  });

  // Get recent RFPs (last 5)
  const recentRfps = rfpRequests.slice(0, 5);

  // Quick stats for overview
  const quickStats = [
    { label: "Total", value: stats?.total ?? 0, color: "bg-blue-500", icon: FileText },
    { label: "In Progress", value: stats?.inProgress ?? 0, color: "bg-orange-500", icon: Clock },
    { label: "Completed", value: stats?.completed ?? 0, color: "bg-green-500", icon: CheckCircle },
    { label: "On Hold", value: stats?.onHold ?? 0, color: "bg-red-500", icon: PauseCircle },
  ];

  const handleStatusFilter = (status: string) => {
    onStatusFilter?.(status);
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "received": return "bg-purple-100 text-purple-800";
      case "in-progress": return "bg-orange-100 text-orange-800";
      case "completed": return "bg-green-100 text-green-800";
      case "on-hold": return "bg-red-100 text-red-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  if (isCollapsed) {
    return (
      <div className={`w-16 bg-white border-r border-gray-200 flex flex-col items-center py-4 space-y-4 ${className}`}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCollapsed(false)}
          className="p-2 h-8 w-8"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onCreateRfp}
          className="p-2 h-8 w-8"
          title="Create RFP"
        >
          <Plus className="h-4 w-4" />
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onCreateContact}
          className="p-2 h-8 w-8"
          title="Create Contact"
        >
          <Users className="h-4 w-4" />
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onCreateProperty}
          className="p-2 h-8 w-8"
          title="Create Property"
        >
          <Building2 className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className={`w-56 bg-white border-r border-gray-200 flex flex-col ${className}`}>
      {/* Header */}
      <div className="p-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Quick Actions</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(true)}
            className="p-1 h-6 w-6"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Quick Create Actions */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Create New</h3>
            <div className="space-y-2">
              <Button 
                onClick={onCreateRfp}
                variant="outline" 
                className="w-full justify-start"
              >
                <Plus className="h-4 w-4 mr-2" />
                New RFP Request
              </Button>
              <Button 
                onClick={onCreateContact}
                variant="outline" 
                className="w-full justify-start"
              >
                <Users className="h-4 w-4 mr-2" />
                New Contact
              </Button>
              <Button 
                onClick={onCreateProperty}
                variant="outline" 
                className="w-full justify-start"
              >
                <Building2 className="h-4 w-4 mr-2" />
                New Property
              </Button>
            </div>
          </div>

          <Separator />






        </div>
      </ScrollArea>
    </div>
  );
}