import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// Removed Select import - using native HTML selects for consistency
import { Label } from "@/components/ui/label";
import { Calculator, Building2, ChevronDown } from "lucide-react";
import Navigation from "@/components/navigation";
import { BaySelectionGrid } from "@/components/bay-selection-grid";
import type { Property, PropertyBay } from "@shared/schema";

export default function BayCalculator() {
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [selectedBays, setSelectedBays] = useState<PropertyBay[]>([]);
  const [totalSquareFootage, setTotalSquareFootage] = useState(0);

  const { data: properties = [], isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const selectedProperty = properties.find(p => p.id.toString() === selectedPropertyId);

  const handleSelectionChange = (bays: PropertyBay[], totalSqFt: number) => {
    setSelectedBays(bays);
    setTotalSquareFootage(totalSqFt);
  };

  const getPropertyWithBays = () => properties.filter(p => p.bays && p.bays.length > 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Calculator className="h-8 w-8 text-blue-600" />
              Bay Calculator
            </h1>
            <p className="text-gray-600 mt-2">
              Select property bays to calculate total leasable square footage
            </p>
          </div>
        </div>

        {/* Property Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Building2 className="h-5 w-5" />
              <span>Select Property</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="property-select">Property</Label>
                  <Select
                    value={selectedPropertyId}
                    onValueChange={setSelectedPropertyId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a property with bay configuration" />
                    </SelectTrigger>
                    <SelectContent>
                      {getPropertyWithBays().map((property) => (
                        <SelectItem key={property.id} value={property.id.toString()}>
                          {property.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                {selectedProperty && (
                  <div className="space-y-2">
                    <Label>Property Details</Label>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-sm font-medium">{selectedProperty.propertyName} - Building {selectedProperty.building}</p>
                      <p className="text-sm text-gray-600">{selectedProperty.streetAddress}</p>
                      <p className="text-sm text-gray-600">{selectedProperty.city}, {selectedProperty.state} {selectedProperty.zip}</p>
                      <p className="text-sm text-blue-600 mt-1">
                        {selectedProperty.bays?.length || 0} bays configured
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {getPropertyWithBays().length === 0 && !isLoading && (
                <div className="text-center py-8 text-gray-500">
                  <Building2 className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p className="font-medium">No properties with bay configuration found</p>
                  <p className="text-sm">Add bay definitions to properties to use the bay calculator.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Bay Selection Grid */}
        {selectedProperty && (
          <BaySelectionGrid
            property={selectedProperty}
            onSelectionChange={handleSelectionChange}
          />
        )}

        {/* Calculation Results */}
        {selectedProperty && totalSquareFootage > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Calculator className="h-5 w-5" />
                <span>Lease Calculation</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-600 font-medium">Total Square Footage</p>
                  <p className="text-3xl font-bold text-blue-700">
                    {totalSquareFootage.toLocaleString()}
                  </p>
                  <p className="text-sm text-blue-600">sq ft</p>
                </div>
                
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <p className="text-sm text-green-600 font-medium">Selected Bays</p>
                  <p className="text-3xl font-bold text-green-700">
                    {selectedBays.length}
                  </p>
                  <p className="text-sm text-green-600">
                    of {selectedProperty.bays?.length || 0} total
                  </p>
                </div>
                
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <p className="text-sm text-purple-600 font-medium">Average Bay Size</p>
                  <p className="text-3xl font-bold text-purple-700">
                    {Math.round(totalSquareFootage / selectedBays.length).toLocaleString()}
                  </p>
                  <p className="text-sm text-purple-600">sq ft</p>
                </div>
              </div>

              {/* Bay Breakdown */}
              <div className="mt-6">
                <h4 className="font-medium text-gray-900 mb-3">Selected Bay Breakdown</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {selectedBays.map((bay) => (
                    <div key={bay.id} className="p-3 border rounded-lg bg-white">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium">{bay.bayNumber}</p>
                          <p className="text-sm text-gray-600 capitalize">{bay.type}</p>
                          {bay.notes && (
                            <p className="text-xs text-gray-500 mt-1">{bay.notes}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-blue-600">
                            {bay.squareFootage.toLocaleString()}
                          </p>
                          <p className="text-xs text-gray-500">sq ft</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}