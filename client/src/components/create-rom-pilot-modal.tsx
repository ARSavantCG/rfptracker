import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
// Removed Select import - using native HTML selects for consistency
import { useToast } from "@/hooks/use-toast";
import { Calculator, User, Building2, ChevronDown } from "lucide-react";
import type { Property } from "@shared/schema";
import { HierarchicalPropertySelector } from "./hierarchical-property-selector";
import { BayConfigurationModal } from "./bay-configuration-modal";
import type { BayConfiguration } from "@shared/schema";

interface RomPilot {
  id: number;
  projectName: string;
  property: string;
  totalEstimate: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateRomPilotModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (createdRomPilot?: RomPilot) => void;
  editingRomPilot?: RomPilot | null;
}

export function CreateRomPilotModal({ isOpen, onClose, onSuccess, editingRomPilot }: CreateRomPilotModalProps) {
  const { toast } = useToast();
  const [projectName, setProjectName] = useState("");
  const [property, setProperty] = useState("");
  const [squareFootage, setSquareFootage] = useState("");
  const [notes, setNotes] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showBayConfig, setShowBayConfig] = useState(false);
  const [selectedBays, setSelectedBays] = useState<BayConfiguration[]>([]);
  const [rentableArea, setRentableArea] = useState<number>(0);

  // Fetch properties for selection
  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    enabled: isOpen,
  });

  // Fetch contacts and filter for owner type only
  const { data: allContacts = [] } = useQuery<any[]>({
    queryKey: ["/api/contacts"],
    enabled: isOpen,
  });
  
  // Filter contacts to only show owner types
  const ownerContacts = allContacts.filter((contact: any) => contact.type === "owner");

  // Use all properties without filtering since each has unique building info
  const displayProperties = properties;

  // Find selected property and its bay configurations
  // HierarchicalPropertySelector returns property ID, so match by ID
  const selectedProperty = displayProperties.find(p => p.id?.toString() === property);
  const propertyBayConfigs = selectedProperty?.bayConfigurations || [];

  // Load existing ROM pilot data when editing
  useEffect(() => {
    if (isOpen && editingRomPilot) {
      setProjectName(editingRomPilot.projectName);
      setProperty(editingRomPilot.property);
      setNotes(editingRomPilot.notes || "");
      setCreatedBy(editingRomPilot.createdBy || "");
    } else if (isOpen && !editingRomPilot) {
      // Reset form when creating new
      setProjectName("");
      setProperty("");
      setSquareFootage("");
      setNotes("");
      setCreatedBy("");
      setSelectedBays([]);
      setRentableArea(0);
      setShowBayConfig(false);
    }
  }, [isOpen, editingRomPilot]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!projectName.trim()) {
      toast({
        title: "Validation Error",
        description: "Project name is required",
        variant: "destructive",
        duration: 6000,
      });
      return;
    }

    if (!property) {
      toast({
        title: "Validation Error", 
        description: "Property selection is required",
        variant: "destructive",
        duration: 6000,
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const romPilotData = {
        projectName: projectName.trim(),
        property,
        selectedBayConfigurations: selectedBays,
        totalEstimate: "0", // No pricing at creation - will be calculated in scope management
        notes: notes.trim() || null,
        createdBy: createdBy.trim() || null,
      };

      const isEditing = !!editingRomPilot;
      const url = isEditing ? `/api/rom-pilots/${editingRomPilot.id}` : "/api/rom-pilots";
      const method = isEditing ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(romPilotData),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${isEditing ? 'update' : 'create'} ROM`);
      }

      const result = await response.json();

      toast({
        title: "Success",
        description: `ROM ${isEditing ? 'updated' : 'created'} successfully. ${!isEditing ? "Opening scope management..." : ""}`,
        duration: 4000,
      });

      onSuccess(isEditing ? undefined : result);
    } catch (error) {
      console.error("Error creating ROM:", error);
      toast({
        title: "Error",
        description: "Failed to create ROM. Please try again.",
        variant: "destructive",
        duration: 6000,
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
            <span>{editingRomPilot ? 'Edit ROM' : 'Create New ROM'}</span>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Property Selection */}
          <div className="space-y-2">
            <Label htmlFor="property">Property *</Label>
            <HierarchicalPropertySelector
              value={property}
              onChange={(value) => setProperty(value)}
            />
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
                  {selectedBays.length > 0 && (
                    <div className="text-xs text-blue-600">
                      {selectedBays.length} bay{selectedBays.length !== 1 ? 's' : ''} selected
                    </div>
                  )}
                  {propertyBayConfigs.length > 0 && selectedBays.length === 0 && (
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
                {!property ? "Select a property first to configure bays" : "Bay selection for project scope - pricing added in Step 2"}
              </div>
            </div>
          </div>

          {/* Old bay configuration modal removed - using standard component now */}
          {false && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">
                  Bay Configuration - {selectedProperty?.propertyName || "Property"}
                </h3>
                
                {propertyBayConfigs.length > 0 ? (
                  <div>
                    <div className="flex items-center gap-4 mb-4">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // Select all bays using the full BayConfiguration objects
                          // (they already have the complete shape selectedBays expects).
                          setSelectedBays(propertyBayConfigs);
                          const totalSF = propertyBayConfigs.reduce((sum, b) => sum + (b.squareFootage || 0), 0);
                          setSquareFootage(totalSF.toString());
                        }}
                      >
                        ✓ Select All
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedBays([]);
                          setSquareFootage("0");
                        }}
                      >
                        Clear All
                      </Button>
                    </div>

                    <div className="bg-gray-50 p-3 rounded-lg relative">
                      <div className="mb-3">
                        <div className="text-sm font-medium text-gray-700">Building Layout</div>
                        <p className="text-xs text-gray-500">Click bays to select for rentable area calculation</p>
                      </div>

                      {/* Building Orientation Compass */}
                      <div className="flex items-start gap-4 mb-3">
                        <div className="bg-white border border-gray-300 rounded-lg p-4 shadow-sm">
                          <div className="relative w-20 h-20">
                            {/* Compass Rose Background */}
                            <div className="absolute inset-0 border-2 border-gray-800 rounded-full"></div>
                            <div className="absolute inset-0.5 border border-gray-600 rounded-full"></div>
                            
                            {/* Compass Rose Star Pattern */}
                            <svg className="absolute inset-1 w-18 h-18" viewBox="0 0 72 72">
                              {/* Main star points (N, S, E, W) */}
                              <path d="M36 4 L37.5 32 L36 36 L34.5 32 Z" fill="#374151" stroke="#1f2937" strokeWidth="0.5"/>
                              <path d="M68 36 L40 37.5 L36 36 L40 34.5 Z" fill="#374151" stroke="#1f2937" strokeWidth="0.5"/>
                              <path d="M36 68 L34.5 40 L36 36 L37.5 40 Z" fill="#374151" stroke="#1f2937" strokeWidth="0.5"/>
                              <path d="M4 36 L32 34.5 L36 36 L32 37.5 Z" fill="#374151" stroke="#1f2937" strokeWidth="0.5"/>
                              
                              {/* Smaller diagonal points (NE, SE, SW, NW) */}
                              <path d="M36 36 L54 18 L55.5 19.5 L36 36 Z" fill="#6b7280" stroke="#374151" strokeWidth="0.5"/>
                              <path d="M36 36 L54 54 L52.5 55.5 L36 36 Z" fill="#6b7280" stroke="#374151" strokeWidth="0.5"/>
                              <path d="M36 36 L18 54 L16.5 52.5 L36 36 Z" fill="#6b7280" stroke="#374151" strokeWidth="0.5"/>
                              <path d="M36 36 L18 18 L19.5 16.5 L36 36 Z" fill="#6b7280" stroke="#374151" strokeWidth="0.5"/>
                              
                              {/* Center circle */}
                              <circle cx="36" cy="36" r="2.5" fill="#374151" stroke="#1f2937" strokeWidth="1"/>
                            </svg>
                            
                            {/* Direction labels - positioned outside the circle */}
                            <div className={`absolute -top-5 left-1/2 transform -translate-x-1/2 text-sm font-bold ${
                              selectedProperty?.firstBayDirection === 'north' ? 'text-red-600' : 'text-gray-800'
                            }`}>N</div>
                            <div className={`absolute top-1/2 -right-5 transform -translate-y-1/2 text-sm font-bold ${
                              selectedProperty?.firstBayDirection === 'east' ? 'text-red-600' : 'text-gray-800'
                            }`}>E</div>
                            <div className={`absolute -bottom-5 left-1/2 transform -translate-x-1/2 text-sm font-bold ${
                              selectedProperty?.firstBayDirection === 'south' ? 'text-red-600' : 'text-gray-800'
                            }`}>S</div>
                            <div className={`absolute top-1/2 -left-5 transform -translate-y-1/2 text-sm font-bold ${
                              selectedProperty?.firstBayDirection === 'west' ? 'text-red-600' : 'text-gray-800'
                            }`}>W</div>
                            
                            {/* Diagonal direction labels */}
                            <div className={`absolute top-1 right-1 text-xs font-medium ${
                              selectedProperty?.firstBayDirection === 'northeast' ? 'text-red-600' : 'text-gray-600'
                            }`}>NE</div>
                            <div className={`absolute bottom-1 right-1 text-xs font-medium ${
                              selectedProperty?.firstBayDirection === 'southeast' ? 'text-red-600' : 'text-gray-600'
                            }`}>SE</div>
                            <div className={`absolute bottom-1 left-1 text-xs font-medium ${
                              selectedProperty?.firstBayDirection === 'southwest' ? 'text-red-600' : 'text-gray-600'
                            }`}>SW</div>
                            <div className={`absolute top-1 left-1 text-xs font-medium ${
                              selectedProperty?.firstBayDirection === 'northwest' ? 'text-red-600' : 'text-gray-600'
                            }`}>NW</div>
                          </div>
                        </div>
                        <div className="text-xs text-gray-600 pt-2">
                          <div className="font-medium mb-1">Building Orientation</div>
                          <div className="text-gray-500">
                            {(() => {
                              const dir = selectedProperty?.firstBayDirection;
                              return dir
                                ? `Bay 1 faces ${String(dir).charAt(0).toUpperCase() + String(dir).slice(1)}`
                                : "Bay 1 faces North";
                            })()}
                          </div>
                        </div>
                      </div>

                      {/* Directional Labels */}
                      <div className="mb-3">
                        <div className="flex justify-between items-center text-xs text-gray-600">
                          <div className="flex items-center gap-2">
                            <span>←</span>
                            <span className="font-medium">West Side</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">East Side</span>
                            <span>→</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Bay Grid - Single Row Layout */}
                      <div className="relative">
                        <div className="flex gap-0.5 justify-start overflow-x-auto pb-1">
                          {propertyBayConfigs.map((bay, index) => {
                            const isSelected = selectedBays.some(b => b.id === bay.id);
                            // Convert to individual bay numbering like RFP configurator
                            const bayNumber = index + 1;
                            const displayBayName = `Bay ${bayNumber}`;
                            
                            return (
                              <div
                                key={bay.id}
                                className={`h-20 w-16 flex flex-col items-center justify-center text-xs p-2 flex-shrink-0 border rounded cursor-pointer transition-all ${
                                  isSelected 
                                    ? "bg-orange-600 text-white border-orange-700" 
                                    : "bg-white border-orange-200 hover:bg-orange-50"
                                }`}
                                onClick={() => {
                                  if (isSelected) {
                                    // Remove bay
                                    const newBays = selectedBays.filter(b => b.id !== bay.id);
                                    setSelectedBays(newBays);
                                    const totalSF = newBays.reduce((sum, b) => sum + b.squareFootage, 0);
                                    setSquareFootage(totalSF.toString());
                                  } else {
                                    // Add bay
                                    // Spread the full bay config (complete shape) and
                                    // override the display name for the selection.
                                    const newBay = { ...bay, bayName: displayBayName };
                                    const newBays = [...selectedBays, newBay];
                                    setSelectedBays(newBays);
                                    const totalSF = newBays.reduce((sum, b) => sum + (b.squareFootage || 0), 0);
                                    setSquareFootage(totalSF.toString());
                                  }
                                }}
                              >
                                <div className="font-bold text-xs mb-1">{displayBayName}</div>
                                <div className="text-xs opacity-75 leading-tight">
                                  {`${(bay.squareFootage / 1000).toFixed(0)}K`}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        
                        {/* Position indicators below bays */}
                        <div className="flex gap-0.5 justify-start overflow-x-auto mt-1">
                          {propertyBayConfigs.map((bay, index) => {
                            const totalBays = propertyBayConfigs.length;
                            let position = "";
                            
                            if (index === 0) position = "West End";
                            else if (index === totalBays - 1) position = "East End";
                            else if (index < totalBays / 3) position = "";
                            else if (index > (totalBays * 2) / 3) position = "";
                            else position = "Center";
                            
                            return (
                              <div key={`pos-${bay.id}`} className="w-16 flex-shrink-0">
                                <div className="text-xs text-center text-gray-500 py-1">
                                  {position}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                      <div className="text-sm">
                        <span className="font-medium text-blue-900">Selected: {selectedBays.length} bays</span>
                      </div>
                      <div className="text-sm text-blue-700">
                        Total Area: {selectedBays.reduce((sum, b) => sum + b.squareFootage, 0).toLocaleString()} SF
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-500 mb-4">No bay configurations found for this property.</p>
                    <p className="text-sm text-gray-400">Configure bays in the Properties section first.</p>
                  </div>
                )}

                <div className="flex justify-between items-center mt-6 pt-4 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowBayConfig(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setShowBayConfig(false)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Confirm Selection
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Created By */}
          <div className="space-y-2">
            <Label htmlFor="created-by">Created By</Label>
            <div className="relative">
              <select
                value={createdBy}
                onChange={(e) => setCreatedBy(e.target.value)}
                className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="">Select user</option>
                {ownerContacts.map((contact: any) => (
                  <option key={contact.id} value={contact.name}>
                    {contact.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
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

        {/* Bay Configuration Modal */}
        {selectedProperty && (
          <BayConfigurationModal
            isOpen={showBayConfig}
            onClose={() => setShowBayConfig(false)}
            property={selectedProperty}
            onConfirm={(area, bays) => {
              setRentableArea(area);
              setSelectedBays(bays);
              setSquareFootage(area.toString());
              setShowBayConfig(false);
            }}
            initialSelectedBays={selectedBays}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}