import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Grid, Calculator, RotateCcw } from "lucide-react";
import type { Property, PropertyBay } from "@shared/schema";

interface BaySelectionGridProps {
  property: Property;
  onSelectionChange?: (selectedBays: PropertyBay[], totalSquareFootage: number) => void;
}

export function BaySelectionGrid({ property, onSelectionChange }: BaySelectionGridProps) {
  const [selectedBayIds, setSelectedBayIds] = useState<Set<string>>(new Set());

  const bays = property.bays || [];
  const gridLayout = property.gridLayout || { rows: 1, columns: 1 };
  const { rows, columns } = gridLayout;

  // Create a grid array with bay assignments
  const createGrid = () => {
    const grid: (PropertyBay | null)[][] = [];
    let bayIndex = 0;
    
    for (let row = 0; row < rows; row++) {
      grid[row] = [];
      for (let col = 0; col < columns; col++) {
        if (bayIndex < bays.length) {
          grid[row][col] = bays[bayIndex];
          bayIndex++;
        } else {
          grid[row][col] = null;
        }
      }
    }
    return grid;
  };

  const grid = createGrid();

  const toggleBaySelection = (bayId: string) => {
    const newSelectedBayIds = new Set(selectedBayIds);
    
    if (newSelectedBayIds.has(bayId)) {
      newSelectedBayIds.delete(bayId);
    } else {
      newSelectedBayIds.add(bayId);
    }
    
    setSelectedBayIds(newSelectedBayIds);
    
    // Calculate selected bays and total square footage
    const selectedBays = bays.filter(bay => newSelectedBayIds.has(bay.id));
    const totalSquareFootage = selectedBays.reduce((total, bay) => total + bay.squareFootage, 0);
    
    onSelectionChange?.(selectedBays, totalSquareFootage);
  };

  const clearSelection = () => {
    setSelectedBayIds(new Set());
    onSelectionChange?.([], 0);
  };

  const getBayTypeColor = (type: string) => {
    switch (type) {
      case 'office': return 'bg-blue-100 border-blue-300 text-blue-800';
      case 'warehouse': return 'bg-gray-100 border-gray-300 text-gray-800';
      case 'retail': return 'bg-green-100 border-green-300 text-green-800';
      case 'mixed': return 'bg-purple-100 border-purple-300 text-purple-800';
      default: return 'bg-gray-100 border-gray-300 text-gray-800';
    }
  };

  const selectedBays = bays.filter(bay => selectedBayIds.has(bay.id));
  const totalSquareFootage = selectedBays.reduce((total, bay) => total + bay.squareFootage, 0);

  if (bays.length === 0) {
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
            <p>No bays configured for this property.</p>
            <p className="text-sm">Edit the property to add bay definitions.</p>
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
            <Grid className="h-5 w-5" />
            <span>Bay Selection Grid - {property.propertyName}</span>
          </CardTitle>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={clearSelection}
              disabled={selectedBayIds.size === 0}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Grid Layout */}
        <div className="space-y-2">
          <div 
            className="grid gap-2 mx-auto"
            style={{ 
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              maxWidth: `${columns * 120 + (columns - 1) * 8}px`
            }}
          >
            {grid.map((row, rowIndex) =>
              row.map((bay, colIndex) => (
                <div key={`${rowIndex}-${colIndex}`} className="aspect-square">
                  {bay ? (
                    <button
                      onClick={() => toggleBaySelection(bay.id)}
                      className={`
                        w-full h-full p-2 rounded-lg border-2 transition-all duration-200
                        flex flex-col items-center justify-center text-xs font-medium
                        hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500
                        ${selectedBayIds.has(bay.id) 
                          ? 'ring-2 ring-blue-500 shadow-lg scale-105' 
                          : 'hover:scale-102'
                        }
                        ${getBayTypeColor(bay.type)}
                      `}
                    >
                      <div className="text-center">
                        <div className="font-bold truncate w-full">{bay.bayNumber}</div>
                        <div className="text-xs mt-1">{bay.squareFootage.toLocaleString()} sq ft</div>
                        <div className="text-xs opacity-75 capitalize">{bay.type}</div>
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

        {/* Selection Summary */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Calculator className="h-5 w-5 text-blue-600" />
              <span className="font-medium">Selection Summary</span>
            </div>
            <Badge variant="secondary">
              {selectedBays.length} of {bays.length} bays selected
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
                    className={getBayTypeColor(bay.type)}
                  >
                    {bay.bayNumber} ({bay.squareFootage.toLocaleString()} sq ft)
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