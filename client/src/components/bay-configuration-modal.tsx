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
import { Grid3x3, Building2, Settings, ArrowLeft } from "lucide-react";
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
  // Props used by create modal (add to interface)
  onBaysPerBuildingChange?: (bays: {[propertyName: string]: BayConfiguration[]}) => void;
  costsPerBuilding?: {[propertyName: string]: BuildingCosts};
  onCostsPerBuildingChange?: (costs: {[propertyName: string]: BuildingCosts}) => void;
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
  initialCostsPerBuilding = {},
  onBaysPerBuildingChange,
  costsPerBuilding = {},
  onCostsPerBuildingChange
}: BayConfigurationModalProps) {
  const [currentArea, setCurrentArea] = useState<number>(0);
  const [currentBays, setCurrentBays] = useState<BayConfiguration[]>([]);
  const [currentOverride, setCurrentOverride] = useState<number | undefined>(initialOverrideArea);
  const [currentSelectedBaysPerBuilding, setCurrentSelectedBaysPerBuilding] = useState<{[propertyName: string]: BayConfiguration[]}>(initialSelectedBaysPerBuilding);
  const [currentCostsPerBuilding, setCurrentCostsPerBuilding] = useState<{[propertyName: string]: BuildingCosts}>(initialCostsPerBuilding);
  
  // Master-detail interface state for multi-building mode
  const [currentBuildingKey, setCurrentBuildingKey] = useState<string | null>(null);

  // Fetch full property data with bay configurations when modal is open (single building mode)
  const { data: fullProperty, isLoading: isSinglePropertyLoading } = useQuery<Property>({
    queryKey: [`/api/properties/${property?.id}`],
    enabled: isOpen && !isMultiBuilding && !!property?.id,
    staleTime: 0,
    refetchOnMount: true,
  });

  // Use parent-provided properties for multi-building mode instead of fetching
  // This prevents showing wrong properties and improves performance
  const allProperties = properties || [];
  const isPropertiesLoading = false; // No loading since we use parent data

  // DEBUG: Log what properties are actually being received
  if (isOpen && isMultiBuilding) {
    console.log('🔧 BAY MODAL DEBUG:', {
      isOpen,
      isMultiBuilding,
      propertiesReceived: properties?.length || 0,
      allPropertiesLength: allProperties.length,
      propertiesArray: properties?.map(p => `${p.propertyName} - Building ${p.building}`) || []
    });
  }

  // Use appropriate data based on mode
  const propertyWithBayConfigs = fullProperty || property;
  
  // For multi-building mode, ALWAYS use parent-provided filtered properties
  // This ensures we only show buildings from the same property park
  const propertiesWithBayConfigs = isMultiBuilding ? 
    (properties || []) : 
    (propertyWithBayConfigs ? [propertyWithBayConfigs] : []);
  const isLoading = isMultiBuilding ? isPropertiesLoading : isSinglePropertyLoading;

  // Debug logging for bay configuration modal
  if (isOpen && isMultiBuilding) {
    console.log('🚨 BAY CONFIG MODAL DEBUG:', {
      isOpen,
      isMultiBuilding,
      propertiesFromParent: properties?.length || 0,
      propertiesFromParentArray: properties,
      propertiesWithBayConfigsLength: propertiesWithBayConfigs.length,
      propertiesWithBayConfigsArray: propertiesWithBayConfigs
    });
  }



  // Helper to generate building key
  const getBuildingKey = (property: Property) => {
    return `${property.propertyName} - Building ${property.building}`;
  };

  // Helper to get selection summary for a building
  const getBuildingSummary = (buildingKey: string) => {
    const selectedBays = currentSelectedBaysPerBuilding[buildingKey] || [];
    const totalSF = selectedBays.reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage), 0);
    return {
      bayCount: selectedBays.length,
      totalSF: totalSF
    };
  };

  // Handle area changes from the bay selection grid
  const handleAreaChange = useCallback((selectedBays: BayConfiguration[], totalSquareFootage: number, selectedBaysPerBuilding?: {[propertyName: string]: BayConfiguration[]}, costsPerBuilding?: {[propertyName: string]: BuildingCosts}) => {
    setCurrentArea(totalSquareFootage);
    setCurrentBays(selectedBays);
    setCurrentSelectedBaysPerBuilding(selectedBaysPerBuilding || {});
    setCurrentCostsPerBuilding(costsPerBuilding || {});
  }, []);

  // Calculate aggregate totals for multi-building mode
  const getTotalSelections = () => {
    if (!isMultiBuilding) {
      return {
        totalBays: currentBays.length,
        totalArea: currentArea
      };
    }

    const allSelectedBays = Object.values(currentSelectedBaysPerBuilding).flat();
    const totalArea = allSelectedBays.reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage), 0);
    
    return {
      totalBays: allSelectedBays.length,
      totalArea: totalArea
    };
  };

  const handleConfirm = () => {
    const { totalBays, totalArea } = getTotalSelections();
    
    console.log('🔧 BayConfigurationModal handleConfirm called with:', {
      currentArea,
      totalArea,
      currentBaysLength: currentBays.length,
      totalBays,
      currentSelectedBaysPerBuilding,
      currentCostsPerBuilding,
      isMultiBuilding
    });
    
    // Use aggregated totals for multi-building mode
    const finalArea = isMultiBuilding ? totalArea : currentArea;
    const finalBays = isMultiBuilding ? Object.values(currentSelectedBaysPerBuilding).flat() : currentBays;
    
    onConfirm(finalArea, finalBays, currentOverride, currentSelectedBaysPerBuilding, currentCostsPerBuilding);
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
        
        {/* Content Area */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">
              <div className="animate-spin h-8 w-8 border-4 border-orange-600 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p>Loading bay configurations...</p>
            </div>
          ) : isMultiBuilding ? (
            // Multi-building master-detail interface
            <div className="flex h-full min-h-[400px]">
              {/* Left: Property List */}
              <div className="w-80 border-r border-gray-200 flex flex-col">
                <div className="p-4 border-b bg-gray-50">
                  <h3 className="font-medium text-gray-900">Available Buildings</h3>
                  <p className="text-sm text-gray-600 mt-1">Click Configure to set up bays for each building</p>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {propertiesWithBayConfigs.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <Building2 className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                      <p>No properties available for multi-building selection.</p>
                      <p className="text-sm mt-1">Select properties to enable multi-building mode.</p>
                    </div>
                  ) : (
                    <div className="p-2">
                      {propertiesWithBayConfigs.map((prop) => {
                        const buildingKey = getBuildingKey(prop);
                        const summary = getBuildingSummary(buildingKey);
                        const isConfiguring = currentBuildingKey === buildingKey;
                        
                        return (
                          <div 
                            key={buildingKey}
                            className={`p-3 mb-2 rounded-lg border ${
                              isConfiguring 
                                ? 'border-orange-500 bg-orange-50' 
                                : 'border-gray-200 bg-white hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-gray-900 truncate">
                                  {prop.propertyName}
                                </h4>
                                <p className="text-sm text-gray-600">
                                  Building {prop.building}
                                </p>
                                {summary.bayCount > 0 && (
                                  <p className="text-xs text-green-600 mt-1">
                                    {summary.bayCount} bays • {summary.totalSF.toLocaleString()} SF
                                  </p>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant={isConfiguring ? "default" : "outline"}
                                onClick={() => setCurrentBuildingKey(isConfiguring ? null : buildingKey)}
                                className={isConfiguring ? "bg-orange-600 hover:bg-orange-700 text-white" : ""}
                              >
                                <Settings className="h-4 w-4 mr-1" />
                                {isConfiguring ? "Close" : "Configure"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Bay Configurator for Selected Building */}
              <div className="flex-1 flex flex-col">
                {currentBuildingKey ? (
                  <>
                    <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-gray-900">Configuring: {currentBuildingKey}</h3>
                        <p className="text-sm text-gray-600 mt-1">Select bays for this building</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCurrentBuildingKey(null)}
                      >
                        <ArrowLeft className="h-4 w-4 mr-1" />
                        Back to List
                      </Button>
                    </div>
                    <div className="flex-1 overflow-auto">
                      {(() => {
                        const selectedProperty = propertiesWithBayConfigs.find(p => getBuildingKey(p) === currentBuildingKey);
                        return selectedProperty ? (
                          <BaySelectionGrid
                            properties={[selectedProperty]}
                            isMultiBuilding={true}
                            onSelectionChange={handleAreaChange}
                            initialSelectedBaysPerBuilding={currentSelectedBaysPerBuilding}
                            initialCostsPerBuilding={currentCostsPerBuilding}
                          />
                        ) : null;
                      })()}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-gray-500">
                    <div className="text-center">
                      <Settings className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                      <p>Select a building to configure its bays</p>
                      <p className="text-sm mt-1">Click "Configure" on any building to get started</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Single building mode (unchanged)
            <BaySelectionGrid
              property={propertyWithBayConfigs}
              isMultiBuilding={false}
              onSelectionChange={handleAreaChange}
              initialSelectedBays={initialSelectedBays}
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
            disabled={getTotalSelections().totalBays === 0}
          >
            Confirm Selection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}