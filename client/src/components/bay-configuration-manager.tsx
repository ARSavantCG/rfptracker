import React, { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Edit, Settings, Copy } from "lucide-react";
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
  const [newBay, setNewBay] = useState({ startBay: "", endBay: "", squareFootage: "" });
  const [editingBay, setEditingBay] = useState<BayConfiguration | null>(null);

  const updatePropertyMutation = useMutation({
    mutationFn: async (updatedConfigurations: BayConfiguration[]) => {
      const response = await fetch(`/api/properties/${property.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bayConfigurations: updatedConfigurations
        })
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
    let highestEndBay = 0;
    bayConfigurations.forEach(bay => {
      // Extract end number from "Bay X-Y" format
      const match = bay.bayName.match(/Bay (\d+)-(\d+)/);
      if (match) {
        const endBay = parseInt(match[2]);
        highestEndBay = Math.max(highestEndBay, endBay);
      }
    });
    
    return highestEndBay + 1;
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
      squareFootage: parseInt(newBay.squareFootage)
    };

    setBayConfigurations([...bayConfigurations, newBayConfig]);
    
    // Reset form with end bay as next starting bay number
    setNewBay({ 
      startBay: endBayNum.toString(), 
      endBay: "", 
      squareFootage: "" 
    });
  };

  // Calculate total square footage
  const totalSquareFootage = bayConfigurations.reduce((total, bay) => total + bay.squareFootage, 0);

  // Set initial starting bay when component mounts or configurations change
  useEffect(() => {
    if (newBay.startBay === "" || newBay.startBay === "1") {
      const nextStart = getNextStartingBay();
      setNewBay(prev => ({ ...prev, startBay: nextStart.toString() }));
    }
  }, [bayConfigurations.length]);

  const removeBayConfiguration = (bayId: string) => {
    setBayConfigurations(bayConfigurations.filter(bay => bay.id !== bayId));
  };

  const copyBayConfiguration = (bay: BayConfiguration) => {
    // Extract end number from the bay name to continue numbering
    const match = bay.bayName.match(/Bay (\d+)-(\d+)/);
    const endBay = match ? parseInt(match[2]) : getNextStartingBay();
    
    // Create a new bay configuration starting from the end of the copied bay
    const newBayConfig: BayConfiguration = {
      id: `bay-${Date.now()}`,
      bayName: `Bay ${endBay}-${endBay + 1}`, // Default to single bay increment
      squareFootage: bay.squareFootage
    };

    setBayConfigurations([...bayConfigurations, newBayConfig]);
    
    // Set the form with the next bay number for further editing if needed
    setNewBay({
      startBay: (endBay + 1).toString(),
      endBay: "",
      squareFootage: ""
    });

    toast({
      title: "Bay Copied",
      description: `${newBayConfig.bayName} added. Continue from Bay ${endBay + 1}.`,
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
      squareFootage: bay.squareFootage.toString()
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
      squareFootage: parseInt(newBay.squareFootage)
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
      squareFootage: "" 
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
      squareFootage: "" 
    });
  };

  const saveBayConfigurations = () => {
    updatePropertyMutation.mutate(bayConfigurations);
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
              <CardTitle className="text-lg">
                {editingBay ? "Edit Bay Configuration" : "Add Bay Configuration"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-5 gap-4 items-end">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Start Bay</Label>
                  <div className="flex items-center">
                    <span className="bg-gray-100 border border-r-0 rounded-l-md px-3 py-2 text-sm text-gray-600">Bay</span>
                    <Input
                      type="number"
                      placeholder="1"
                      value={newBay.startBay}
                      onChange={(e) => setNewBay({ ...newBay, startBay: e.target.value })}
                      className="rounded-l-none"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">End Bay</Label>
                  <div className="flex items-center">
                    <span className="bg-gray-100 border border-r-0 rounded-l-md px-3 py-2 text-sm text-gray-600">Bay</span>
                    <Input
                      type="number"
                      value={newBay.endBay}
                      onChange={(e) => setNewBay({ ...newBay, endBay: e.target.value })}
                      className="rounded-l-none"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="squareFootage" className="text-sm font-medium">Square Footage</Label>
                  <Input
                    id="squareFootage"
                    type="number"
                    value={newBay.squareFootage}
                    onChange={(e) => setNewBay({ ...newBay, squareFootage: e.target.value })}
                  />
                </div>
                <div className="flex gap-2">
                  {editingBay ? (
                    <>
                      <Button onClick={saveEditedBay} className="flex-1">
                        <Edit className="h-4 w-4 mr-2" />
                        Save
                      </Button>
                      <Button onClick={cancelEdit} variant="outline" className="flex-1">
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button onClick={addBayConfiguration} className="w-full">
                      <Plus className="h-4 w-4 mr-2" />
                      Add
                    </Button>
                  )}
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
                  {/* Table Header */}
                  <div className="grid grid-cols-5 gap-4 pb-2 border-b font-medium text-sm text-gray-600">
                    <div>Start Bay</div>
                    <div>End Bay</div>
                    <div>Range</div>
                    <div className="text-right">Square Footage</div>
                    <div className="text-center">Actions</div>
                  </div>
                  
                  {/* Bay Rows */}
                  {bayConfigurations.map((bay) => {
                    const match = bay.bayName.match(/Bay (\d+)-(\d+)/);
                    const startBay = match ? match[1] : '';
                    const endBay = match ? match[2] : '';
                    
                    return (
                      <div key={bay.id} className="grid grid-cols-5 gap-4 items-center py-2">
                        <div className="text-sm">Bay {startBay}</div>
                        <div className="text-sm">Bay {endBay}</div>
                        <div className="text-sm font-medium">{bay.bayName}</div>
                        <div className="text-sm text-right">{bay.squareFootage.toLocaleString()} SF</div>
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
                  <div className="grid grid-cols-5 gap-4 pt-2 border-t font-medium">
                    <div></div>
                    <div></div>
                    <div className="text-sm">Total</div>
                    <div className="text-sm text-right">{totalSquareFootage.toLocaleString()} SF</div>
                    <div></div>
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