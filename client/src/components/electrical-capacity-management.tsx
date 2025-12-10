import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// Removed Select import - using native HTML selects for consistency
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, Zap, Cable, Building2, Activity, ChevronDown, Save, Users, AlertTriangle, CheckCircle } from "lucide-react";
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
  capacityAmps?: number; // Direct AMPS entry for panels
  voltage?: string; // Voltage configuration: "480", "208"
  panelLocation?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Voltage options for panel configuration (3-phase only)
const VOLTAGE_OPTIONS = [
  { value: "480", label: "480V (3-Phase)", multiplier: 480 * Math.sqrt(3) },
  { value: "208", label: "208/120V (3-Phase)", multiplier: 208 * Math.sqrt(3) },
] as const;

// Get voltage multiplier for 3-phase systems
const getVoltageMultiplier = (voltage: string = "480"): number => {
  const option = VOLTAGE_OPTIONS.find(v => v.value === voltage);
  return option ? option.multiplier : 480 * Math.sqrt(3);
};

// Helper function to convert kVA to AMPS based on voltage
const kvaToAmps = (kva: number, voltage: string = "480"): number => {
  const multiplier = getVoltageMultiplier(voltage);
  return Math.round((kva * 1000) / multiplier);
};

// Helper function to convert AMPS to kVA based on voltage - round to integer for database storage
const ampsToKva = (amps: number, voltage: string = "480"): number => {
  const multiplier = getVoltageMultiplier(voltage);
  return Math.round((amps * multiplier) / 1000);
};

// Get panel capacity in AMPS - prefer stored value, fallback to conversion using voltage
const getPanelAmps = (panel: MainPanel): number => panel.capacityAmps || kvaToAmps(panel.maxCapacityKva, panel.voltage || "480");

// Get voltage display label
const getVoltageLabel = (voltage: string = "480"): string => {
  const option = VOLTAGE_OPTIONS.find(v => v.value === voltage);
  return option ? option.label : "480V (3-Phase)";
};

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

// Active RFP electrical allocation
interface ActiveRfpAllocation {
  rfpId: number;
  rfpNumber: string;
  tenantName: string;
  status: string;
  allocations: Array<{ kva: number; voltage: string; amps: number }>;
  totalKva: number;
}

interface ElectricalCapacityManagementProps {
  propertyId: number;
  propertyName: string;
  property?: {
    id: number;
    electricalAllocation?: number | null;
    electricalAllocationIncrement?: number | null;
  };
}

