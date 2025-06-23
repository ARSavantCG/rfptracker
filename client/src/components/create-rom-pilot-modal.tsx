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

  // Use all properties without filtering since each has unique building info
  const displayProperties = properties;

  // Find selected property and its bay configurations
  const selectedProperty = displayProperties.find(p => p.displayName === property);
  const propertyBayConfigs = selectedProperty?.bayConfigurations || [];

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
                {displayProperties.map((prop) => (
                  <SelectItem key={prop.id} value={prop.displayName}>
                    {prop.displayName}
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

          {/* Bay Configuration */}
          <div className="space-y-2">
            <Label>Bay Configuration</Label>
            <div className="border rounded-lg p-4 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-gray-700">
                    Total Square Footage: {squareFootage ? `${parseInt(squareFootage).toLocaleString()} SF` : "Not configured"}
                  </div>
                  {bayConfigs.length > 0 && (
                    <div className="text-xs text-blue-600">
                      {bayConfigs.length} bay{bayConfigs.length !== 1 ? 's' : ''} selected
                    </div>
                  )}
                  {propertyBayConfigs.length > 0 && bayConfigs.length === 0 && (
                    <div className="text-xs text-gray-600">
                      {propertyBayConfigs.length} bay{propertyBayConfigs.length !== 1 ? 's' : ''} available for this property
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowBayConfig(true)}
                  disabled={!property}
                >
                  <Building2 className="w-4 h-4 mr-1" />
                  Configure Bays
                </Button>
              </div>
              
              <div className="text-xs text-gray-500">
                {!property ? "Select a property first to configure bays" : "Click to select bays for this ROM estimate"}
              </div>
            </div>
          </div>

          {/* Bay Configuration Modal */}
          {showBayConfig && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">
                  Bay Configuration - {selectedProperty?.propertyName || "Property"}
                </h3>
                
                {propertyBayConfigs.length > 0 ? (
                  <div>
                    <p className="text-sm text-gray-600 mb-4">
                      Select bays to include in this ROM estimate:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto">
                      {propertyBayConfigs.map((bay) => {
                        const isSelected = bayConfigs.some(b => b.id === bay.id);
                        return (
                          <div 
                            key={bay.id} 
                            className={`border rounded-lg p-4 cursor-pointer transition-all hover:shadow-md ${
                              isSelected 
                                ? 'bg-blue-50 border-blue-500 shadow-md' 
                                : 'bg-white border-gray-200 hover:border-gray-300'
                            }`}
                            onClick={() => {
                              if (isSelected) {
                                // Remove bay
                                const newBays = bayConfigs.filter(b => b.id !== bay.id);
                                setBayConfigs(newBays);
                                const totalSF = newBays.reduce((sum, b) => sum + b.squareFootage, 0);
                                setSquareFootage(totalSF.toString());
                              } else {
                                // Add bay
                                const newBay = {
                                  id: bay.id,
                                  bayName: bay.bayName,
                                  squareFootage: bay.squareFootage
                                };
                                const newBays = [...bayConfigs, newBay];
                                setBayConfigs(newBays);
                                const totalSF = newBays.reduce((sum, b) => sum + b.squareFootage, 0);
                                setSquareFootage(totalSF.toString());
                              }
                            }}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="font-semibold text-gray-900">{bay.bayName}</div>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {}} // Handled by parent div onClick
                                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                              />
                            </div>
                            <div className="text-sm text-gray-600 mb-1">
                              {bay.squareFootage.toLocaleString()} SF
                            </div>
                            <div className="text-xs text-gray-500">
                              {bay.standardDockDoors + bay.oversizedDockDoors} dock doors
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-500 mb-4">No bay configurations found for this property.</p>
                    <p className="text-sm text-gray-400">Configure bays in the Properties section first.</p>
                  </div>
                )}

                <div className="flex justify-between items-center mt-6 pt-4 border-t">
                  <div className="text-sm text-gray-600">
                    {bayConfigs.length > 0 && (
                      <>Total: {bayConfigs.reduce((sum, b) => sum + b.squareFootage, 0).toLocaleString()} SF</>
                    )}
                  </div>
                  <Button
                    type="button"
                    onClick={() => setShowBayConfig(false)}
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