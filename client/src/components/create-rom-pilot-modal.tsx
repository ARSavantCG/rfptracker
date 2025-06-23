import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Calculator, User, Building2 } from "lucide-react";
import type { Property } from "@shared/schema";

interface CreateRomPilotModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateRomPilotModal({ isOpen, onClose, onSuccess }: CreateRomPilotModalProps) {
  const { toast } = useToast();
  const [projectName, setProjectName] = useState("");
  const [property, setProperty] = useState("");
  const [squareFootage, setSquareFootage] = useState("");
  const [notes, setNotes] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showBayConfig, setShowBayConfig] = useState(false);
  const [bayConfigs, setBayConfigs] = useState<Array<{
    id: string;
    bayName: string;
    squareFootage: number;
  }>>([]);

  // Fetch properties for selection
  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    enabled: isOpen,
  });

  // Remove duplicates from properties and ensure unique keys
  const uniqueProperties = properties.filter((prop, index, self) => 
    index === self.findIndex(p => p.propertyName === prop.propertyName)
  );

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setProjectName("");
      setProperty("");
      setSquareFootage("");
      setNotes("");
      setCreatedBy("");
      setBayConfigs([]);
      setShowBayConfig(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!projectName.trim()) {
      toast({
        title: "Validation Error",
        description: "Project name is required",
        variant: "destructive",
      });
      return;
    }

    if (!property) {
      toast({
        title: "Validation Error", 
        description: "Property selection is required",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Calculate basic estimate based on square footage
      const sf = parseInt(squareFootage) || 0;
      const estimatePerSF = 50; // Basic $50/SF estimate
      const totalEstimate = (sf * estimatePerSF).toString();

      const romPilotData = {
        projectName: projectName.trim(),
        property,
        totalEstimate,
        notes: notes.trim() || null,
        createdBy: createdBy.trim() || null,
      };

      const response = await fetch("/api/rom-pilots", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(romPilotData),
      });

      if (!response.ok) {
        throw new Error("Failed to create ROM Pilot");
      }

      toast({
        title: "Success",
        description: "ROM Pilot created successfully",
      });

      onSuccess();
    } catch (error) {
      console.error("Error creating ROM Pilot:", error);
      toast({
        title: "Error",
        description: "Failed to create ROM Pilot. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Calculator className="h-5 w-5" />
            <span>Create New ROM Pilot</span>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Property Selection */}
          <div className="space-y-2">
            <Label htmlFor="property">Property *</Label>
            <Select value={property} onValueChange={setProperty}>
              <SelectTrigger>
                <SelectValue placeholder="Select a property" />
              </SelectTrigger>
              <SelectContent>
                {uniqueProperties.map((prop) => (
                  <SelectItem key={prop.id} value={prop.propertyName}>
                    {prop.propertyName} - {prop.building}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Project Name */}
          <div className="space-y-2">
            <Label htmlFor="project-name">Project Name *</Label>
            <Input
              id="project-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Enter project name"
              required
            />
          </div>

          {/* Bay Configuration with Square Footage */}
          <div className="space-y-2">
            <Label>Bay Configuration & Square Footage</Label>
            <div className="border rounded-lg p-4 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-gray-700">
                    Total Square Footage: {squareFootage ? `${parseInt(squareFootage).toLocaleString()} SF` : "Not configured"}
                  </div>
                  {squareFootage && (
                    <div className="text-xs text-gray-600">
                      Estimated cost: ${(parseInt(squareFootage) * 50).toLocaleString()} (@ $50/SF)
                    </div>
                  )}
                  {bayConfigs.length > 0 && (
                    <div className="text-xs text-blue-600">
                      {bayConfigs.length} bay{bayConfigs.length !== 1 ? 's' : ''} configured
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowBayConfig(true)}
                >
                  <Building2 className="w-4 h-4 mr-1" />
                  Configure Bays
                </Button>
              </div>
              
              <div className="text-xs text-gray-500">
                Click "Configure Bays" to set up bay details and calculate total square footage
              </div>
            </div>
          </div>

          {/* Bay Configuration Modal */}
          {showBayConfig && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                <h3 className="text-lg font-semibold mb-4">Bay Configuration</h3>
                
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {bayConfigs.map((bay, index) => (
                    <div key={bay.id} className="border rounded p-3 bg-gray-50">
                      <div className="flex justify-between items-start mb-2">
                        <div className="text-sm font-medium">Bay {index + 1}</div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const newBays = bayConfigs.filter(b => b.id !== bay.id);
                            setBayConfigs(newBays);
                            const totalSF = newBays.reduce((sum, b) => sum + b.squareFootage, 0);
                            setSquareFootage(totalSF.toString());
                          }}
                        >
                          ×
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <Input
                          placeholder="Bay name"
                          value={bay.bayName}
                          onChange={(e) => {
                            const newBays = bayConfigs.map(b => 
                              b.id === bay.id ? { ...b, bayName: e.target.value } : b
                            );
                            setBayConfigs(newBays);
                          }}
                        />
                        <Input
                          type="number"
                          placeholder="Square footage"
                          value={bay.squareFootage || ""}
                          onChange={(e) => {
                            const sf = parseInt(e.target.value) || 0;
                            const newBays = bayConfigs.map(b => 
                              b.id === bay.id ? { ...b, squareFootage: sf } : b
                            );
                            setBayConfigs(newBays);
                            const totalSF = newBays.reduce((sum, b) => sum + b.squareFootage, 0);
                            setSquareFootage(totalSF.toString());
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3 mt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const newBay = {
                        id: Date.now().toString(),
                        bayName: `Bay ${bayConfigs.length + 1}`,
                        squareFootage: 0
                      };
                      setBayConfigs([...bayConfigs, newBay]);
                    }}
                  >
                    Add Bay
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setShowBayConfig(false)}
                    className="flex-1"
                  >
                    Done
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Created By */}
          <div className="space-y-2">
            <Label htmlFor="created-by">Created By</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="created-by"
                value={createdBy}
                onChange={(e) => setCreatedBy(e.target.value)}
                placeholder="Your name (optional)"
                className="pl-10"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any additional notes about this ROM pilot..."
              rows={3}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create ROM Pilot"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}