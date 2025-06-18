import React, { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Edit, Settings, Copy, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Property, BayConfiguration } from "@shared/schema";

interface BayConfigurationManagerProps {
  property: Property;
}

export default function BayConfigurationManager({ property }: BayConfigurationManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [bayConfigurations, setBayConfigurations] = useState<BayConfiguration[]>(
    property.bayConfigurations || []
  );
  const [mechanicalRoomSF, setMechanicalRoomSF] = useState<string>(
    property.mechanicalRoomSquareFootage?.toString() || "0"
  );
  const [newBay, setNewBay] = useState({ startBay: "", endBay: "", squareFootage: "", standardDockDoors: "", oversizedDockDoors: "" });
  const [editingBay, setEditingBay] = useState<BayConfiguration | null>(null);
  const [showBayDetails, setShowBayDetails] = useState(false);
  const [isEditingMechRoom, setIsEditingMechRoom] = useState(false);
  const [tempMechRoomSF, setTempMechRoomSF] = useState("");

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
      const mechanicalRoomAllocation = Math.round(mechanicalSF * allocationPercentage * 100) / 100;
      const rentableSquareFootage = bay.squareFootage + mechanicalRoomAllocation;
      
      return {
        ...bay,
        mechanicalRoomAllocation,
        rentableSquareFootage
      };
    });
  };

  const updatePropertyMutation = useMutation({
    mutationFn: async (data: { bayConfigurations: BayConfiguration[], mechanicalRoomSquareFootage: number }) => {
      const response = await fetch(`/api/properties/${property.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        throw new Error('Failed to update bay configurations');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({
        title: "Success",
        description: "Bay configurations updated successfully",
      });
      setIsOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update bay configurations",
        variant: "destructive",
      });
    },
  });

  // Calculate the next starting bay number
  const getNextStartingBay = (): number => {
    if (bayConfigurations.length === 0) return 1;
    
    // Find the highest ending bay number from existing configurations
    // The next start bay should be the same as the highest end bay (overlapping)
    let highestEndBay = 0;
    bayConfigurations.forEach(bay => {
      // Extract end number from "Bay X-Y" format
      const match = bay.bayName.match(/Bay (\d+)-(\d+)/);
      if (match) {
        const endBay = parseInt(match[2]);
        highestEndBay = Math.max(highestEndBay, endBay);
      }
    });
    
    return highestEndBay; // Start at the end bay, not +1
  };

  const saveBayConfigurations = () => {
    const mechanicalSF = parseFloat(mechanicalRoomSF) || 0;
    const updatedBays = calculateBayAllocations(bayConfigurations, mechanicalSF);
    
    updatePropertyMutation.mutate({
      bayConfigurations: updatedBays,
      mechanicalRoomSquareFootage: mechanicalSF
    });
  };

  const addBayConfiguration = () => {
    if (!newBay.startBay || !newBay.endBay || !newBay.squareFootage) {
      toast({
        title: "Error",
        description: "Please fill in start bay, end bay, and square footage",
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

    const newBayConfig: BayConfiguration = {
      id: Date.now().toString(),
      bayName: `Bay ${startBayNum}-${endBayNum}`,
      squareFootage: parseInt(newBay.squareFootage),
      standardDockDoors: parseInt(newBay.standardDockDoors) || 0,
      oversizedDockDoors: parseInt(newBay.oversizedDockDoors) || 0
    };

    setBayConfigurations([...bayConfigurations, newBayConfig]);
    
    // Reset form with next starting bay number
    const nextStart = getNextStartingBay();
    setNewBay({ 
      startBay: nextStart.toString(), 
      endBay: (nextStart + 1).toString(), 
      squareFootage: "",
      standardDockDoors: "",
      oversizedDockDoors: ""
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
      oversizedDockDoors: ""
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
      oversizedDockDoors: bay.oversizedDockDoors?.toString() || "0"
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
      squareFootage: parseInt(newBay.squareFootage),
      standardDockDoors: parseInt(newBay.standardDockDoors) || 0,
      oversizedDockDoors: parseInt(newBay.oversizedDockDoors) || 0
    };

    setBayConfigurations(bayConfigurations.map(bay => 
      bay.id === editingBay.id ? updatedBay : bay
    ));

    // Reset form
    setEditingBay(null);
    const nextStart = getNextStartingBay();
    setNewBay({ 
      startBay: nextStart.toString(), 
      endBay: "", 
      squareFootage: "",
      standardDockDoors: "",
      oversizedDockDoors: ""
    });

    toast({
      title: "Success",
      description: "Bay configuration updated successfully",
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
      oversizedDockDoors: ""
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
        },
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
        <Button variant="outline" size="sm" className="flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Manage Bay Configurations
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bay Configurations - {property.propertyName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Add New Bay Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Add Bay Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-5 gap-4 items-end">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Start Bay</Label>
                  <div className="flex items-center">
                    <span className="bg-gray-100 border border-r-0 rounded-l-md px-3 py-2 text-sm text-gray-600">Bay</span>
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="1"
                      value={newBay.startBay}
                      onChange={(e) => setNewBay({ ...newBay, startBay: e.target.value })}
                      className="rounded-l-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">End Bay</Label>
                  <div className="flex items-center">
                    <span className="bg-gray-100 border border-r-0 rounded-l-md px-3 py-2 text-sm text-gray-600">Bay</span>
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={newBay.endBay}
                      onChange={(e) => setNewBay({ ...newBay, endBay: e.target.value })}
                      className="rounded-l-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="squareFootage" className="text-sm font-medium">Square Footage</Label>
                  <Input
                    id="squareFootage"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={newBay.squareFootage}
                    onChange={(e) => setNewBay({ ...newBay, squareFootage: e.target.value })}
                    className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                <div className="flex gap-2">
                  <Button onClick={addBayConfiguration} className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    Add
                  </Button>
                </div>
              </div>
            </CardContent>
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
                        <div>Start Bay</div>
                        <div>End Bay</div>
                        <div>Range</div>
                        <div className="text-right">Floor Area</div>
                        <div className="text-right">Mech Room</div>
                        <div className="text-right">Rentable SF</div>
                        <div className="text-center">Dock Doors</div>
                        <div className="text-center">Actions</div>
                      </div>
                      
                      {/* Bay Rows */}
                      {bayConfigurations.map((bay) => {
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
                                  <Label className="text-sm font-medium">Start Bay</Label>
                                  <div className="flex items-center">
                                    <span className="bg-gray-100 border border-r-0 rounded-l-md px-3 py-2 text-sm text-gray-600">Bay</span>
                                    <Input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={newBay.startBay}
                                      onChange={(e) => setNewBay({ ...newBay, startBay: e.target.value })}
                                      className="rounded-l-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium">End Bay</Label>
                                  <div className="flex items-center">
                                    <span className="bg-gray-100 border border-r-0 rounded-l-md px-3 py-2 text-sm text-gray-600">Bay</span>
                                    <Input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={newBay.endBay}
                                      onChange={(e) => setNewBay({ ...newBay, endBay: e.target.value })}
                                      className="rounded-l-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="squareFootage" className="text-sm font-medium">Square Footage</Label>
                                  <Input
                                    id="squareFootage"
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={newBay.squareFootage}
                                    onChange={(e) => setNewBay({ ...newBay, squareFootage: e.target.value })}
                                    className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                            <div className="text-sm">Bay {startBay}</div>
                            <div className="text-sm">Bay {endBay}</div>
                            <div className="text-sm font-medium">{bay.bayName}</div>
                            <div className="text-sm text-right">{bay.squareFootage.toLocaleString()} SF</div>
                            <div className="text-sm text-right">{mechanicalRoomAllocation > 0 ? mechanicalRoomAllocation.toLocaleString() : '0'} SF</div>
                            <div className="text-sm text-right font-medium">{rentableSquareFootage.toLocaleString()} SF</div>
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
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeBayConfiguration(bay.id)}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                                title="Delete bay"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                      
                      {/* Total Row */}
                      <div className="grid grid-cols-8 gap-4 pt-2 border-t font-medium">
                        <div></div>
                        <div></div>
                        <div className="text-sm">Total</div>
                        <div className="text-sm text-right">{totalSquareFootage.toLocaleString()} SF</div>
                        <div className="text-sm text-right">{(parseFloat(mechanicalRoomSF) || 0).toLocaleString()} SF</div>
                        <div className="text-sm text-right">{(totalSquareFootage + (parseFloat(mechanicalRoomSF) || 0)).toLocaleString()} SF</div>
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

          {/* Summary Section */}
          {bayConfigurations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Property Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-6">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {(parseFloat(mechanicalRoomSF) || 0).toLocaleString()} SF
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Mechanical Rooms</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {totalSquareFootage.toLocaleString()} SF
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Bay Configurations</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                      {(totalSquareFootage + (parseFloat(mechanicalRoomSF) || 0)).toLocaleString()} SF
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Total</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

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