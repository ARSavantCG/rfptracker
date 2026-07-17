import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Calculator, Grid3x3 } from "lucide-react";
import type { Property, ColumnRange } from "@shared/schema";

interface ColumnRangeSelectorProps {
  property: Property;
  onRentableAreaChange: (area: number, selectedRanges: ColumnRange[]) => void;
  initialSelectedRanges?: ColumnRange[];
}

export default function ColumnRangeSelector({ 
  property, 
  onRentableAreaChange,
  initialSelectedRanges = []
}: ColumnRangeSelectorProps) {
  const [selectedRanges, setSelectedRanges] = useState<string[]>(
    initialSelectedRanges.map(range => range.id)
  );

  const columnRanges: ColumnRange[] = property.columnRanges || [];

  // Calculate total rentable area from selected ranges
  const calculateTotalArea = () => {
    return selectedRanges.reduce((total, rangeId) => {
      const range = columnRanges.find(r => r.id === rangeId);
      return total + (range?.squareFootage || 0);
    }, 0);
  };

  const toggleRangeSelection = (rangeId: string) => {
    const newSelection = selectedRanges.includes(rangeId)
      ? selectedRanges.filter(id => id !== rangeId)
      : [...selectedRanges, rangeId].sort((a, b) => {
          const rangeA = columnRanges.find(r => r.id === a);
          const rangeB = columnRanges.find(r => r.id === b);
          return (rangeA?.startColumn || 0) - (rangeB?.startColumn || 0);
        });
    
    setSelectedRanges(newSelection);
  };

  const clearSelection = () => {
    setSelectedRanges([]);
  };

  const selectConsecutiveRanges = (startColumn: number, endColumn: number) => {
    const consecutiveRanges = columnRanges
      .filter(range => range.startColumn >= startColumn && range.endColumn <= endColumn)
      .map(range => range.id);
    setSelectedRanges(consecutiveRanges);
  };

  // Update parent component when selection changes
  useEffect(() => {
    const totalArea = calculateTotalArea();
    const selectedRangeObjects = columnRanges.filter(range => selectedRanges.includes(range.id));
    onRentableAreaChange(totalArea, selectedRangeObjects);
  }, [selectedRanges, columnRanges, onRentableAreaChange]);

  if (columnRanges.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Grid3x3 className="h-5 w-5 text-orange-600" />
            <span>Column Range Selection</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-gray-500">
            <Grid3x3 className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p className="font-medium">No column ranges defined</p>
            <p className="text-sm">Add column ranges to the property to enable automatic rentable area calculation.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Grid3x3 className="h-5 w-5 text-blue-600" />
          <span>Select Column Ranges - {property.propertyName}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Column Range Grid */}
        <div className="grid gap-2 max-h-60 overflow-y-auto">
          {columnRanges.map((range) => (
            <div
              key={range.id}
              className={`
                p-3 border-2 rounded-lg cursor-pointer transition-all duration-200
                ${selectedRanges.includes(range.id)
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-blue-300 hover:bg-blue-25'
                }
              `}
              onClick={() => toggleRangeSelection(range.id)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">
                    Columns {range.startColumn} - {range.endColumn}
                  </div>
                  <div className="text-xs text-gray-600">
                    {range.description}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-blue-600">
                    {range.squareFootage.toLocaleString()} SF
                  </div>
                  {selectedRanges.includes(range.id) && (
                    <div className="text-xs text-blue-600 font-medium">
                      ✓ Selected
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Quick Selection Buttons */}
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => selectConsecutiveRanges(1, 5)}
            className="text-xs"
          >
            Columns 1-5
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => selectConsecutiveRanges(1, 10)}
            className="text-xs"
          >
            Columns 1-10
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedRanges(columnRanges.map(r => r.id))}
            className="text-xs"
          >
            Select All
          </Button>
          {selectedRanges.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearSelection}
              className="text-xs text-red-600 border-red-300 hover:bg-red-50"
            >
              Clear
            </Button>
          )}
        </div>

        {/* Total Calculation */}
        <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
          <div className="flex items-center space-x-2">
            <Calculator className="h-5 w-5 text-green-600" />
            <span className="font-medium text-green-900">
              Total Rentable Area:
            </span>
          </div>
          <div className="text-2xl font-bold text-green-900">
            {calculateTotalArea().toLocaleString()} SF
          </div>
        </div>

        {selectedRanges.length > 0 && (
          <div className="text-xs text-gray-600">
            Selected: {selectedRanges.length} range{selectedRanges.length !== 1 ? 's' : ''} 
            ({selectedRanges.map(id => {
              const range = columnRanges.find(r => r.id === id);
              return range ? `${range.startColumn}-${range.endColumn}` : '';
            }).filter(Boolean).join(', ')})
          </div>
        )}
      </CardContent>
    </Card>
  );
}