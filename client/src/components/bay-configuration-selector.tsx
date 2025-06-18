import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Calculator, Grid3x3 } from "lucide-react";
import type { Property, BayConfiguration } from "@shared/schema";

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

  const bayConfigurations = property.bayConfigurations || [];

  // Convert bay configurations to proper bay representation
  // Each bay configuration represents one bay with unique sequential numbering
  const individualBays = bayConfigurations.map((bayConfig, index) => {
    const match = bayConfig.bayName.match(/Bay (\d+)-(\d+)/);
    if (!match) return null;
    
    // Use sequential numbering based on array index to ensure unique bay numbers
    const bayNumber = index + 1;
    
    return {
      id: bayConfig.id,
      bayNumber: bayNumber,
      bayName: `Bay ${bayNumber}`,
      squareFootage: bayConfig.squareFootage, // Full rentable area for this bay
      standardDockDoors: bayConfig.standardDockDoors,
      oversizedDockDoors: bayConfig.oversizedDockDoors
    };
  }).filter(Boolean);

  // Calculate total rentable area from selected individual bays
  const calculateTotalArea = () => {
    return selectedBayIds.reduce((total, bayId) => {
      const bay = individualBays.find(b => b.id === bayId);
      return total + (bay?.squareFootage || 0);
    }, 0);
  };

  const toggleBaySelection = (bayId: string) => {
    const newSelection = selectedBayIds.includes(bayId)
      ? selectedBayIds.filter(id => id !== bayId)
      : [...selectedBayIds, bayId];
    
    setSelectedBayIds(newSelection);
  };

  const clearSelection = () => {
    setSelectedBayIds([]);
  };

  const selectAllBays = () => {
    setSelectedBayIds(individualBays.map(bay => bay.id));
  };

  const totalArea = calculateTotalArea();
  const selectedBays = selectedBayIds.map(id => 
    individualBays.find(bay => bay.id === id)!
  ).filter(Boolean);

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
        <div className="bg-gray-50 p-3 rounded-lg">
          <div className="mb-2">
            <Label className="text-sm font-medium text-gray-700">Building Layout</Label>
            <p className="text-xs text-gray-500">Click bays to select for rentable area calculation</p>
          </div>
          
          {/* Single row layout representing building */}
          <div className="flex gap-0.5 justify-start overflow-x-auto pb-1">
            {individualBays.map((bay) => {
              const isSelected = selectedBayIds.includes(bay.id);
              return (
                <Button
                  key={bay.id}
                  variant={isSelected ? "default" : "outline"}
                  className={`h-16 w-10 flex flex-col items-center justify-center text-xs p-1 flex-shrink-0 ${
                    isSelected 
                      ? "bg-orange-600 hover:bg-orange-700 text-white border-orange-700" 
                      : "hover:bg-orange-50 border-orange-200 bg-white"
                  }`}
                  onClick={() => toggleBaySelection(bay.id)}
                  style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                >
                  <div className="font-medium text-xs rotate-180">{bay.bayName}</div>
                  <div className="text-xs opacity-75 leading-tight rotate-180">
                    {(bay.squareFootage / 1000).toFixed(0)}K
                  </div>
                  {(bay.standardDockDoors > 0 || bay.oversizedDockDoors > 0) && (
                    <div className="text-xs opacity-60 leading-tight rotate-180">
                      {bay.standardDockDoors + bay.oversizedDockDoors}D
                    </div>
                  )}
                </Button>
              );
            })}
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
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}