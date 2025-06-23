import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Calculator, User } from "lucide-react";
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
  const [notes, setNotes] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [selectedBayConfigurations, setSelectedBayConfigurations] = useState<BayConfiguration[]>([]);
  const [bayConfigModalOpen, setBayConfigModalOpen] = useState(false);
  const [calculatedFloorArea, setCalculatedFloorArea] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch properties for selection
  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    enabled: isOpen,
  });

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setProjectName("");
      setProperty("");
      setNotes("");
      setCreatedBy("");
      setSelectedProperty(null);
      setSelectedBayConfigurations([]);
      setCalculatedFloorArea(0);
    }
  }, [isOpen]);

  // Update selected property when property changes
  useEffect(() => {
    if (property && properties.length > 0) {
      const foundProperty = properties.find(p => p.propertyName === property);
      setSelectedProperty(foundProperty || null);
    }
  }, [property, properties]);

  const handleFloorAreaChange = (area: number, bayConfigs: BayConfiguration[]) => {
    const roundedArea = Math.round(area);
    setCalculatedFloorArea(roundedArea);
    setSelectedBayConfigurations(bayConfigs);
  };

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
      const romPilotData = {
        projectName: projectName.trim(),
        property,
        selectedBayConfigurations,
        totalEstimate: "0", // Will be calculated based on scope items
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

      const createdPilot = await response.json();

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

  const formatArea = (area: number) => {
    return area > 0 ? `${area.toLocaleString()} SF` : "No bays selected";
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

          {/* Property Selection */}
          <div className="space-y-2">
            <Label htmlFor="property">Property *</Label>
            <PropertySelector
              value={property}
              onChange={setProperty}
            />
          </div>

          {/* Bay Configuration */}
          <div className="space-y-2">
            <Label>Bay Configuration</Label>
            <div className="border rounded-lg p-4 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <Building className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium">
                    Selected Area: {formatArea(calculatedFloorArea)}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setBayConfigModalOpen(true)}
                  disabled={!selectedProperty}
                >
                  {selectedBayConfigurations.length > 0 ? "Modify Bays" : "Select Bays"}
                </Button>
              </div>
              
              {selectedBayConfigurations.length > 0 && (
                <div className="text-xs text-gray-600">
                  {selectedBayConfigurations.length} bay{selectedBayConfigurations.length !== 1 ? 's' : ''} selected
                </div>
              )}
              
              {!selectedProperty && (
                <p className="text-xs text-gray-500">Select a property first to configure bays</p>
              )}
            </div>
          </div>

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

      {/* Bay Configuration Modal */}
      {selectedProperty && (
        <BayConfigurationModal
          isOpen={bayConfigModalOpen}
          onClose={() => setBayConfigModalOpen(false)}
          property={selectedProperty}
          onFloorAreaChange={handleFloorAreaChange}
          selectedBayConfigurations={selectedBayConfigurations}
        />
      )}
    </Dialog>
  );
}