import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle, Building2, Printer, Zap, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Property, Transformer, MainPanel, PropertyExistingImprovement, BayConfiguration } from "@shared/schema";

interface PropertyWithRelations extends Property {
  transformers?: Transformer[];
  panels?: MainPanel[];
  existingImprovements?: PropertyExistingImprovement[];
}

export default function PropertyDataAudit() {
  const { data: properties, isLoading: propertiesLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const handlePrint = () => {
    window.print();
  };

  if (propertiesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading property data...</span>
      </div>
    );
  }

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return "[MISSING]";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") {
      if (value === 0) return "0";
      return value.toLocaleString();
    }
    if (typeof value === "string") {
      if (value.trim() === "") return "[EMPTY]";
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return "[EMPTY ARRAY]";
      return `${value.length} items`;
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  };

  const isMissing = (value: any): boolean => {
    if (value === null || value === undefined) return true;
    if (typeof value === "string" && value.trim() === "") return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  };

  const isZero = (value: any): boolean => {
    return typeof value === "number" && value === 0;
  };

  const getFieldCategory = (fieldName: string): string => {
    const categories: Record<string, string[]> = {
      "Location & Identity": ["propertyName", "building", "isSingleBuilding", "streetAddress", "city", "state", "zip", "displayName", "displayOrder"],
      "Parking": ["standardParking", "accessibleParking", "evParking", "trailerParking"],
      "Electrical": ["electricalAllocation", "electricalAllocationIncrement"],
      "Bay Configuration": ["bayConfigurations", "mechanicalRoomSquareFootage", "firstBayDirection", "bayProgressionDirection"],
      "Building Specifications": ["buildingDepth", "slabThickness", "clearHeight", "floorFlatness", "truckApronSlab", "rampCapacity", "roofRValue", "firePumpInfo", "fireSprinklerInfo"],
      "Metadata": ["id", "createdAt", "updatedAt"],
    };
    
    for (const [category, fields] of Object.entries(categories)) {
      if (fields.includes(fieldName)) return category;
    }
    return "Other";
  };

  const groupFieldsByCategory = (property: Property) => {
    const grouped: Record<string, { field: string; value: any; missing: boolean; zero: boolean }[]> = {};
    
    const excludeFields = ["createdAt", "updatedAt"];
    
    for (const [key, value] of Object.entries(property)) {
      if (excludeFields.includes(key)) continue;
      
      const category = getFieldCategory(key);
      if (!grouped[category]) grouped[category] = [];
      
      grouped[category].push({
        field: key,
        value,
        missing: isMissing(value),
        zero: isZero(value),
      });
    }
    
    return grouped;
  };

  const formatFieldName = (fieldName: string): string => {
    return fieldName
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  };

  const calculateTotals = (property: Property) => {
    const bays = property.bayConfigurations || [];
    return {
      totalBays: bays.length,
      totalSquareFootage: bays.reduce((sum, bay) => sum + (bay.squareFootage || 0), 0),
      totalRentable: bays.reduce((sum, bay) => sum + (bay.rentableSquareFootage || 0), 0),
      totalStandardDoors: bays.reduce((sum, bay) => sum + (bay.standardDockDoors || 0), 0),
      totalOversizedDoors: bays.reduce((sum, bay) => sum + (bay.oversizedDockDoors || 0), 0),
      totalParking: (property.standardParking || 0) + (property.accessibleParking || 0) + (property.evParking || 0),
    };
  };

  return (
    <div className="container mx-auto py-8 print:py-2">
      <div className="flex justify-between items-center mb-6 print:hidden">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Building2 className="h-8 w-8" />
            Property Data Audit Report
          </h1>
          <p className="text-muted-foreground mt-1">
            Complete source of truth for all property data with missing field identification
          </p>
        </div>
        <Button onClick={handlePrint} className="gap-2">
          <Printer className="h-4 w-4" />
          Print Report
        </Button>
      </div>

      <div className="print:block hidden mb-4">
        <h1 className="text-2xl font-bold">Property Data Audit Report</h1>
        <p className="text-sm text-gray-600">Generated: {new Date().toLocaleDateString()}</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 print:grid-cols-4 print:gap-2 print:mb-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{properties?.length || 0}</div>
            <div className="text-sm text-muted-foreground">Total Properties</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">
              {properties?.reduce((sum, p) => sum + (p.bayConfigurations?.length || 0), 0) || 0}
            </div>
            <div className="text-sm text-muted-foreground">Total Bays</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600">
              {properties?.filter(p => 
                p.buildingDepth && p.clearHeight && p.slabThickness
              ).length || 0}
            </div>
            <div className="text-sm text-muted-foreground">Complete Specs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-amber-600">
              {properties?.filter(p => 
                !p.buildingDepth || !p.clearHeight || !p.slabThickness
              ).length || 0}
            </div>
            <div className="text-sm text-muted-foreground">Missing Specs</div>
          </CardContent>
        </Card>
      </div>

      {/* Property Details */}
      <div className="space-y-8 print:space-y-4">
        {properties?.map((property) => {
          const grouped = groupFieldsByCategory(property);
          const totals = calculateTotals(property);
          const missingFields = Object.values(grouped)
            .flat()
            .filter(f => f.missing || (f.zero && !["id", "displayOrder", "mechanicalRoomSquareFootage"].includes(f.field)));
          
          return (
            <Card key={property.id} className="print:break-inside-avoid">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between">
                  <span className="text-xl">
                    {property.propertyName} - Building {property.building}
                  </span>
                  {missingFields.length === 0 ? (
                    <Badge className="bg-green-100 text-green-800 gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Complete
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-500 text-amber-700 gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {missingFields.length} Missing/Empty Fields
                    </Badge>
                  )}
                </CardTitle>
                <div className="text-sm text-muted-foreground">
                  {property.streetAddress}, {property.city}, {property.state} {property.zip}
                </div>
              </CardHeader>
              <CardContent>
                {/* Quick Stats */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4 p-3 bg-muted/50 rounded-lg print:grid-cols-6">
                  <div className="text-center">
                    <div className="font-semibold">{totals.totalBays}</div>
                    <div className="text-xs text-muted-foreground">Bays</div>
                  </div>
                  <div className="text-center">
                    <div className="font-semibold">{totals.totalRentable.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Rentable SF</div>
                  </div>
                  <div className="text-center">
                    <div className="font-semibold">{totals.totalSquareFootage.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Bay SF</div>
                  </div>
                  <div className="text-center">
                    <div className="font-semibold">{totals.totalStandardDoors}</div>
                    <div className="text-xs text-muted-foreground">Std Doors</div>
                  </div>
                  <div className="text-center">
                    <div className="font-semibold">{totals.totalOversizedDoors}</div>
                    <div className="text-xs text-muted-foreground">OS Doors</div>
                  </div>
                  <div className="text-center">
                    <div className="font-semibold">{totals.totalParking}</div>
                    <div className="text-xs text-muted-foreground">Parking</div>
                  </div>
                </div>

                {/* Categorized Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2 print:gap-2">
                  {Object.entries(grouped)
                    .filter(([category]) => category !== "Metadata")
                    .map(([category, fields]) => (
                      <div key={category} className="border rounded-lg p-3 print:p-2">
                        <h4 className="font-semibold text-sm mb-2 text-primary">{category}</h4>
                        <div className="space-y-1">
                          {fields.map(({ field, value, missing, zero }) => (
                            <div key={field} className="flex justify-between text-sm">
                              <span className="text-muted-foreground">{formatFieldName(field)}:</span>
                              <span className={`font-medium ${missing ? 'text-red-600' : zero ? 'text-amber-600' : ''}`}>
                                {field === "bayConfigurations" ? (
                                  <span>{(value as BayConfiguration[])?.length || 0} bays configured</span>
                                ) : (
                                  formatValue(value)
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>

                {/* Bay Configuration Details */}
                {property.bayConfigurations && property.bayConfigurations.length > 0 && (
                  <div className="mt-4 border rounded-lg p-3 print:p-2">
                    <h4 className="font-semibold text-sm mb-2 text-primary">Bay Configuration Details</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-1">Bay</th>
                            <th className="text-right py-1">Bay SF</th>
                            <th className="text-right py-1">Rentable SF</th>
                            <th className="text-center py-1">Std Doors</th>
                            <th className="text-center py-1">OS Doors</th>
                            <th className="text-center py-1">Restroom</th>
                            <th className="text-center py-1">Storefront</th>
                          </tr>
                        </thead>
                        <tbody>
                          {property.bayConfigurations.map((bay) => (
                            <tr key={bay.id} className="border-b border-dashed">
                              <td className="py-1">{bay.bayName}</td>
                              <td className="text-right py-1">{bay.squareFootage?.toLocaleString() || 0}</td>
                              <td className="text-right py-1">{bay.rentableSquareFootage?.toLocaleString() || 0}</td>
                              <td className="text-center py-1">{bay.standardDockDoors || 0}</td>
                              <td className="text-center py-1">{bay.oversizedDockDoors || 0}</td>
                              <td className="text-center py-1">{bay.hasRestroom ? "Yes" : "No"}</td>
                              <td className="text-center py-1">{bay.hasStorefrontEntry ? "Yes" : "No"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Missing/Required Data Section */}
                {missingFields.length > 0 && (
                  <div className="mt-4 border border-amber-300 bg-amber-50 rounded-lg p-3 print:p-2">
                    <h4 className="font-semibold text-sm mb-2 text-amber-800 flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" />
                      MISSING/REQUIRED DATA
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 print:grid-cols-4">
                      {missingFields.map(({ field, zero }) => (
                        <div key={field} className="text-sm">
                          <span className={`font-medium ${zero ? 'text-amber-700' : 'text-red-700'}`}>
                            {formatFieldName(field)}: {zero ? "[ZERO]" : "[MISSING]"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-sm text-muted-foreground print:mt-4">
        <p>Report generated on {new Date().toLocaleString()}</p>
        <p>Total Properties Audited: {properties?.length || 0}</p>
      </div>
    </div>
  );
}
