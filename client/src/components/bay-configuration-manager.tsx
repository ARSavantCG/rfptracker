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
  const [newBay, setNewBay] = useState({ bayName: "", squareFootage: "" });

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
    if (!newBay.bayName || !newBay.squareFootage) {
      toast({
        title: "Error",
        description: "Please fill in both bay name and square footage",
        variant: "destructive",
      });
      return;
    }

    const newBayConfig: BayConfiguration = {
      id: Date.now().toString(),
      bayName: newBay.bayName,
      squareFootage: parseInt(newBay.squareFootage)
    };

    setBayConfigurations([...bayConfigurations, newBayConfig]);
    setNewBay({ bayName: "", squareFootage: "" });
  };

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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bayName">Bay Name</Label>
                  <Input
                    id="bayName"
                    placeholder="e.g., Bay 1-2, Bay 2-3"
                    value={newBay.bayName}
                    onChange={(e) => setNewBay({ ...newBay, bayName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="squareFootage">Square Footage</Label>
                  <Input
                    id="squareFootage"
                    type="number"
                    placeholder="e.g., 15301"
                    value={newBay.squareFootage}
                    onChange={(e) => setNewBay({ ...newBay, squareFootage: e.target.value })}
                  />
                </div>
              </div>
              <Button onClick={addBayConfiguration} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Add Bay Configuration
              </Button>
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
                <div className="space-y-3">
                  {bayConfigurations.map((bay) => (
                    <div
                      key={bay.id}
                      className="flex items-center justify-between p-3 border rounded-lg bg-gray-50"
                    >
                      <div className="flex-1">
                        <div className="font-medium">{bay.bayName}</div>
                        <div className="text-sm text-gray-600">
                          {bay.squareFootage.toLocaleString()} SF
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeBayConfiguration(bay.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
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