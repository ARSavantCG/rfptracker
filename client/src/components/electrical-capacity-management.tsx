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
import { Plus, Edit, Trash2, Zap, Cable, Building2, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";

interface Transformer {
  id: number;
  propertyId: number;
  name: string;
  capacity: number;
  location: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  installationDate?: string;
  maintenanceSchedule?: string;
  notes?: string;
}

interface MainPanel {
  id: number;
  propertyId: number;
  transformerId: number;
  name: string;
  capacity: number;
  location: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  notes?: string;
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
      apiRequest(`/api/main-panels/${id}`, 'PUT', panel),
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
    const totalTransformerCapacity = transformers.reduce((sum: number, t: Transformer) => sum + t.capacity, 0);
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
      name: formData.get('name') as string,
      capacity: parseFloat(formData.get('capacity') as string),
      location: formData.get('location') as string,
      manufacturer: formData.get('manufacturer') as string || undefined,
      model: formData.get('model') as string || undefined,
      serialNumber: formData.get('serialNumber') as string || undefined,
      installationDate: formData.get('installationDate') as string || undefined,
      maintenanceSchedule: formData.get('maintenanceSchedule') as string || undefined,
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
      propertyId,
      transformerId: parseInt(formData.get('transformerId') as string),
      name: formData.get('name') as string,
      capacity: parseFloat(formData.get('capacity') as string),
      location: formData.get('location') as string,
      manufacturer: formData.get('manufacturer') as string || undefined,
      model: formData.get('model') as string || undefined,
      serialNumber: formData.get('serialNumber') as string || undefined,
      notes: formData.get('notes') as string || undefined,
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Zap className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Electrical Capacity Management</h2>
            <p className="text-sm text-gray-600">{propertyName}</p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Capacity</p>
              <p className="text-2xl font-bold text-blue-600">{capacityStats.total.toLocaleString()}</p>
              <p className="text-xs text-gray-500">kVA</p>
            </div>
            <div className="p-2 bg-blue-100 rounded-lg">
              <Zap className="h-4 w-4 text-blue-600" />
            </div>
          </div>
        </Card>
        
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Available</p>
              <p className="text-2xl font-bold text-green-600">{capacityStats.available.toLocaleString()}</p>
              <p className="text-xs text-gray-500">kVA</p>
            </div>
            <div className="p-2 bg-green-100 rounded-lg">
              <Activity className="h-4 w-4 text-green-600" />
            </div>
          </div>
        </Card>
        
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Reserved</p>
              <p className="text-2xl font-bold text-orange-600">{capacityStats.reserved.toLocaleString()}</p>
              <p className="text-xs text-gray-500">kVA</p>
            </div>
            <div className="p-2 bg-orange-100 rounded-lg">
              <Building2 className="h-4 w-4 text-orange-600" />
            </div>
          </div>
        </Card>
        
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Utilization</p>
              <p className="text-2xl font-bold text-purple-600">{capacityStats.utilizationPercent.toFixed(1)}%</p>
              <p className="text-xs text-gray-500">capacity used</p>
            </div>
            <div className="p-2 bg-purple-100 rounded-lg">
              <Cable className="h-4 w-4 text-purple-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* Quick Actions */}
      {transformers.length === 0 ? (
        <Card className="p-6 text-center border-dashed border-2 border-gray-300">
          <Zap className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-semibold mb-2">Get Started with Electrical Management</h3>
          <p className="text-gray-600 mb-4">Add your first transformer to begin tracking electrical capacity</p>
          <Button 
            onClick={() => { setEditingTransformer(null); setShowTransformerDialog(true); }}
            className="!px-2 !py-1 !text-xs !h-6 !min-h-6 !leading-none !font-normal"
            style={{ fontSize: '11px', height: '24px', padding: '2px 8px' }}
          >
            <Plus className="h-3 w-3 mr-1" style={{ width: '10px', height: '10px' }} />
            <span style={{ fontSize: '10px' }}>Add Transformer</span>
          </Button>
        </Card>
      ) : (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Quick Actions</h3>
            <div className="flex gap-2">
              <Button 
                variant="outline"
                onClick={() => { setEditingTransformer(null); setShowTransformerDialog(true); }}
                className="!px-1 !py-0.5 !text-xs !h-5 !min-h-5 !leading-none"
                style={{ fontSize: '10px', height: '20px', padding: '1px 6px' }}
              >
                <Plus className="h-2 w-2 mr-0.5" style={{ width: '8px', height: '8px' }} />
                <span style={{ fontSize: '9px' }}>Transformer</span>
              </Button>
              <Button 
                variant="outline"
                onClick={() => { setEditingPanel(null); setShowPanelDialog(true); }}
                disabled={transformers.length === 0}
                className="!px-1 !py-0.5 !text-xs !h-5 !min-h-5 !leading-none"
                style={{ fontSize: '10px', height: '20px', padding: '1px 6px' }}
              >
                <Plus className="h-2 w-2 mr-0.5" style={{ width: '8px', height: '8px' }} />
                <span style={{ fontSize: '9px' }}>Panel</span>
              </Button>
              <Button 
                variant="outline"
                onClick={() => { setEditingAssignment(null); setShowAssignmentDialog(true); }}
                disabled={mainPanels.length === 0}
                className="!px-1 !py-0.5 !text-xs !h-5 !min-h-5 !leading-none"
                style={{ fontSize: '10px', height: '20px', padding: '1px 6px' }}
              >
                <Plus className="h-2 w-2 mr-0.5" style={{ width: '8px', height: '8px' }} />
                <span style={{ fontSize: '9px' }}>Bay</span>
              </Button>
              <Button 
                onClick={() => { setEditingReservation(null); setShowReservationDialog(true); }}
                disabled={bayAssignments.length === 0}
                className="!px-1 !py-0.5 !text-xs !h-5 !min-h-5 !leading-none"
                style={{ fontSize: '10px', height: '20px', padding: '1px 6px' }}
              >
                <Plus className="h-2 w-2 mr-0.5" style={{ width: '8px', height: '8px' }} />
                <span style={{ fontSize: '9px' }}>Reserve</span>
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Management Sections */}
      <Card>
        <CardContent className="p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="transformers">Transformers</TabsTrigger>
              <TabsTrigger value="panels">Panels</TabsTrigger>
              <TabsTrigger value="reservations">Reservations</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6">
              <div className="grid grid-cols-2 gap-6">
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
            </TabsContent>

            <TabsContent value="transformers" className="mt-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Transformers</h3>
                <Button onClick={() => { setEditingTransformer(null); setShowTransformerDialog(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Transformer
                </Button>
              </div>

              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Capacity</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Manufacturer</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transformers.map((transformer: Transformer) => (
                      <TableRow key={transformer.id}>
                        <TableCell className="font-medium">{transformer.name}</TableCell>
                        <TableCell>{transformer.capacity.toLocaleString()} kVA</TableCell>
                        <TableCell>{transformer.location}</TableCell>
                        <TableCell>{transformer.manufacturer || 'N/A'}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setEditingTransformer(transformer); setShowTransformerDialog(true); }}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => deleteTransformerMutation.mutate(transformer.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
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
            </TabsContent>

            <TabsContent value="panels" className="mt-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Main Panels</h3>
                <Button 
                  onClick={() => { setEditingPanel(null); setShowPanelDialog(true); }}
                  disabled={transformers.length === 0}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Main Panel
                </Button>
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
                          <TableCell className="font-medium">{panel.name}</TableCell>
                          <TableCell>{transformer?.name || 'Unknown'}</TableCell>
                          <TableCell>{panel.capacity.toLocaleString()} kVA</TableCell>
                          <TableCell>{panel.location}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setEditingPanel(panel); setShowPanelDialog(true); }}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => deleteMainPanelMutation.mutate(panel.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
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
            </TabsContent>

            <TabsContent value="reservations" className="mt-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Electrical Reservations</h3>
                <Button 
                  onClick={() => { setEditingReservation(null); setShowReservationDialog(true); }}
                  disabled={bayAssignments.length === 0}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Reservation
                </Button>
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
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setEditingReservation(reservation); setShowReservationDialog(true); }}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => deleteReservationMutation.mutate(reservation.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
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
            </TabsContent>
          </Tabs>
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
                  defaultValue={editingTransformer?.name || ''}
                  placeholder="e.g., Main Transformer A"
                  required
                />
              </div>
              <div>
                <Label htmlFor="capacity">Capacity (kVA) *</Label>
                <Input
                  name="capacity"
                  type="number"
                  defaultValue={editingTransformer?.capacity || ''}
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
                <Label htmlFor="manufacturer">Manufacturer</Label>
                <Input
                  name="manufacturer"
                  defaultValue={editingTransformer?.manufacturer || ''}
                  placeholder="e.g., ABB"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowTransformerDialog(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingTransformer ? 'Update' : 'Add'} Transformer
              </Button>
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
                  defaultValue={editingPanel?.name || ''}
                  placeholder="e.g., Main Panel A"
                  required
                />
              </div>
              <div>
                <Label htmlFor="capacity">Capacity (kVA) *</Label>
                <Input
                  name="capacity"
                  type="number"
                  defaultValue={editingPanel?.capacity || ''}
                  placeholder="e.g., 800"
                  required
                />
              </div>
              <div>
                <Label htmlFor="transformerId">Transformer *</Label>
                <Select name="transformerId" defaultValue={editingPanel?.transformerId?.toString()}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select transformer" />
                  </SelectTrigger>
                  <SelectContent>
                    {transformers.map((transformer: Transformer) => (
                      <SelectItem key={transformer.id} value={transformer.id.toString()}>
                        {transformer.name} ({transformer.capacity} kVA)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="location">Location *</Label>
                <Input
                  name="location"
                  defaultValue={editingPanel?.location || ''}
                  placeholder="e.g., Electrical Room North"
                  required
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowPanelDialog(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingPanel ? 'Update' : 'Add'} Main Panel
              </Button>
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
                <Select name="mainPanelId" defaultValue={editingAssignment?.mainPanelId?.toString()}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select main panel" />
                  </SelectTrigger>
                  <SelectContent>
                    {mainPanels.map((panel: MainPanel) => (
                      <SelectItem key={panel.id} value={panel.id.toString()}>
                        {panel.name} ({panel.capacity} kVA)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAssignmentDialog(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingAssignment ? 'Update' : 'Add'} Bay Assignment
              </Button>
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
              <Button type="button" variant="outline" onClick={() => setShowReservationDialog(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingReservation ? 'Update' : 'Create'} Reservation
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
