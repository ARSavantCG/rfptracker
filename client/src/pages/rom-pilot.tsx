import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Calculator, Edit, Trash2, FileText, ListChecks, Download } from "lucide-react";
import Navigation from "@/components/navigation";
import { CreateRomPilotModal } from "@/components/create-rom-pilot-modal";
import { RomPilotScopeModal } from "@/components/rom-pilot-scope-modal";
import { RomScopeItemsModal } from "@/components/rom-scope-items-modal";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface RomPilot {
  id: number;
  projectName: string;
  property: string;
  totalEstimate: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export default function RomPilotPage() {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [scopeModalOpen, setScopeModalOpen] = useState(false);
  const [scopeItemsModalOpen, setScopeItemsModalOpen] = useState(false);
  const [selectedRomPilot, setSelectedRomPilot] = useState<RomPilot | null>(null);
  const [editingRomPilot, setEditingRomPilot] = useState<RomPilot | null>(null);
  const { toast } = useToast();

  const { data: romPilots = [], isLoading, refetch } = useQuery<RomPilot[]>({
    queryKey: ["/api/rom-pilots"],
  });

  const deleteRomPilot = async (id: number) => {
    if (!confirm("Are you sure you want to delete this ROM Pilot?")) return;

    try {
      const response = await fetch(`/api/rom-pilots/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete ROM Pilot");
      }

      toast({
        title: "Success",
        description: "ROM Pilot deleted successfully",
      });

      refetch();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete ROM Pilot",
        variant: "destructive",
      });
    }
  };

  const formatCurrency = (value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return "$0";
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
  };

  const generateRomReport = async (pilot: RomPilot) => {
    try {
      const response = await fetch(`/api/rom-pilots/${pilot.id}/report`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error('Failed to generate ROM report');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const newWindow = window.open(url, '_blank', 'width=450,height=400,scrollbars=yes,resizable=yes');
      
      if (newWindow) {
        newWindow.onload = () => {
          setTimeout(() => {
            window.URL.revokeObjectURL(url);
          }, 1000);
        };
      }

      toast({
        title: "Success",
        description: "ROM report generated successfully",
      });
    } catch (error) {
      console.error('Error generating ROM report:', error);
      toast({
        title: "Error",
        description: "Failed to generate ROM report",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center space-x-2">
              <Calculator className="h-8 w-8 text-blue-600" />
              <span>ROM Pilot</span>
            </h1>
            <p className="text-gray-600 mt-1">
              Create rough order of magnitude estimates for tenant improvement projects
            </p>
          </div>
          
          <div className="flex space-x-3">
            <Button 
              variant="outline"
              onClick={() => setScopeItemsModalOpen(true)}
              className="flex items-center space-x-2"
            >
              <ListChecks className="h-4 w-4" />
              <span>Manage Scope Items</span>
            </Button>
            <Button 
              onClick={() => setCreateModalOpen(true)}
              className="flex items-center space-x-2"
            >
              <Plus className="h-4 w-4" />
              <span>New ROM</span>
            </Button>
          </div>
        </div>

        {/* ROM Pilots Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {isLoading ? (
            <div className="col-span-full flex justify-center items-center py-12">
              <div className="text-center">
                <Calculator className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">Loading ROM Pilots...</p>
              </div>
            </div>
          ) : romPilots.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-12">
              <Calculator className="h-16 w-16 text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No ROMs</h3>
              <p className="text-gray-500 text-center mb-6 max-w-md">
                Get started by creating your first rough order of magnitude estimate. 
                Select a property, configure bays, and add scope items with pricing.
              </p>
              <Button 
                onClick={() => setCreateModalOpen(true)}
                className="flex items-center space-x-2"
              >
                <Plus className="h-4 w-4" />
                <span>Create First ROM</span>
              </Button>
            </div>
          ) : (
            romPilots.map((pilot) => (
              <Card key={pilot.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="p-3 pb-2">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-xs font-semibold truncate leading-tight">
                        {pilot.projectName}
                      </CardTitle>
                      <p className="text-xs text-gray-500 truncate">{pilot.property}</p>
                    </div>
                    <div className="flex space-x-0.5 ml-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingRomPilot(pilot);
                          setCreateModalOpen(true);
                        }}
                        className="h-5 w-5 p-0"
                      >
                        <Edit className="h-2.5 w-2.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteRomPilot(pilot.id)}
                        className="text-red-600 hover:text-red-700 h-5 w-5 p-0"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent className="p-3 pt-0 space-y-2">
                  <div className="bg-green-50 p-1.5 rounded">
                    <p className="text-xs text-green-600 font-medium">Total</p>
                    <p className="text-sm font-bold text-green-800">
                      {formatCurrency(pilot.totalEstimate)}
                    </p>
                  </div>
                  
                  <div className="text-xs text-gray-500 border-t pt-1">
                    <span>{format(new Date(pilot.createdAt), "MMM d")}</span>
                  </div>
                  
                  <div className="space-y-1">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => {
                        setSelectedRomPilot(pilot);
                        setScopeModalOpen(true);
                      }}
                      className="w-full h-5 text-xs px-1"
                    >
                      <ListChecks className="h-2.5 w-2.5 mr-1" />
                      Scope
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => generateRomReport(pilot)}
                      className="w-full h-5 text-xs px-1"
                    >
                      <Download className="h-2.5 w-2.5 mr-1" />
                      Report
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      <CreateRomPilotModal
        isOpen={createModalOpen}
        onClose={() => {
          setCreateModalOpen(false);
          setEditingRomPilot(null);
        }}
        onSuccess={(createdRomPilot?: RomPilot) => {
          setCreateModalOpen(false);
          setEditingRomPilot(null);
          refetch();
          
          // If a new ROM was created (not editing), open the scope modal
          if (createdRomPilot && !editingRomPilot) {
            setSelectedRomPilot(createdRomPilot);
            setScopeModalOpen(true);
          }
        }}
        editingRomPilot={editingRomPilot}
      />

      {selectedRomPilot && (
        <RomPilotScopeModal
          isOpen={scopeModalOpen}
          onClose={() => {
            setScopeModalOpen(false);
            setSelectedRomPilot(null);
          }}
          romPilotId={selectedRomPilot.id}
          romPilotName={selectedRomPilot.projectName}
        />
      )}

      <RomScopeItemsModal
        isOpen={scopeItemsModalOpen}
        onClose={() => setScopeItemsModalOpen(false)}
      />
    </div>
  );
}