import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Grid, Calculator, RotateCcw } from "lucide-react";
import type { Property, BayConfiguration } from "@shared/schema";

interface BaySelectionGridProps {
  property: Property;
  onSelectionChange?: (selectedBays: BayConfiguration[], totalSquareFootage: number) => void;
}

export function BaySelectionGrid({ property, onSelectionChange }: BaySelectionGridProps) {
  const [selectedBayIds, setSelectedBayIds] = useState<Set<string>>(new Set());

  // Sort bay configurations by their actual bay names to ensure proper order
  const sortedBayConfigs = [...(property.bayConfigurations || [])].sort((a, b) => {
    const aMatch = a.bayName.match(/Bay (\d+)-(\d+)/);
    const bMatch = b.bayName.match(/Bay (\d+)-(\d+)/);
    if (!aMatch || !bMatch) return 0;
    const aStart = parseInt(aMatch[1]);
    const bStart = parseInt(bMatch[1]);
    return aStart - bStart;
  });

  // REVERSE the order so Bay 1 is easternmost (rightmost) and increases westward (leftward)
  const bays = sortedBayConfigs.reverse();
  
  // Create a simple grid layout based on number of bays
  const bayCount = bays.length;
  const calculatedColumns = Math.ceil(Math.sqrt(bayCount));
  const calculatedRows = Math.ceil(bayCount / calculatedColumns);
  const { rows, columns } = { rows: calculatedRows, columns: calculatedColumns };

  // Create a grid array with bay assignments
  const createGrid = () => {
    const grid: (BayConfiguration | null)[][] = [];
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

  const getBayColor = () => {
    return 'bg-gray-100 border-gray-300 text-gray-800';
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
        {/* Grid Layout with Horizontal Scrolling */}
        <div className="space-y-2">
          {/* Add horizontal scroll container for wide bay configurations */}
          <div className="overflow-x-auto pb-4">
            <div 
              className="grid gap-2"
              style={{ 
                gridTemplateColumns: `repeat(${columns}, 96px)`, // Fixed 96px width per column for consistent sizing
                minWidth: `${columns * 96 + (columns - 1) * 8}px` // Minimum width to ensure all bays fit
              }}
            >
            {grid.map((row, rowIndex) =>
              row.map((bay, colIndex) => (
                <div key={`${rowIndex}-${colIndex}`} className="h-32 w-24">
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
                        ${getBayColor()}
                      `}
                    >
                      <div className="text-center">
                        <div className="font-bold truncate w-full">{bay.bayName}</div>
                        <div className="text-xs mt-1">{bay.squareFootage.toLocaleString()} sq ft</div>
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
                    className={getBayColor()}
                  >
                    {bay.bayName} ({bay.squareFootage.toLocaleString()} sq ft)
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