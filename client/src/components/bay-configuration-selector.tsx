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

  // Convert bay ranges to individual bays for better visual representation
  const individualBays = bayConfigurations.flatMap(bayConfig => {
    const match = bayConfig.bayName.match(/Bay (\d+)-(\d+)/);
    if (!match) return [];
    
    const startBay = parseInt(match[1]);
    const endBay = parseInt(match[2]);
    const baysInRange = endBay - startBay + 1;
    const sqftPerBay = bayConfig.squareFootage / baysInRange;
    const standardDoorsPerBay = Math.floor(bayConfig.standardDockDoors / baysInRange);
    const oversizedDoorsPerBay = Math.floor(bayConfig.oversizedDockDoors / baysInRange);
    
    const bays = [];
    for (let i = startBay; i <= endBay; i++) {
      bays.push({
        id: `${bayConfig.id}-bay-${i}`,
        bayNumber: i,
        bayName: `Bay ${i}`,
        squareFootage: Math.round(sqftPerBay),
        standardDockDoors: standardDoorsPerBay,
        oversizedDockDoors: oversizedDoorsPerBay,
        parentConfigId: bayConfig.id
      });
    }
    return bays;
  }).sort((a, b) => a.bayNumber - b.bayNumber);

  // Calculate total rentable area from selected bays
  const calculateTotalArea = () => {
    return selectedBayIds.reduce((total, bayId) => {
      const bay = bayConfigurations.find(b => b.id === bayId);
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

  const totalArea = calculateTotalArea();
  const selectedBays = selectedBayIds.map(id => 
    bayConfigurations.find(bay => bay.id === id)!
  ).filter(Boolean);

  // Update parent component when selection changes
  useEffect(() => {
    onRentableAreaChange(totalArea, selectedBays);
  }, [selectedBayIds, totalArea]);

  if (!bayConfigurations.length) {
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
            <p className="text-sm">Add bay configurations to the property to enable automatic rentable area calculation.</p>
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
        {/* Bay Selection Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {bayConfigurations.map((bay) => {
            const isSelected = selectedBayIds.includes(bay.id);
            return (
              <Button
                key={bay.id}
                variant={isSelected ? "default" : "outline"}
                className={`h-16 flex flex-col items-center justify-center text-xs p-2 ${
                  isSelected 
                    ? "bg-orange-600 hover:bg-orange-700 text-white" 
                    : "hover:bg-orange-50 border-orange-200"
                }`}
                onClick={() => toggleBaySelection(bay.id)}
              >
                <div className="font-medium">{bay.bayName}</div>
                <div className="text-xs opacity-75">
                  {bay.squareFootage.toLocaleString()} SF
                </div>
              </Button>
            );
          })}
        </div>

        {/* Selection Summary */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <Label className="font-medium">Selected Bays:</Label>
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
                <span className="font-medium text-orange-900">
                  Total Rentable Area: {totalArea.toLocaleString()} SF
                </span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}