import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, Zap, Cable, Building2, Activity, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";

interface Transformer {
  id: number;
  propertyId: number;
  transformerName: string;
  totalCapacityKva: number;
  fplId?: string;
  installationDate?: string;
  notes?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface MainPanel {
  id: number;
  transformerId: number;
  panelName: string;
  maxCapacityKva: number;
  panelLocation?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface BayPanelAssignment {
  id: number;
  propertyId: number;
  mainPanelId: number;
  bayConfiguration: string;
  capacity: number;
  notes?: string;
}

interface ElectricalReservation {
  id: number;
  propertyId: number;
  bayPanelAssignmentId: number;
  reservedFor: string;
  reservedCapacity: number;
  startDate: string;
  endDate?: string;
  status: 'active' | 'pending' | 'expired';
  notes?: string;
}

interface ElectricalCapacityManagementProps {
  propertyId: number;
  propertyName: string;
}

export function ElectricalCapacityManagement({ propertyId, propertyName }: ElectricalCapacityManagementProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [showTransformerDialog, setShowTransformerDialog] = useState(false);
  const [showPanelDialog, setShowPanelDialog] = useState(false);
  const [showAssignmentDialog, setShowAssignmentDialog] = useState(false);
  const [showReservationDialog, setShowReservationDialog] = useState(false);
  const [editingTransformer, setEditingTransformer] = useState<Transformer | null>(null);
  const [editingPanel, setEditingPanel] = useState<MainPanel | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<BayPanelAssignment | null>(null);
  const [editingReservation, setEditingReservation] = useState<ElectricalReservation | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all electrical data
  const { data: transformers = [] } = useQuery<Transformer[]>({
    queryKey: [`/api/properties/${propertyId}/transformers`],
  });

  const { data: mainPanels = [] } = useQuery<MainPanel[]>({
    queryKey: [`/api/properties/${propertyId}/main-panels`],
  });

  const { data: bayAssignments = [] } = useQuery<BayPanelAssignment[]>({
    queryKey: [`/api/properties/${propertyId}/bay-panel-assignments`],
  });

  const { data: reservations = [] } = useQuery<ElectricalReservation[]>({
    queryKey: [`/api/properties/${propertyId}/electrical-reservations`],
  });

  const { data: property } = useQuery({
    queryKey: [`/api/properties/${propertyId}`],
  });

  // Mutations for CRUD operations
  const createTransformerMutation = useMutation({
    mutationFn: async (transformer: Omit<Transformer, 'id'>) => 
      apiRequest(`/api/properties/${propertyId}/transformers`, 'POST', transformer),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/transformers`] });
      setShowTransformerDialog(false);
      setEditingTransformer(null);
      toast({ title: "Transformer created successfully" });
    },
  });

  const updateTransformerMutation = useMutation({
    mutationFn: async ({ id, ...transformer }: Transformer) =>
      apiRequest(`/api/transformers/${id}`, 'PUT', transformer),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/transformers`] });
      setShowTransformerDialog(false);
      setEditingTransformer(null);
      toast({ title: "Transformer updated successfully" });
    },
  });

  const deleteTransformerMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/transformers/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/transformers`] });
      toast({ title: "Transformer deleted successfully" });
    },
  });

  const createMainPanelMutation = useMutation({
    mutationFn: async (panel: Omit<MainPanel, 'id'>) =>
      apiRequest(`/api/properties/${propertyId}/main-panels`, 'POST', panel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/main-panels`] });
      setShowPanelDialog(false);
      setEditingPanel(null);
      toast({ title: "Main panel created successfully" });
    },
  });

  const updateMainPanelMutation = useMutation({
    mutationFn: async ({ id, ...panel }: MainPanel) =>
      apiRequest(`/api/main-panels/${id}`, 'PATCH', panel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/main-panels`] });
      setShowPanelDialog(false);
      setEditingPanel(null);
      toast({ title: "Main panel updated successfully" });
    },
  });

  const deleteMainPanelMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/main-panels/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/main-panels`] });
      toast({ title: "Main panel deleted successfully" });
    },
  });

  const createBayAssignmentMutation = useMutation({
    mutationFn: async (assignment: Omit<BayPanelAssignment, 'id'>) =>
      apiRequest(`/api/properties/${propertyId}/bay-panel-assignments`, 'POST', assignment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/bay-panel-assignments`] });
      setShowAssignmentDialog(false);
      setEditingAssignment(null);
      toast({ title: "Bay assignment created successfully" });
    },
  });

  const updateBayAssignmentMutation = useMutation({
    mutationFn: async ({ id, ...assignment }: BayPanelAssignment) =>
      apiRequest(`/api/bay-panel-assignments/${id}`, 'PUT', assignment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/bay-panel-assignments`] });
      setShowAssignmentDialog(false);
      setEditingAssignment(null);
      toast({ title: "Bay assignment updated successfully" });
    },
  });

  const deleteBayAssignmentMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/bay-panel-assignments/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/bay-panel-assignments`] });
      toast({ title: "Bay assignment deleted successfully" });
    },
  });

  const createReservationMutation = useMutation({
    mutationFn: async (reservation: Omit<ElectricalReservation, 'id'>) =>
      apiRequest(`/api/properties/${propertyId}/electrical-reservations`, 'POST', reservation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/electrical-reservations`] });
      setShowReservationDialog(false);
      setEditingReservation(null);
      toast({ title: "Electrical reservation created successfully" });
    },
  });

  const updateReservationMutation = useMutation({
    mutationFn: async ({ id, ...reservation }: ElectricalReservation) =>
      apiRequest(`/api/electrical-reservations/${id}`, 'PUT', reservation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/electrical-reservations`] });
      setShowReservationDialog(false);
      setEditingReservation(null);
      toast({ title: "Electrical reservation updated successfully" });
    },
  });

  const deleteReservationMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/electrical-reservations/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/electrical-reservations`] });
      toast({ title: "Electrical reservation deleted successfully" });
    },
  });

  // Calculate capacity utilization
  const calculateCapacityUtilization = () => {
    const totalTransformerCapacity = transformers.reduce((sum: number, t: Transformer) => sum + t.totalCapacityKva, 0);
    const totalReservedCapacity = reservations
      .filter((r: ElectricalReservation) => r.status === 'active')
      .reduce((sum: number, r: ElectricalReservation) => sum + r.reservedCapacity, 0);
    
    return {
      total: totalTransformerCapacity,
      reserved: totalReservedCapacity,
      available: totalTransformerCapacity - totalReservedCapacity,
      utilizationPercent: totalTransformerCapacity > 0 ? (totalReservedCapacity / totalTransformerCapacity) * 100 : 0
    };
  };

  const capacityStats = calculateCapacityUtilization();

  // Form handlers
  const handleTransformerSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const transformer = {
      propertyId,
      transformerName: formData.get('name') as string,
      totalCapacityKva: parseFloat(formData.get('capacity') as string),
      fplId: formData.get('manufacturer') as string || undefined, // FPL Designation No.
      installationDate: formData.get('installationDate') as string || undefined,
      notes: formData.get('notes') as string || undefined,
    };

    if (editingTransformer) {
      updateTransformerMutation.mutate({ ...transformer, id: editingTransformer.id });
    } else {
      createTransformerMutation.mutate(transformer);
    }
  };

  const handleMainPanelSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const panel = {
      transformerId: parseInt(formData.get('transformerId') as string),
      panelName: formData.get('name') as string,
      maxCapacityKva: parseFloat(formData.get('capacity') as string),
      panelLocation: formData.get('location') as string,
    };

    if (editingPanel) {
      updateMainPanelMutation.mutate({ ...panel, id: editingPanel.id });
    } else {
      createMainPanelMutation.mutate(panel);
    }
  };

  const handleBayAssignmentSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const assignment = {
      propertyId,
      mainPanelId: parseInt(formData.get('mainPanelId') as string),
      bayConfiguration: formData.get('bayConfiguration') as string,
      capacity: parseFloat(formData.get('capacity') as string),
      notes: formData.get('notes') as string || undefined,
    };

    if (editingAssignment) {
      updateBayAssignmentMutation.mutate({ ...assignment, id: editingAssignment.id });
    } else {
      createBayAssignmentMutation.mutate(assignment);
    }
  };

  const handleReservationSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const reservation = {
      propertyId,
      bayPanelAssignmentId: parseInt(formData.get('bayPanelAssignmentId') as string),
      reservedFor: formData.get('reservedFor') as string,
      reservedCapacity: parseFloat(formData.get('reservedCapacity') as string),
      startDate: formData.get('startDate') as string,
      endDate: formData.get('endDate') as string || undefined,
      status: formData.get('status') as 'active' | 'pending' | 'expired',
      notes: formData.get('notes') as string || undefined,
    };

    if (editingReservation) {
      updateReservationMutation.mutate({ ...reservation, id: editingReservation.id });
    } else {
      createReservationMutation.mutate(reservation);
    }
  };

  return (
    <div className="space-y-2 electrical-management-compact">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-blue-100 rounded-md">
            <Zap className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Electrical Capacity Management</h2>
            <p className="text-xs text-gray-600">{propertyName}</p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-2">
        <Card className="p-2">
          <div className="flex items-start gap-2">
            <div className="p-1 bg-blue-100 rounded-md mt-0.5">
              <Zap className="h-3 w-3 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600">Total Capacity</p>
              <p className="text-lg font-bold text-blue-600">{capacityStats.total.toLocaleString()}</p>
              <p className="text-xs text-gray-500">kVA</p>
            </div>
          </div>
        </Card>
        
        <Card className="p-2">
          <div className="flex items-start gap-2">
            <div className="p-1 bg-green-100 rounded-md mt-0.5">
              <Activity className="h-3 w-3 text-green-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600">Available</p>
              <p className="text-lg font-bold text-green-600">{capacityStats.available.toLocaleString()}</p>
              <p className="text-xs text-gray-500">kVA</p>
            </div>
          </div>
        </Card>
        
        <Card className="p-2">
          <div className="flex items-start gap-2">
            <div className="p-1 bg-orange-100 rounded-md mt-0.5">
              <Building2 className="h-3 w-3 text-orange-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600">Reserved</p>
              <p className="text-lg font-bold text-orange-600">{capacityStats.reserved.toLocaleString()}</p>
              <p className="text-xs text-gray-500">kVA</p>
            </div>
          </div>
        </Card>
        
        <Card className="p-2">
          <div className="flex items-start gap-2">
            <div className="p-1 bg-purple-100 rounded-md mt-0.5">
              <Cable className="h-3 w-3 text-purple-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600">Utilization</p>
              <p className="text-lg font-bold text-purple-600">{capacityStats.utilizationPercent.toFixed(1)}%</p>
              <p className="text-xs text-gray-500">capacity used</p>
            </div>
          </div>
        </Card>
      </div>



      {/* Management Sections */}
      <Card>
        <CardContent className="p-3">
            <div className="grid w-full grid-cols-4 gap-1 p-1 bg-gray-100 rounded-lg" style={{ height: '24px' }}>
              <button 
                onClick={() => setActiveTab('overview')}
                className={`text-xs rounded px-2 py-1 transition-colors ${activeTab === 'overview' ? 'bg-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                style={{ height: '20px', fontSize: '10px', padding: '2px 4px', lineHeight: '1' }}
              >
                Overview
              </button>
              <button 
                onClick={() => setActiveTab('transformers')}
                className={`text-xs rounded px-2 py-1 transition-colors ${activeTab === 'transformers' ? 'bg-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                style={{ height: '20px', fontSize: '10px', padding: '2px 4px', lineHeight: '1' }}
              >
                Transformers
              </button>
              <button 
                onClick={() => setActiveTab('panels')}
                className={`text-xs rounded px-2 py-1 transition-colors ${activeTab === 'panels' ? 'bg-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                style={{ height: '20px', fontSize: '10px', padding: '2px 4px', lineHeight: '1' }}
              >
                Panels
              </button>
              <button 
                onClick={() => setActiveTab('reservations')}
                className={`text-xs rounded px-2 py-1 transition-colors ${activeTab === 'reservations' ? 'bg-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                style={{ height: '20px', fontSize: '10px', padding: '2px 4px', lineHeight: '1' }}
              >
                Reservations
              </button>
            </div>

            {activeTab === 'overview' && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                {/* Active Reservations */}
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Building2 className="h-5 w-5 text-blue-600" />
                    <h3 className="font-semibold">Active Reservations</h3>
                  </div>
                  {reservations.filter((r: ElectricalReservation) => r.status === 'active').length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <p>No active reservations</p>
                      <p className="text-sm mt-1">Create reservations to track electrical capacity usage</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {reservations
                        .filter((r: ElectricalReservation) => r.status === 'active')
                        .map((reservation: ElectricalReservation) => (
                          <div key={reservation.id} className="p-3 border rounded-lg">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium">{reservation.reservedFor}</p>
                                <p className="text-sm text-gray-600">{reservation.reservedCapacity.toLocaleString()} kVA</p>
                              </div>
                              <Badge variant="secondary">{reservation.status}</Badge>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* System Status */}
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="h-5 w-5 text-green-600" />
                    <h3 className="font-semibold">System Status</h3>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span>Transformers</span>
                      <span className="font-semibold">{transformers.length}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span>Main Panels</span>
                      <span className="font-semibold">{mainPanels.length}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span>Bay Assignments</span>
                      <span className="font-semibold">{bayAssignments.length}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span>Active Reservations</span>
                      <span className="font-semibold">{reservations.filter((r: ElectricalReservation) => r.status === 'active').length}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'transformers' && (
              <div className="mt-3">
                <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Transformers</h3>
                <button 
                  onClick={() => { setEditingTransformer(null); setShowTransformerDialog(true); }}
                  className="inline-flex items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                  style={{ fontSize: '10px', height: '20px', padding: '2px 6px', minHeight: '20px', lineHeight: '1' }}
                >
                  <Plus style={{ width: '8px', height: '8px', marginRight: '3px' }} />
                  Add Transformer
                </button>
              </div>

              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Capacity</TableHead>
                      <TableHead>FPL Designation No.</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transformers.map((transformer: Transformer) => (
                      <TableRow key={transformer.id}>
                        <TableCell className="font-medium">{transformer.transformerName}</TableCell>
                        <TableCell>{transformer.totalCapacityKva.toLocaleString()} kVA</TableCell>
                        <TableCell>{transformer.fplId || 'N/A'}</TableCell>
                        <TableCell>
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            transformer.isActive !== false ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {transformer.isActive !== false ? 'Active' : 'Inactive'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <button
                              onClick={() => { setEditingTransformer(transformer); setShowTransformerDialog(true); }}
                              className="inline-flex items-center justify-center rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                              style={{ fontSize: '8px', height: '16px', padding: '1px 3px', minHeight: '16px' }}
                            >
                              <Edit style={{ width: '6px', height: '6px' }} />
                            </button>
                            <button
                              onClick={() => deleteTransformerMutation.mutate(transformer.id)}
                              className="inline-flex items-center justify-center rounded bg-red-600 text-white hover:bg-red-700"
                              style={{ fontSize: '8px', height: '16px', padding: '1px 3px', minHeight: '16px' }}
                            >
                              <Trash2 style={{ width: '6px', height: '6px' }} />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {transformers.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Zap className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="mb-2">No transformers configured</p>
                  <p className="text-sm">Add a transformer to begin electrical capacity management</p>
                </div>
              )}
              </div>
            )}

            {activeTab === 'panels' && (
              <div className="mt-3">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Main Panels</h3>
                <button 
                  onClick={() => { setEditingPanel(null); setShowPanelDialog(true); }}
                  disabled={transformers.length === 0}
                  className="inline-flex items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ fontSize: '10px', height: '20px', padding: '2px 6px', minHeight: '20px', lineHeight: '1' }}
                >
                  <Plus style={{ width: '8px', height: '8px', marginRight: '3px' }} />
                  Add Main Panel
                </button>
              </div>

              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Transformer</TableHead>
                      <TableHead>Capacity</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mainPanels.map((panel: MainPanel) => {
                      const transformer = transformers.find((t: Transformer) => t.id === panel.transformerId);
                      return (
                        <TableRow key={panel.id}>
                          <TableCell className="font-medium">{panel.panelName}</TableCell>
                          <TableCell>{transformer?.transformerName || 'Unknown'}</TableCell>
                          <TableCell>{panel.maxCapacityKva.toLocaleString()} kVA</TableCell>
                          <TableCell>{panel.panelLocation || 'N/A'}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <button
                                onClick={() => { setEditingPanel(panel); setShowPanelDialog(true); }}
                                className="inline-flex items-center justify-center rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                                style={{ fontSize: '8px', height: '16px', padding: '1px 3px', minHeight: '16px' }}
                              >
                                <Edit style={{ width: '6px', height: '6px' }} />
                              </button>
                              <button
                                onClick={() => deleteMainPanelMutation.mutate(panel.id)}
                                className="inline-flex items-center justify-center rounded bg-red-600 text-white hover:bg-red-700"
                                style={{ fontSize: '8px', height: '16px', padding: '1px 3px', minHeight: '16px' }}
                              >
                                <Trash2 style={{ width: '6px', height: '6px' }} />
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {mainPanels.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Cable className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="mb-2">No main panels configured</p>
                  <p className="text-sm">Add main panels to distribute electrical capacity from transformers</p>
                </div>
              )}
              </div>
            )}

            {activeTab === 'reservations' && (
              <div className="mt-3">
                <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Electrical Reservations</h3>
                <button 
                  onClick={() => { setEditingReservation(null); setShowReservationDialog(true); }}
                  disabled={bayAssignments.length === 0}
                  className="inline-flex items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ fontSize: '10px', height: '20px', padding: '2px 6px', minHeight: '20px', lineHeight: '1' }}
                >
                  <Plus style={{ width: '8px', height: '8px', marginRight: '3px' }} />
                  Create Reservation
                </button>
              </div>

              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reserved For</TableHead>
                      <TableHead>Bay Assignment</TableHead>
                      <TableHead>Capacity</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reservations.map((reservation: ElectricalReservation) => {
                      const assignment = bayAssignments.find((a: BayPanelAssignment) => a.id === reservation.bayPanelAssignmentId);
                      return (
                        <TableRow key={reservation.id}>
                          <TableCell className="font-medium">{reservation.reservedFor}</TableCell>
                          <TableCell>{assignment?.bayConfiguration || 'N/A'}</TableCell>
                          <TableCell>{reservation.reservedCapacity.toLocaleString()} kVA</TableCell>
                          <TableCell>{formatDate(reservation.startDate)}</TableCell>
                          <TableCell>
                            <Badge variant={
                              reservation.status === 'active' ? 'default' : 
                              reservation.status === 'pending' ? 'secondary' : 'destructive'
                            }>
                              {reservation.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <button
                                onClick={() => { setEditingReservation(reservation); setShowReservationDialog(true); }}
                                className="inline-flex items-center justify-center rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                                style={{ fontSize: '8px', height: '16px', padding: '1px 3px', minHeight: '16px' }}
                              >
                                <Edit style={{ width: '6px', height: '6px' }} />
                              </button>
                              <button
                                onClick={() => deleteReservationMutation.mutate(reservation.id)}
                                className="inline-flex items-center justify-center rounded bg-red-600 text-white hover:bg-red-700"
                                style={{ fontSize: '8px', height: '16px', padding: '1px 3px', minHeight: '16px' }}
                              >
                                <Trash2 style={{ width: '6px', height: '6px' }} />
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {reservations.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="mb-2">No electrical reservations</p>
                  <p className="text-sm">Reserve electrical capacity for specific tenants or projects</p>
                </div>
              )}
              </div>
            )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <Dialog open={showTransformerDialog} onOpenChange={setShowTransformerDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingTransformer ? 'Edit Transformer' : 'Add New Transformer'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTransformerSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input
                  name="name"
                  defaultValue={editingTransformer?.transformerName || ''}
                  placeholder="e.g., Main Transformer A"
                  required
                />
              </div>
              <div>
                <Label htmlFor="capacity">Capacity (kVA) *</Label>
                <Input
                  name="capacity"
                  type="number"
                  defaultValue={editingTransformer?.totalCapacityKva || ''}
                  placeholder="e.g., 2000"
                  required
                />
              </div>
              <div>
                <Label htmlFor="location">Location *</Label>
                <Input
                  name="location"
                  defaultValue={editingTransformer?.location || ''}
                  placeholder="e.g., Main Electrical Room"
                  required
                />
              </div>
              <div>
                <Label htmlFor="manufacturer">FPL Designation No.</Label>
                <Input
                  name="manufacturer"
                  defaultValue={editingTransformer?.fplId || ''}
                  placeholder="e.g., FPL-TR-001"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button 
                type="button" 
                onClick={() => setShowTransformerDialog(false)}
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                style={{ fontSize: '11px', height: '24px', padding: '4px 8px', minHeight: '24px', lineHeight: '1' }}
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                style={{ fontSize: '11px', height: '24px', padding: '4px 8px', minHeight: '24px', lineHeight: '1' }}
              >
                {editingTransformer ? 'Update' : 'Add'} Transformer
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showPanelDialog} onOpenChange={setShowPanelDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingPanel ? 'Edit Main Panel' : 'Add New Main Panel'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleMainPanelSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input
                  name="name"
                  defaultValue={editingPanel?.panelName || ''}
                  placeholder="e.g., Main Panel A"
                  required
                />
              </div>
              <div>
                <Label htmlFor="capacity">Capacity (kVA) *</Label>
                <Input
                  name="capacity"
                  type="number"
                  defaultValue={editingPanel?.maxCapacityKva || ''}
                  placeholder="e.g., 800"
                  required
                />
              </div>
              <div>
                <Label htmlFor="transformerId">Transformer *</Label>
                <div className="relative">
                  <select
                    name="transformerId"
                    defaultValue={editingPanel?.transformerId?.toString() || ''}
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-8"
                  >
                    <option value="">Select transformer</option>
                    {transformers.map((transformer: Transformer) => (
                      <option key={transformer.id} value={transformer.id.toString()}>
                        {transformer.transformerName} ({transformer.totalCapacityKva} kVA)
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-3 h-4 w-4 opacity-50 pointer-events-none" />
                </div>
              </div>
              <div>
                <Label htmlFor="location">Location *</Label>
                <Input
                  name="location"
                  defaultValue={editingPanel?.panelLocation || ''}
                  placeholder="e.g., Electrical Room North"
                  required
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button 
                type="button" 
                onClick={() => setShowPanelDialog(false)}
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                style={{ fontSize: '11px', height: '24px', padding: '4px 8px', minHeight: '24px', lineHeight: '1' }}
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                style={{ fontSize: '11px', height: '24px', padding: '4px 8px', minHeight: '24px', lineHeight: '1' }}
              >
                {editingPanel ? 'Update' : 'Add'} Main Panel
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showAssignmentDialog} onOpenChange={setShowAssignmentDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingAssignment ? 'Edit Bay Assignment' : 'Add New Bay Assignment'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleBayAssignmentSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="bayConfiguration">Bay Configuration *</Label>
                <Input
                  name="bayConfiguration"
                  defaultValue={editingAssignment?.bayConfiguration || ''}
                  placeholder="e.g., Bay 1-2"
                  required
                />
              </div>
              <div>
                <Label htmlFor="capacity">Capacity (kVA) *</Label>
                <Input
                  name="capacity"
                  type="number"
                  defaultValue={editingAssignment?.capacity || ''}
                  placeholder="e.g., 200"
                  required
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="mainPanelId">Main Panel *</Label>
                <div className="relative">
                  <select
                    name="mainPanelId"
                    defaultValue={editingAssignment?.mainPanelId?.toString() || ''}
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-8"
                  >
                    <option value="">Select main panel</option>
                    {mainPanels.map((panel: MainPanel) => (
                      <option key={panel.id} value={panel.id.toString()}>
                        {panel.panelName} ({panel.maxCapacityKva} kVA)
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-3 h-4 w-4 opacity-50 pointer-events-none" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button 
                type="button" 
                onClick={() => setShowAssignmentDialog(false)}
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                style={{ fontSize: '11px', height: '24px', padding: '4px 8px', minHeight: '24px', lineHeight: '1' }}
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                style={{ fontSize: '11px', height: '24px', padding: '4px 8px', minHeight: '24px', lineHeight: '1' }}
              >
                {editingAssignment ? 'Update' : 'Add'} Bay Assignment
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showReservationDialog} onOpenChange={setShowReservationDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingReservation ? 'Edit Reservation' : 'Create New Reservation'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleReservationSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="reservedFor">Reserved For *</Label>
                <Input
                  name="reservedFor"
                  defaultValue={editingReservation?.reservedFor || ''}
                  placeholder="e.g., ABC Manufacturing Co."
                  required
                />
              </div>
              <div>
                <Label htmlFor="reservedCapacity">Reserved Capacity (kVA) *</Label>
                <Input
                  name="reservedCapacity"
                  type="number"
                  defaultValue={editingReservation?.reservedCapacity || ''}
                  placeholder="e.g., 150"
                  required
                />
              </div>
              <div>
                <Label htmlFor="bayPanelAssignmentId">Bay Assignment *</Label>
                <Select name="bayPanelAssignmentId" defaultValue={editingReservation?.bayPanelAssignmentId?.toString()}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select bay assignment" />
                  </SelectTrigger>
                  <SelectContent>
                    {bayAssignments.map((assignment: BayPanelAssignment) => (
                      <SelectItem key={assignment.id} value={assignment.id.toString()}>
                        {assignment.bayConfiguration} ({assignment.capacity} kVA)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="status">Status *</Label>
                <Select name="status" defaultValue={editingReservation?.status || 'pending'}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="startDate">Start Date *</Label>
                <Input
                  name="startDate"
                  type="date"
                  defaultValue={editingReservation?.startDate ? new Date(editingReservation.startDate).toISOString().split('T')[0] : ''}
                  required
                />
              </div>
              <div>
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  name="endDate"
                  type="date"
                  defaultValue={editingReservation?.endDate ? new Date(editingReservation.endDate).toISOString().split('T')[0] : ''}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button 
                type="button" 
                onClick={() => setShowReservationDialog(false)}
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                style={{ fontSize: '11px', height: '24px', padding: '4px 8px', minHeight: '24px', lineHeight: '1' }}
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                style={{ fontSize: '11px', height: '24px', padding: '4px 8px', minHeight: '24px', lineHeight: '1' }}
              >
                {editingReservation ? 'Update' : 'Create'} Reservation
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
