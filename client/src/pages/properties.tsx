import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building, MapPin, Plus, Search, Edit, Grid, ChevronDown, ChevronUp, Printer, Layers } from "lucide-react";
import { useState } from "react";
import Navigation from "@/components/navigation";
import { PropertyFormModal } from "@/components/property-form-modal";
import BayConfigurationManager from "@/components/bay-configuration-manager";
import { formatDate } from "@/lib/utils";
import LeaseManagementModal from "@/components/lease-management-modal";
import { PropertyExistingImprovementsModal } from "@/components/property-existing-improvements-modal";
import { PropertyAttachments } from "@/components/property-attachments";
import type { Property, BayConfiguration } from "@shared/schema";

export default function Properties() {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedProperty, setExpandedProperty] = useState<string | null>(null);
  const [expandedPropertyInfo, setExpandedPropertyInfo] = useState<number | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<Record<string, string>>({});

  const { data: properties, isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  // Query for executed leases for all properties
  const { data: allExecutedLeases } = useQuery<any[]>({
    queryKey: ["/api/executed-leases/all"],
  });

  const filteredProperties = properties?.filter(property =>
    property.propertyName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    property.building?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    property.streetAddress?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    property.city?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  // Group properties by base property name
  const groupedProperties = filteredProperties.reduce((groups, property) => {
    const baseName = property.propertyName;
    if (!groups[baseName]) {
      groups[baseName] = [];
    }
    groups[baseName].push(property);
    return groups;
  }, {} as Record<string, Property[]>);

  // Sort buildings within each group alphabetically (A first, then B, C, etc.)
  Object.keys(groupedProperties).forEach(baseName => {
    groupedProperties[baseName].sort((a, b) => {
      const buildingA = a.building || '';
      const buildingB = b.building || '';
      return buildingA.localeCompare(buildingB);
    });
  });

  const formatAddress = (property: Property) => {
    const parts = [
      property.streetAddress,
      property.city,
      property.state,
      property.zip
    ].filter(Boolean);
    return parts.join(', ');
  };

  const togglePropertyExpansion = (baseName: string) => {
    setExpandedProperty(expandedProperty === baseName ? null : baseName);
  };

  const handleBuildingSelection = (baseName: string, value: string) => {
    setSelectedBuilding(prev => ({
      ...prev,
      [baseName]: value
    }));
    
    // Set expansion state based on selection
    if (value === "all") {
      setExpandedProperty(baseName);
    } else if (value === "stacked") {
      setExpandedProperty(null);
    } else {
      // Single building selected - show it expanded to display fully
      setExpandedProperty(baseName);
    }
  };

  // Helper functions
  const getBayConfigurationCount = (property: Property): number => {
    return property.bayConfigurations?.length || 0;
  };

  const getTotalRentableArea = (property: Property): number => {
    const bayConfigurations = property.bayConfigurations as BayConfiguration[] || [];
    
    // Calculate using correct method: bay SF + total mechanical room SF
    const totalBaySquareFootage = bayConfigurations.reduce((total, bay) => {
      return total + (bay.squareFootage || 0);
    }, 0);
    const mechanicalRoomSquareFootage = property.mechanicalRoomSquareFootage || 0;
    
    return totalBaySquareFootage + mechanicalRoomSquareFootage;
  };

  const calculateParkingRatio = (property: Property): string => {
    const totalRegularParking = (property.standardParking || 0) + (property.accessibleParking || 0) + (property.evParking || 0);
    const totalRentableSquareFootage = getTotalRentableArea(property);
    
    if (totalRentableSquareFootage === 0) return "0.00";
    
    const ratio = totalRegularParking / totalRentableSquareFootage;
    return (ratio * 1000).toFixed(2);
  };

  const calculateTrailerParkingRatio = (property: Property): string => {
    const trailerParking = property.trailerParking || 0;
    const totalRentableSquareFootage = getTotalRentableArea(property);
    
    if (totalRentableSquareFootage === 0) return "0.00";
    
    const ratio = trailerParking / totalRentableSquareFootage;
    return (ratio * 1000).toFixed(2);
  };

  const getDoorCounts = (property: Property): { standard: number; oversized: number; total: number } => {
    const bayConfigurations = property.bayConfigurations as BayConfiguration[] || [];
    const standardDoors = bayConfigurations.reduce((total, bay) => {
      return total + (bay.standardDockDoors || 0);
    }, 0);
    const oversizedDoors = bayConfigurations.reduce((total, bay) => {
      return total + (bay.oversizedDockDoors || 0);
    }, 0);
    return {
      standard: standardDoors,
      oversized: oversizedDoors,
      total: standardDoors + oversizedDoors
    };
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Building className="h-8 w-8 text-blue-600" />
              Properties
            </h1>
            <p className="text-gray-600 mt-2">
              Manage your property portfolio and building information
            </p>
          </div>
          <PropertyFormModal />
        </div>

        {/* Search Bar */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search properties by name, building, address, or city..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>



        {/* Properties Grid */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-600 mt-4">Loading properties...</p>
          </div>
        ) : filteredProperties.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-12">
                <Building className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {searchTerm ? 'No properties found' : 'No properties yet'}
                </h3>
                <p className="text-gray-600 mb-6">
                  {searchTerm 
                    ? 'Try adjusting your search terms'
                    : 'Get started by adding your first property'
                  }
                </p>
                {!searchTerm && (
                  <PropertyFormModal />
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {Object.entries(groupedProperties).map(([baseName, buildings]) => {
              const isExpanded = expandedProperty === baseName;
              const isMultiBuilding = buildings.length > 1;
              const selectedBuildingId = selectedBuilding[baseName];
              
              // Filter buildings based on selection
              let displayBuildings = buildings;
              if (selectedBuildingId && selectedBuildingId !== "all" && selectedBuildingId !== "stacked") {
                displayBuildings = buildings.filter(b => b.id.toString() === selectedBuildingId);
              }
              
              // Override isExpanded logic for single building selection
              const effectiveExpansion = selectedBuildingId === "stacked" ? false : 
                                       selectedBuildingId && selectedBuildingId !== "all" && selectedBuildingId !== "stacked" ? true : 
                                       isExpanded;
              
              return (
                <div key={baseName} className="relative">
                  {/* Stacked Cards Container */}
                  <div className="relative" style={{ minHeight: isMultiBuilding ? '400px' : 'auto' }}>
                    {displayBuildings.map((property, index) => {
                      const isVisible = effectiveExpansion || index < 3;
                      // Reverse the visual stacking order: A in back (index 0), B on top (index 1), etc.
                      const visualIndex = displayBuildings.length - 1 - index;
                      const stackOffset = effectiveExpansion ? index * 16 : visualIndex * 8;
                      const zIndex = effectiveExpansion ? displayBuildings.length - index : index + 1;
                      
                      return (
                        <Card 
                          key={property.id} 
                          className={`
                            transition-all duration-300 ease-in-out
                            ${index > 0 && !effectiveExpansion ? 'absolute' : 'relative'}
                            ${isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}
                            ${isMultiBuilding && !effectiveExpansion ? 'cursor-pointer' : ''}
                            hover:shadow-lg
                            ${isMultiBuilding && !effectiveExpansion && index === 0 ? 'hover:scale-[1.02]' : ''}
                            ${effectiveExpansion && index > 0 ? 'mt-4' : ''}
                          `}
                          style={{
                            zIndex,
                            ...(index > 0 && !effectiveExpansion ? {
                              top: `-${stackOffset * 4}px`,
                              left: `${stackOffset}px`,
                              right: `-${stackOffset}px`,
                              transform: `rotate(${index * 0.3}deg)`,
                              boxShadow: `0 ${index * 4}px ${index * 8}px rgba(0,0,0,0.2)`
                            } : {})
                          }}
                          onClick={() => isMultiBuilding && !effectiveExpansion ? handleBuildingSelection(baseName, "all") : undefined}
                        >
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="p-2 bg-blue-100 rounded-lg">
                              <Building className="h-6 w-6 text-blue-600" />
                            </div>
                            <div>
                              <CardTitle className="text-lg font-bold">
                                {property.propertyName || 'Unnamed Property'}
                              </CardTitle>
                              {property.building && (
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                    Bldg. {property.building}
                                  </span>
                                </div>
                              )}
                              {buildings.length > 1 && index === 0 && !isExpanded && (
                                <div className="flex items-center gap-2 mt-2">
                                  <p className="text-xs text-blue-600 font-medium">
                                    {buildings.length} Buildings ({buildings.map(b => b.building).join(', ')})
                                  </p>
                                  <ChevronDown className="h-3 w-3 text-blue-600" />
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <PropertyFormModal 
                              property={property}
                              trigger={
                                <Button variant="outline" size="sm">
                                  <Edit className="h-4 w-4" />
                                </Button>
                              }
                            />
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={async () => {
                                try {
                                  const token = localStorage.getItem('auth-token');
                                  const response = await fetch(`/api/properties/${property.id}/print`, {
                                    headers: {
                                      'Authorization': `Bearer ${token}`
                                    }
                                  });
                                  
                                  if (!response.ok) {
                                    throw new Error('Print failed');
                                  }
                                  
                                  const blob = await response.blob();
                                  const url = window.URL.createObjectURL(blob);
                                  window.open(url, '_blank');
                                } catch (error) {
                                  console.error('Print error:', error);
                                }
                              }}
                              title="Print property report"
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                            <PropertyAttachments 
                              propertyId={property.id}
                              propertyName={property.propertyName || 'Property'}
                            />
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          <div className="flex items-start text-sm text-gray-600">
                            <MapPin className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />
                            <div>
                              <p>{formatAddress(property)}</p>
                            </div>
                          </div>
                          
                          {property.displayName && property.displayName !== formatAddress(property) && (
                            <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
                              <strong>Display Name:</strong> {property.displayName}
                            </div>
                          )}
                          
                          <div className="text-xs text-gray-400 pt-2 border-t">
                            <p>Property ID: {property.id}</p>
                            {property.createdAt && (
                              <p>Added: {formatDate(property.createdAt)}</p>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-2 mt-4">
                          <BayConfigurationManager property={property} />
                          <LeaseManagementModal 
                            property={property} 
                            availableBays={property.bayConfigurations || []} 
                          />
                          <PropertyExistingImprovementsModal 
                            property={property}
                          />
                        </div>
                        
                        {/* Property Info Section */}
                        <div className="mt-4 pt-4 border-t">
                          <div 
                            className="flex items-center justify-between cursor-pointer hover:bg-gray-50 p-2 rounded -m-2 mb-1"
                            onClick={() => setExpandedPropertyInfo(expandedPropertyInfo === property.id ? null : property.id)}
                          >
                            <h4 className="text-sm font-semibold text-gray-800">Property Info</h4>
                            {expandedPropertyInfo === property.id ? (
                              <ChevronUp className="h-4 w-4 text-gray-500" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-gray-500" />
                            )}
                          </div>
                          
                          {expandedPropertyInfo === property.id && (
                            <div className="space-y-3 mt-3">
                              {/* Rentable Area and Bay Count */}
                              <div className="space-y-2 mb-3 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Total Rentable Area:</span>
                                  <span className="font-medium text-gray-900">
                                    {getTotalRentableArea(property).toLocaleString()} SF
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Bay Count:</span>
                                  <span className="font-medium text-gray-900">
                                    {getBayConfigurationCount(property)} bays
                                  </span>
                                </div>
                              </div>

                              {/* Dock Door Information */}
                              <div className="mb-3">
                                <div className="text-sm text-gray-600 mb-2">Dock Doors:</div>
                                <div className="space-y-1 text-xs">
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Standard:</span>
                                    <span className="font-medium">{getDoorCounts(property).standard}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Oversized:</span>
                                    <span className="font-medium">{getDoorCounts(property).oversized}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Total:</span>
                                    <span className="font-medium">{getDoorCounts(property).total} doors</span>
                                  </div>
                                </div>
                              </div>

                              {/* Vehicular Parking Information */}
                              <div className="mb-3">
                                <div className="text-sm text-gray-600 mb-2">Vehicular Parking:</div>
                                <div className="space-y-1 text-xs">
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Standard:</span>
                                    <span className="font-medium">{property.standardParking || 0}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Accessible:</span>
                                    <span className="font-medium">{property.accessibleParking || 0}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">EV:</span>
                                    <span className="font-medium">{property.evParking || 0}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-700 font-medium">Total:</span>
                                    <span className="font-semibold">{((property.standardParking || 0) + (property.accessibleParking || 0) + (property.evParking || 0))} spaces</span>
                                  </div>
                                </div>
                              </div>

                              {/* Trailer Parking Information */}
                              <div className="mb-3">
                                <div className="text-sm text-gray-600 mb-2">Trailer Parking:</div>
                                <div className="space-y-1 text-xs">
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Trailer:</span>
                                    <span className="font-medium">{property.trailerParking || 0} spaces</span>
                                  </div>
                                </div>
                              </div>

                              {/* Parking Ratio */}
                              <div className="text-sm bg-blue-50 p-2 rounded mb-3">
                                <div className="flex justify-between items-center">
                                  <span className="text-gray-600">Parking Ratio:</span>
                                  <span className="font-medium text-blue-700">
                                    {calculateParkingRatio(property)} per 1,000 SF
                                  </span>
                                </div>
                              </div>

                              {/* Trailer Parking Ratio */}
                              <div className="text-sm bg-orange-50 p-2 rounded mb-3">
                                <div className="flex justify-between items-center">
                                  <span className="text-gray-600">Trailer Parking Ratio:</span>
                                  <span className="font-medium text-orange-700">
                                    {calculateTrailerParkingRatio(property)} per 1,000 SF
                                  </span>
                                </div>
                              </div>

                              {/* Executed Leases */}
                              {(() => {
                                const propertyLeases = (allExecutedLeases || []).filter(
                                  (lease: any) => lease.propertyId === property.id
                                );
                                
                                // Calculate totals for leased areas and parking
                                const totalLeasedArea = propertyLeases.reduce((total: number, lease: any) => {
                                  // Use override if available, otherwise calculate from bay configurations
                                  if (lease.rentableAreaOverride) {
                                    return total + lease.rentableAreaOverride;
                                  }
                                  const assignedBayConfigs = property.bayConfigurations?.filter(
                                    (bay: any) => lease.assignedBays?.includes(bay.id)
                                  ) || [];
                                  const leaseArea = assignedBayConfigs.reduce(
                                    (subtotal: number, bay: any) => subtotal + (bay.rentableSquareFootage || bay.squareFootage || 0),
                                    0
                                  );
                                  return total + leaseArea;
                                }, 0);
                                
                                const totalLeasedParking = propertyLeases.reduce((total: number, lease: any) => {
                                  return total + (lease.standardParking || 0) + (lease.accessibleParking || 0) + 
                                         (lease.evParking || 0) + (lease.trailerParking || 0);
                                }, 0);
                                
                                // Calculate remaining available space
                                const totalPropertyArea = getTotalRentableArea(property);
                                const totalPropertyParking = (property.standardParking || 0) + 
                                                           (property.accessibleParking || 0) + 
                                                           (property.evParking || 0);
                                const totalPropertyTrailerParking = property.trailerParking || 0;
                                
                                // Calculate totals for leased trailer parking separately
                                const totalLeasedTrailerParking = propertyLeases.reduce((total: number, lease: any) => {
                                  return total + (lease.trailerParking || 0);
                                }, 0);
                                
                                const remainingArea = totalPropertyArea - totalLeasedArea;
                                const remainingParking = totalPropertyParking - (totalLeasedParking - totalLeasedTrailerParking);
                                const remainingTrailerParking = totalPropertyTrailerParking - totalLeasedTrailerParking;
                                
                                return (
                                  <div>
                                    <div className="text-sm text-gray-600 mb-2 flex justify-between items-center">
                                      <span>Executed Leases:</span>
                                      <span className="text-xs text-gray-500">({propertyLeases.length})</span>
                                    </div>
                                    {propertyLeases.length === 0 ? (
                                      <div className="text-xs text-gray-400 italic text-center py-2">
                                        No executed leases
                                      </div>
                                    ) : (
                                      <div className="space-y-2 max-h-32 overflow-y-auto">
                                        {propertyLeases.map((lease: any) => {
                                          // Use override if available, otherwise calculate from bay configurations
                                          let totalRentableArea;
                                          if (lease.rentableAreaOverride) {
                                            totalRentableArea = lease.rentableAreaOverride;
                                          } else {
                                            const assignedBayConfigs = property.bayConfigurations?.filter(
                                              (bay: any) => lease.assignedBays?.includes(bay.id)
                                            ) || [];
                                            totalRentableArea = assignedBayConfigs.reduce(
                                              (total: number, bay: any) => total + (bay.rentableSquareFootage || bay.squareFootage || 0),
                                              0
                                            );
                                          }
                                          
                                          // Calculate vehicular and trailer parking separately
                                          const vehicularParking = (lease.standardParking || 0) + 
                                                                 (lease.accessibleParking || 0) + 
                                                                 (lease.evParking || 0);
                                          const trailerParking = lease.trailerParking || 0;
                                          
                                          return (
                                            <div key={lease.id} className="bg-gray-50 p-2 rounded text-xs">
                                              <div className="font-medium text-gray-900 mb-1">
                                                {lease.tenantName}
                                              </div>
                                              <div className="space-y-1 text-gray-600">
                                                <div className="flex justify-between">
                                                  <span className="text-gray-500">Area:</span>
                                                  <span className="font-medium">
                                                    {totalRentableArea.toLocaleString()} SF
                                                    {lease.rentableAreaOverride && (
                                                      <span className="text-xs text-orange-600 ml-1">(Override)</span>
                                                    )}
                                                  </span>
                                                </div>
                                                <div className="flex justify-between">
                                                  <span className="text-gray-500">Vehicular:</span>
                                                  <span className="font-medium">
                                                    {vehicularParking} spaces
                                                  </span>
                                                </div>
                                                <div className="flex justify-between">
                                                  <span className="text-gray-500">Trailer:</span>
                                                  <span className="font-medium">
                                                    {trailerParking} spaces
                                                  </span>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                    
                                    {/* Remaining Available Space Summary */}
                                    <div className="mt-3 pt-3 border-t border-gray-200">
                                      <div className="text-sm text-gray-600 mb-2">Available Space:</div>
                                      <div className="bg-green-50 p-2 rounded text-xs">
                                        <div className="space-y-1 text-gray-700">
                                          <div className="flex justify-between">
                                            <span className="text-gray-500">Remaining Area:</span>
                                            <span className="font-semibold text-green-700">
                                              {remainingArea.toLocaleString()} SF
                                            </span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-gray-500">Remaining Vehicular:</span>
                                            <span className="font-semibold text-green-700">
                                              {remainingParking} spaces
                                            </span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-gray-500">Remaining Trailer Parking:</span>
                                            <span className="font-semibold text-green-700">
                                              {remainingTrailerParking} spaces
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                      );
                    })}
                  </div>
                    
                    {/* Expand/Collapse Button for Multi-Building Properties */}
                    {isMultiBuilding && (
                      <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 z-40">
                        <div className="flex items-center gap-2">
                          <Select
                            value={selectedBuilding[baseName] || "stacked"}
                            onValueChange={(value) => handleBuildingSelection(baseName, value)}
                          >
                            <SelectTrigger className="bg-white shadow-lg hover:shadow-xl px-4 py-2 text-sm font-medium border border-gray-300 hover:border-blue-400 hover:bg-blue-50 w-52">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="stacked">
                                <div className="flex items-center">
                                  <Layers className="h-4 w-4 mr-2" />
                                  Stack Cards
                                </div>
                              </SelectItem>
                              <SelectItem value="all">
                                <div className="flex items-center">
                                  <Grid className="h-4 w-4 mr-2" />
                                  View All Buildings ({buildings.length})
                                </div>
                              </SelectItem>
                              {buildings.map((building) => (
                                <SelectItem key={building.id} value={building.id.toString()}>
                                  <div className="flex items-center">
                                    <Building className="h-4 w-4 mr-2 text-blue-600" />
                                    Building {building.building}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                    
                    {/* Subtle building count indicator */}
                    {!isExpanded && isMultiBuilding && (
                      <div className="absolute top-3 right-3 z-40">
                        <div className="bg-white shadow-md border border-gray-200 px-2 py-1 rounded text-xs text-gray-600 font-medium">
                          {buildings.length} Buildings
                        </div>
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}