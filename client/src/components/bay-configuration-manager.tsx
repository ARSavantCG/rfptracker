import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Edit, Settings } from "lucide-react";
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
  const [newBay, setNewBay] = useState({ bayRange: "", squareFootage: "" });

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

  const addBayConfiguration = () => {
    if (!newBay.bayRange || !newBay.squareFootage) {
      toast({
        title: "Error",
        description: "Please fill in both bay range and square footage",
        variant: "destructive",
      });
      return;
    }

    const newBayConfig: BayConfiguration = {
      id: Date.now().toString(),
      bayName: `Bay ${newBay.bayRange}`, // Automatically prefix with "Bay"
      squareFootage: parseInt(newBay.squareFootage)
    };

    setBayConfigurations([...bayConfigurations, newBayConfig]);
    setNewBay({ bayRange: "", squareFootage: "" });
  };

  // Calculate total square footage
  const totalSquareFootage = bayConfigurations.reduce((total, bay) => total + bay.squareFootage, 0);

  const removeBayConfiguration = (bayId: string) => {
    setBayConfigurations(bayConfigurations.filter(bay => bay.id !== bayId));
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
              <CardTitle className="text-lg">Add Bay Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4 items-end">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Bay</Label>
                  <div className="flex items-center">
                    <span className="bg-gray-100 border border-r-0 rounded-l-md px-3 py-2 text-sm text-gray-600">Bay</span>
                    <Input
                      placeholder="1-2"
                      value={newBay.bayRange}
                      onChange={(e) => setNewBay({ ...newBay, bayRange: e.target.value })}
                      className="rounded-l-none"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="squareFootage" className="text-sm font-medium">Square Footage</Label>
                  <Input
                    id="squareFootage"
                    type="number"
                    placeholder="15301"
                    value={newBay.squareFootage}
                    onChange={(e) => setNewBay({ ...newBay, squareFootage: e.target.value })}
                  />
                </div>
                <div>
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
                  {/* Table Header */}
                  <div className="grid grid-cols-4 gap-4 pb-2 border-b font-medium text-sm text-gray-600">
                    <div>Bay</div>
                    <div>Range</div>
                    <div className="text-right">Square Footage</div>
                    <div></div>
                  </div>
                  
                  {/* Bay Rows */}
                  {bayConfigurations.map((bay) => (
                    <div key={bay.id} className="grid grid-cols-4 gap-4 items-center py-2">
                      <div className="text-sm font-medium">Bay</div>
                      <div className="text-sm">{bay.bayName.replace('Bay ', '')}</div>
                      <div className="text-sm text-right">{bay.squareFootage.toLocaleString()} SF</div>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeBayConfiguration(bay.id)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  
                  {/* Total Row */}
                  <div className="grid grid-cols-4 gap-4 pt-2 border-t font-medium">
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