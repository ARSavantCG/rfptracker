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
      apiRequest(`/api/properties/${propertyId}/transformers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transformer),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/transformers`] });
      setShowTransformerDialog(false);
      setEditingTransformer(null);
      toast({ title: "Transformer created successfully" });
    },
  });

  const updateTransformerMutation = useMutation({
    mutationFn: async ({ id, ...transformer }: Transformer) =>
      apiRequest(`/api/transformers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transformer),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/transformers`] });
      setShowTransformerDialog(false);
      setEditingTransformer(null);
      toast({ title: "Transformer updated successfully" });
    },
  });

  const deleteTransformerMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/transformers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/transformers`] });
      toast({ title: "Transformer deleted successfully" });
    },
  });

  const createMainPanelMutation = useMutation({
    mutationFn: async (panel: Omit<MainPanel, 'id'>) =>
      apiRequest(`/api/properties/${propertyId}/main-panels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(panel),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/main-panels`] });
      setShowPanelDialog(false);
      setEditingPanel(null);
      toast({ title: "Main panel created successfully" });
    },
  });

  const updateMainPanelMutation = useMutation({
    mutationFn: async ({ id, ...panel }: MainPanel) =>
      apiRequest(`/api/main-panels/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(panel),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/main-panels`] });
      setShowPanelDialog(false);
      setEditingPanel(null);
      toast({ title: "Main panel updated successfully" });
    },
  });

  const deleteMainPanelMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/main-panels/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/main-panels`] });
      toast({ title: "Main panel deleted successfully" });
    },
  });

  const createBayAssignmentMutation = useMutation({
    mutationFn: async (assignment: Omit<BayPanelAssignment, 'id'>) =>
      apiRequest(`/api/properties/${propertyId}/bay-panel-assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assignment),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/bay-panel-assignments`] });
      setShowAssignmentDialog(false);
      setEditingAssignment(null);
      toast({ title: "Bay assignment created successfully" });
    },
  });

  const updateBayAssignmentMutation = useMutation({
    mutationFn: async ({ id, ...assignment }: BayPanelAssignment) =>
      apiRequest(`/api/bay-panel-assignments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assignment),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/bay-panel-assignments`] });
      setShowAssignmentDialog(false);
      setEditingAssignment(null);
      toast({ title: "Bay assignment updated successfully" });
    },
  });

  const deleteBayAssignmentMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/bay-panel-assignments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/bay-panel-assignments`] });
      toast({ title: "Bay assignment deleted successfully" });
    },
  });

  const createReservationMutation = useMutation({
    mutationFn: async (reservation: Omit<ElectricalReservation, 'id'>) =>
      apiRequest(`/api/properties/${propertyId}/electrical-reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reservation),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/electrical-reservations`] });
      setShowReservationDialog(false);
      setEditingReservation(null);
      toast({ title: "Electrical reservation created successfully" });
    },
  });

  const updateReservationMutation = useMutation({
    mutationFn: async ({ id, ...reservation }: ElectricalReservation) =>
      apiRequest(`/api/electrical-reservations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reservation),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/electrical-reservations`] });
      setShowReservationDialog(false);
      setEditingReservation(null);
      toast({ title: "Electrical reservation updated successfully" });
    },
  });

  const deleteReservationMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/electrical-reservations/${id}`, { method: 'DELETE' }),
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
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Zap className="h-4 w-4" />
            Electrical Capacity Management - {propertyName}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {/* Compact Stats Bar */}
          <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3 mb-3">
            <div className="flex items-center gap-6">
              <div className="text-center">
                <div className="text-lg font-bold text-blue-600">{capacityStats.total.toLocaleString()}</div>
                <div className="text-xs text-gray-600">Total Capacity (kVA)</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-green-600">{capacityStats.available.toLocaleString()}</div>
                <div className="text-xs text-gray-600">Available (kVA)</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-orange-600">{capacityStats.reserved.toLocaleString()}</div>
                <div className="text-xs text-gray-600">Reserved (kVA)</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-purple-600">{capacityStats.utilizationPercent.toFixed(1)}%</div>
                <div className="text-xs text-gray-600">Utilization</div>
              </div>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-5 h-8">
              <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
              <TabsTrigger value="transformers" className="text-xs">Transformers</TabsTrigger>
              <TabsTrigger value="panels" className="text-xs">Main Panels</TabsTrigger>
              <TabsTrigger value="assignments" className="text-xs">Bay Assignments</TabsTrigger>
              <TabsTrigger value="reservations" className="text-xs">Reservations</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-2 mt-3">
              {/* Compact Overview Grid */}
              <div className="grid grid-cols-2 gap-3">
                {/* Active Reservations - Compact */}
                <div className="border rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Building2 className="h-4 w-4 text-blue-500" />
                    <span className="font-medium text-sm">Active Reservations</span>
                  </div>
                  {reservations.filter((r: ElectricalReservation) => r.status === 'active').length === 0 ? (
                    <p className="text-xs text-gray-500">No active reservations</p>
                  ) : (
                    <div className="space-y-1">
                      {reservations
                        .filter((r: ElectricalReservation) => r.status === 'active')
                        .slice(0, 3)
                        .map((reservation: ElectricalReservation) => (
                          <div key={reservation.id} className="flex justify-between items-center py-1 text-xs">
                            <div>
                              <div className="font-medium">{reservation.reservedFor}</div>
                              <div className="text-gray-600">{reservation.reservedCapacity} kVA</div>
                            </div>
                            <Badge variant="secondary" className="text-xs py-0">{reservation.status}</Badge>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* Recent Activity - Compact */}
                <div className="border rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="h-4 w-4 text-green-500" />
                    <span className="font-medium text-sm">Recent Activity</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      <Activity className="h-3 w-3 text-blue-500" />
                      <span>System monitoring active</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Cable className="h-3 w-3 text-green-500" />
                      <span>All panels operational</span>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="transformers" className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Transformers</h3>
                <Button onClick={() => { setEditingTransformer(null); setShowTransformerDialog(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Transformer
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Capacity (kVA)</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Manufacturer</TableHead>
                    <TableHead>Installation Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transformers.map((transformer: Transformer) => (
                    <TableRow key={transformer.id}>
                      <TableCell className="font-medium">{transformer.name}</TableCell>
                      <TableCell>{transformer.capacity.toLocaleString()}</TableCell>
                      <TableCell>{transformer.location}</TableCell>
                      <TableCell>{transformer.manufacturer || 'N/A'}</TableCell>
                      <TableCell>{transformer.installationDate || 'N/A'}</TableCell>
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
            </TabsContent>

            <TabsContent value="panels" className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Main Panels</h3>
                <Button onClick={() => { setEditingPanel(null); setShowPanelDialog(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Main Panel
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Transformer</TableHead>
                    <TableHead>Capacity (kVA)</TableHead>
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
                        <TableCell>{panel.capacity.toLocaleString()}</TableCell>
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
            </TabsContent>

            <TabsContent value="assignments" className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Bay Panel Assignments & Reservations</h3>
                <div className="flex gap-2">
                  <Button onClick={() => { setEditingAssignment(null); setShowAssignmentDialog(true); }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Bay Assignment
                  </Button>
                  <Button onClick={() => { setEditingReservation(null); setShowReservationDialog(true); }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Reservation
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Bay Assignments</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Bay</TableHead>
                          <TableHead>Panel</TableHead>
                          <TableHead>Capacity</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bayAssignments.map((assignment: BayPanelAssignment) => {
                          const panel = mainPanels.find((p: MainPanel) => p.id === assignment.mainPanelId);
                          return (
                            <TableRow key={assignment.id}>
                              <TableCell>{assignment.bayConfiguration}</TableCell>
                              <TableCell>{panel?.name || 'Unknown'}</TableCell>
                              <TableCell>{assignment.capacity} kVA</TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => { setEditingAssignment(assignment); setShowAssignmentDialog(true); }}
                                  >
                                    <Edit className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => deleteBayAssignmentMutation.mutate(assignment.id)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Electrical Reservations</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Reserved For</TableHead>
                          <TableHead>Capacity</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reservations.map((reservation: ElectricalReservation) => (
                          <TableRow key={reservation.id}>
                            <TableCell>{reservation.reservedFor}</TableCell>
                            <TableCell>{reservation.reservedCapacity} kVA</TableCell>
                            <TableCell>
                              <Badge variant={reservation.status === 'active' ? 'default' : 'secondary'}>
                                {reservation.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => { setEditingReservation(reservation); setShowReservationDialog(true); }}
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => deleteReservationMutation.mutate(reservation.id)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="reservations" className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Electrical Reservations</h3>
                <Button onClick={() => { setEditingReservation(null); setShowReservationDialog(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create New Reservation
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reserved For</TableHead>
                    <TableHead>Bay Assignment</TableHead>
                    <TableHead>Capacity (kVA)</TableHead>
                    <TableHead>Start Date</TableHead>
                    <TableHead>End Date</TableHead>
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
                        <TableCell>{reservation.reservedCapacity.toLocaleString()}</TableCell>
                        <TableCell>{formatDate(reservation.startDate)}</TableCell>
                        <TableCell>{reservation.endDate ? formatDate(reservation.endDate) : 'Open-ended'}</TableCell>
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

              {reservations.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="mb-2">No electrical reservations yet</p>
                  <p className="text-sm">Start by adding transformers and main panels, then create bay assignments before making reservations.</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Transformer Dialog */}
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
                  placeholder="e.g., 1500"
                  required
                />
              </div>
              <div>
                <Label htmlFor="location">Location *</Label>
                <Input
                  name="location"
                  defaultValue={editingTransformer?.location || ''}
                  placeholder="e.g., North Electrical Room"
                  required
                />
              </div>
              <div>
                <Label htmlFor="manufacturer">Manufacturer</Label>
                <Input
                  name="manufacturer"
                  defaultValue={editingTransformer?.manufacturer || ''}
                  placeholder="e.g., General Electric"
                />
              </div>
              <div>
                <Label htmlFor="model">Model</Label>
                <Input
                  name="model"
                  defaultValue={editingTransformer?.model || ''}
                  placeholder="e.g., 9T23B3874G02"
                />
              </div>
              <div>
                <Label htmlFor="serialNumber">Serial Number</Label>
                <Input
                  name="serialNumber"
                  defaultValue={editingTransformer?.serialNumber || ''}
                  placeholder="e.g., ABC123456"
                />
              </div>
              <div>
                <Label htmlFor="installationDate">Installation Date</Label>
                <Input
                  name="installationDate"
                  type="date"
                  defaultValue={editingTransformer?.installationDate || ''}
                />
              </div>
              <div>
                <Label htmlFor="maintenanceSchedule">Maintenance Schedule</Label>
                <Input
                  name="maintenanceSchedule"
                  defaultValue={editingTransformer?.maintenanceSchedule || ''}
                  placeholder="e.g., Annual"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Input
                name="notes"
                defaultValue={editingTransformer?.notes || ''}
                placeholder="Additional notes..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowTransformerDialog(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingTransformer ? 'Update' : 'Create'} Transformer
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Main Panel Dialog */}
      <Dialog open={showPanelDialog} onOpenChange={setShowPanelDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingPanel ? 'Edit Main Panel' : 'Add New Main Panel'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleMainPanelSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="transformerId">Transformer *</Label>
                <Select name="transformerId" defaultValue={editingPanel?.transformerId?.toString()} required>
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
                <Label htmlFor="name">Panel Name *</Label>
                <Input
                  name="name"
                  defaultValue={editingPanel?.name || ''}
                  placeholder="e.g., Main Panel 1A"
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
                <Label htmlFor="location">Location *</Label>
                <Input
                  name="location"
                  defaultValue={editingPanel?.location || ''}
                  placeholder="e.g., Bay 1 Electrical Room"
                  required
                />
              </div>
              <div>
                <Label htmlFor="manufacturer">Manufacturer</Label>
                <Input
                  name="manufacturer"
                  defaultValue={editingPanel?.manufacturer || ''}
                  placeholder="e.g., Square D"
                />
              </div>
              <div>
                <Label htmlFor="model">Model</Label>
                <Input
                  name="model"
                  defaultValue={editingPanel?.model || ''}
                  placeholder="e.g., NF442L1C"
                />
              </div>
              <div>
                <Label htmlFor="serialNumber">Serial Number</Label>
                <Input
                  name="serialNumber"
                  defaultValue={editingPanel?.serialNumber || ''}
                  placeholder="e.g., XYZ789012"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Input
                name="notes"
                defaultValue={editingPanel?.notes || ''}
                placeholder="Additional notes..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowPanelDialog(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingPanel ? 'Update' : 'Create'} Main Panel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bay Assignment Dialog */}
      <Dialog open={showAssignmentDialog} onOpenChange={setShowAssignmentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingAssignment ? 'Edit Bay Assignment' : 'Add New Bay Assignment'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleBayAssignmentSubmit} className="space-y-4">
            <div>
              <Label htmlFor="mainPanelId">Main Panel *</Label>
              <Select name="mainPanelId" defaultValue={editingAssignment?.mainPanelId?.toString()} required>
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
              <Label htmlFor="capacity">Assigned Capacity (kVA) *</Label>
              <Input
                name="capacity"
                type="number"
                defaultValue={editingAssignment?.capacity || ''}
                placeholder="e.g., 200"
                required
              />
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Input
                name="notes"
                defaultValue={editingAssignment?.notes || ''}
                placeholder="Additional notes..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAssignmentDialog(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingAssignment ? 'Update' : 'Create'} Bay Assignment
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Electrical Reservation Dialog */}
      <Dialog open={showReservationDialog} onOpenChange={setShowReservationDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingReservation ? 'Edit Electrical Reservation' : 'Add New Electrical Reservation'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleReservationSubmit} className="space-y-4">
            <div>
              <Label htmlFor="bayPanelAssignmentId">Bay Panel Assignment *</Label>
              <Select name="bayPanelAssignmentId" defaultValue={editingReservation?.bayPanelAssignmentId?.toString()} required>
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
              <Label htmlFor="reservedFor">Reserved For *</Label>
              <Input
                name="reservedFor"
                defaultValue={editingReservation?.reservedFor || ''}
                placeholder="e.g., Tenant ABC Corp"
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="startDate">Start Date *</Label>
                <Input
                  name="startDate"
                  type="date"
                  defaultValue={editingReservation?.startDate || ''}
                  required
                />
              </div>
              <div>
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  name="endDate"
                  type="date"
                  defaultValue={editingReservation?.endDate || ''}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="status">Status *</Label>
              <Select name="status" defaultValue={editingReservation?.status || 'pending'} required>
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
              <Label htmlFor="notes">Notes</Label>
              <Input
                name="notes"
                defaultValue={editingReservation?.notes || ''}
                placeholder="Additional notes..."
              />
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
}