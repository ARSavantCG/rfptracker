import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Grid3x3, Check, Compass, Navigation } from "lucide-react";
import type { Property, BayConfiguration, ExecutedLease } from "@shared/schema";

interface BayConfigurationModalProps {
  isOpen: boolean;
  onClose: () => void;
  property: Property;
  onConfirm: (area: number, selectedBays: BayConfiguration[]) => void;
  initialSelectedBays?: BayConfiguration[];
}

export function BayConfigurationModal({ 
  isOpen, 
  onClose, 
  property, 
  onConfirm,
  initialSelectedBays = [] 
}: BayConfigurationModalProps) {
  const [selectedBayIds, setSelectedBayIds] = useState<string[]>([]);
  const [selectedBays, setSelectedBays] = useState<BayConfiguration[]>([]);

  // Fetch executed leases for this property to exclude leased bays
  const { data: executedLeases = [], isLoading: isLoadingLeases } = useQuery<ExecutedLease[]>({
    queryKey: [`/api/properties/${property.id}/executed-leases`],
    enabled: !!property.id && isOpen
  });

  // Get list of all bay IDs that are already leased
  const leasedBayIds = executedLeases.flatMap(lease => lease.assignedBays || []);
  


  // Initialize selected bays from props
  useEffect(() => {
    if (initialSelectedBays.length > 0) {
      setSelectedBayIds(initialSelectedBays.map(bay => bay.id));
      setSelectedBays(initialSelectedBays);
    }
  }, [initialSelectedBays]);

  if (!property.bayConfigurations || property.bayConfigurations.length === 0) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Bay Configuration Selection</DialogTitle>
            <DialogDescription>
              Select bays for rentable area calculation
            </DialogDescription>
          </DialogHeader>
          <Card>
            <CardContent>
              <div className="text-center py-8 text-gray-500">
                <Grid3x3 className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                <p className="font-medium">No bay configurations defined</p>
                <p className="text-sm">Add bay configurations to the property to enable automatic floor area calculation.</p>
              </div>
            </CardContent>
          </Card>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Use the bay configurations directly as they already represent individual bays
  const individualBays = property.bayConfigurations;

  const toggleBaySelection = (bayId: string) => {
    // Don't allow selection of leased bays
    if (leasedBayIds.includes(bayId)) {
      return;
    }

    const bay = individualBays.find(b => b.id === bayId);
    if (!bay) return;

    if (selectedBayIds.includes(bayId)) {
      setSelectedBayIds(prev => prev.filter(id => id !== bayId));
      setSelectedBays(prev => prev.filter(b => b.id !== bayId));
    } else {
      setSelectedBayIds(prev => [...prev, bayId]);
      setSelectedBays(prev => [...prev, bay]);
    }
  };

  const handleSelectAll = () => {
    // Only select available (non-leased) bays
    const availableBays = individualBays.filter(bay => !leasedBayIds.includes(bay.id));
    setSelectedBayIds(availableBays.map(bay => bay.id));
    setSelectedBays([...availableBays]);
  };

  const handleClearAll = () => {
    setSelectedBayIds([]);
    setSelectedBays([]);
  };

  const handleConfirm = () => {
    const totalArea = selectedBays.reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage), 0);
    onConfirm(totalArea, selectedBays);
    onClose();
  };

  const totalSelectedArea = selectedBays.reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage), 0);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[1000px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Grid3x3 className="h-5 w-5 text-orange-600" />
            Bay Configuration Selection
          </DialogTitle>
          <DialogDescription>
            Select bays to include in the rentable area calculation for this RFP. Red bays are already leased and cannot be selected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              onClick={handleSelectAll}
              variant="outline"
              size="sm"
              className="flex items-center gap-1"
            >
              <Check className="h-4 w-4" />
              Select All
            </Button>
            <Button
              onClick={handleClearAll}
              variant="outline"
              size="sm"
            >
              Clear All
            </Button>
          </div>

          {/* Building Layout */}
          <div className="bg-gray-50 p-4 rounded-lg relative">
            <div className="flex justify-between items-start mb-3">
              <div>
                <Label className="text-sm font-medium text-gray-700">Building Layout</Label>
                <p className="text-xs text-gray-500">Click bays to select for rentable area calculation</p>
              </div>
              
              {/* Professional Compass Rose */}
              <div className="relative">
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
                      property.firstBayDirection === 'north' ? 'text-red-600' : 'text-gray-800'
                    }`}>N</div>
                    <div className={`absolute top-1/2 -right-5 transform -translate-y-1/2 text-sm font-bold ${
                      property.firstBayDirection === 'east' ? 'text-red-600' : 'text-gray-800'
                    }`}>E</div>
                    <div className={`absolute -bottom-5 left-1/2 transform -translate-x-1/2 text-sm font-bold ${
                      property.firstBayDirection === 'south' ? 'text-red-600' : 'text-gray-800'
                    }`}>S</div>
                    <div className={`absolute top-1/2 -left-5 transform -translate-y-1/2 text-sm font-bold ${
                      property.firstBayDirection === 'west' ? 'text-red-600' : 'text-gray-800'
                    }`}>W</div>
                    
                    {/* Diagonal direction labels */}
                    <div className={`absolute top-1 right-1 text-xs font-medium ${
                      property.firstBayDirection === 'northeast' ? 'text-red-600' : 'text-gray-600'
                    }`}>NE</div>
                    <div className={`absolute bottom-1 right-1 text-xs font-medium ${
                      property.firstBayDirection === 'southeast' ? 'text-red-600' : 'text-gray-600'
                    }`}>SE</div>
                    <div className={`absolute bottom-1 left-1 text-xs font-medium ${
                      property.firstBayDirection === 'southwest' ? 'text-red-600' : 'text-gray-600'
                    }`}>SW</div>
                    <div className={`absolute top-1 left-1 text-xs font-medium ${
                      property.firstBayDirection === 'northwest' ? 'text-red-600' : 'text-gray-600'
                    }`}>NW</div>
                  </div>
                  <div className="mt-2 text-center space-y-1">
                    <p className="text-xs font-medium text-gray-700">Building Orientation</p>
                    <p className="text-xs text-gray-500">
                      {property.firstBayDirection 
                        ? `Bay 1 faces ${property.firstBayDirection.charAt(0).toUpperCase() + property.firstBayDirection.slice(1)}`
                        : "Bay orientation not configured"
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Directional Labels */}
            <div className="mb-4">
              <div className="flex justify-between items-center text-xs text-gray-600">
                <div className="flex items-center gap-2">
                  <Navigation className="w-3 h-3 rotate-180" />
                  <span className="font-medium">West Side</span>
                  <span className="text-gray-400">(Street / Entrance)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">(Loading Docks)</span>
                  <span className="font-medium">East Side</span>
                  <Navigation className="w-3 h-3" />
                </div>
              </div>
            </div>
            
            {/* Bay Grid - Narrow buttons to fit all in one row */}
            <div className="relative">
              {/* Bay Numbers Row */}
              <div className="flex gap-1 justify-start overflow-x-auto mb-2">
                {individualBays.map((bay, index) => {
                  const isSelected = selectedBayIds.includes(bay.id);
                  const isLeased = leasedBayIds.includes(bay.id);
                  
                  return (
                    <Button
                      key={bay.id}
                      variant={isSelected ? "default" : "outline"}
                      disabled={isLeased}
                      className={`h-20 w-12 flex flex-col items-center justify-center text-xs p-1 flex-shrink-0 ${
                        isLeased
                          ? "bg-red-800 text-white border-red-900 cursor-not-allowed opacity-95"
                          : isSelected 
                            ? "bg-orange-600 hover:bg-orange-700 text-white border-orange-700" 
                            : "hover:bg-orange-50 border-orange-200 bg-white"
                      }`}
                      onClick={() => toggleBaySelection(bay.id)}
                    >
                      <div className="flex flex-col items-center justify-center h-full">
                        <div className="font-bold text-xs mb-1">
                          {bay.bayName.replace('Bay ', '')}
                        </div>
                        <div className="text-xs opacity-75">
                          {isLeased ? "LEA" : `${((bay.rentableSquareFootage || bay.squareFootage) / 1000).toFixed(0)}K`}
                        </div>
                      </div>
                    </Button>
                  );
                })}
              </div>

              {/* Position indicators below bays */}
              <div className="flex gap-1 justify-start overflow-x-auto">
                {individualBays.map((bay, index) => {
                  const totalBays = individualBays.length;
                  let position = "";
                  
                  if (index === 0) position = "West End";
                  else if (index === totalBays - 1) position = "East End";
                  else if (index < totalBays / 3) position = "West";
                  else if (index > (totalBays * 2) / 3) position = "East";
                  else position = "Center";
                  
                  return (
                    <div key={`pos-${bay.id}`} className="w-12 flex-shrink-0">
                      <div className="text-xs text-center text-gray-500 py-1">
                        {position}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Selection Summary */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="font-medium text-blue-900">
                  Selected: {selectedBays.length} bay{selectedBays.length !== 1 ? 's' : ''}
                </p>
                <p className="text-sm text-blue-700">
                  Total Area: {totalSelectedArea.toLocaleString()} SF
                </p>
              </div>
              {selectedBays.length > 0 && (
                <div className="text-sm text-blue-700">
                  Selected: {selectedBays.map(bay => bay.bayName).join(', ')}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button 
            onClick={handleConfirm}
            disabled={selectedBays.length === 0}
          >
            Confirm Selection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}