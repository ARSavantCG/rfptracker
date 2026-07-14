import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle, Building2, Printer, DollarSign, Zap, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Property, Transformer, MainPanel, PropertyExistingImprovement, BayConfiguration, ExecutedLease } from "@shared/schema";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";

export default function PropertyDataAudit() {
  const { data: properties, isLoading: propertiesLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const { data: allImprovements } = useQuery<Record<number, PropertyExistingImprovement[]>>({
    queryKey: ["/api/all-property-improvements"],
    queryFn: async () => {
      if (!properties) return {};
      const improvementsMap: Record<number, PropertyExistingImprovement[]> = {};
      await Promise.all(
        properties.map(async (p) => {
          try {
            const res = await fetch(`/api/properties/${p.id}/existing-improvements`, {
              credentials: 'include',
              headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` }
            });
            if (res.ok) {
              improvementsMap[p.id] = await res.json();
            }
          } catch (e) {
            improvementsMap[p.id] = [];
          }
        })
      );
      return improvementsMap;
    },
    enabled: !!properties && properties.length > 0,
  });

  const { data: allTransformers } = useQuery<Record<number, Transformer[]>>({
    queryKey: ["/api/all-property-transformers"],
    queryFn: async () => {
      if (!properties) return {};
      const transformersMap: Record<number, Transformer[]> = {};
      await Promise.all(
        properties.map(async (p) => {
          try {
            const res = await fetch(`/api/properties/${p.id}/transformers`, {
              credentials: 'include',
              headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` }
            });
            if (res.ok) {
              transformersMap[p.id] = await res.json();
            }
          } catch (e) {
            transformersMap[p.id] = [];
          }
        })
      );
      return transformersMap;
    },
    enabled: !!properties && properties.length > 0,
  });

  const { data: allPanels } = useQuery<Record<number, MainPanel[]>>({
    queryKey: ["/api/all-property-panels"],
    queryFn: async () => {
      if (!properties) return {};
      const panelsMap: Record<number, MainPanel[]> = {};
      await Promise.all(
        properties.map(async (p) => {
          try {
            const res = await fetch(`/api/properties/${p.id}/main-panels`, {
              credentials: 'include',
              headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` }
            });
            if (res.ok) {
              panelsMap[p.id] = await res.json();
            }
          } catch (e) {
            panelsMap[p.id] = [];
          }
        })
      );
      return panelsMap;
    },
    enabled: !!properties && properties.length > 0,
  });

  const { data: allLeases } = useQuery<Record<number, ExecutedLease[]>>({
    queryKey: ["/api/all-property-leases"],
    queryFn: async () => {
      if (!properties) return {};
      const leasesMap: Record<number, ExecutedLease[]> = {};
      await Promise.all(
        properties.map(async (p) => {
          try {
            const res = await fetch(`/api/properties/${p.id}/executed-leases`, {
              credentials: 'include',
              headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` }
            });
            if (res.ok) {
              leasesMap[p.id] = await res.json();
            }
          } catch (e) {
            leasesMap[p.id] = [];
          }
        })
      );
      return leasesMap;
    },
    enabled: !!properties && properties.length > 0,
  });

  const handlePrint = () => {
    window.print();
  };

  const handleCostsInPlacePortfolio = async () => {
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const response = await fetch(`/api/reports/costs-in-place`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        throw new Error('Costs-in-Place portfolio report failed');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      console.error('Costs-in-Place portfolio report error:', error);
    }
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
      "Location & Identity": ["propertyName", "building", "isSingleBuilding", "displayOrder"],
      "Parking": ["standardParking", "accessibleParking", "evParking", "trailerParking"],
      "Electrical": ["electricalAllocation", "electricalAllocationIncrement"],
      "Bay Configuration": ["bayConfigurations", "mechanicalRoomSquareFootage", "firstBayDirection", "bayProgressionDirection"],
      "Building Specifications": ["buildingDepth", "slabThickness", "clearHeight", "floorFlatness", "truckApronSlab", "rampCapacity", "roofRValue", "firePumpInfo", "fireSprinklerInfo"],
      "Land Lease": ["isLandLease", "beneficialOccupancyDate", "leaseExpirationDate", "leaseExtensions"],
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
    const customLabels: Record<string, string> = {
      isSingleBuilding: "Single Building",
      isLandLease: "Land Lease",
      beneficialOccupancyDate: "Beneficial Occupancy",
      leaseExpirationDate: "Lease Expiration",
      leaseExtensions: "Extension Options",
    };
    if (customLabels[fieldName]) return customLabels[fieldName];
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
    <>
      <style>{`
        @media print {
          @page {
            size: portrait;
            margin: 0.5in;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
      <div className="min-h-screen">
      {/* Bridge Blue Header Bar - Matches report branding */}
      <div style={{ background: 'rgb(0, 50, 130)' }} className="text-white py-4 px-6 print:py-2 print:px-4">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <img src="/api/bridge-logo" alt="Kurv Industrial" className="h-8 bg-white rounded px-2 py-1" />
            <div>
              <h1 className="text-2xl font-bold">Property Data Audit Report</h1>
              <p className="text-blue-200 text-sm">Complete source of truth for all property data</p>
            </div>
          </div>
          <div className="flex items-center gap-4 print:hidden">
            <span className="text-sm text-blue-200">Generated: {new Date().toLocaleDateString()}</span>
            <Button onClick={handleCostsInPlacePortfolio} variant="secondary" className="gap-2">
              <DollarSign className="h-4 w-4" />
              Costs-in-Place Report
            </Button>
            <Button onClick={handlePrint} variant="secondary" className="gap-2">
              <Printer className="h-4 w-4" />
              Print Report
            </Button>
          </div>
        </div>
      </div>
      
      <div className="container mx-auto py-6 print:py-2 px-4">

      {/* Property Details */}
      <div className="space-y-8 print:space-y-4">
        {properties?.map((property) => {
          const grouped = groupFieldsByCategory(property);
          const totals = calculateTotals(property);
          const missingFields = Object.values(grouped)
            .flat()
            .filter(f => {
              if (f.field === "building" && property.isSingleBuilding) return false;
              const isLandLeaseOnlyField = ["beneficialOccupancyDate", "leaseExpirationDate", "leaseExtensions"].includes(f.field);
              if (isLandLeaseOnlyField && !property.isLandLease) return false;
              return f.missing || (f.zero && !["id", "displayOrder", "mechanicalRoomSquareFootage"].includes(f.field));
            });
          const improvements = allImprovements?.[property.id] || [];
          const totalCostsInPlace = improvements.reduce((sum, imp) => {
            const forecastCost = imp.forecastCost || 0;
            const committedCost = imp.committedCost || 0;
            const actualsCost = imp.actualsCost || 0;
            return sum + forecastCost + committedCost + actualsCost;
          }, 0);
          const transformers = allTransformers?.[property.id] || [];
          const panels = allPanels?.[property.id] || [];
          const leases = allLeases?.[property.id] || [];
          const totalTransformerKva = transformers.reduce((sum, t) => sum + (t.totalCapacityKva || 0), 0);
          
          return (
            <Card key={property.id} className="print:break-after-page">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between">
                  <span className="text-xl">
                    {property.propertyName}{property.isSingleBuilding ? "" : ` - Building ${property.building}`}
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
                    .filter(([category]) => category !== "Metadata" && category !== "Location & Identity" && category !== "Other")
                    .map(([category, fields]) => (
                      <div key={category} className="border rounded-lg p-3 print:p-2">
                        <h4 className="font-semibold text-sm mb-2 text-primary">{category}</h4>
                        <div className="space-y-1">
                          {fields.map(({ field, value, missing, zero }) => {
                            const isBuildingFieldOnSingleBuilding = field === "building" && property.isSingleBuilding;
                            const isLandLeaseOnlyField = ["beneficialOccupancyDate", "leaseExpirationDate", "leaseExtensions"].includes(field);
                            const isNotApplicable = isBuildingFieldOnSingleBuilding || (isLandLeaseOnlyField && !property.isLandLease);
                            
                            let displayValue: string;
                            if (isNotApplicable) {
                              displayValue = "N/A";
                            } else if (field === "bayConfigurations") {
                              displayValue = `${(value as BayConfiguration[])?.length || 0} bays configured`;
                            } else if (["beneficialOccupancyDate", "leaseExpirationDate"].includes(field) && value) {
                              displayValue = new Date(value as string).toLocaleDateString();
                            } else {
                              displayValue = formatValue(value);
                            }
                            
                            const showMissing = missing && !isNotApplicable && !(isLandLeaseOnlyField && !property.isLandLease);
                            return (
                              <div key={field} className="flex justify-between text-sm">
                                <span className="text-muted-foreground">{formatFieldName(field)}:</span>
                                <span className={`font-medium ${showMissing ? 'text-red-600' : zero ? 'text-amber-600' : ''}`}>
                                  {displayValue}
                                </span>
                              </div>
                            );
                          })}
                          {/* Embed Electrical Infrastructure in Electrical category */}
                          {category === "Electrical" && transformers.length > 0 && (() => {
                            const totalPanelKva = panels.reduce((sum, p) => sum + (p.maxCapacityKva || 0), 0);
                            const availableKva = totalTransformerKva - totalPanelKva;
                            const usagePercent = totalTransformerKva > 0 ? Math.round((totalPanelKva / totalTransformerKva) * 100) : 0;
                            return (
                              <div className="mt-3 pt-2 border-t space-y-2">
                                <div className="text-xs font-semibold text-primary flex items-center gap-1">
                                  <Zap className="h-3 w-3" />
                                  Transformer Infrastructure
                                </div>
                                <div className="grid grid-cols-4 gap-1 text-xs">
                                  <div className="text-center">
                                    <div className="font-semibold">{totalTransformerKva.toLocaleString()}</div>
                                    <div className="text-muted-foreground">Total kVA</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="font-semibold">{totalPanelKva.toLocaleString()}</div>
                                    <div className="text-muted-foreground">Allocated</div>
                                  </div>
                                  <div className="text-center">
                                    <div className={`font-semibold ${availableKva < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                                      {availableKva.toLocaleString()}
                                    </div>
                                    <div className="text-muted-foreground">Available</div>
                                  </div>
                                  <div className="text-center">
                                    <div className={`font-semibold ${usagePercent > 90 ? 'text-red-600' : usagePercent > 75 ? 'text-amber-600' : 'text-emerald-700'}`}>
                                      {usagePercent}%
                                    </div>
                                    <div className="text-muted-foreground">Used</div>
                                  </div>
                                </div>
                                {transformers.map((transformer) => {
                                  const transformerPanels = panels.filter(p => p.transformerId === transformer.id);
                                  const transformerAllocated = transformerPanels.reduce((sum, p) => sum + (p.maxCapacityKva || 0), 0);
                                  const transformerAvailable = (transformer.totalCapacityKva || 0) - transformerAllocated;
                                  return (
                                    <div key={transformer.id} className="border-l-2 border-amber-300 pl-2 text-xs">
                                      <div className="flex justify-between">
                                        <span>{transformer.transformerName}</span>
                                        <span>
                                          {transformer.totalCapacityKva?.toLocaleString() || 0} kVA
                                          <span className={`ml-1 ${transformerAvailable < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                            ({transformerAvailable >= 0 ? '+' : ''}{transformerAvailable})
                                          </span>
                                        </span>
                                      </div>
                                      {transformer.fplId && <div className="text-muted-foreground">FPL: {transformer.fplId}</div>}
                                      {transformerPanels.map((panel) => (
                                        <div key={panel.id} className="flex justify-between text-muted-foreground pl-2">
                                          <span>{panel.panelName} ({panel.voltage}V)</span>
                                          <span>{panel.maxCapacityKva || 0} kVA / {panel.capacityAmps || 0}A</span>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                          {category === "Electrical" && transformers.length === 0 && (
                            <div className="mt-2 pt-2 border-t text-xs text-muted-foreground italic">
                              No transformers/panels recorded
                            </div>
                          )}
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

                {/* Existing Leases */}
                <div className="mt-4 border rounded-lg p-3 print:p-2 bg-blue-50/50">
                  <h4 className="font-semibold text-sm mb-2 text-primary flex items-center gap-1">
                    <FileText className="h-4 w-4" />
                    Existing Leases
                  </h4>
                  {leases.length > 0 ? (
                    <div className="space-y-1">
                      {leases.map((lease) => (
                        <div key={lease.id} className="flex justify-between text-sm border-b border-dashed pb-1">
                          <span className="text-muted-foreground">
                            {lease.tenantName || 'Unknown Tenant'} - {lease.bayNumbers || 'N/A'}
                          </span>
                          <span className="font-medium">
                            {lease.rentableSquareFootage?.toLocaleString() || 0} SF
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between text-sm pt-2 border-t font-semibold">
                        <span>Total Leased:</span>
                        <span>{leases.reduce((sum, l) => sum + (l.rentableSquareFootage || 0), 0).toLocaleString()} SF</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No existing leases recorded</p>
                  )}
                </div>

                {/* Existing Improvements / Costs in Place */}
                <div className="mt-4 border rounded-lg p-3 print:p-2 bg-emerald-50/50">
                  <h4 className="font-semibold text-sm mb-2 text-primary flex items-center gap-1">
                    <DollarSign className="h-4 w-4" />
                    Existing Improvements (Costs in Place)
                  </h4>
                  {improvements.length > 0 ? (
                    <div className="space-y-1">
                      {improvements.map((imp) => {
                        const total = (imp.forecastCost || 0) + (imp.committedCost || 0) + (imp.actualsCost || 0);
                        return (
                          <div key={imp.id} className="flex justify-between text-sm border-b border-dashed pb-1">
                            <span className="text-muted-foreground">
                              {imp.category || 'Uncategorized'}: {imp.description || '-'}
                            </span>
                            <span className="font-medium text-emerald-700">
                              ${(total / 100).toLocaleString()}
                            </span>
                          </div>
                        );
                      })}
                      <div className="flex justify-between text-sm pt-2 border-t font-semibold">
                        <span>Total Costs in Place:</span>
                        <span className="text-emerald-700">${(totalCostsInPlace / 100).toLocaleString()}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No existing improvements recorded</p>
                  )}
                </div>

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
    </div>
    </>
  );
}
