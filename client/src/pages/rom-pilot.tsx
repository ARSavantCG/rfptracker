import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Calculator, Edit, Trash2, FileText, ListChecks, Download, Save, Archive, BarChart2 } from "lucide-react";
import Navigation from "@/components/navigation";
import { CreateRomPilotModal } from "@/components/create-rom-pilot-modal";
import { RomPilotScopeModal } from "@/components/rom-pilot-scope-modal-new";
import { RomScopeItemsModal } from "@/components/rom-scope-items-modal";
import { CostBenchmarks } from "@/components/cost-benchmarks";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface RomPilot {
  id: number;
  romNumber?: string;
  projectName: string;
  property: string;
  propertyName?: string;
  totalEstimate: string;
  notes?: string;
  status?: string;
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
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/rom-pilots/${id}`, {
        method: "DELETE",
        headers: {
          ...(token && { "Authorization": `Bearer ${token}` })
        },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to delete ROM Pilot");
      }

      toast({
        title: "Success",
        description: "ROM Pilot deleted successfully",
        duration: 4000,
      });

      refetch();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete ROM Pilot",
        variant: "destructive",
        duration: 6000,
      });
    }
  };

  const saveRomPilot = async (id: number) => {
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/rom-pilots/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token && { "Authorization": `Bearer ${token}` })
        },
        credentials: "include",
        body: JSON.stringify({ status: "active" }),
      });

      if (!response.ok) {
        throw new Error("Failed to save ROM Pilot");
      }

      toast({
        title: "Success",
        description: "ROM Pilot saved successfully",
        duration: 4000,
      });

      refetch();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save ROM Pilot",
        variant: "destructive",
        duration: 6000,
      });
    }
  };

  const archiveRomPilot = async (id: number) => {
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/rom-pilots/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token && { "Authorization": `Bearer ${token}` })
        },
        credentials: "include",
        body: JSON.stringify({ status: "archived" }),
      });

      if (!response.ok) {
        throw new Error("Failed to archive ROM Pilot");
      }

      toast({
        title: "Success",
        description: "ROM Pilot archived successfully",
        duration: 4000,
      });

      refetch();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to archive ROM Pilot",
        variant: "destructive",
        duration: 6000,
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
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/rom-pilots/${pilot.id}/report`, {
        method: 'GET',
        headers: {
          ...(token && { "Authorization": `Bearer ${token}` })
        },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error('Failed to generate ROM report');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
      
      // Clean up the URL after a short delay
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 1000);

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
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center space-x-2">
            <Calculator className="h-8 w-8 text-blue-600" />
            <span>ROM Pilot</span>
          </h1>
          <p className="text-gray-600 mt-1">
            Create rough order of magnitude estimates for tenant improvement projects
          </p>
        </div>

        <Tabs defaultValue="estimates">
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              <TabsTrigger value="estimates" className="flex items-center gap-1">
                <Calculator className="h-3.5 w-3.5" /> ROM Estimates
              </TabsTrigger>
              <TabsTrigger value="benchmarks" className="flex items-center gap-1">
                <BarChart2 className="h-3.5 w-3.5" /> Benchmarks
              </TabsTrigger>
            </TabsList>

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

          <TabsContent value="benchmarks">
            <CostBenchmarks />
          </TabsContent>

          <TabsContent value="estimates">
        {/* ROM Pilots Table */}
        <div className="bg-white rounded-lg shadow">
          <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <Calculator className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">Loading ROM Pilots...</p>
              </div>
            </div>
          ) : romPilots.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
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
            <table className="w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{width: '120px'}}>ROM #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{width: '160px'}}>Project</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{width: '200px'}}>Property</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{width: '120px'}}>Total Est.</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{width: '80px'}}>Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{width: '100px'}}>Created</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider" style={{width: '320px'}}>Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {romPilots.map((pilot) => (
                  <tr key={pilot.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3 whitespace-nowrap" style={{width: '120px'}}>
                      <div className="text-xs font-medium text-blue-600 truncate">{pilot.romNumber || 'ROM-' + pilot.id}</div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap" style={{width: '160px'}}>
                      <div className="text-xs font-medium text-gray-900 truncate" title={pilot.projectName}>{pilot.projectName}</div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap" style={{width: '200px'}}>
                      <div className="text-xs text-gray-500 truncate" title={pilot.propertyName && pilot.propertyName !== 'undefined' ? pilot.propertyName.replace(/\s*-\s*undefined\s*$/i, '').trim() : pilot.property}>
                        {pilot.propertyName && pilot.propertyName !== 'undefined' 
                          ? pilot.propertyName.replace(/\s*-\s*undefined\s*$/i, '').trim()
                          : pilot.property}
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap" style={{width: '120px'}}>
                      <div className="text-xs font-medium text-green-600">{formatCurrency(pilot.totalEstimate)}</div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap" style={{width: '80px'}}>
                      <span className={`inline-flex px-1 py-1 text-xs font-semibold rounded-full ${
                        pilot.status === 'active' ? 'bg-green-100 text-green-800' :
                        pilot.status === 'archived' ? 'bg-gray-100 text-gray-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {(pilot.status || 'draft').substring(0, 6)}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-500" style={{width: '100px'}}>
                      {format(new Date(pilot.createdAt), "MMM d")}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-right text-xs font-medium" style={{width: '320px'}}>
                      <div className="flex items-center justify-end space-x-0.5 flex-nowrap" style={{width: '320px'}}>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingRomPilot(pilot);
                            setCreateModalOpen(true);
                          }}
                          className="text-xs px-1 py-0.5 h-6"
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedRomPilot(pilot);
                            setScopeModalOpen(true);
                          }}
                          className="text-xs px-1.5 py-0.5 h-6"
                        >
                          <ListChecks className="h-3 w-3" />
                        </Button>
                        {pilot.status === 'draft' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => saveRomPilot(pilot.id)}
                            className="text-xs text-blue-600 hover:text-blue-700 px-1.5 py-0.5 h-6"
                          >
                            <Save className="h-3 w-3" />
                          </Button>
                        )}
                        {pilot.status === 'active' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => archiveRomPilot(pilot.id)}
                            className="text-xs text-orange-600 hover:text-orange-700 px-1.5 py-0.5 h-6"
                          >
                            <Archive className="h-3 w-3" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => generateRomReport(pilot)}
                          className="text-xs px-1.5 py-0.5 h-6"
                        >
                          <Download className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteRomPilot(pilot.id)}
                          className="text-xs text-red-600 hover:text-red-700 px-1 py-0.5 h-6"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>
        </div>
          </TabsContent>
        </Tabs>
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