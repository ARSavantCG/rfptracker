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
  initialSelectedBaysPerBuilding?: {[propertyName: string]: BayConfiguration[]};
  initialCostsPerBuilding?: {[propertyName: string]: BuildingCosts};
}

export function BaySelectionGrid({ 
  property, 
  properties = [], 
  onSelectionChange, 
  isMultiBuilding = false,
  onMultiBuildingToggle,
  initialSelectedBaysPerBuilding = {},
  initialCostsPerBuilding = {}
}: BaySelectionGridProps) {
  const [selectedBayIds, setSelectedBayIds] = useState<Set<string>>(new Set());
  const [multiBuildingMode, setMultiBuildingMode] = useState(isMultiBuilding);
  const [selectedBaysPerBuilding, setSelectedBaysPerBuilding] = useState<{[propertyName: string]: BayConfiguration[]}>(initialSelectedBaysPerBuilding);
  const [costsPerBuilding, setCostsPerBuilding] = useState<{[propertyName: string]: BuildingCosts}>(initialCostsPerBuilding);
  const [selectedBuildingIds, setSelectedBuildingIds] = useState<{[propertyName: string]: Set<string>}>({});

  // Initialize building selections for multi-building mode
  useEffect(() => {
    if (multiBuildingMode && properties.length > 0) {
      const initialBuildingIds: {[propertyName: string]: Set<string>} = {};
      properties.forEach(prop => {
        const propName = prop.propertyName;
        const selectedBays = selectedBaysPerBuilding[propName] || [];
        initialBuildingIds[propName] = new Set(selectedBays.map(bay => bay.id));
      });
      console.log('🔧 Initializing selectedBuildingIds:', initialBuildingIds);
      setSelectedBuildingIds(initialBuildingIds);
    }
  }, [multiBuildingMode, properties]);

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
    return sortedBayConfigs.reverse();
  };

  // For single building mode, get bays from the property
  const bays = property ? getSortedBays(property) : [];
  
  // Create a simple grid layout based on number of bays
  const createGrid = (baysArray: BayConfiguration[]) => {
    const bayCount = baysArray.length;
    const calculatedColumns = Math.ceil(Math.sqrt(bayCount));
    const calculatedRows = Math.ceil(bayCount / calculatedColumns);
    const grid: (BayConfiguration | null)[][] = [];
    
    let bayIndex = 0;
    for (let row = 0; row < calculatedRows; row++) {
      grid[row] = [];
      for (let col = 0; col < calculatedColumns; col++) {
        if (bayIndex < baysArray.length) {
          grid[row][col] = baysArray[bayIndex];
          bayIndex++;
        } else {
          grid[row][col] = null;
        }
      }
    }
    return { grid, columns: calculatedColumns };
  };

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
  const toggleMultiBuildingBaySelection = (propertyName: string, bayId: string, bay: BayConfiguration) => {
    console.log('🔧 Multi-building bay click:', { propertyName, bayId, bay: bay.bayName });
    console.log('🔧 Current selectedBuildingIds:', selectedBuildingIds);
    console.log('🔧 Type of selectedBuildingIds[propertyName]:', typeof selectedBuildingIds[propertyName], selectedBuildingIds[propertyName]);
    console.log('🔧 Is Set?:', selectedBuildingIds[propertyName] instanceof Set);
    
    const currentBuildingIds = selectedBuildingIds[propertyName] instanceof Set 
      ? selectedBuildingIds[propertyName] 
      : new Set();
    const newBuildingIds = new Set(currentBuildingIds);
    
    if (newBuildingIds.has(bayId)) {
      newBuildingIds.delete(bayId);
    } else {
      newBuildingIds.add(bayId);
    }
    
    // Update the building-specific selections
    const newSelectedBuildingIds: {[propertyName: string]: Set<string>} = {
      ...selectedBuildingIds,
      [propertyName]: newBuildingIds
    };
    setSelectedBuildingIds(newSelectedBuildingIds);
    
    // Get all bays for this property and filter selected ones
    const property = properties.find(p => p.propertyName === propertyName);
    if (property) {
      const propertyBays = getSortedBays(property);
      const selectedBaysForBuilding = propertyBays.filter(bay => newBuildingIds.has(bay.id));
      
      // Update selected bays per building
      const newSelectedBaysPerBuilding = {
        ...selectedBaysPerBuilding,
        [propertyName]: selectedBaysForBuilding
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
                ? `Multi-Building Bay Selection (${properties.length} properties)` 
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
            {properties.map((prop) => {
              const propBays = getSortedBays(prop);
              const propSelectedIds = selectedBuildingIds[prop.propertyName] || new Set();
              const propSelectedBays = propBays.filter(bay => propSelectedIds.has(bay.id));
              const propTotalSF = propSelectedBays.reduce((total, bay) => total + (bay.rentableSquareFootage || bay.squareFootage), 0);
              
              const { grid, columns } = createGrid(propBays);
              
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
                  <div className="overflow-x-scroll pb-4 bay-scroll">
                    <div 
                      className="grid gap-2"
                      style={{ 
                        gridTemplateColumns: `repeat(${columns}, 80px)`,
                        minWidth: `${columns * 80 + (columns - 1) * 8}px`
                      }}
                    >
                      {grid.map((row, rowIndex) =>
                        row.map((bay, colIndex) => (
                          <div key={`${prop.id}-${rowIndex}-${colIndex}`} className="h-24 w-20">
                            {bay ? (
                              <button
                                onClick={() => toggleMultiBuildingBaySelection(prop.propertyName, bay.id, bay)}
                                className={`
                                  w-full h-full p-2 rounded-lg border-2 transition-all duration-200
                                  flex flex-col items-center justify-center text-xs font-medium
                                  hover:shadow-md focus:outline-none focus:ring-2 focus:ring-orange-500
                                  ${propSelectedIds.has(bay.id) 
                                    ? 'ring-2 ring-orange-500 shadow-lg scale-105' 
                                    : 'hover:scale-102'
                                  }
                                  ${getBayColor(propSelectedIds.has(bay.id))}
                                `}
                              >
                                <div className="text-center">
                                  <div className="font-bold truncate w-full">{bay.bayName}</div>
                                  <div className="text-xs mt-1">{(bay.rentableSquareFootage || bay.squareFootage).toLocaleString()} sq ft</div>
                                  <div className="flex justify-center mt-1 gap-1 text-xs min-h-[1.5rem]">
                                    {bay.hasStorefrontEntry && (
                                      <span className="text-orange-600 text-lg" title="Storefront Entry">🚪</span>
                                    )}
                                    {bay.hasSpeculativeOffice && (
                                      <span className="text-blue-600 text-lg" title="Speculative Office">🏢</span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            ) : (
                              <div className="w-full h-full border-2 border-dashed border-gray-200 rounded-lg bg-gray-50"></div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  
                  {/* Property-specific summary */}
                  <div className="bg-white p-3 rounded-lg mt-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Selected: {propTotalSF.toLocaleString()} sq ft</span>
                      <div className="flex flex-wrap gap-2">
                        {propSelectedBays.map((bay) => (
                          <Badge key={bay.id} variant="outline" className="text-xs">
                            {bay.bayName}
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
            <div className="overflow-x-scroll pb-4 bay-scroll">
              <div 
                className="grid gap-2"
                style={{ 
                  gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(bays.length))}, 80px)`,
                  minWidth: `${Math.ceil(Math.sqrt(bays.length)) * 80 + (Math.ceil(Math.sqrt(bays.length)) - 1) * 8}px`
                }}
              >
                {(() => {
                  const { grid } = createGrid(bays);
                  
                  return grid.map((row, rowIndex) =>
                    row.map((bay, colIndex) => (
                      <div key={`${rowIndex}-${colIndex}`} className="h-24 w-20">
                        {bay ? (
                          <button
                            onClick={() => toggleBaySelection(bay.id)}
                            className={`
                              w-full h-full p-2 rounded-lg border-2 transition-all duration-200
                              flex flex-col items-center justify-center text-xs font-medium
                              hover:shadow-md focus:outline-none focus:ring-2 focus:ring-orange-500
                              ${selectedBayIds.has(bay.id) 
                                ? 'ring-2 ring-orange-500 shadow-lg scale-105' 
                                : 'hover:scale-102'
                              }
                              ${getBayColor(selectedBayIds.has(bay.id))}
                            `}
                          >
                            <div className="text-center">
                              <div className="font-bold truncate w-full">{bay.bayName}</div>
                              <div className="text-xs mt-1">{(bay.rentableSquareFootage || bay.squareFootage).toLocaleString()} sq ft</div>
                              <div className="flex justify-center mt-1 gap-1 text-xs min-h-[1.5rem]">
                                {bay.hasStorefrontEntry && (
                                  <span className="text-orange-600 text-lg" title="Storefront Entry">🚪</span>
                                )}
                                {bay.hasSpeculativeOffice && (
                                  <span className="text-blue-600 text-lg" title="Speculative Office">🏢</span>
                                )}
                              </div>
                            </div>
                          </button>
                        ) : (
                          <div className="w-full h-full border-2 border-dashed border-gray-200 rounded-lg bg-gray-50"></div>
                        )}
                      </div>
                    ))
                  );
                })()}
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
                ? `${selectedBays.length} bays total across ${Object.keys(selectedBaysPerBuilding).length} buildings`
                : `${selectedBays.length} of ${bays.length} bays selected`
              }
            </Badge>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600">Total Square Footage</p>
              <p className="text-2xl font-bold text-blue-600">
                {totalSquareFootage.toLocaleString()} sq ft
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Average per Bay</p>
              <p className="text-2xl font-bold text-gray-700">
                {selectedBays.length > 0 
                  ? Math.round(totalSquareFootage / selectedBays.length).toLocaleString()
                  : '0'
                } sq ft
              </p>
            </div>
          </div>

          {selectedBays.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-gray-600 mb-2">Selected Bays:</p>
              <div className="flex flex-wrap gap-2">
                {selectedBays.map((bay) => (
                  <Badge 
                    key={bay.id} 
                    variant="outline"
                    className={getBayColor(true)}
                  >
                    {bay.bayName} ({(bay.rentableSquareFootage || bay.squareFootage).toLocaleString()} sq ft)
                    {bay.hasStorefrontEntry && <span className="text-orange-600 ml-1" title="Storefront Entry">🚪</span>}
                    {bay.hasSpeculativeOffice && <span className="text-blue-600 ml-1" title="Speculative Office">🏢</span>}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bay Type Legend */}
        <div className="border-t pt-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Bay Types:</p>
          <div className="flex flex-wrap gap-2">
            <Badge className="bg-blue-100 border-blue-300 text-blue-800">Office</Badge>
            <Badge className="bg-gray-100 border-gray-300 text-gray-800">Warehouse</Badge>
            <Badge className="bg-green-100 border-green-300 text-green-800">Retail</Badge>
            <Badge className="bg-purple-100 border-purple-300 text-purple-800">Mixed</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}