import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Calculator, Grid3x3, Compass, Navigation } from "lucide-react";
import type { Property, BayConfiguration, ExecutedLease } from "@shared/schema";

interface BayConfigurationSelectorProps {
  property: Property;
  onRentableAreaChange: (area: number, selectedBays: BayConfiguration[]) => void;
  initialSelectedBays?: BayConfiguration[];
}

export default function BayConfigurationSelector({ 
  property, 
  onRentableAreaChange,
  initialSelectedBays = []
}: BayConfigurationSelectorProps) {
  const [selectedBayIds, setSelectedBayIds] = useState<string[]>(
    initialSelectedBays.map(bay => bay.id)
  );

  // Fetch executed leases for this property to exclude leased bays
  const { data: executedLeases = [], isLoading: isLoadingLeases } = useQuery<ExecutedLease[]>({
    queryKey: [`/api/properties/${property.id}/executed-leases`],
    enabled: !!property.id
  });

  const bayConfigurations = property.bayConfigurations || [];
  
  // Debug raw property data to see API response structure
  console.log('🏢 BayConfigurationSelector - Raw property object:', property);
  console.log('🏢 BayConfigurationSelector - bayConfigurations:', bayConfigurations);
  console.log('🏢 BayConfigurationSelector - bayConfigurations length:', bayConfigurations.length);
  if (bayConfigurations.length > 0) {
    console.log('🏢 BayConfigurationSelector - First 3 bays:', bayConfigurations.slice(0, 3));
    
    // Check for data integrity issues
    const totalFromAPI = bayConfigurations.reduce((sum, bay) => sum + (bay.squareFootage || 0), 0);
    console.log('🏢 BayConfigurationSelector - Total SF from API:', totalFromAPI);
    console.log('🏢 BayConfigurationSelector - Expected total SF:', 408763);
    console.log('🏢 BayConfigurationSelector - Mechanical room SF:', property.mechanicalRoomSquareFootage);
    console.log('🏢 BayConfigurationSelector - Expected grand total:', 408763 + (property.mechanicalRoomSquareFootage || 0));
  }

  // Get list of all bay IDs that are already leased
  const leasedBayIds = executedLeases.flatMap(lease => lease.assignedBays || []);
  


  // Convert bay configurations to proper bay representation
  // Each bay configuration represents one bay with unique sequential numbering
  const individualBays = bayConfigurations.map((bayConfig, index) => {
    // Debug each bay configuration to see data integrity
    console.log(`Bay ${index + 1} config:`, bayConfig);
    
    // Check for missing data
    if (!bayConfig || !bayConfig.bayName || !bayConfig.squareFootage || bayConfig.squareFootage === 0) {
      console.log(`❌ CORRUPTED BAY DATA at index ${index}:`, bayConfig);
      console.log(`  - bayConfig exists: ${!!bayConfig}`);
      console.log(`  - bayName exists: ${!!bayConfig?.bayName}`);
      console.log(`  - squareFootage exists: ${!!bayConfig?.squareFootage}`);
      console.log(`  - squareFootage value: ${bayConfig?.squareFootage}`);
      return null;
    }
    
    const match = bayConfig.bayName.match(/Bay (\d+)-(\d+)/);
    if (!match) {
      console.log(`❌ Bay name match failed for:`, bayConfig.bayName);
      return null;
    }
    
    // Use sequential numbering based on array index to ensure unique bay numbers
    const bayNumber = index + 1;
    
    return {
      id: bayConfig.id,
      bayNumber: bayNumber,
      bayName: `Bay ${bayNumber}`,
      squareFootage: bayConfig.squareFootage, // Full rentable area for this bay
      standardDockDoors: bayConfig.standardDockDoors || 0,
      oversizedDockDoors: bayConfig.oversizedDockDoors || 0
    };
  }).filter((bay): bay is NonNullable<typeof bay> => bay !== null);

  // Calculate total rentable area from selected individual bays with proportional mechanical allocation
  const calculateTotalArea = () => {
    // Get selected bay configurations from original bay configurations
    console.log('🔧 DEBUGGING Bay ID Lookup:');
    console.log('- selectedBayIds:', selectedBayIds);
    console.log('- Available bay IDs from bayConfigurations:', bayConfigurations.map(b => b.id));
    
    const selectedBayConfigs = selectedBayIds.map(bayId => {
      const found = bayConfigurations.find(bay => bay.id === bayId);
      if (!found) {
        console.log(`❌ BAY NOT FOUND: ID ${bayId} not found in bayConfigurations`);
      }
      return found;
    }).filter((bay): bay is NonNullable<typeof bay> => bay != null);
    
    console.log('- Selected bay configs found:', selectedBayConfigs.length, 'out of', selectedBayIds.length, 'requested');
    
    if (selectedBayConfigs.length === 0) return 0;
    
    // Calculate selected bay square footage (warehouse area only - use squareFootage, not rentableSquareFootage)
    const selectedBaySquareFootage = selectedBayConfigs.reduce((sum, bay) => {
      const sf = bay.squareFootage || 0;
      console.log(`  Adding bay ${bay.bayName}: ${sf} SF`);
      return sum + sf;
    }, 0);
    
    console.log('🔢 DETAILED BAY CALCULATION:');
    console.log('- Selected bay configs:', selectedBayConfigs.map(b => `${b.bayName}: ${b.squareFootage || 0} SF (type: ${typeof b.squareFootage})`));
    console.log('- Sum calculation result:', selectedBaySquareFootage);
    
    // Check if any square footage values are strings instead of numbers
    const stringValues = selectedBayConfigs.filter(b => typeof b.squareFootage === 'string');
    if (stringValues.length > 0) {
      console.log('🚨 STRING SQUARE FOOTAGE VALUES FOUND:');
      stringValues.forEach(bay => {
        console.log(`  ${bay.bayName}: "${bay.squareFootage}" (string) -> ${parseInt(String(bay.squareFootage || 0))} (parsed)`);
      });
    }
    
    // Calculate total property bay square footage for proportion calculation
    const totalPropertyBaysSF = bayConfigurations.reduce((sum, bay) => sum + (bay.squareFootage || 0), 0);
    
    // Calculate proportional mechanical room allocation using property-level mechanical room SF
    const mechanicalRoomSF = property.mechanicalRoomSquareFootage || 0;
    
    // For precision when all bays selected, use exact mechanical room SF to avoid floating point errors
    let proportionalMechanical;
    if (selectedBayConfigs.length === bayConfigurations.length) {
      // All bays selected = 100% of mechanical room
      proportionalMechanical = mechanicalRoomSF;
    } else {
      // Partial selection = proportional allocation
      proportionalMechanical = totalPropertyBaysSF > 0 ? (selectedBaySquareFootage / totalPropertyBaysSF) * mechanicalRoomSF : 0;
    }
    
    // Debug logging - always show when calculating
    if (selectedBayConfigs.length > 0) {
      console.log('🔍 DEBUG Bay Selector Calculation:');
      console.log('- Selected bays count:', selectedBayConfigs.length, 'of', bayConfigurations.length);
      console.log('- Selected bay square footage:', selectedBaySquareFootage);
      console.log('- Total warehouse SF from bays:', totalPropertyBaysSF);
      console.log('- Mechanical room SF:', property.mechanicalRoomSquareFootage);
      console.log('- Proportional mechanical:', proportionalMechanical);
      console.log('- Expected total:', totalPropertyBaysSF + (property.mechanicalRoomSquareFootage || 0));
      
      // Critical debug: Show actual vs expected totals
      const calculatedTotal = selectedBaySquareFootage + proportionalMechanical;
      const expectedWhenAllSelected = 409189; // Known correct total
      const discrepancy = expectedWhenAllSelected - calculatedTotal;
      console.log('- CALCULATED TOTAL:', calculatedTotal);
      console.log('- EXPECTED WHEN ALL SELECTED:', expectedWhenAllSelected);
      console.log('- DISCREPANCY:', discrepancy, 'SF');
      
      // NEW: Check if selectedBaySquareFootage matches expected 408,763
      const expectedBayTotal = 408763;
      const bayDiscrepancy = expectedBayTotal - selectedBaySquareFootage;
      console.log('🚨 BAY TOTAL ANALYSIS:');
      console.log('- Expected bay total (from DB):', expectedBayTotal);
      console.log('- Calculated bay total:', selectedBaySquareFootage);
      console.log('- Bay calculation discrepancy:', bayDiscrepancy, 'SF');
      
      if (bayDiscrepancy !== 0) {
        console.log('🚨 ISSUE FOUND: Bay calculation is wrong by', bayDiscrepancy, 'SF');
        console.log('- This means', Math.abs(bayDiscrepancy), 'SF worth of bays are missing from calculation');
      }
      
      // Show which bays are actually in calculation
      console.log('- Bays in calculation:', selectedBayConfigs.map(bay => `${bay.bayName}: ${bay.squareFootage} SF`));
      
      // Debug individual bay values 
      console.log('- Individual bay values:');
      let frontendTotal = 0;
      selectedBayConfigs.forEach(bay => {
        const sf = bay.squareFootage || 0;
        frontendTotal += sf;
        console.log(`  ${bay.bayName}: ${sf} SF`);
      });
      
      console.log('- Frontend calculated total bays:', frontendTotal);
      console.log('- Database bay total (from server):', 408763);
      console.log('- Difference:', frontendTotal - 408763);
      
      // Check for missing squareFootage values in SELECTED bays
      const missingBays = selectedBayConfigs.filter(bay => !bay.squareFootage || bay.squareFootage === 0);
      if (missingBays.length > 0) {
        console.log('⚠️ PROBLEM: Selected bays missing squareFootage:', missingBays.map(b => b.bayName));
      }
      
      // Check all bay configurations for comparison
      console.log('- All bay configurations count:', bayConfigurations.length);
      const allBaysTotal = bayConfigurations.reduce((sum, bay) => sum + (bay.squareFootage || 0), 0);
      console.log('- All bays frontend total:', allBaysTotal);
      
      // Show which bays have missing square footage in ALL BAYS (not just selected)
      const baysMissingData = bayConfigurations.filter(bay => !bay.squareFootage || bay.squareFootage === 0);
      if (baysMissingData.length > 0) {
        console.log('🚨 FOUND THE PROBLEM: Bays missing squareFootage data:');
        baysMissingData.forEach(bay => {
          console.log(`  ${bay.bayName}: ${bay.squareFootage || 'MISSING'} SF`);
          console.log(`  Full bay object:`, bay);
        });
      }
      
      // CRITICAL: Check if any selected bay IDs don't have corresponding bay configs  
      const selectedIdsNotFound = selectedBayIds.filter(bayId => 
        !bayConfigurations.find(bay => bay.id === bayId)
      );
      if (selectedIdsNotFound.length > 0) {
        console.log('🚨 CRITICAL: Selected bay IDs not found in bayConfigurations:');
        selectedIdsNotFound.forEach(id => console.log(`  Missing bay ID: ${id}`));
      }
      
      // Show sample of all bay configs to check data structure
      console.log('Sample bay configurations (first 3):');
      bayConfigurations.slice(0, 3).forEach(bay => {
        console.log(`  ${bay.bayName}:`, {
          squareFootage: bay.squareFootage,
          type: typeof bay.squareFootage,
          hasProperty: bay.hasOwnProperty('squareFootage')
        });
      });
    }
    
    // Total rentable area = selected warehouse SF + proportional mechanical allocation
    const totalRentableArea = selectedBaySquareFootage + proportionalMechanical;
    
    // Debug logging
    if (selectedBayConfigs.length === bayConfigurations.length) {
      console.log('- Calculated area being returned:', Math.round(totalRentableArea));
    }
    
    return Math.round(totalRentableArea);
  };

  const toggleBaySelection = (bayId: string) => {
    // Don't allow selection of leased bays
    if (leasedBayIds.includes(bayId)) return;
    
    const newSelection = selectedBayIds.includes(bayId)
      ? selectedBayIds.filter(id => id !== bayId)
      : [...selectedBayIds, bayId];
    
    setSelectedBayIds(newSelection);
  };

  const clearSelection = () => {
    setSelectedBayIds([]);
  };

  const selectAllBays = () => {
    // FIXED: Use original bayConfigurations IDs, not transformed individualBays IDs
    const availableBayIds = bayConfigurations
      .filter(bay => bay && !leasedBayIds.includes(bay.id))
      .map(bay => bay.id);
    
    console.log('*** SELECT ALL CLICKED ***');
    console.log('Available bay IDs (from bayConfigurations):', availableBayIds);
    console.log('Total bays in property:', bayConfigurations.length);
    console.log('Individual bays processed:', individualBays.length);
    
    setSelectedBayIds(availableBayIds);
  };

  const totalArea = calculateTotalArea();
  
  // Get selected bay configurations with proportional mechanical room allocation
  const selectedBays = selectedBayIds.map(bayId => {
    const originalBayConfig = bayConfigurations.find(bay => bay.id === bayId);
    if (!originalBayConfig) return null;
    
    // Calculate proportional mechanical room allocation for this bay
    const totalPropertyBaysSF = bayConfigurations.reduce((sum, bay) => sum + (bay.squareFootage || 0), 0);
    const mechanicalRoomSF = property.mechanicalRoomSquareFootage || 0;
    const bayProportion = totalPropertyBaysSF > 0 ? (originalBayConfig.squareFootage || 0) / totalPropertyBaysSF : 0;
    const mechanicalRoomAllocation = mechanicalRoomSF * bayProportion;
    
    return {
      ...originalBayConfig,
      mechanicalRoomAllocation: mechanicalRoomAllocation
    };
  }).filter((bay): bay is NonNullable<typeof bay> => bay != null);

  // Update parent component when selection changes
  useEffect(() => {
    onRentableAreaChange(totalArea, selectedBays);
  }, [selectedBayIds, totalArea]);

  if (!individualBays.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Grid3x3 className="h-5 w-5 text-orange-600" />
            Bay Configuration Selection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <Grid3x3 className="h-12 w-12 mx-auto mb-3 text-gray-400" />
            <p className="font-medium">No bay configurations defined</p>
            <p className="text-sm">Add bay configurations to the property to enable automatic floor area calculation.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Grid3x3 className="h-5 w-5 text-orange-600" />
          Bay Configuration Selection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Building-like Bay Layout */}
        <div className="bg-gray-50 p-3 rounded-lg relative">
          <div className="mb-3">
            <Label className="text-sm font-medium text-gray-700">Building Layout</Label>
            <p className="text-xs text-gray-500">Click bays to select for rentable area calculation. Red bays are already leased and unavailable.</p>
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
            </div>
            <div className="text-xs text-gray-600 pt-2">
              <div className="font-medium mb-1">Building Orientation</div>
              <div className="text-gray-500">
                {property.firstBayDirection 
                  ? `Bay 1 faces ${property.firstBayDirection.charAt(0).toUpperCase() + property.firstBayDirection.slice(1)}`
                  : "Bay orientation not configured"
                }
              </div>
            </div>
          </div>

          {/* Directional Labels */}
          <div className="mb-3">
            <div className="flex justify-between items-center text-xs text-gray-600">
              <div className="flex items-center gap-2">
                <Navigation className="w-3 h-3 rotate-180" />
                <span className="font-medium">West</span>
                <span className="text-gray-400">(Street / Entrance)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">(Loading Docks)</span>
                <span className="font-medium">East</span>
                <Navigation className="w-3 h-3" />
              </div>
            </div>
          </div>
          
          {/* Bay Grid with Position Indicators */}
          <div className="relative">
            {/* Single row layout representing building */}
            <div className="flex gap-0.5 justify-start overflow-x-auto pb-1">
            {individualBays.map((bay) => {
              const isSelected = selectedBayIds.includes(bay.id);
              const isLeased = leasedBayIds.includes(bay.id);
              return (
                <Button
                  key={bay.id}
                  variant={isSelected ? "default" : "outline"}
                  disabled={isLeased}
                  className={`h-20 w-16 flex flex-col items-center justify-center text-xs p-2 flex-shrink-0 ${
                    isLeased
                      ? "bg-red-800 border-red-900 text-white cursor-not-allowed opacity-95"
                      : isSelected 
                        ? "bg-orange-600 hover:bg-orange-700 text-white border-orange-700" 
                        : "hover:bg-orange-50 border-orange-200 bg-white"
                  }`}
                  onClick={() => toggleBaySelection(bay.id)}
                >
                  <div className="font-bold text-xs mb-1">{bay.bayName}</div>
                  <div className="text-xs opacity-75 leading-tight">
                    {isLeased ? "LEA" : `${(bay.squareFootage / 1000).toFixed(0)}K SF`}
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
            
            {/* Position indicators below bays */}
            <div className="flex gap-0.5 justify-start overflow-x-auto mt-1">
              {individualBays.map((bay, index) => {
                const totalBays = individualBays.length;
                let position = "";
                
                if (index === 0) position = "West End";
                else if (index === totalBays - 1) position = "East End";
                else if (index < totalBays / 3) position = "West";
                else if (index > (totalBays * 2) / 3) position = "East";
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

        {/* Selection Summary */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <Label className="font-medium">Selected Bays:</Label>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAllBays}
                className="text-orange-600 hover:text-orange-700"
              >
                Select All
              </Button>
              {selectedBayIds.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearSelection}
                  className="text-gray-500 hover:text-gray-700"
                >
                  Clear All
                </Button>
              )}
            </div>
          </div>
          
          {selectedBayIds.length === 0 ? (
            <p className="text-sm text-gray-500">No bays selected</p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {selectedBays.map((bay) => (
                  <span
                    key={bay.id}
                    className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-orange-100 text-orange-800"
                  >
                    {bay.bayName}
                    <span className="ml-1 font-medium">
                      ({bay.squareFootage.toLocaleString()} SF)
                    </span>
                  </span>
                ))}
              </div>
              
              <div className="flex items-center gap-2 p-3 bg-orange-50 rounded-lg">
                <Calculator className="h-4 w-4 text-orange-600" />
                <div className="flex flex-col">
                  <span className="font-medium text-orange-900">
                    Total Rentable Area: {totalArea.toLocaleString()} SF
                  </span>
                  <span className="text-xs text-orange-700">
                    Building Total Available: {bayConfigurations.reduce((sum, bay) => sum + bay.squareFootage, 0).toLocaleString()} SF
                  </span>
                  <span className="text-xs text-red-600">
                    DEBUG: Expected 409,189 SF | Actual: {totalArea.toLocaleString()} SF | Diff: {409189 - totalArea} SF
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}