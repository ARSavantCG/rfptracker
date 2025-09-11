import { useState, useCallback } from "react";
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
import { Grid3x3, Building2 } from "lucide-react";
import { BaySelectionGrid } from "./bay-selection-grid";
import type { Property, BayConfiguration, BuildingCosts } from "@shared/schema";

interface BayConfigurationModalProps {
  isOpen: boolean;
  onClose: () => void;
  property?: Property; // Optional for single building mode
  properties?: Property[]; // For multi-building mode
  isMultiBuilding?: boolean;
  onConfirm: (
    area: number, 
    selectedBays: BayConfiguration[], 
    overrideArea?: number,
    selectedBaysPerBuilding?: {[propertyName: string]: BayConfiguration[]},
    costsPerBuilding?: {[propertyName: string]: BuildingCosts}
  ) => void;
  initialSelectedBays?: BayConfiguration[];
  initialOverrideArea?: number;
  initialSelectedBaysPerBuilding?: {[propertyName: string]: BayConfiguration[]};
  initialCostsPerBuilding?: {[propertyName: string]: BuildingCosts};
}

export function BayConfigurationModal({ 
  isOpen, 
  onClose, 
  property, 
  properties = [],
  isMultiBuilding = false,
  onConfirm,
  initialSelectedBays = [],
  initialOverrideArea,
  initialSelectedBaysPerBuilding = {},
  initialCostsPerBuilding = {}
}: BayConfigurationModalProps) {
  const [currentArea, setCurrentArea] = useState<number>(0);
  const [currentBays, setCurrentBays] = useState<BayConfiguration[]>([]);
  const [currentOverride, setCurrentOverride] = useState<number | undefined>(initialOverrideArea);
  const [currentSelectedBaysPerBuilding, setCurrentSelectedBaysPerBuilding] = useState<{[propertyName: string]: BayConfiguration[]}>(initialSelectedBaysPerBuilding);
  const [currentCostsPerBuilding, setCurrentCostsPerBuilding] = useState<{[propertyName: string]: BuildingCosts}>(initialCostsPerBuilding);

  // Fetch full property data with bay configurations when modal is open (single building mode)
  const { data: fullProperty, isLoading: isSinglePropertyLoading } = useQuery<Property>({
    queryKey: [`/api/properties/${property?.id}`],
    enabled: isOpen && !isMultiBuilding && !!property?.id,
    staleTime: 0,
    refetchOnMount: true,
  });

  // Fetch all properties data for multi-building mode
  const { data: allProperties = [], isLoading: isPropertiesLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    enabled: isOpen && isMultiBuilding,
    staleTime: 0,
    refetchOnMount: true,
  });

  // Use appropriate data based on mode
  const propertyWithBayConfigs = fullProperty || property;
  
  // For multi-building mode, filter to only buildings within the same property
  const propertiesWithBayConfigs = isMultiBuilding && property ? 
    allProperties.filter(p => p.propertyName === property.propertyName) : 
    (propertyWithBayConfigs ? [propertyWithBayConfigs] : []);
  const isLoading = isMultiBuilding ? isPropertiesLoading : isSinglePropertyLoading;



  // Handle area changes from the bay selection grid
  const handleAreaChange = useCallback((selectedBays: BayConfiguration[], totalSquareFootage: number, selectedBaysPerBuilding?: {[propertyName: string]: BayConfiguration[]}, costsPerBuilding?: {[propertyName: string]: BuildingCosts}) => {
    setCurrentArea(totalSquareFootage);
    setCurrentBays(selectedBays);
    setCurrentSelectedBaysPerBuilding(selectedBaysPerBuilding || {});
    setCurrentCostsPerBuilding(costsPerBuilding || {});
  }, []);

  const handleConfirm = () => {
    console.log('🔧 BayConfigurationModal handleConfirm called with:', {
      currentArea,
      currentBaysLength: currentBays.length,
      currentSelectedBaysPerBuilding,
      currentCostsPerBuilding,
      isMultiBuilding
    });
    onConfirm(currentArea, currentBays, currentOverride, currentSelectedBaysPerBuilding, currentCostsPerBuilding);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[780px] max-w-[90vw] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isMultiBuilding ? <Building2 className="h-5 w-5 text-orange-600" /> : <Grid3x3 className="h-5 w-5 text-orange-600" />}
            {isMultiBuilding ? 'Multi-Building Bay Selection' : 'Bay Configuration Selection'}
          </DialogTitle>
          <DialogDescription>
            {isMultiBuilding 
              ? 'Select bays across multiple buildings for tenants requiring space in the same park.'
              : 'Select bays for rentable area calculation. You can override the calculated area if needed for existing leases.'
            }
          </DialogDescription>
        </DialogHeader>
        
        {/* Scrollable Content Area - allows both vertical and horizontal scrolling */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">
              <div className="animate-spin h-8 w-8 border-4 border-orange-600 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p>Loading bay configurations...</p>
            </div>
          ) : (
            <BaySelectionGrid
              property={!isMultiBuilding ? propertyWithBayConfigs : undefined}
              properties={isMultiBuilding ? propertiesWithBayConfigs : undefined}
              isMultiBuilding={isMultiBuilding}
              onSelectionChange={handleAreaChange}
              initialSelectedBaysPerBuilding={initialSelectedBaysPerBuilding}
              initialCostsPerBuilding={initialCostsPerBuilding}
            />
          )}
        </div>

        {/* Fixed Footer - always visible at bottom */}
        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm}
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