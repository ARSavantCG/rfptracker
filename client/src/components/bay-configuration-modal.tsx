import { useState, useEffect } from "react";
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
import { Grid3x3, Check } from "lucide-react";
import type { Property, BayConfiguration } from "@shared/schema";

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
    setSelectedBayIds(individualBays.map(bay => bay.id));
    setSelectedBays([...individualBays]);
  };

  const handleClearAll = () => {
    setSelectedBayIds([]);
    setSelectedBays([]);
  };

  const handleConfirm = () => {
    const totalArea = selectedBays.reduce((sum, bay) => sum + bay.squareFootage, 0);
    onConfirm(totalArea, selectedBays);
    onClose();
  };

  const totalSelectedArea = selectedBays.reduce((sum, bay) => sum + bay.squareFootage, 0);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[1000px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Grid3x3 className="h-5 w-5 text-orange-600" />
            Bay Configuration Selection
          </DialogTitle>
          <DialogDescription>
            Select bays to include in the rentable area calculation for this RFP
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
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="mb-3">
              <Label className="text-sm font-medium text-gray-700">Building Layout</Label>
              <p className="text-xs text-gray-500">Click bays to select for rentable area calculation</p>
            </div>
            
            {/* Bay Grid - More space available */}
            <div className="flex gap-2 justify-start flex-wrap">
              {individualBays.map((bay) => {
                const isSelected = selectedBayIds.includes(bay.id);
                return (
                  <Button
                    key={bay.id}
                    variant={isSelected ? "default" : "outline"}
                    className={`h-24 w-20 flex flex-col items-center justify-center text-xs p-2 flex-shrink-0 ${
                      isSelected 
                        ? "bg-orange-600 hover:bg-orange-700 text-white border-orange-700" 
                        : "hover:bg-orange-50 border-orange-200 bg-white"
                    }`}
                    onClick={() => toggleBaySelection(bay.id)}
                  >
                    <div className="font-bold text-sm mb-1">{bay.bayName}</div>
                    <div className="text-xs opacity-75 leading-tight">
                      {(bay.squareFootage / 1000).toFixed(0)}K SF
                    </div>
                    {(bay.standardDockDoors > 0 || bay.oversizedDockDoors > 0) && (
                      <div className="text-xs opacity-60 leading-tight mt-1">
                        {bay.standardDockDoors + bay.oversizedDockDoors} Doors
                      </div>
                    )}
                  </Button>
                );
              })}
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