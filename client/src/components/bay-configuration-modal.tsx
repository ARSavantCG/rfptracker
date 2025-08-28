import { useState } from "react";
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
import { Grid3x3 } from "lucide-react";
import BayConfigurationSelector from "./bay-configuration-selector";
import type { Property, BayConfiguration } from "@shared/schema";

interface BayConfigurationModalProps {
  isOpen: boolean;
  onClose: () => void;
  property: Property;
  onConfirm: (area: number, selectedBays: BayConfiguration[], overrideArea?: number) => void;
  initialSelectedBays?: BayConfiguration[];
  initialOverrideArea?: number;
}

export function BayConfigurationModal({ 
  isOpen, 
  onClose, 
  property, 
  onConfirm,
  initialSelectedBays = [],
  initialOverrideArea
}: BayConfigurationModalProps) {
  const [currentArea, setCurrentArea] = useState<number>(0);
  const [currentBays, setCurrentBays] = useState<BayConfiguration[]>([]);
  const [currentOverride, setCurrentOverride] = useState<number | undefined>(initialOverrideArea);

  // Fetch full property data with bay configurations when modal is open
  const { data: fullProperty, isLoading, error } = useQuery<Property>({
    queryKey: [`/api/properties/${property?.id}`],
    enabled: isOpen && !!property?.id,
    staleTime: 0,
    refetchOnMount: true,
  });


  // Use full property data if available, otherwise fallback to prop
  const propertyWithBayConfigs = fullProperty || property;



  // Handle area changes from the bay configuration selector
  const handleAreaChange = (area: number, selectedBays: BayConfiguration[], overrideArea?: number) => {
    console.log('🔧 Bay Configuration Modal - handleAreaChange called:', {
      area,
      selectedBaysCount: selectedBays.length,
      selectedBays,
      overrideArea
    });
    setCurrentArea(area);
    setCurrentBays(selectedBays);
    setCurrentOverride(overrideArea);
  };

  const handleConfirm = () => {
    onConfirm(currentArea, currentBays, currentOverride);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-fit min-w-[600px] max-w-[90vw] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Grid3x3 className="h-5 w-5 text-orange-600" />
            Bay Configuration Selection
          </DialogTitle>
          <DialogDescription>
            Select bays for rentable area calculation. You can override the calculated area if needed for existing leases.
          </DialogDescription>
        </DialogHeader>
        
        {/* Scrollable Content Area - allows both vertical and horizontal scrolling */}
        <div className="flex-1 overflow-auto">
          <BayConfigurationSelector
            property={propertyWithBayConfigs}
            onRentableAreaChange={handleAreaChange}
            initialSelectedBays={initialSelectedBays}
            initialOverrideArea={initialOverrideArea}
          />
        </div>

        {/* Fixed Footer - always visible at bottom */}
        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={() => {
              console.log('🔧 Confirm Selection clicked - current state:', {
                currentBaysLength: currentBays.length,
                currentBays,
                currentArea,
                disabled: currentBays.length === 0
              });
              handleConfirm();
            }}
            className="bg-orange-600 hover:bg-orange-700 text-white"
            disabled={currentBays.length === 0}
          >
            Confirm Selection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}