export function ElectricalCapacityManagement({ propertyId, propertyName, property: initialProperty }: ElectricalCapacityManagementProps) {
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

  // Fetch active RFP electrical allocations for this property
  const { data: activeRfpAllocations = [] } = useQuery<ActiveRfpAllocation[]>({
    queryKey: [`/api/properties/${propertyId}/active-electrical-allocations`],
  });

  const { data: propertyData, refetch: refetchProperty } = useQuery({
    queryKey: [`/api/properties/${propertyId}`],
  });
  
  // State for tenant allocation settings - use propertyData from query
  const propData = propertyData as { electricalAllocation?: number | null; electricalAllocationIncrement?: number | null } | undefined;
  const [tenantAllocation, setTenantAllocation] = useState<number>(propData?.electricalAllocation || initialProperty?.electricalAllocation || 0);
  const [allocationIncrement, setAllocationIncrement] = useState<number>(propData?.electricalAllocationIncrement || initialProperty?.electricalAllocationIncrement || 200);
  
  // Update state when property data changes
  useEffect(() => {
    if (propData) {
      setTenantAllocation(propData.electricalAllocation || 0);
      setAllocationIncrement(propData.electricalAllocationIncrement || 200);
    }
  }, [propData]);
  
  // Mutation to update property tenant allocation settings
  const updateTenantAllocationMutation = useMutation({
    mutationFn: async (data: { electricalAllocation: number; electricalAllocationIncrement: number }) =>
      apiRequest(`/api/properties/${propertyId}/electrical-allocation`, 'PATCH', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/properties'] });
      refetchProperty();
      toast({ title: "Tenant allocation settings saved", duration: 3000 });
    },
    onError: () => {
      toast({ title: "Failed to save settings", variant: "destructive", duration: 3000 });
    },
  });

  // Mutations for CRUD operations
  const createTransformerMutation = useMutation({
    mutationFn: async (transformer: Omit<Transformer, 'id'>) => 
      apiRequest(`/api/properties/${propertyId}/transformers`, 'POST', transformer),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/transformers`] });
      setShowTransformerDialog(false);
      setEditingTransformer(null);
      toast({ title: "Transformer created successfully", duration: 4000 });
    },
  });

  const updateTransformerMutation = useMutation({
    mutationFn: async ({ id, ...transformer }: Transformer) =>
      apiRequest(`/api/transformers/${id}`, 'PUT', transformer),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/transformers`] });
      setShowTransformerDialog(false);
      setEditingTransformer(null);
      toast({ title: "Transformer updated successfully", duration: 4000 });
    },
  });

  const deleteTransformerMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/transformers/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/transformers`] });
      toast({ title: "Transformer deleted successfully", duration: 4000 });
    },
  });

  const createMainPanelMutation = useMutation({
    mutationFn: async (panel: Omit<MainPanel, 'id'>) =>
      apiRequest(`/api/properties/${propertyId}/main-panels`, 'POST', panel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/main-panels`] });
      setShowPanelDialog(false);
      setEditingPanel(null);
      toast({ title: "Main panel created successfully", duration: 4000 });
    },
  });

  const updateMainPanelMutation = useMutation({
    mutationFn: async ({ id, ...panel }: MainPanel) =>
      apiRequest(`/api/main-panels/${id}`, 'PATCH', panel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/main-panels`] });
      setShowPanelDialog(false);
      setEditingPanel(null);
      toast({ title: "Main panel updated successfully", duration: 4000 });
    },
  });

  const deleteMainPanelMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/main-panels/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/main-panels`] });
      toast({ title: "Main panel deleted successfully", duration: 4000 });
    },
  });

  const createBayAssignmentMutation = useMutation({
    mutationFn: async (assignment: Omit<BayPanelAssignment, 'id'>) =>
      apiRequest(`/api/properties/${propertyId}/bay-panel-assignments`, 'POST', assignment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/bay-panel-assignments`] });
      setShowAssignmentDialog(false);
      setEditingAssignment(null);
      toast({ title: "Bay assignment created successfully", duration: 4000 });
    },
  });

  const updateBayAssignmentMutation = useMutation({
    mutationFn: async ({ id, ...assignment }: BayPanelAssignment) =>
      apiRequest(`/api/bay-panel-assignments/${id}`, 'PUT', assignment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/bay-panel-assignments`] });
      setShowAssignmentDialog(false);
      setEditingAssignment(null);
      toast({ title: "Bay assignment updated successfully", duration: 4000 });
    },
  });

  const deleteBayAssignmentMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/bay-panel-assignments/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/bay-panel-assignments`] });
      toast({ title: "Bay assignment deleted successfully", duration: 4000 });
    },
  });

  const createReservationMutation = useMutation({
    mutationFn: async (reservation: Omit<ElectricalReservation, 'id'>) =>
      apiRequest(`/api/properties/${propertyId}/electrical-reservations`, 'POST', reservation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/electrical-reservations`] });
      setShowReservationDialog(false);
      setEditingReservation(null);
      toast({ title: "Electrical reservation created successfully", duration: 4000 });
    },
  });

  const updateReservationMutation = useMutation({
    mutationFn: async ({ id, ...reservation }: ElectricalReservation) =>
      apiRequest(`/api/electrical-reservations/${id}`, 'PUT', reservation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/electrical-reservations`] });
      setShowReservationDialog(false);
      setEditingReservation(null);
      toast({ title: "Electrical reservation updated successfully", duration: 4000 });
    },
  });

  const deleteReservationMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/electrical-reservations/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/electrical-reservations`] });
      toast({ title: "Electrical reservation deleted successfully", duration: 4000 });
    },
  });

  // Calculate capacity utilization based on panel allocation
  const calculateCapacityUtilization = () => {
    const totalTransformerCapacity = transformers.reduce((sum: number, t: Transformer) => sum + t.totalCapacityKva, 0);
    
    // Calculate total panel capacity in kVA (this is what's allocated from transformers)
    const totalPanelCapacityKva = mainPanels.reduce((sum: number, p: MainPanel) => sum + p.maxCapacityKva, 0);
    
    // Calculate total AMPS in service for display
    const totalPanelAmps = mainPanels.reduce((sum: number, p: MainPanel) => sum + getPanelAmps(p), 0);
    
    // Reserved is what's allocated to panels (subtract from transformer capacity)
    const availableCapacity = Math.max(0, totalTransformerCapacity - totalPanelCapacityKva);
    
    return {
      total: totalTransformerCapacity,
      allocated: totalPanelCapacityKva,
      allocatedAmps: totalPanelAmps,
      available: availableCapacity,
      utilizationPercent: totalTransformerCapacity > 0 ? (totalPanelCapacityKva / totalTransformerCapacity) * 100 : 0
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
    const capacityAmps = parseInt(formData.get('capacityAmps') as string);
    const transformerId = parseInt(formData.get('transformerId') as string);
    const voltage = formData.get('voltage') as string || "480";
    
    // Check for overallocation - calculate total panel capacity for this transformer
    const selectedTransformer = transformers.find((t: Transformer) => t.id === transformerId);
    if (selectedTransformer) {
      // Get all existing panels for this transformer (excluding the one being edited)
      const existingPanelsKva = mainPanels
        .filter((p: MainPanel) => p.transformerId === transformerId && (!editingPanel || p.id !== editingPanel.id))
        .reduce((sum: number, p: MainPanel) => sum + p.maxCapacityKva, 0);
      
      const newPanelKva = ampsToKva(capacityAmps, voltage);
      const newTotalKva = existingPanelsKva + newPanelKva;
      const transformerCapacityKva = selectedTransformer.totalCapacityKva;
      
      if (newTotalKva > transformerCapacityKva) {
        const overageKva = newTotalKva - transformerCapacityKva;
        const overageAmps = kvaToAmps(overageKva, voltage);
        const proceed = window.confirm(
          `⚠️ OVERALLOCATION WARNING\n\n` +
          `This will exceed the transformer capacity!\n\n` +
          `Transformer: ${selectedTransformer.transformerName} (${transformerCapacityKva} kVA)\n` +
          `Current panels: ${existingPanelsKva.toFixed(1)} kVA\n` +
          `New panel: ${newPanelKva.toFixed(1)} kVA @ ${voltage}V\n` +
          `Total: ${newTotalKva.toFixed(1)} kVA\n` +
          `Over by: ${overageKva.toFixed(1)} kVA (~${overageAmps} AMPS)\n\n` +
          `A transformer upgrade may be required.\n\n` +
          `Do you want to proceed anyway?`
        );
        if (!proceed) {
          return;
        }
      }
    }
    
    const panel = {
      transformerId: transformerId,
      panelName: formData.get('name') as string,
      maxCapacityKva: ampsToKva(capacityAmps, voltage), // Convert AMPS to kVA using selected voltage
      capacityAmps: capacityAmps, // Store AMPS directly
      voltage: voltage, // Store the voltage configuration
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
              <p className="text-xs font-medium text-gray-600">Allocated</p>
              <p className="text-lg font-bold text-orange-600">{capacityStats.allocatedAmps.toLocaleString()}</p>
              <p className="text-xs text-gray-500">AMPS ({capacityStats.allocated.toLocaleString()} kVA)</p>
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

      {/* Tenant Allocation Pool - kVA-centric with dual-voltage AMPS display */}
      {(() => {
        // Calculate available kVA and convert to AMPS at both voltages
        const availableKva = capacityStats.available;
        const availableAmps480 = kvaToAmps(availableKva, "480");
        const availableAmps208 = kvaToAmps(availableKva, "208");
        
        // Pool is stored in kVA - convert current allocation from AMPS to kVA for comparison
        const poolKva = ampsToKva(tenantAllocation, "480"); // Legacy: stored as AMPS @ 480V
        const poolAmps480 = kvaToAmps(poolKva, "480");
        const poolAmps208 = kvaToAmps(poolKva, "208");
        
        const minimumKva = 50; // ~60 AMPS @ 480V or ~139 AMPS @ 208V
        const isAtCapacity = availableKva <= 0;
        const isLowCapacity = availableKva > 0 && availableKva < minimumKva;
        const hasCapacity = availableKva >= minimumKva;
        const isOverAllocated = poolKva > availableKva && availableKva > 0;
        
        return (
          <Card className={`border-2 ${isAtCapacity ? 'border-red-300 bg-red-50/30' : isLowCapacity ? 'border-orange-300 bg-orange-50/30' : 'border-cyan-200 bg-cyan-50/30'}`}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-md ${isAtCapacity ? 'bg-red-100' : isLowCapacity ? 'bg-orange-100' : 'bg-cyan-100'}`}>
                    {isAtCapacity ? <AlertTriangle className="h-4 w-4 text-red-600" /> : 
                     isLowCapacity ? <AlertTriangle className="h-4 w-4 text-orange-600" /> :
                     <Users className="h-4 w-4 text-cyan-600" />}
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Tenant Allocation Pool</h3>
                    <p className="text-xs text-gray-500">Available capacity for tenant electrical services</p>
                  </div>
                </div>
                {isAtCapacity && (
                  <Badge variant="destructive" className="text-xs">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    At Capacity
                  </Badge>
                )}
                {isLowCapacity && (
                  <Badge className="text-xs bg-orange-500">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Low Capacity
                  </Badge>
                )}
                {hasCapacity && (
                  <Badge className="text-xs bg-green-500">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Available
                  </Badge>
                )}
              </div>
              
              {/* Available Capacity - kVA with dual-voltage AMPS breakdown */}
              <div className={`mt-3 p-3 rounded-lg border ${isAtCapacity ? 'bg-red-50 border-red-200' : isLowCapacity ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <Zap className={`h-5 w-5 mt-0.5 ${isAtCapacity ? 'text-red-600' : isLowCapacity ? 'text-orange-600' : 'text-green-600'}`} />
                    <div>
                      <p className={`text-xs font-medium ${isAtCapacity ? 'text-red-700' : isLowCapacity ? 'text-orange-700' : 'text-green-700'}`}>
                        Available for Tenants
                      </p>
                      <p className={`text-xl font-bold ${isAtCapacity ? 'text-red-600' : isLowCapacity ? 'text-orange-600' : 'text-green-600'}`}>
                        {availableKva.toLocaleString()} kVA
                      </p>
                      {/* Dual-voltage AMPS breakdown */}
                      <div className="mt-1 flex gap-3">
                        <div className={`text-xs px-2 py-1 rounded ${isAtCapacity ? 'bg-red-100' : isLowCapacity ? 'bg-orange-100' : 'bg-green-100'}`}>
                          <span className="font-semibold">{availableAmps480.toLocaleString()}</span>
                          <span className="text-gray-600"> AMPS @ 480V</span>
                        </div>
                        <div className={`text-xs px-2 py-1 rounded ${isAtCapacity ? 'bg-red-100' : isLowCapacity ? 'bg-orange-100' : 'bg-green-100'}`}>
                          <span className="font-semibold">{availableAmps208.toLocaleString()}</span>
                          <span className="text-gray-600"> AMPS @ 208V</span>
                        </div>
                      </div>
                      <p className={`text-xs mt-1 ${isAtCapacity ? 'text-red-500' : isLowCapacity ? 'text-orange-500' : 'text-green-500'}`}>
                        Remaining transformer capacity after house panels
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTenantAllocation(availableAmps480)} // Set to equivalent AMPS @ 480V
                    className={`${isAtCapacity ? 'border-red-300 text-red-600 hover:bg-red-100' : isLowCapacity ? 'border-orange-300 text-orange-600 hover:bg-orange-100' : 'border-green-300 text-green-600 hover:bg-green-100'}`}
                    disabled={availableKva <= 0}
                    data-testid="button-use-available-capacity"
                  >
                    <Zap className="h-3 w-3 mr-1" />
                    Use Available
                  </Button>
                </div>
              </div>
              
              {/* Warning Messages */}
              {isAtCapacity && (
                <div className="mt-2 p-2 bg-red-100 border border-red-300 rounded-lg">
                  <p className="text-xs text-red-700 font-medium flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    No capacity available for tenant allocation. Consider adding transformers or reducing panel allocations.
                  </p>
                </div>
              )}
              {isLowCapacity && (
                <div className="mt-2 p-2 bg-orange-100 border border-orange-300 rounded-lg">
                  <p className="text-xs text-orange-700 font-medium flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Available capacity ({availableKva} kVA) is below minimum threshold. May need infrastructure upgrade.
                  </p>
                </div>
              )}
              
              {/* Pool Settings with dual-voltage display */}
              <div className="mt-3 p-3 bg-gray-50 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Cable className="h-4 w-4 text-cyan-600" />
                  <span className="text-sm font-medium">Tenant Pool Settings</span>
                </div>
                <div className="grid grid-cols-3 gap-4 items-end">
                  <div>
                    <Label htmlFor="totalAllocation" className="text-xs font-medium">Pool Size (AMPS @ 480V)</Label>
                    <Input
                      id="totalAllocation"
                      type="number"
                      min="0"
                      step="100"
                      value={tenantAllocation}
                      onChange={(e) => setTenantAllocation(parseInt(e.target.value) || 0)}
                      className={`mt-1 ${isOverAllocated ? 'border-orange-400 bg-orange-50' : ''}`}
                      data-testid="input-total-electrical-allocation"
                    />
                    {/* Show equivalent at 208V */}
                    <p className="text-xs text-gray-500 mt-1">
                      = {poolAmps208.toLocaleString()} AMPS @ 208V ({poolKva.toLocaleString()} kVA)
                    </p>
                    {isOverAllocated && (
                      <p className="text-xs text-orange-600 font-medium mt-1">
                        ⚠️ Exceeds available by {(poolKva - availableKva).toLocaleString()} kVA
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="allocationIncrement" className="text-xs font-medium">Rounding Increment (AMPS)</Label>
                    <Input
                      id="allocationIncrement"
                      type="number"
                      min="50"
                      step="50"
                      value={allocationIncrement}
                      onChange={(e) => setAllocationIncrement(parseInt(e.target.value) || 200)}
                      className="mt-1"
                      data-testid="input-allocation-increment"
                    />
                    <p className="text-xs text-gray-500 mt-1">Minimum allocation per tenant</p>
                  </div>
                  <div>
                    <Button
                      onClick={() => updateTenantAllocationMutation.mutate({ 
                        electricalAllocation: tenantAllocation, 
                        electricalAllocationIncrement: allocationIncrement 
                      })}
                      disabled={updateTenantAllocationMutation.isPending}
                      className="bg-cyan-600 hover:bg-cyan-700"
                      data-testid="button-save-allocation"
                    >
                      <Save className="h-4 w-4 mr-1" />
                      {updateTenantAllocationMutation.isPending ? "Saving..." : "Save Settings"}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

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
              <div className="mt-3 space-y-4">
                {/* Active RFP Allocations - Real-time tracking */}
                <div className="p-3 border-2 border-blue-200 rounded-lg bg-blue-50/30">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Zap className="h-5 w-5 text-blue-600" />
                      <h3 className="font-semibold">Active RFP Allocations</h3>
                    </div>
                    {activeRfpAllocations.length > 0 && (
                      <Badge className="bg-blue-500">
                        {activeRfpAllocations.reduce((sum, a) => sum + a.totalKva, 0).toLocaleString()} kVA allocated
                      </Badge>
                    )}
                  </div>
                  
                  {activeRfpAllocations.length === 0 ? (
                    <div className="text-center py-4 text-gray-500">
                      <p className="text-sm">No active RFP electrical allocations</p>
                      <p className="text-xs mt-1">Allocations from in-progress RFPs will appear here</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {activeRfpAllocations.map((rfp) => (
                        <div key={rfp.rfpId} className="p-2 bg-white border rounded-lg">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium text-sm">{rfp.tenantName}</p>
                              <p className="text-xs text-gray-500">{rfp.rfpNumber}</p>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {rfp.status}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {rfp.allocations.map((alloc, idx) => (
                              <div key={idx} className="text-xs px-2 py-1 bg-blue-100 rounded">
                                <span className="font-semibold">{alloc.kva}</span> kVA @ {alloc.voltage}V
                                <span className="text-gray-500 ml-1">({alloc.amps} A)</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Manual Reservations */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Building2 className="h-4 w-4 text-gray-600" />
                      <h3 className="font-medium text-sm">Manual Reservations</h3>
                    </div>
                    {reservations.filter((r: ElectricalReservation) => r.status === 'active').length === 0 ? (
                      <div className="text-center py-4 text-gray-400 border rounded-lg">
                        <p className="text-xs">No manual reservations</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {reservations
                          .filter((r: ElectricalReservation) => r.status === 'active')
                          .map((reservation: ElectricalReservation) => (
                            <div key={reservation.id} className="p-2 border rounded-lg">
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="font-medium text-sm">{reservation.reservedFor}</p>
                                  <p className="text-xs text-gray-500">{reservation.reservedCapacity.toLocaleString()} kVA</p>
                                </div>
                                <Badge variant="secondary" className="text-xs">{reservation.status}</Badge>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* System Status */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Activity className="h-4 w-4 text-green-600" />
                      <h3 className="font-medium text-sm">System Status</h3>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg text-sm">
                        <span>Transformers</span>
                        <span className="font-semibold">{transformers.length}</span>
                      </div>
                      <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg text-sm">
                        <span>Main Panels</span>
                        <span className="font-semibold">{mainPanels.length}</span>
                      </div>
                      <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg text-sm">
                        <span>Active RFP Allocations</span>
                        <span className="font-semibold">{activeRfpAllocations.length}</span>
                      </div>
                      <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg text-sm">
                        <span>Manual Reservations</span>
                        <span className="font-semibold">{reservations.filter((r: ElectricalReservation) => r.status === 'active').length}</span>
                      </div>
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
                      <TableHead>Voltage</TableHead>
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
                          <TableCell>{panel.voltage || '480'}V</TableCell>
                          <TableCell>{getPanelAmps(panel).toLocaleString()} AMPS</TableCell>
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
                  onKeyDown={(e) => {
                    if (e.key === 'Tab' && !e.shiftKey) {
                      e.preventDefault();
                      const capacityInput = document.querySelector('input[name="capacity"]') as HTMLInputElement;
                      if (capacityInput) {
                        capacityInput.focus();
                        capacityInput.select();
                      }
                    }
                  }}
                  required
                />
              </div>
              <div>
                <Label htmlFor="capacity">Capacity (kVA) *</Label>
                <Input
                  name="capacity"
                  onKeyDown={(e) => {
                    if (e.key === 'Tab' && !e.shiftKey) {
                      e.preventDefault();
                      const fplInput = document.querySelector('input[name="fplDesignationNo"]') as HTMLInputElement;
                      if (fplInput) {
                        fplInput.focus();
                        fplInput.select();
                      }
                    } else if (e.key === 'Tab' && e.shiftKey) {
                      e.preventDefault();
                      const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement;
                      if (nameInput) {
                        nameInput.focus();
                        nameInput.select();
                      }
                    }
                  }}
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
                  defaultValue={editingTransformer?.transformerLocation || ''}
                  placeholder="e.g., Main Electrical Room"
                  onKeyDown={(e) => {
                    if (e.key === 'Tab' && !e.shiftKey) {
                      e.preventDefault();
                      const fplInput = document.querySelector('input[name="manufacturer"]') as HTMLInputElement;
                      if (fplInput) {
                        fplInput.focus();
                        fplInput.select();
                      }
                    } else if (e.key === 'Tab' && e.shiftKey) {
                      e.preventDefault();
                      const capacityInput = document.querySelector('input[name="capacity"]') as HTMLInputElement;
                      if (capacityInput) {
                        capacityInput.focus();
                        capacityInput.select();
                      }
                    }
                  }}
                  required
                />
              </div>
              <div>
                <Label htmlFor="manufacturer">FPL Designation No.</Label>
                <Input
                  name="manufacturer"
                  defaultValue={editingTransformer?.fplId || ''}
                  placeholder="e.g., FPL-TR-001"
                  onKeyDown={(e) => {
                    if (e.key === 'Tab' && e.shiftKey) {
                      e.preventDefault();
                      const locationInput = document.querySelector('input[name="location"]') as HTMLInputElement;
                      if (locationInput) {
                        locationInput.focus();
                        locationInput.select();
                      }
                    }
                  }}
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
                <Label htmlFor="capacityAmps">Capacity (AMPS) *</Label>
                <Input
                  name="capacityAmps"
                  type="number"
                  min="0"
                  defaultValue={editingPanel?.capacityAmps || (editingPanel?.maxCapacityKva ? kvaToAmps(editingPanel.maxCapacityKva) : '')}
                  placeholder="e.g., 200, 400, 600, 800"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Recommended: 200 AMP increments</p>
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
                <Label htmlFor="voltage">Voltage *</Label>
                <div className="relative">
                  <select
                    name="voltage"
                    defaultValue={editingPanel?.voltage || '480'}
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-8"
                  >
                    {VOLTAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-3 h-4 w-4 opacity-50 pointer-events-none" />
                </div>
                <p className="text-xs text-gray-500 mt-1">Higher voltage = lower amperage for same kVA</p>
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
                        {panel.panelName} ({getPanelAmps(panel)} AMPS)
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
                <div className="relative">
                  <select
                    name="bayPanelAssignmentId"
                    defaultValue={editingReservation?.bayPanelAssignmentId?.toString() || ''}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white pr-8"
                    required
                  >
                    <option value="">Select bay assignment</option>
                    {bayAssignments.map((assignment: BayPanelAssignment) => (
                      <option key={assignment.id} value={assignment.id.toString()}>
                        {assignment.bayConfiguration} ({assignment.capacity} kVA)
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div>
                <Label htmlFor="status">Status *</Label>
                <div className="relative">
                  <select
                    name="status"
                    defaultValue={editingReservation?.status || 'pending'}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white pr-8"
                    required
                  >
                    <option value="pending">Pending</option>
                    <option value="active">Active</option>
                    <option value="expired">Expired</option>
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                </div>
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
