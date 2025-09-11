import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Grid, Calculator, RotateCcw, Building, Building2 } from "lucide-react";
import type { Property, BayConfiguration, BuildingCosts } from "@shared/schema";

interface BaySelectionGridProps {
  property?: Property;
  properties?: Property[]; // For multi-building mode
  onSelectionChange?: (
    selectedBays: BayConfiguration[], 
    totalSquareFootage: number,
    selectedBaysPerBuilding?: {[propertyName: string]: BayConfiguration[]},
    costsPerBuilding?: {[propertyName: string]: BuildingCosts}
  ) => void;
  isMultiBuilding?: boolean;
  onMultiBuildingToggle?: (enabled: boolean) => void;
  initialSelectedBays?: BayConfiguration[]; // For single-building mode
  initialSelectedBaysPerBuilding?: {[propertyName: string]: BayConfiguration[]};
  initialCostsPerBuilding?: {[propertyName: string]: BuildingCosts};
}

export function BaySelectionGrid({ 
  property, 
  properties = [], 
  onSelectionChange, 
  isMultiBuilding = false,
  onMultiBuildingToggle,
  initialSelectedBays = [],
  initialSelectedBaysPerBuilding = {},
  initialCostsPerBuilding = {}
}: BaySelectionGridProps) {
  const [selectedBayIds, setSelectedBayIds] = useState<Set<string>>(new Set());
  const [multiBuildingMode, setMultiBuildingMode] = useState(isMultiBuilding);
  const [selectedBaysPerBuilding, setSelectedBaysPerBuilding] = useState<{[propertyName: string]: BayConfiguration[]}>(initialSelectedBaysPerBuilding);
  const [costsPerBuilding, setCostsPerBuilding] = useState<{[propertyName: string]: BuildingCosts}>(initialCostsPerBuilding);
  const [selectedBuildingIds, setSelectedBuildingIds] = useState<{[propertyName: string]: Set<string>}>({});

  // Initialize single-building mode with previous selections
  useEffect(() => {
    if (!multiBuildingMode && initialSelectedBays.length > 0) {
      console.debug('🔧 Initializing single-building mode with previous selections:', initialSelectedBays.length, 'bays');
      const initialBayIds = new Set(initialSelectedBays.map(bay => bay.id));
      setSelectedBayIds(initialBayIds);
    }
  }, [initialSelectedBays.length, multiBuildingMode]);

  // Initialize building selections for multi-building mode
  useEffect(() => {
    if (multiBuildingMode && properties.length > 0) {
      const initialBuildingIds: {[propertyName: string]: Set<string>} = {};
      properties.forEach(prop => {
        const buildingKey = `${prop.propertyName} - Building ${prop.building}`;
        // Use initial data if available, otherwise start with empty set
        const selectedBays = initialSelectedBaysPerBuilding[buildingKey] || selectedBaysPerBuilding[buildingKey] || [];
        initialBuildingIds[buildingKey] = new Set(selectedBays.map(bay => bay.id));
      });
      setSelectedBuildingIds(initialBuildingIds);
      
      // Emit initial state on mount for multi-building mode
      if (Object.keys(initialSelectedBaysPerBuilding).length > 0) {
        console.debug('🔧 Emitting initial multi-building state on mount');
        const allSelectedBays = Object.values(initialSelectedBaysPerBuilding).flat();
        const totalSquareFootage = allSelectedBays.reduce((sum, bay) => 
          sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
        onSelectionChange?.(allSelectedBays, totalSquareFootage, initialSelectedBaysPerBuilding, initialCostsPerBuilding);
      }
    }
  }, [multiBuildingMode, properties.length]);

  // Emit initial state on mount for single-building mode
  useEffect(() => {
    if (!multiBuildingMode && initialSelectedBays.length > 0 && property) {
      console.debug('🔧 Emitting initial single-building state on mount');
      const totalSquareFootage = initialSelectedBays.reduce((sum, bay) => 
        sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
      onSelectionChange?.(initialSelectedBays, totalSquareFootage);
    }
  }, [initialSelectedBays.length, multiBuildingMode, property?.id]);

  // Handle multi-building toggle
  const handleMultiBuildingToggle = (enabled: boolean) => {
    setMultiBuildingMode(enabled);
    onMultiBuildingToggle?.(enabled);
    
    // Clear selections when switching modes
    if (enabled) {
      setSelectedBayIds(new Set());
      setSelectedBaysPerBuilding({});
      setCostsPerBuilding({});
      setSelectedBuildingIds({});
    } else {
      setSelectedBaysPerBuilding({});
      setCostsPerBuilding({});
      setSelectedBuildingIds({});
    }
  };

  // Get sorted bay configurations for a property
  const getSortedBays = (prop: Property) => {
    const sortedBayConfigs = [...(prop.bayConfigurations || [])].sort((a, b) => {
      const aMatch = a.bayName.match(/Bay (\d+)-(\d+)/);
      const bMatch = b.bayName.match(/Bay (\d+)-(\d+)/);
      if (!aMatch || !bMatch) return 0;
      const aStart = parseInt(aMatch[1]);
      const bStart = parseInt(bMatch[1]);
      return aStart - bStart;
    });
    // REVERSE the order so Bay 1 is easternmost (rightmost) and increases westward (leftward)
    return sortedBayConfigs.reverse().filter(bay => bay && bay.id && bay.bayName);
  };

  // Parse bay name to show clean format (Bay 12 instead of Bay 12-13)
  const getBayDisplayName = (bayName: string) => {
    const match = bayName.match(/Bay (\d+)-(\d+)/);
    if (match) {
      return `Bay ${match[1]}`;
    }
    return bayName; // Fallback if no match
  };

  // For single building mode, get bays from the property
  const bays = property ? getSortedBays(property) : [];
  

  // Toggle bay selection for single building mode
  const toggleBaySelection = (bayId: string) => {
    const newSelectedBayIds = new Set(selectedBayIds);
    
    if (newSelectedBayIds.has(bayId)) {
      newSelectedBayIds.delete(bayId);
    } else {
      newSelectedBayIds.add(bayId);
    }
    
    setSelectedBayIds(newSelectedBayIds);
    
    // Calculate selected bays and total rentable square footage (includes mechanical room allocation)
    const selectedBays = bays.filter(bay => newSelectedBayIds.has(bay.id));
    const totalSquareFootage = selectedBays.reduce((total, bay) => total + (bay.rentableSquareFootage || bay.squareFootage), 0);
    
    onSelectionChange?.(selectedBays, totalSquareFootage);
  };

  // Toggle bay selection for multi-building mode
  const toggleMultiBuildingBaySelection = (buildingKey: string, bayId: string, bay: BayConfiguration) => {
    console.log('🔧 Bay click detected:', { buildingKey, bayId, bay: bay.bayName });
    
    // Ensure the building exists in selectedBuildingIds
    if (!selectedBuildingIds[buildingKey]) {
      setSelectedBuildingIds(prev => ({
        ...prev,
        [buildingKey]: new Set()
      }));
    }
    
    const currentBuildingIds = selectedBuildingIds[buildingKey] instanceof Set 
      ? selectedBuildingIds[buildingKey] 
      : new Set();
    const newBuildingIds = new Set(currentBuildingIds);
    
    if (newBuildingIds.has(bayId)) {
      newBuildingIds.delete(bayId);
    } else {
      newBuildingIds.add(bayId);
    }
    
    // Update the building-specific selections
    const newSelectedBuildingIds: {[propertyName: string]: Set<string>} = {};
    
    // Copy existing selections (ensure they are Sets)
    Object.keys(selectedBuildingIds).forEach(key => {
      const existing = selectedBuildingIds[key];
      newSelectedBuildingIds[key] = existing instanceof Set ? existing : new Set<string>();
    });
    
    // Update the current building's selection
    newSelectedBuildingIds[buildingKey] = newBuildingIds as Set<string>;
    setSelectedBuildingIds(newSelectedBuildingIds);
    
    // Get all bays for this building and filter selected ones
    const property = properties.find(p => `${p.propertyName} - Building ${p.building}` === buildingKey);
    if (property) {
      const propertyBays = getSortedBays(property);
      const selectedBaysForBuilding = propertyBays.filter(bay => newBuildingIds.has(bay.id));
      
      // Update selected bays per building
      const newSelectedBaysPerBuilding = {
        ...selectedBaysPerBuilding,
        [buildingKey]: selectedBaysForBuilding
      };
      setSelectedBaysPerBuilding(newSelectedBaysPerBuilding);
      
      // Calculate totals for all buildings
      const allSelectedBays: BayConfiguration[] = [];
      let totalSquareFootage = 0;
      
      Object.values(newSelectedBaysPerBuilding).forEach(buildingBays => {
        allSelectedBays.push(...buildingBays);
        totalSquareFootage += buildingBays.reduce((total, bay) => total + (bay.rentableSquareFootage || bay.squareFootage), 0);
      });
      
      // Notify parent component
      onSelectionChange?.(allSelectedBays, totalSquareFootage, newSelectedBaysPerBuilding, costsPerBuilding);
    }
  };

  const clearSelection = () => {
    if (multiBuildingMode) {
      setSelectedBuildingIds({});
      setSelectedBaysPerBuilding({});
      setCostsPerBuilding({});
      onSelectionChange?.([], 0, {}, {});
    } else {
      setSelectedBayIds(new Set());
      onSelectionChange?.([], 0);
    }
  };

  // Update costs for a specific building
  const updateBuildingCosts = (propertyName: string, costs: BuildingCosts) => {
    const newCostsPerBuilding = {
      ...costsPerBuilding,
      [propertyName]: costs
    };
    setCostsPerBuilding(newCostsPerBuilding);
    
    // Recalculate totals and notify parent
    const allSelectedBays: BayConfiguration[] = [];
    let totalSquareFootage = 0;
    
    Object.values(selectedBaysPerBuilding).forEach(buildingBays => {
      allSelectedBays.push(...buildingBays);
      totalSquareFootage += buildingBays.reduce((total, bay) => total + (bay.rentableSquareFootage || bay.squareFootage), 0);
    });
    
    onSelectionChange?.(allSelectedBays, totalSquareFootage, selectedBaysPerBuilding, newCostsPerBuilding);
  };

  const getBayColor = (isSelected: boolean) => {
    return isSelected
      ? 'bg-orange-100 border-orange-500 text-orange-900'
      : 'bg-gray-100 border-gray-300 text-gray-800';
  };

  // Calculate totals for display
  let selectedBays: BayConfiguration[] = [];
  let totalSquareFootage = 0;
  
  if (multiBuildingMode) {
    Object.values(selectedBaysPerBuilding).forEach(buildingBays => {
      selectedBays.push(...buildingBays);
      totalSquareFootage += buildingBays.reduce((total, bay) => total + (bay.rentableSquareFootage || bay.squareFootage), 0);
    });
  } else {
    selectedBays = bays.filter(bay => selectedBayIds.has(bay.id));
    totalSquareFootage = selectedBays.reduce((total, bay) => total + (bay.rentableSquareFootage || bay.squareFootage), 0);
  }

  // Check if we have any data to display
  const hasData = multiBuildingMode ? properties.length > 0 : (property && bays.length > 0);
  
  if (!hasData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Grid className="h-5 w-5" />
            <span>Bay Selection Grid</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <Grid className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p>{multiBuildingMode ? "No properties available for multi-building selection." : "No bays configured for this property."}</p>
            <p className="text-sm">{multiBuildingMode ? "Select properties to enable multi-building mode." : "Edit the property to add bay definitions."}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            {multiBuildingMode ? <Building2 className="h-5 w-5" /> : <Grid className="h-5 w-5" />}
            <span>
              {multiBuildingMode 
                ? (() => {
                    const propertiesWithInitialSelections = Object.keys(initialSelectedBaysPerBuilding);
                    const filteredCount = propertiesWithInitialSelections.length > 0 
                      ? properties.filter(prop => {
                          const buildingKey = `${prop.propertyName} - Building ${prop.building}`;
                          return propertiesWithInitialSelections.includes(buildingKey);
                        }).length
                      : properties.length;
                    return `Multi-Building Bay Selection (${filteredCount} properties)`;
                  })()
                : `Bay Selection Grid - ${property?.propertyName || 'Property'}`
              }
            </span>
          </CardTitle>
          <div className="flex items-center space-x-4">
            {/* Multi-Building Toggle */}
            {onMultiBuildingToggle && (
              <div className="flex items-center space-x-2">
                <Label htmlFor="multi-building-toggle" className="text-sm font-medium">
                  Multi-Building
                </Label>
                <Switch
                  id="multi-building-toggle"
                  checked={multiBuildingMode}
                  onCheckedChange={handleMultiBuildingToggle}
                />
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={clearSelection}
              disabled={multiBuildingMode ? Object.keys(selectedBaysPerBuilding).length === 0 : selectedBayIds.size === 0}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Clear All
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {multiBuildingMode ? (
          /* Multi-Building Mode */
          <div className="space-y-6">
            {(() => {
              // In multi-building mode, always show all properties
              // Initial selections will just pre-populate the bay configurations
              return properties;
            })().map((prop) => {
              const propBays = getSortedBays(prop);
              const buildingKey = `${prop.propertyName} - Building ${prop.building}`;
              const propSelectedIds = selectedBuildingIds[buildingKey] || new Set();
              const propSelectedBays = propBays.filter(bay => propSelectedIds.has(bay.id));
              const propTotalSF = propSelectedBays.reduce((total, bay) => total + (bay.rentableSquareFootage || bay.squareFootage), 0);
              
              return (
                <div key={prop.id} className="border rounded-lg p-4 bg-gray-50">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <Building className="h-5 w-5" />
                      {prop.propertyName} - Building {prop.building}
                    </h3>
                    <Badge variant="secondary">
                      {propSelectedBays.length} of {propBays.length} bays
                    </Badge>
                  </div>
                  
                  {/* Bay Grid for this property */}
                  <div className="overflow-x-auto pb-2">
                    <div className="flex gap-1 justify-center" style={{ minWidth: 'max-content' }}>
                      {propBays.filter(bay => bay && bay.id && bay.bayName).map((bay) => (
                        <div key={bay.id} className="flex-shrink-0">
                          <button
                            onClick={() => toggleMultiBuildingBaySelection(`${prop.propertyName} - Building ${prop.building}`, bay.id, bay)}
                            className={`
                              w-12 h-36 p-0.5 rounded border-2 transition-all duration-200
                              flex flex-col items-center justify-center text-xs font-medium
                              hover:shadow-md focus:outline-none focus:ring-2 focus:ring-orange-500
                              ${propSelectedIds.has(bay.id) 
                                ? 'ring-2 ring-orange-500 shadow-lg' 
                                : ''
                              }
                              ${getBayColor(propSelectedIds.has(bay.id))}
                            `}
                          >
                            <div className="text-center w-full">
                              <div className="font-bold" style={{fontSize: '9px', lineHeight: '10px', marginBottom: '2px'}}>{getBayDisplayName(bay.bayName)}</div>
                              <div className="text-gray-600" style={{fontSize: '8px', lineHeight: '9px', marginBottom: '2px'}}>{Math.round((bay.rentableSquareFootage || bay.squareFootage) / 1000)}k</div>
                              
                              {/* Vertical Stack: Doors → Amenities */}
                              <div className="flex flex-col items-center gap-px">
                                {/* Standard Dock Doors */}
                                {bay.standardDockDoors > 0 && (
                                  <span className="text-blue-600" style={{fontSize: '8px', lineHeight: '9px'}} title={`${bay.standardDockDoors} Standard Dock Doors`}>
                                    {bay.standardDockDoors}🚛
                                  </span>
                                )}
                                {/* Oversized Dock Doors */}
                                {bay.oversizedDockDoors > 0 && (
                                  <span className="text-purple-600" style={{fontSize: '8px', lineHeight: '9px'}} title={`${bay.oversizedDockDoors} Oversized Dock Doors`}>
                                    {bay.oversizedDockDoors}🚚
                                  </span>
                                )}
                                {/* Storefront Entry */}
                                {bay.hasStorefrontEntry && (
                                  <span className="text-orange-600" style={{fontSize: '10px', lineHeight: '11px'}} title="Storefront Entry">🚪</span>
                                )}
                                {/* Speculative Office */}
                                {bay.hasSpeculativeOffice && (
                                  <span className="text-blue-600" style={{fontSize: '10px', lineHeight: '11px'}} title="Speculative Office">🏢</span>
                                )}
                                {/* Restroom */}
                                {bay.hasRestroom && (
                                  <span className="text-green-600" style={{fontSize: '10px', lineHeight: '11px'}} title="Restroom">🚽</span>
                                )}
                              </div>
                            </div>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* Property-specific summary */}
                  <div className="bg-white p-3 rounded-lg mt-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Selected: {propTotalSF.toLocaleString()} sq ft</span>
                      <div className="flex flex-wrap gap-2">
                        {propSelectedBays.map((bay) => (
                          <Badge key={bay.id} variant="outline" className="text-xs">
                            {getBayDisplayName(bay.bayName)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Single Building Mode */
          <div className="space-y-2">
            <div className="overflow-x-auto pb-4">
              <div className="flex gap-1 justify-center" style={{ minWidth: 'max-content' }}>
                {bays.filter(bay => bay && bay.id && bay.bayName).map((bay) => (
                  <div key={bay.id} className="flex-shrink-0">
                    <button
                      onClick={() => toggleBaySelection(bay.id)}
                      className={`
                        w-12 h-36 p-0.5 rounded border-2 transition-all duration-200
                        flex flex-col items-center justify-center text-xs font-medium
                        hover:shadow-md focus:outline-none focus:ring-2 focus:ring-orange-500
                        ${selectedBayIds.has(bay.id) 
                          ? 'ring-2 ring-orange-500 shadow-lg' 
                          : ''
                        }
                        ${getBayColor(selectedBayIds.has(bay.id))}
                      `}
                      data-testid={`bay-button-${getBayDisplayName(bay.bayName).replace(/\s/g, '-')}`}
                    >
                      <div className="text-center w-full">
                        <div className="font-bold" style={{fontSize: '9px', lineHeight: '10px', marginBottom: '2px'}}>{getBayDisplayName(bay.bayName)}</div>
                        <div className="text-gray-600" style={{fontSize: '8px', lineHeight: '9px', marginBottom: '2px'}}>{Math.round((bay.rentableSquareFootage || bay.squareFootage) / 1000)}k</div>
                        
                        {/* Vertical Stack: Doors → Amenities */}
                        <div className="flex flex-col items-center gap-px">
                          {/* Standard Dock Doors */}
                          {bay.standardDockDoors > 0 && (
                            <span className="text-blue-600" style={{fontSize: '8px', lineHeight: '9px'}} title={`${bay.standardDockDoors} Standard Dock Doors`}>
                              {bay.standardDockDoors}🚛
                            </span>
                          )}
                          {/* Oversized Dock Doors */}
                          {bay.oversizedDockDoors > 0 && (
                            <span className="text-purple-600" style={{fontSize: '8px', lineHeight: '9px'}} title={`${bay.oversizedDockDoors} Oversized Dock Doors`}>
                              {bay.oversizedDockDoors}🚚
                            </span>
                          )}
                          {/* Storefront Entry */}
                          {bay.hasStorefrontEntry && (
                            <span className="text-orange-600" style={{fontSize: '10px', lineHeight: '11px'}} title="Storefront Entry">🚪</span>
                          )}
                          {/* Speculative Office */}
                          {bay.hasSpeculativeOffice && (
                            <span className="text-blue-600" style={{fontSize: '10px', lineHeight: '11px'}} title="Speculative Office">🏢</span>
                          )}
                          {/* Restroom */}
                          {bay.hasRestroom && (
                            <span className="text-green-600" style={{fontSize: '10px', lineHeight: '11px'}} title="Restroom">🚽</span>
                          )}
                        </div>
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Selection Summary */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Calculator className="h-5 w-5 text-blue-600" />
              <span className="font-medium">
                {multiBuildingMode ? 'Multi-Building Selection Summary' : 'Selection Summary'}
              </span>
            </div>
            <Badge variant="secondary">
              {multiBuildingMode 
                ? (() => {
                    const buildingBreakdown = Object.entries(selectedBaysPerBuilding)
                      .filter(([_, bays]) => bays.length > 0)
                      .map(([buildingKey, bays]) => {
                        // Extract building number from key like "Bridge Point Miami Station - Building 1"
                        const buildingNumber = buildingKey.split(' - Building ')[1] || '?';
                        return `Building ${buildingNumber}: ${bays.length} bays`;
                      })
                      .join(', ');
                    return buildingBreakdown || '0 bays selected';
                  })()
                : `${selectedBays.length} of ${bays.length} bays selected`
              }
            </Badge>
          </div>
          
          <div className="text-center">
            <p className="text-sm text-gray-600">Total Square Footage</p>
            <p className="text-2xl font-bold text-blue-600">
              {totalSquareFootage.toLocaleString()} sq ft
            </p>
          </div>

          {multiBuildingMode && Object.keys(selectedBaysPerBuilding).length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-gray-600 mb-2">Per-Building Breakdown:</p>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(selectedBaysPerBuilding)
                  .filter(([_, bays]) => bays.length > 0)
                  .map(([buildingKey, bays]) => {
                    // Extract building number from key like "Bridge Point Miami Station - Building 1"
                    const buildingNumber = buildingKey.split(' - Building ')[1] || '?';
                    const buildingSquareFootage = bays.reduce((total, bay) => total + (bay.rentableSquareFootage || bay.squareFootage), 0);
                    return (
                      <div key={buildingKey} className="bg-white p-3 rounded border">
                        <p className="text-sm font-medium text-gray-800">Building {buildingNumber}</p>
                        <p className="text-lg font-bold text-blue-600">{buildingSquareFootage.toLocaleString()} sq ft</p>
                        <p className="text-xs text-gray-500">{bays.length} bays selected</p>
                      </div>
                    );
                  })
                }
              </div>
            </div>
          )}

          {selectedBays.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-gray-600 mb-2">Selected Bays:</p>
              <div className="overflow-x-auto">
                <div className="flex flex-wrap gap-2" style={{ maxWidth: `${bays.length * 48 + (bays.length - 1) * 4}px` }}>
                  {selectedBays.map((bay) => (
                    <Badge 
                      key={bay.id} 
                      variant="outline"
                      className={getBayColor(true)}
                    >
                      {getBayDisplayName(bay.bayName)} ({(bay.rentableSquareFootage || bay.squareFootage).toLocaleString()} sq ft)
                      {bay.hasStorefrontEntry && <span className="text-orange-600 ml-1" title="Storefront Entry">🚪</span>}
                      {bay.hasSpeculativeOffice && <span className="text-blue-600 ml-1" title="Speculative Office">🏢</span>}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

      </CardContent>
    </Card>
  );
}