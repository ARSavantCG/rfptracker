import React, { useState, useEffect, useMemo } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Edit, Settings, Copy, ChevronDown, ChevronRight, Compass, Navigation, Printer, DoorOpen, Building2, GripVertical, Users } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { FormulaInput } from './formula-input';
import type { Property, BayConfiguration } from "@shared/schema";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";

interface BayConfigurationManagerProps {
  property: Property;
}

export default function BayConfigurationManager({ property }: BayConfigurationManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Check if user has properties delete permissions
  const canDeleteBays = user?.permissions?.includes('properties.delete') || false;
  const [isOpen, setIsOpen] = useState(false);
  // Fetch fresh property data to ensure bay configurations are up-to-date
  const { data: freshProperty } = useQuery<Property>({
    queryKey: [`/api/properties/${property.id}`],
    enabled: !!property.id,
    staleTime: 0,
    refetchOnMount: true,
  });

  const [bayConfigurations, setBayConfigurations] = useState<BayConfiguration[]>(
    freshProperty?.bayConfigurations || property.bayConfigurations || []
  );

  // Update bay configurations when fresh data arrives
  useEffect(() => {
    if (freshProperty?.bayConfigurations) {
      setBayConfigurations(freshProperty.bayConfigurations);
    }
  }, [freshProperty?.bayConfigurations]);
  const [mechanicalRoomSF, setMechanicalRoomSF] = useState<string>(
    property.mechanicalRoomSquareFootage?.toString() || "0"
  );
  const [newBay, setNewBay] = useState({ 
    startBay: "", 
    endBay: "", 
    squareFootage: "", 
    standardDockDoors: "", 
    oversizedDockDoors: "", 
    hasStorefrontEntry: false, 
    hasSpeculativeOffice: false, 
    hasRestroom: false,
    canBeSplit: false,
    splitNorthSquareFootage: "",
    splitSouthSquareFootage: "",
    splitNorthDockDoors: "",
    splitSouthDockDoors: "",
    splitNorthOversizedDoors: "",
    splitSouthOversizedDoors: ""
  });
  const [editingBay, setEditingBay] = useState<BayConfiguration | null>(null);
  const [showBayDetails, setShowBayDetails] = useState(false);


  // Sort bay configurations numerically by start bay number
  const sortedBayConfigurations = useMemo(() => {
    return [...bayConfigurations].sort((a, b) => {
      const matchA = a.bayName.match(/Bay (\d+)-(\d+)/);
      const matchB = b.bayName.match(/Bay (\d+)-(\d+)/);
      if (!matchA || !matchB) return 0;
      return parseInt(matchA[1]) - parseInt(matchB[1]);
    });
  }, [bayConfigurations]);
  const [isEditingMechRoom, setIsEditingMechRoom] = useState(false);
  const [tempMechRoomSF, setTempMechRoomSF] = useState("");
  const [showAddBayForm, setShowAddBayForm] = useState(false);
  
  // Directional orientation state
  const [firstBayDirection, setFirstBayDirection] = useState<string>(property.firstBayDirection || "");
  const [bayProgressionDirection, setBayProgressionDirection] = useState<string>(property.bayProgressionDirection || "");

  const handlePrint = async () => {
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const response = await fetch(`/api/properties/${property.id}/bay-configurations/print`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Print failed');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      console.error('Bay configurations print error:', error);
      toast({
        title: "Print Error",
        description: "Failed to generate bay configurations report",
        variant: "destructive",
        duration: 6000,
      });
    }
  };

  // Auto-populate start bay when bay configurations change
  useEffect(() => {
    if (!editingBay) {
      const nextStart = getNextStartingBay();
      setNewBay(prev => ({ 
        ...prev, 
        startBay: nextStart.toString(),
        endBay: (nextStart + 1).toString()
      }));
    }
  }, [bayConfigurations, editingBay]);

  // Calculate mechanical room allocation and rentable square footage for all bays
  const calculateBayAllocations = (bays: BayConfiguration[], mechanicalSF: number): BayConfiguration[] => {
    const totalFloorArea = bays.reduce((sum, bay) => sum + bay.squareFootage, 0);
    
    return bays.map(bay => {
      const allocationPercentage = totalFloorArea > 0 ? bay.squareFootage / totalFloorArea : 0;
      const mechanicalRoomAllocation = Math.round(mechanicalSF * allocationPercentage);
      const rentableSquareFootage = Math.round(bay.squareFootage + mechanicalRoomAllocation);
      
      return {
        ...bay,
        mechanicalRoomAllocation,
        rentableSquareFootage
      };
    });
  };

  const updatePropertyMutation = useMutation({
    mutationFn: async (data: { 
      bayConfigurations: BayConfiguration[], 
      mechanicalRoomSquareFootage: number,
      firstBayDirection?: string,
      bayProgressionDirection?: string 
    }) => {
      const response = await fetch(`/api/properties/${property.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}`,
        },
        credentials: 'include',
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        throw new Error('Failed to update bay configurations');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      toast({
        title: "Success",
        description: "Bay configurations updated successfully",
        duration: 4000,
      });
      // Don't close the dialog - let users continue editing other bays
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update bay configurations",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  // Calculate the next starting bay number

  const renumberBaysSequentially = async () => {
    // Renumber all bays to be sequential (1-2, 2-3, 3-4, etc.)
    const renumberedBays = sortedBayConfigurations.map((bay, index) => {
      const startBay = index + 1;
      const endBay = startBay + 1;
      return {
        ...bay,
        bayName: `Bay ${startBay}-${endBay}`
      };
    });

    const mechanicalSF = parseFloat(mechanicalRoomSF) || 0;
    const updatedBays = calculateBayAllocations(renumberedBays, mechanicalSF);
    
    updatePropertyMutation.mutate({
      bayConfigurations: updatedBays,
      mechanicalRoomSquareFootage: mechanicalSF,
      firstBayDirection: firstBayDirection || undefined,
      bayProgressionDirection: bayProgressionDirection || undefined
    });
    
    toast({
      title: "Success",
      description: "Bays have been renumbered sequentially",
      duration: 4000,
    });
  };

  const getNextStartingBay = (): number => {
    if (bayConfigurations.length === 0) return 1;
    
    // Sort bay configurations numerically by start bay number
    const sortedBays = [...bayConfigurations].sort((a, b) => {
      const matchA = a.bayName.match(/Bay (\d+)-(\d+)/);
      const matchB = b.bayName.match(/Bay (\d+)-(\d+)/);
      if (!matchA || !matchB) return 0;
      return parseInt(matchA[1]) - parseInt(matchB[1]);
    });
    
    // Find the last bay in sequence and calculate next starting bay
    const lastBay = sortedBays[sortedBays.length - 1];
    const match = lastBay.bayName.match(/Bay (\d+)-(\d+)/);
    if (match) {
      const endBay = parseInt(match[2]);
      return endBay; // Next bay starts at the end of the last bay
    }
    
    return 1;
  };

  const saveBayConfigurations = () => {
    const mechanicalSF = parseFloat(mechanicalRoomSF) || 0;
    const updatedBays = calculateBayAllocations(bayConfigurations, mechanicalSF);
    
    updatePropertyMutation.mutate({
      bayConfigurations: updatedBays,
      mechanicalRoomSquareFootage: mechanicalSF,
      firstBayDirection: firstBayDirection || undefined,
      bayProgressionDirection: bayProgressionDirection || undefined
    });
  };

  const addBayConfiguration = () => {
    if (!newBay.startBay || !newBay.endBay || !newBay.squareFootage) {
      toast({
        title: "Error",
        description: "Please fill in start bay, end bay, and square footage",
        variant: "destructive",
        duration: 6000,
      });
      return;
    }

    const startBayNum = parseInt(newBay.startBay);
    const endBayNum = parseInt(newBay.endBay);

    if (endBayNum <= startBayNum) {
      toast({
        title: "Error",
        description: "End bay must be greater than start bay",
        variant: "destructive",
      });
      return;
    }

    const newBayConfig: BayConfiguration = {
      id: Date.now().toString(),
      bayName: `Bay ${startBayNum}-${endBayNum}`,
      squareFootage: parseFloat(newBay.squareFootage) || 0,
      standardDockDoors: parseInt(newBay.standardDockDoors) || 0,
      oversizedDockDoors: parseInt(newBay.oversizedDockDoors) || 0,
      hasStorefrontEntry: newBay.hasStorefrontEntry,
      hasSpeculativeOffice: newBay.hasSpeculativeOffice,
      hasRestroom: newBay.hasRestroom,
      canBeSplit: newBay.canBeSplit,
      splitNorthDockDoors: newBay.canBeSplit ? (parseInt(newBay.splitNorthDockDoors) || 0) : undefined,
      splitSouthDockDoors: newBay.canBeSplit ? (parseInt(newBay.splitSouthDockDoors) || 0) : undefined,
      splitNorthOversizedDoors: newBay.canBeSplit ? (parseInt(newBay.splitNorthOversizedDoors) || 0) : undefined,
      splitSouthOversizedDoors: newBay.canBeSplit ? (parseInt(newBay.splitSouthOversizedDoors) || 0) : undefined
    };

    setBayConfigurations([...bayConfigurations, newBayConfig]);
    
    // Reset form with next starting bay number
    const nextStart = getNextStartingBay();
    setNewBay({ 
      startBay: nextStart.toString(), 
      endBay: (nextStart + 1).toString(), 
      squareFootage: "",
      standardDockDoors: "",
      oversizedDockDoors: "",
      hasStorefrontEntry: false,
      hasSpeculativeOffice: false,
      hasRestroom: false,
      canBeSplit: false,
      splitNorthSquareFootage: "",
      splitSouthSquareFootage: "",
      splitNorthDockDoors: "",
      splitSouthDockDoors: "",
      splitNorthOversizedDoors: "",
      splitSouthOversizedDoors: "",
      splitNorthStorefront: false,
      splitSouthStorefront: false,
      splitNorthOffice: false,
      splitSouthOffice: false,
      splitNorthRestroom: false,
      splitSouthRestroom: false
    });
  };

  // Calculate total square footage and dock doors
  const totalSquareFootage = bayConfigurations.reduce((total, bay) => total + bay.squareFootage, 0);
  const totalStandardDoors = bayConfigurations.reduce((total, bay) => total + (bay.standardDockDoors || 0), 0);
  const totalOversizedDoors = bayConfigurations.reduce((total, bay) => total + (bay.oversizedDockDoors || 0), 0);



  const removeBayConfiguration = (bayId: string) => {
    setBayConfigurations(bayConfigurations.filter(bay => bay.id !== bayId));
  };

  const copyBayConfiguration = (bay: BayConfiguration) => {
    // Get the next sequential bay number (not based on the copied bay)
    const nextStartBay = getNextStartingBay();
    const nextEndBay = nextStartBay + 1;
    
    // Create a new bay configuration with the next sequential numbering
    const newBayConfig: BayConfiguration = {
      id: `bay-${Date.now()}`,
      bayName: `Bay ${nextStartBay}-${nextEndBay}`,
      squareFootage: bay.squareFootage,
      standardDockDoors: bay.standardDockDoors,
      oversizedDockDoors: bay.oversizedDockDoors
    };

    const updatedBayConfigurations = [...bayConfigurations, newBayConfig];
    setBayConfigurations(updatedBayConfigurations);
    
    // Calculate the next start bay based on the updated list
    const newNextStart = nextEndBay; // The end of what we just added becomes the start of the next
    setNewBay({
      startBay: newNextStart.toString(),
      endBay: (newNextStart + 1).toString(),
      squareFootage: "",
      standardDockDoors: "",
      oversizedDockDoors: "",
      hasStorefrontEntry: false,
      hasSpeculativeOffice: false,
      hasRestroom: false,
      canBeSplit: false,
      splitNorthSquareFootage: "",
      splitSouthSquareFootage: "",
      splitNorthDockDoors: "",
      splitSouthDockDoors: "",
      splitNorthOversizedDoors: "",
      splitSouthOversizedDoors: "",
      splitNorthStorefront: false,
      splitSouthStorefront: false,
      splitNorthOffice: false,
      splitSouthOffice: false,
      splitNorthRestroom: false,
      splitSouthRestroom: false
    });

    toast({
      title: "Bay Copied",
      description: `${newBayConfig.bayName} created with copied properties.`,
    });
  };

  const editBayConfiguration = (bay: BayConfiguration) => {
    const match = bay.bayName.match(/Bay (\d+)-(\d+)/);
    const startBay = match ? match[1] : "";
    const endBay = match ? match[2] : "";
    
    setEditingBay(bay);
    setNewBay({
      startBay,
      endBay,
      squareFootage: bay.squareFootage.toString(),
      standardDockDoors: bay.standardDockDoors?.toString() || "0",
      oversizedDockDoors: bay.oversizedDockDoors?.toString() || "0",
      hasStorefrontEntry: bay.hasStorefrontEntry || false,
      hasSpeculativeOffice: bay.hasSpeculativeOffice || false,
      hasRestroom: bay.hasRestroom || false,
      canBeSplit: bay.canBeSplit || false,
      splitNorthSquareFootage: bay.canBeSplit ? Math.floor(bay.squareFootage / 2).toString() : "",
      splitSouthSquareFootage: bay.canBeSplit ? Math.ceil(bay.squareFootage / 2).toString() : "",
      splitNorthDockDoors: bay.splitNorthDockDoors?.toString() || "",
      splitSouthDockDoors: bay.splitSouthDockDoors?.toString() || "",
      splitNorthOversizedDoors: bay.splitNorthOversizedDoors?.toString() || "",
      splitSouthOversizedDoors: bay.splitSouthOversizedDoors?.toString() || "",
      splitNorthStorefront: bay.splitNorthStorefront || false,
      splitSouthStorefront: bay.splitSouthStorefront || false,
      splitNorthOffice: bay.splitNorthOffice || false,
      splitSouthOffice: bay.splitSouthOffice || false,
      splitNorthRestroom: bay.splitNorthRestroom || false,
      splitSouthRestroom: bay.splitSouthRestroom || false
    });
  };

  const saveEditedBay = () => {
    if (!editingBay || !newBay.startBay || !newBay.endBay || !newBay.squareFootage) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    const startBayNum = parseInt(newBay.startBay);
    const endBayNum = parseInt(newBay.endBay);

    if (endBayNum <= startBayNum) {
      toast({
        title: "Error",
        description: "End bay must be greater than start bay",
        variant: "destructive",
      });
      return;
    }

    const updatedBay: BayConfiguration = {
      ...editingBay,
      bayName: `Bay ${startBayNum}-${endBayNum}`,
      squareFootage: parseFloat(newBay.squareFootage) || 0,
      standardDockDoors: parseInt(newBay.standardDockDoors) || 0,
      oversizedDockDoors: parseInt(newBay.oversizedDockDoors) || 0,
      hasStorefrontEntry: newBay.hasStorefrontEntry,
      hasSpeculativeOffice: newBay.hasSpeculativeOffice,
      hasRestroom: newBay.hasRestroom,
      canBeSplit: newBay.canBeSplit,
      splitNorthDockDoors: newBay.canBeSplit ? (parseInt(newBay.splitNorthDockDoors) || 0) : undefined,
      splitSouthDockDoors: newBay.canBeSplit ? (parseInt(newBay.splitSouthDockDoors) || 0) : undefined,
      splitNorthOversizedDoors: newBay.canBeSplit ? (parseInt(newBay.splitNorthOversizedDoors) || 0) : undefined,
      splitSouthOversizedDoors: newBay.canBeSplit ? (parseInt(newBay.splitSouthOversizedDoors) || 0) : undefined,
      splitNorthStorefront: newBay.canBeSplit ? newBay.splitNorthStorefront : undefined,
      splitSouthStorefront: newBay.canBeSplit ? newBay.splitSouthStorefront : undefined,
      splitNorthOffice: newBay.canBeSplit ? newBay.splitNorthOffice : undefined,
      splitSouthOffice: newBay.canBeSplit ? newBay.splitSouthOffice : undefined,
      splitNorthRestroom: newBay.canBeSplit ? newBay.splitNorthRestroom : undefined,
      splitSouthRestroom: newBay.canBeSplit ? newBay.splitSouthRestroom : undefined
    };

    const updatedConfigurations = bayConfigurations.map(bay => 
      bay.id === editingBay.id ? updatedBay : bay
    );
    
    setBayConfigurations(updatedConfigurations);

    // Save to database
    const mechanicalSF = parseFloat(mechanicalRoomSF) || 0;
    const updatedBays = calculateBayAllocations(updatedConfigurations, mechanicalSF);
    
    updatePropertyMutation.mutate({
      bayConfigurations: updatedBays,
      mechanicalRoomSquareFootage: mechanicalSF,
      firstBayDirection: firstBayDirection || undefined,
      bayProgressionDirection: bayProgressionDirection || undefined
    });

    // Reset form
    setEditingBay(null);
    const nextStart = getNextStartingBay();
    setNewBay({ 
      startBay: nextStart.toString(), 
      endBay: "", 
      squareFootage: "",
      standardDockDoors: "",
      oversizedDockDoors: "",
      hasStorefrontEntry: false,
      hasSpeculativeOffice: false,
      hasRestroom: false,
      canBeSplit: false,
      splitNorthSquareFootage: "",
      splitSouthSquareFootage: "",
      splitNorthDockDoors: "",
      splitSouthDockDoors: "",
      splitNorthOversizedDoors: "",
      splitSouthOversizedDoors: "",
      splitNorthStorefront: false,
      splitSouthStorefront: false,
      splitNorthOffice: false,
      splitSouthOffice: false,
      splitNorthRestroom: false,
      splitSouthRestroom: false
    });
  };

  const cancelEdit = () => {
    setEditingBay(null);
    const nextStart = getNextStartingBay();
    setNewBay({ 
      startBay: nextStart.toString(), 
      endBay: "", 
      squareFootage: "",
      standardDockDoors: "",
      oversizedDockDoors: "",
      hasStorefrontEntry: false,
      hasSpeculativeOffice: false,
      hasRestroom: false,
      canBeSplit: false,
      splitNorthSquareFootage: "",
      splitSouthSquareFootage: "",
      splitNorthDockDoors: "",
      splitSouthDockDoors: "",
      splitNorthOversizedDoors: "",
      splitSouthOversizedDoors: "",
      splitNorthStorefront: false,
      splitSouthStorefront: false,
      splitNorthOffice: false,
      splitSouthOffice: false,
      splitNorthRestroom: false,
      splitSouthRestroom: false
    });
  };

  const startEditingMechRoom = () => {
    setIsEditingMechRoom(true);
    setTempMechRoomSF(mechanicalRoomSF);
  };

  const saveMechanicalRoom = async () => {
    const mechRoomValue = parseFloat(tempMechRoomSF) || 0;
    
    try {
      const response = await fetch(`/api/properties/${property.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          bayConfigurations,
          mechanicalRoomSquareFootage: mechRoomValue
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to update mechanical room square footage');
      }
      
      setMechanicalRoomSF(mechRoomValue.toString());
      setIsEditingMechRoom(false);
      setTempMechRoomSF("");
      
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({
        title: "Success",
        description: "Mechanical room square footage updated successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update mechanical room square footage",
        variant: "destructive",
      });
    }
  };

  const cancelMechRoomEdit = () => {
    setIsEditingMechRoom(false);
    setTempMechRoomSF("");
  };



  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex items-center gap-1 text-xs px-2 py-1 h-6">
          <Settings className="h-3 w-3" />
          Manage Bay Configurations
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[900px] max-h-[80vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between pr-12">
          <DialogTitle>Bay Configurations - {property.propertyName}</DialogTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="flex items-center gap-1 mr-2 mt-1"
          >
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </DialogHeader>

        <div className="space-y-6">
          {/* Property Summary */}
          {bayConfigurations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Property Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-6">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {totalSquareFootage.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} SF
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Bay Configurations</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {(parseFloat(mechanicalRoomSF) || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} SF
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Mechanical Rooms</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                      {(totalSquareFootage + (parseFloat(mechanicalRoomSF) || 0)).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} SF
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Total</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {/* Add New Bay Configuration */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Add Bay Configuration</CardTitle>
                <Button 
                  onClick={() => setShowAddBayForm(!showAddBayForm)} 
                  variant="outline" 
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  {showAddBayForm ? "Hide Form" : "Add New Bay"}
                </Button>
              </div>
            </CardHeader>
            {showAddBayForm && (
              <CardContent className="space-y-4">
                {/* Building Orientation Guide */}
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Building Orientation Guide</Label>
                      <p className="text-xs text-gray-500">Configure directional bay numbering system</p>
                    </div>
                    
                    {/* Dynamic Compass Rose Indicator */}
                    <div className="bg-white border border-gray-300 rounded-lg p-4 shadow-sm">
                      <div className="relative w-24 h-24">
                        {/* Outer compass ring */}
                        <div className="absolute inset-0 border-2 border-gray-800 rounded-full"></div>
                        <div className="absolute inset-1 border border-gray-600 rounded-full"></div>
                        
                        {/* Compass Rose Star Pattern */}
                        <svg className="absolute inset-2 w-20 h-20" viewBox="0 0 80 80">
                          {/* Main star points (N, S, E, W) */}
                          <path d="M40 5 L42 35 L40 40 L38 35 Z" fill="#374151" stroke="#1f2937" strokeWidth="0.5"/>
                          <path d="M75 40 L45 42 L40 40 L45 38 Z" fill="#374151" stroke="#1f2937" strokeWidth="0.5"/>
                          <path d="M40 75 L38 45 L40 40 L42 45 Z" fill="#374151" stroke="#1f2937" strokeWidth="0.5"/>
                          <path d="M5 40 L35 38 L40 40 L35 42 Z" fill="#374151" stroke="#1f2937" strokeWidth="0.5"/>
                          
                          {/* Smaller diagonal points (NE, SE, SW, NW) */}
                          <path d="M40 40 L60 20 L62 22 L40 40 Z" fill="#6b7280" stroke="#374151" strokeWidth="0.5"/>
                          <path d="M40 40 L60 60 L58 62 L40 40 Z" fill="#6b7280" stroke="#374151" strokeWidth="0.5"/>
                          <path d="M40 40 L20 60 L18 58 L40 40 Z" fill="#6b7280" stroke="#374151" strokeWidth="0.5"/>
                          <path d="M40 40 L20 20 L22 18 L40 40 Z" fill="#6b7280" stroke="#374151" strokeWidth="0.5"/>
                          
                          {/* Center circle */}
                          <circle cx="40" cy="40" r="3" fill="#374151" stroke="#1f2937" strokeWidth="1"/>
                        </svg>
                        
                        {/* Direction labels - positioned well outside the circle */}
                        <div className={`absolute -top-6 left-1/2 transform -translate-x-1/2 text-lg font-bold ${
                          firstBayDirection === 'north' ? 'text-red-600' : 'text-gray-800'
                        }`}>N</div>
                        <div className={`absolute top-1/2 -right-6 transform -translate-y-1/2 text-lg font-bold ${
                          firstBayDirection === 'east' ? 'text-red-600' : 'text-gray-800'
                        }`}>E</div>
                        <div className={`absolute -bottom-6 left-1/2 transform -translate-x-1/2 text-lg font-bold ${
                          firstBayDirection === 'south' ? 'text-red-600' : 'text-gray-800'
                        }`}>S</div>
                        <div className={`absolute top-1/2 -left-6 transform -translate-y-1/2 text-lg font-bold ${
                          firstBayDirection === 'west' ? 'text-red-600' : 'text-gray-800'
                        }`}>W</div>
                        
                        {/* Diagonal direction labels */}
                        <div className={`absolute top-1 right-1 text-sm font-medium ${
                          firstBayDirection === 'northeast' ? 'text-red-600' : 'text-gray-600'
                        }`}>NE</div>
                        <div className={`absolute bottom-1 right-1 text-sm font-medium ${
                          firstBayDirection === 'southeast' ? 'text-red-600' : 'text-gray-600'
                        }`}>SE</div>
                        <div className={`absolute bottom-1 left-1 text-sm font-medium ${
                          firstBayDirection === 'southwest' ? 'text-red-600' : 'text-gray-600'
                        }`}>SW</div>
                        <div className={`absolute top-1 left-1 text-sm font-medium ${
                          firstBayDirection === 'northwest' ? 'text-red-600' : 'text-gray-600'
                        }`}>NW</div>
                      </div>
                    </div>
                  </div>

                  {/* Directional Configuration */}
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-gray-700">Direction of Bay 1</Label>
                      <select 
                        value={firstBayDirection} 
                        onChange={(e) => setFirstBayDirection(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">Select direction</option>
                        <option value="north">North</option>
                        <option value="northeast">Northeast</option>
                        <option value="east">East</option>
                        <option value="southeast">Southeast</option>
                        <option value="south">South</option>
                        <option value="southwest">Southwest</option>
                        <option value="west">West</option>
                        <option value="northwest">Northwest</option>
                      </select>
                      <p className="text-xs text-gray-500">Which direction does the front door of the first bay face?</p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-gray-700">Bay Progression Direction</Label>
                      <select 
                        value={bayProgressionDirection} 
                        onChange={(e) => setBayProgressionDirection(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">Select direction</option>
                        <option value="north">North</option>
                        <option value="east">East</option>
                        <option value="south">South</option>
                        <option value="west">West</option>
                      </select>
                      <p className="text-xs text-gray-500">Which direction do bay numbers increase? (Bay 1 → Bay 2 → Bay 3)</p>
                    </div>
                  </div>

                  {/* Dynamic Directional Layout Guide */}
                  <div className="bg-blue-50 p-3 rounded-lg">
                    <h4 className="font-medium text-sm text-blue-900 mb-2">Bay Numbering Guide</h4>
                    {firstBayDirection && bayProgressionDirection ? (
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center gap-2 text-blue-800">
                          <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                          <span><strong>Bay 1</strong> faces <strong>{firstBayDirection.toUpperCase()}</strong></span>
                        </div>
                        <div className="flex items-center gap-2 text-blue-800">
                          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                          <span>Subsequent bays progress towards the <strong>{bayProgressionDirection.toUpperCase()}</strong></span>
                        </div>
                        <div className="text-blue-600 italic">
                          Example: Bay 1 → Bay 2 → Bay 3 (going {bayProgressionDirection})
                        </div>
                      </div>
                    ) : (
                      <div className="text-orange-600 text-xs">
                        ⚠️ Please set both bay direction and progression direction above to enable proper bay numbering
                      </div>
                    )}
                  </div>

                  {/* Visual Bay Example */}
                  {bayConfigurations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <div className="text-xs text-gray-600 mb-2">Current Bay Layout:</div>
                      <div className="flex gap-1 overflow-x-auto">
                        {bayConfigurations.slice(0, 8).map((bay, index) => (
                          <div key={bay.id} className="bg-blue-100 border border-blue-200 rounded px-2 py-1 text-xs text-blue-800 flex-shrink-0">
                            {bay.bayName.replace('Bay ', '')}
                          </div>
                        ))}
                        {bayConfigurations.length > 8 && (
                          <div className="text-xs text-gray-400 px-2 py-1">+{bayConfigurations.length - 8} more</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

              <div className="grid grid-cols-5 gap-4 items-end">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Start Column</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="1"
                    value={newBay.startBay}
                    onChange={(e) => setNewBay({ ...newBay, startBay: e.target.value })}
                    className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">End Column</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="2"
                    value={newBay.endBay}
                    onChange={(e) => setNewBay({ ...newBay, endBay: e.target.value })}
                    className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="squareFootage" className="text-sm font-medium">Square Footage</Label>
                  <Input
                    id="squareFootage"
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*\.?[0-9]*"
                    value={newBay.squareFootage}
                    onChange={(e) => setNewBay({ ...newBay, squareFootage: e.target.value })}
                    className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    placeholder="e.g. 10534.5"
                  />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="standardDockDoors" className="text-sm font-medium">Standard Doors</Label>
                    <Input
                      id="standardDockDoors"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={newBay.standardDockDoors}
                      onChange={(e) => setNewBay({ ...newBay, standardDockDoors: e.target.value })}
                      className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="oversizedDockDoors" className="text-sm font-medium">Oversized Doors</Label>
                    <Input
                      id="oversizedDockDoors"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={newBay.oversizedDockDoors}
                      onChange={(e) => setNewBay({ ...newBay, oversizedDockDoors: e.target.value })}
                      className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="hasStorefrontEntry"
                      checked={newBay.hasStorefrontEntry}
                      onCheckedChange={(checked) => setNewBay({ ...newBay, hasStorefrontEntry: checked as boolean })}
                    />
                    <Label htmlFor="hasStorefrontEntry" className="text-sm font-medium flex items-center gap-1">
                      <DoorOpen className="h-4 w-4" />
                      Storefront Entry
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="hasSpeculativeOffice"
                      checked={newBay.hasSpeculativeOffice}
                      onCheckedChange={(checked) => setNewBay({ ...newBay, hasSpeculativeOffice: checked as boolean })}
                    />
                    <Label htmlFor="hasSpeculativeOffice" className="text-sm font-medium flex items-center gap-1">
                      <Building2 className="h-4 w-4" />
                      Speculative Office
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="hasRestroom"
                      checked={newBay.hasRestroom}
                      onCheckedChange={(checked) => setNewBay({ ...newBay, hasRestroom: checked as boolean })}
                    />
                    <Label htmlFor="hasRestroom" className="text-sm font-medium flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      Restroom
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="canBeSplit"
                      checked={newBay.canBeSplit}
                      onCheckedChange={(checked) => setNewBay({ ...newBay, canBeSplit: checked as boolean })}
                    />
                    <Label htmlFor="canBeSplit" className="text-sm font-medium flex items-center gap-1">
                      <GripVertical className="h-4 w-4" />
                      Can be split into North/South
                    </Label>
                  </div>
                </div>

                {/* Split Bay Configuration - only show when canBeSplit is checked */}
                {newBay.canBeSplit && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-4">
                    <h4 className="font-medium text-blue-900 text-sm flex items-center gap-2">
                      <GripVertical className="h-4 w-4" />
                      Split Bay Configuration
                    </h4>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <h5 className="font-medium text-sm text-blue-800">North Half</h5>
                        <div className="space-y-2">
                          <div className="space-y-1">
                            <Label className="text-xs font-medium">Square Footage</Label>
                            <FormulaInput
                              value={newBay.splitNorthSquareFootage}
                              onChange={(value, evaluatedValue) => {
                                const totalBayArea = parseFloat(newBay.squareFootage) || 0;
                                
                                // Use evaluated value if available, otherwise parse the raw value
                                const northNum = evaluatedValue !== undefined ? evaluatedValue : (parseFloat(String(value)) || 0);
                                const southNum = totalBayArea - northNum;
                                
                                setNewBay({ 
                                  ...newBay, 
                                  splitNorthSquareFootage: String(value),
                                  splitSouthSquareFootage: southNum > 0 ? southNum.toString() : ""
                                });
                              }}
                              className="text-sm"
                              placeholder="e.g. 20000 or =35247*0.6"
                              type="quantity"
                              decimalPlaces={0}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Standard Doors</Label>
                              <Input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={newBay.splitNorthDockDoors}
                                onChange={(e) => setNewBay({ ...newBay, splitNorthDockDoors: e.target.value })}
                                className="text-sm"
                                placeholder="0"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Oversized Doors</Label>
                              <Input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={newBay.splitNorthOversizedDoors}
                                onChange={(e) => setNewBay({ ...newBay, splitNorthOversizedDoors: e.target.value })}
                                className="text-sm"
                                placeholder="0"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <h5 className="font-medium text-sm text-green-800">South Half</h5>
                        <div className="space-y-2">
                          <div className="space-y-1">
                            <Label className="text-xs font-medium">Square Footage</Label>
                            <FormulaInput
                              value={newBay.splitSouthSquareFootage}
                              onChange={(value, evaluatedValue) => {
                                const totalBayArea = parseFloat(newBay.squareFootage) || 0;
                                
                                // Use evaluated value if available, otherwise parse the raw value
                                const southNum = evaluatedValue !== undefined ? evaluatedValue : (parseFloat(String(value)) || 0);
                                const northNum = totalBayArea - southNum;
                                
                                setNewBay({ 
                                  ...newBay, 
                                  splitSouthSquareFootage: String(value),
                                  splitNorthSquareFootage: northNum > 0 ? northNum.toString() : ""
                                });
                              }}
                              className="text-sm"
                              placeholder="e.g. 15247 or =35247*0.4"
                              type="quantity"
                              decimalPlaces={0}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Standard Doors</Label>
                              <Input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={newBay.splitSouthDockDoors}
                                onChange={(e) => setNewBay({ ...newBay, splitSouthDockDoors: e.target.value })}
                                className="text-sm"
                                placeholder="0"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Oversized Doors</Label>
                              <Input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={newBay.splitSouthOversizedDoors}
                                onChange={(e) => setNewBay({ ...newBay, splitSouthOversizedDoors: e.target.value })}
                                className="text-sm"
                                placeholder="0"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="text-xs text-blue-600 bg-blue-100 p-2 rounded">
                      {(() => {
                        // Helper function to evaluate formulas
                        const evaluateValue = (value: string) => {
                          if (!value) return 0;
                          if (value.startsWith('=')) {
                            try {
                              const formula = value.slice(1);
                              const result = Function('"use strict"; return (' + formula + ')')();
                              return !isNaN(result) ? Math.round(result) : parseInt(value) || 0;
                            } catch (e) {
                              return parseInt(value) || 0;
                            }
                          }
                          return parseInt(value) || 0;
                        };

                        const northValue = evaluateValue(newBay.splitNorthSquareFootage);
                        const southValue = evaluateValue(newBay.splitSouthSquareFootage);
                        const totalBayArea = parseFloat(newBay.squareFootage) || 0;

                        return (
                          <>
                            💡 When split: North {northValue.toLocaleString()} SF, South {southValue.toLocaleString()} SF
                            {northValue + southValue !== totalBayArea && 
                              <div className="text-orange-600 mt-1">⚠️ Total split area ({(northValue + southValue).toLocaleString()} SF) doesn't match bay total ({totalBayArea.toLocaleString()} SF)</div>
                            }
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={addBayConfiguration} className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    Add
                  </Button>
                </div>
              </div>
              </CardContent>
            )}
          </Card>

          {/* Current Bay Configurations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Current Bay Configurations</CardTitle>
            </CardHeader>
            <CardContent>
              {bayConfigurations.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No bay configurations defined</p>
                  <p className="text-sm">Add bay configurations above to enable automatic rentable area calculation in RFPs</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Clickable Count Summary */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setShowBayDetails(!showBayDetails)}
                        className="flex items-center gap-2 text-blue-600 hover:text-blue-700 transition-colors"
                      >
                        {showBayDetails ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <span className="font-medium">{bayConfigurations.length} configured</span>
                      </button>
                      {bayConfigurations.length > 1 && (
                        <Button
                          onClick={renumberBaysSequentially}
                          variant="outline"
                          size="sm"
                          className="text-blue-600 hover:text-blue-700"
                        >
                          <Navigation className="h-4 w-4 mr-1" />
                          Renumber Sequentially
                        </Button>
                      )}
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
                      <div>Total: {totalSquareFootage.toLocaleString()} SF</div>
                      <div className="flex gap-4">
                        <span>Standard Doors: {totalStandardDoors}</span>
                        <span>Oversized Doors: {totalOversizedDoors}</span>
                      </div>
                    </div>
                  </div>

                  {/* Expandable Bay Details */}
                  {showBayDetails && (
                    <div className="space-y-4">
                      {/* Table Header */}
                      <div className="grid grid-cols-8 gap-4 pb-2 border-b font-medium text-sm text-gray-600">
                        <div>Start Column</div>
                        <div>End Column</div>
                        <div>Bay</div>
                        <div className="text-right">Floor Area</div>
                        <div className="text-right">Mech Room</div>
                        <div className="text-right">Rentable SF</div>
                        <div className="text-center">Dock Doors</div>
                        <div className="text-center">Actions</div>
                      </div>

                      {/* Bay Rows */}
                      {sortedBayConfigurations.map((bay) => {
                        const match = bay.bayName.match(/Bay (\d+)-(\d+)/);
                        const startBay = match ? match[1] : '';
                        const endBay = match ? match[2] : '';
                        
                        const isEditing = editingBay?.id === bay.id;
                        
                        if (isEditing) {
                          // Inline edit form
                          return (
                            <div key={bay.id} className="bg-blue-50 border border-blue-200 rounded-md p-4 space-y-4">
                              <div className="text-sm font-medium text-blue-700 mb-3">
                                🔧 Editing {bay.bayName}
                              </div>
                              <div className="grid grid-cols-5 gap-4 items-end">
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium">Start Column</Label>
                                  <Input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={newBay.startBay}
                                    onChange={(e) => setNewBay({ ...newBay, startBay: e.target.value })}
                                    className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium">End Column</Label>
                                  <Input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={newBay.endBay}
                                    onChange={(e) => setNewBay({ ...newBay, endBay: e.target.value })}
                                    className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="squareFootage" className="text-sm font-medium">Square Footage</Label>
                                  <Input
                                    id="squareFootage"
                                    type="text"
                                    inputMode="decimal"
                                    pattern="[0-9]*\.?[0-9]*"
                                    value={newBay.squareFootage}
                                    onChange={(e) => setNewBay({ ...newBay, squareFootage: e.target.value })}
                                    className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    placeholder="e.g. 10534.5"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="standardDoors" className="text-sm font-medium">Standard Doors</Label>
                                  <Input
                                    id="standardDoors"
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={newBay.standardDockDoors}
                                    onChange={(e) => setNewBay({ ...newBay, standardDockDoors: e.target.value })}
                                    className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="oversizedDoors" className="text-sm font-medium">Oversized Doors</Label>
                                  <Input
                                    id="oversizedDoors"
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={newBay.oversizedDockDoors}
                                    onChange={(e) => setNewBay({ ...newBay, oversizedDockDoors: e.target.value })}
                                    className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                </div>
                              </div>
                              <div className="space-y-3 mt-4">
                                <div className="flex items-center space-x-2">
                                  <Checkbox 
                                    id="editHasStorefrontEntry"
                                    checked={newBay.hasStorefrontEntry}
                                    onCheckedChange={(checked) => setNewBay({ ...newBay, hasStorefrontEntry: checked as boolean })}
                                  />
                                  <Label htmlFor="editHasStorefrontEntry" className="text-sm font-medium flex items-center gap-1">
                                    <DoorOpen className="h-4 w-4" />
                                    Storefront Entry
                                  </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Checkbox 
                                    id="editHasSpeculativeOffice"
                                    checked={newBay.hasSpeculativeOffice}
                                    onCheckedChange={(checked) => setNewBay({ ...newBay, hasSpeculativeOffice: checked as boolean })}
                                  />
                                  <Label htmlFor="editHasSpeculativeOffice" className="text-sm font-medium flex items-center gap-1">
                                    <Building2 className="h-4 w-4" />
                                    Speculative Office
                                  </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Checkbox 
                                    id="editHasRestroom"
                                    checked={newBay.hasRestroom}
                                    onCheckedChange={(checked) => setNewBay({ ...newBay, hasRestroom: checked as boolean })}
                                  />
                                  <Label htmlFor="editHasRestroom" className="text-sm font-medium flex items-center gap-1">
                                    <Users className="h-4 w-4" />
                                    Restroom
                                  </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Checkbox 
                                    id="editCanBeSplit"
                                    checked={newBay.canBeSplit}
                                    onCheckedChange={(checked) => setNewBay({ ...newBay, canBeSplit: checked as boolean })}
                                  />
                                  <Label htmlFor="editCanBeSplit" className="text-sm font-medium flex items-center gap-1">
                                    <GripVertical className="h-4 w-4" />
                                    Can be split into North/South
                                  </Label>
                                </div>
                              </div>

                              {/* Split Bay Configuration for Edit - only show when canBeSplit is checked */}
                              {newBay.canBeSplit && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-3">
                                  <h4 className="font-medium text-blue-900 text-sm flex items-center gap-2">
                                    <GripVertical className="h-4 w-4" />
                                    Split Bay Configuration
                                  </h4>
                                  
                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                      <h5 className="font-medium text-xs text-blue-800">North Half</h5>
                                      <div className="space-y-1">
                                        <div className="space-y-1">
                                          <Label className="text-xs font-medium">Square Footage</Label>
                                          <FormulaInput
                                            value={newBay.splitNorthSquareFootage}
                                            onChange={(value, evaluatedValue) => {
                                              const totalBayArea = parseFloat(newBay.squareFootage) || 0;
                                              
                                              // Use evaluated value if available, otherwise parse the raw value
                                              const northNum = evaluatedValue !== undefined ? evaluatedValue : (parseFloat(String(value)) || 0);
                                              const southNum = totalBayArea - northNum;
                                              
                                              setNewBay({ 
                                                ...newBay, 
                                                splitNorthSquareFootage: String(value),
                                                splitSouthSquareFootage: southNum > 0 ? southNum.toString() : ""
                                              });
                                            }}
                                            className="text-xs h-8"
                                            placeholder="=35247*0.6"
                                            type="quantity"
                                            decimalPlaces={0}
                                          />
                                        </div>
                                        <div className="grid grid-cols-2 gap-1">
                                          <div className="space-y-1">
                                            <Label className="text-xs">Standard Doors</Label>
                                            <Input
                                              type="text"
                                              inputMode="numeric"
                                              pattern="[0-9]*"
                                              value={newBay.splitNorthDockDoors}
                                              onChange={(e) => setNewBay({ ...newBay, splitNorthDockDoors: e.target.value })}
                                              className="text-xs h-8"
                                              placeholder="0"
                                            />
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-xs">Oversized Doors</Label>
                                            <Input
                                              type="text"
                                              inputMode="numeric"
                                              pattern="[0-9]*"
                                              value={newBay.splitNorthOversizedDoors}
                                              onChange={(e) => setNewBay({ ...newBay, splitNorthOversizedDoors: e.target.value })}
                                              className="text-xs h-8"
                                              placeholder="0"
                                            />
                                          </div>
                                        </div>
                                        
                                        {/* North Half Amenities */}
                                        <div className="grid grid-cols-3 gap-1">
                                          <div className="flex items-center space-x-1">
                                            <Checkbox 
                                              id="splitNorthStorefront"
                                              checked={newBay.splitNorthStorefront}
                                              onCheckedChange={(checked) => setNewBay({ ...newBay, splitNorthStorefront: checked as boolean })}
                                            />
                                            <Label htmlFor="splitNorthStorefront" className="text-xs flex items-center gap-1">
                                              🚪 SF
                                            </Label>
                                          </div>
                                          <div className="flex items-center space-x-1">
                                            <Checkbox 
                                              id="splitNorthOffice"
                                              checked={newBay.splitNorthOffice}
                                              onCheckedChange={(checked) => setNewBay({ ...newBay, splitNorthOffice: checked as boolean })}
                                            />
                                            <Label htmlFor="splitNorthOffice" className="text-xs flex items-center gap-1">
                                              🏢 Off
                                            </Label>
                                          </div>
                                          <div className="flex items-center space-x-1">
                                            <Checkbox 
                                              id="splitNorthRestroom"
                                              checked={newBay.splitNorthRestroom}
                                              onCheckedChange={(checked) => setNewBay({ ...newBay, splitNorthRestroom: checked as boolean })}
                                            />
                                            <Label htmlFor="splitNorthRestroom" className="text-xs flex items-center gap-1">
                                              🚻 RR
                                            </Label>
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="space-y-2">
                                      <h5 className="font-medium text-xs text-green-800">South Half</h5>
                                      <div className="space-y-1">
                                        <div className="space-y-1">
                                          <Label className="text-xs font-medium">Square Footage</Label>
                                          <FormulaInput
                                            value={newBay.splitSouthSquareFootage}
                                            onChange={(value, evaluatedValue) => {
                                              const totalBayArea = parseFloat(newBay.squareFootage) || 0;
                                              
                                              // Use evaluated value if available, otherwise parse the raw value
                                              const southNum = evaluatedValue !== undefined ? evaluatedValue : (parseFloat(String(value)) || 0);
                                              const northNum = totalBayArea - southNum;
                                              
                                              setNewBay({ 
                                                ...newBay, 
                                                splitSouthSquareFootage: String(value),
                                                splitNorthSquareFootage: northNum > 0 ? northNum.toString() : ""
                                              });
                                            }}
                                            className="text-xs h-8"
                                            placeholder="=35247*0.4"
                                            type="quantity"
                                            decimalPlaces={0}
                                          />
                                        </div>
                                        <div className="grid grid-cols-2 gap-1">
                                          <div className="space-y-1">
                                            <Label className="text-xs">Standard Doors</Label>
                                            <Input
                                              type="text"
                                              inputMode="numeric"
                                              pattern="[0-9]*"
                                              value={newBay.splitSouthDockDoors}
                                              onChange={(e) => setNewBay({ ...newBay, splitSouthDockDoors: e.target.value })}
                                              className="text-xs h-8"
                                              placeholder="0"
                                            />
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-xs">Oversized Doors</Label>
                                            <Input
                                              type="text"
                                              inputMode="numeric"
                                              pattern="[0-9]*"
                                              value={newBay.splitSouthOversizedDoors}
                                              onChange={(e) => setNewBay({ ...newBay, splitSouthOversizedDoors: e.target.value })}
                                              className="text-xs h-8"
                                              placeholder="0"
                                            />
                                          </div>
                                        </div>
                                        
                                        {/* South Half Amenities */}
                                        <div className="grid grid-cols-3 gap-1">
                                          <div className="flex items-center space-x-1">
                                            <Checkbox 
                                              id="splitSouthStorefront"
                                              checked={newBay.splitSouthStorefront}
                                              onCheckedChange={(checked) => setNewBay({ ...newBay, splitSouthStorefront: checked as boolean })}
                                            />
                                            <Label htmlFor="splitSouthStorefront" className="text-xs flex items-center gap-1">
                                              🚪 SF
                                            </Label>
                                          </div>
                                          <div className="flex items-center space-x-1">
                                            <Checkbox 
                                              id="splitSouthOffice"
                                              checked={newBay.splitSouthOffice}
                                              onCheckedChange={(checked) => setNewBay({ ...newBay, splitSouthOffice: checked as boolean })}
                                            />
                                            <Label htmlFor="splitSouthOffice" className="text-xs flex items-center gap-1">
                                              🏢 Off
                                            </Label>
                                          </div>
                                          <div className="flex items-center space-x-1">
                                            <Checkbox 
                                              id="splitSouthRestroom"
                                              checked={newBay.splitSouthRestroom}
                                              onCheckedChange={(checked) => setNewBay({ ...newBay, splitSouthRestroom: checked as boolean })}
                                            />
                                            <Label htmlFor="splitSouthRestroom" className="text-xs flex items-center gap-1">
                                              🚻 RR
                                            </Label>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                  
                                  <div className="text-xs text-blue-600 bg-blue-100 p-2 rounded">
                                    {(() => {
                                      // Helper function to evaluate formulas
                                      const evaluateValue = (value: string) => {
                                        if (!value) return 0;
                                        if (value.startsWith('=')) {
                                          try {
                                            const formula = value.slice(1);
                                            const result = Function('"use strict"; return (' + formula + ')')();
                                            return !isNaN(result) ? Math.round(result) : parseInt(value) || 0;
                                          } catch (e) {
                                            return parseInt(value) || 0;
                                          }
                                        }
                                        return parseInt(value) || 0;
                                      };

                                      const northValue = evaluateValue(newBay.splitNorthSquareFootage);
                                      const southValue = evaluateValue(newBay.splitSouthSquareFootage);
                                      const totalBayArea = parseFloat(newBay.squareFootage) || 0;

                                      return (
                                        <>
                                          💡 When split: North {northValue.toLocaleString()} SF, South {southValue.toLocaleString()} SF
                                          {northValue + southValue !== totalBayArea && 
                                            <div className="text-orange-600 mt-1">⚠️ Total split area ({(northValue + southValue).toLocaleString()} SF) doesn't match bay total ({totalBayArea.toLocaleString()} SF)</div>
                                          }
                                        </>
                                      );
                                    })()}
                                  </div>
                                </div>
                              )}

                              <div className="flex gap-2">
                                <Button onClick={saveEditedBay} className="flex-1">
                                  <Edit className="h-4 w-4 mr-2" />
                                  Save
                                </Button>
                                <Button onClick={cancelEdit} variant="outline" className="flex-1">
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          );
                        }

                        // Calculate mechanical room allocation for this bay
                        const mechanicalSF = parseFloat(mechanicalRoomSF) || 0;
                        const totalFloorArea = bayConfigurations.reduce((sum, b) => sum + b.squareFootage, 0);
                        const allocationPercentage = totalFloorArea > 0 ? bay.squareFootage / totalFloorArea : 0;
                        const mechanicalRoomAllocation = Math.round(mechanicalSF * allocationPercentage * 100) / 100;
                        const rentableSquareFootage = bay.squareFootage + mechanicalRoomAllocation;
                        
                        // Normal display row
                        return (
                          <div key={bay.id} className="grid grid-cols-8 gap-4 items-center py-2">
                            <div className="text-sm">{startBay}</div>
                            <div className="text-sm">{endBay}</div>
                            <div className="text-sm font-medium">Bay {startBay}</div>
                            <div className="text-sm text-right">{bay.squareFootage.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} SF</div>
                            <div className="text-sm text-right">{mechanicalRoomAllocation > 0 ? mechanicalRoomAllocation.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '0.0'} SF</div>
                            <div className="text-sm text-right font-medium">{rentableSquareFootage.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} SF</div>
                            <div className="text-sm text-center">{bay.standardDockDoors || 0} / {bay.oversizedDockDoors || 0}</div>
                            <div className="flex justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyBayConfiguration(bay)}
                                className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 h-8 w-8 p-0"
                                title="Copy bay"
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => editBayConfiguration(bay)}
                                className="text-gray-600 hover:text-gray-700 hover:bg-gray-50 h-8 w-8 p-0"
                                title="Edit bay"
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                              {canDeleteBays && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeBayConfiguration(bay.id)}
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                                  title="Delete bay"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      
                      {/* Total Row */}
                      <div className="grid grid-cols-8 gap-4 pt-2 border-t font-medium">
                        <div></div>
                        <div></div>
                        <div className="text-sm">Total</div>
                        <div className="text-sm text-right">{totalSquareFootage.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} SF</div>
                        <div className="text-sm text-right">{(parseFloat(mechanicalRoomSF) || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} SF</div>
                        <div className="text-sm text-right">{(totalSquareFootage + (parseFloat(mechanicalRoomSF) || 0)).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} SF</div>
                        <div className="text-sm text-center">{totalStandardDoors} / {totalOversizedDoors}</div>
                        <div></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Mechanical Room Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Mechanical Room Square Footage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isEditingMechRoom ? (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-4 space-y-4">
                  <div className="text-sm font-medium text-blue-700 mb-3">
                    🔧 Editing Mechanical Room Square Footage
                  </div>
                  <div className="grid grid-cols-2 gap-4 items-end">
                    <div className="space-y-2">
                      <Label htmlFor="tempMechanicalRoomSF" className="text-sm font-medium">Total Mechanical Room SF</Label>
                      <Input
                        id="tempMechanicalRoomSF"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="0"
                        value={tempMechRoomSF}
                        onChange={(e) => setTempMechRoomSF(e.target.value)}
                        className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={saveMechanicalRoom} size="sm">
                        Save
                      </Button>
                      <Button onClick={cancelMechRoomEdit} variant="outline" size="sm">
                        Cancel
                      </Button>
                    </div>
                  </div>
                  <div className="text-sm text-gray-600">
                    <p>This amount will be allocated to bays based on their percentage of total floor area.</p>
                    <p className="text-xs mt-1">The allocated mechanical room area is added to each bay's square footage to calculate rentable area.</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 items-center">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Total Mechanical Room SF</Label>
                    <div className="flex items-center gap-2">
                      <div className="px-3 py-2 bg-gray-50 border rounded-md flex-1 text-sm">
                        {(parseFloat(mechanicalRoomSF) || 0).toLocaleString()} SF
                      </div>
                      <Button onClick={startEditingMechRoom} variant="outline" size="sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-sm text-gray-600">
                    <p>This amount will be allocated to bays based on their percentage of total floor area.</p>
                    <p className="text-xs mt-1">The allocated mechanical room area is added to each bay's square footage to calculate rentable area.</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>



          {/* Save Button */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={saveBayConfigurations}
              disabled={updatePropertyMutation.isPending}
            >
              {updatePropertyMutation.isPending ? "Saving..." : "Save Bay Configurations"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}