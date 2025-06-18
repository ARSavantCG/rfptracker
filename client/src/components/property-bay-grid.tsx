import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Grid, Calculator } from "lucide-react";
import type { PropertyBay } from "@shared/schema";

interface GridBay {
  id: string;
  row: number;
  col: number;
  squareFootage: number;
  bayNumber: string;
  type: 'office' | 'warehouse' | 'retail' | 'mixed';
  notes?: string;
}

interface PropertyBayGridProps {
  propertyId: number;
  propertyName: string;
  bays: PropertyBay[];
  gridLayout: { rows: number; columns: number };
  onBaysUpdate?: (bays: PropertyBay[], selectedBays: string[]) => void;
}

export default function PropertyBayGrid({ 
  propertyName, 
  bays, 
  gridLayout,
  onBaysUpdate 
}: PropertyBayGridProps) {
  const [selectedBays, setSelectedBays] = useState<string[]>([]);
  
  // Convert PropertyBay to GridBay for display
  const convertToGridBays = (): GridBay[] => {
    return bays.map((bay, index) => ({
      id: bay.id,
      row: Math.floor(index / gridLayout.columns),
      col: index % gridLayout.columns,
      squareFootage: bay.squareFootage,
      bayNumber: bay.bayNumber,
      type: bay.type,
      notes: bay.notes
    }));
  };

  // Create a grid matrix from converted bay data
  const createGridMatrix = () => {
    const gridBays = convertToGridBays();
    const matrix: (GridBay | null)[][] = [];
    for (let row = 0; row < gridLayout.rows; row++) {
      matrix[row] = [];
      for (let col = 0; col < gridLayout.columns; col++) {
        const bay = gridBays.find(b => b.row === row && b.col === col);
        matrix[row][col] = bay || null;
      }
    }
    return matrix;
  };

  const gridMatrix = createGridMatrix();

  const toggleBaySelection = (bayId: string) => {
    const newSelection = selectedBays.includes(bayId)
      ? selectedBays.filter(id => id !== bayId)
      : [...selectedBays, bayId];
    
    setSelectedBays(newSelection);
    if (onBaysUpdate) {
      onBaysUpdate(bays, newSelection);
    }
  };

  const calculateTotalSquareFootage = () => {
    return selectedBays.reduce((total, bayId) => {
      const bay = bays.find(b => b.id === bayId);
      return total + (bay?.squareFootage || 0);
    }, 0);
  };

  const clearSelection = () => {
    setSelectedBays([]);
    if (onBaysUpdate) {
      onBaysUpdate(bays, []);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Grid className="h-5 w-5 text-blue-600" />
          <span>{propertyName} - Bay Selection Grid</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Grid Display */}
          <div className="overflow-auto border rounded-lg p-4 bg-gray-50">
            <div 
              className="grid gap-1"
              style={{ 
                gridTemplateColumns: `repeat(${gridLayout.columns}, minmax(80px, 1fr))`,
                gridTemplateRows: `repeat(${gridLayout.rows}, minmax(60px, auto))`
              }}
            >
              {gridMatrix.map((row, rowIndex) =>
                row.map((bay, colIndex) => (
                  <div
                    key={`${rowIndex}-${colIndex}`}
                    className={`
                      border border-gray-300 p-2 text-xs text-center cursor-pointer
                      transition-colors duration-200
                      ${bay ? 'hover:bg-blue-100' : 'bg-gray-200'}
                      ${bay && selectedBays.includes(bay.id) 
                        ? 'bg-blue-500 text-white border-blue-600' 
                        : bay 
                          ? 'bg-white hover:bg-blue-50' 
                          : 'cursor-not-allowed'
                      }
                    `}
                    onClick={() => bay && toggleBaySelection(bay.id)}
                  >
                    {bay ? (
                      <div className="space-y-1">
                        <div className="font-medium">
                          {bay.bayNumber}
                        </div>
                        <div className="text-xs opacity-75">
                          {bay.squareFootage.toLocaleString()} SF
                        </div>
                        <div className="text-xs opacity-60">
                          {bay.type}
                        </div>
                      </div>
                    ) : (
                      <div className="text-gray-400">-</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Selection Summary */}
          <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Calculator className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-blue-900">
                  Selected Bays: {selectedBays.length}
                </span>
              </div>
              <div className="text-xl font-bold text-blue-900">
                Total: {calculateTotalSquareFootage().toLocaleString()} SF
              </div>
            </div>
            
            {selectedBays.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearSelection}
                className="text-blue-600 border-blue-300 hover:bg-blue-100"
              >
                Clear Selection
              </Button>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center space-x-6 text-sm text-gray-600 pt-2 border-t">
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 bg-white border border-gray-300 rounded"></div>
              <span>Available Bay</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 bg-blue-500 border border-blue-600 rounded"></div>
              <span>Selected Bay</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 bg-gray-200 border border-gray-300 rounded"></div>
              <span>No Bay</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}