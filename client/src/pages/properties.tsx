import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building, MapPin, Plus, Search, Edit, Grid, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import Navigation from "@/components/navigation";
import { PropertyFormModal } from "@/components/property-form-modal";
import BayConfigurationManager from "@/components/bay-configuration-manager";
import type { Property, BayConfiguration } from "@shared/schema";

export default function Properties() {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedProperty, setExpandedProperty] = useState<string | null>(null);

  const { data: properties, isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
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

  // Sort buildings within each group
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

  const getBayConfigurationCount = (property: Property): number => {
    return property.bayConfigurations?.length || 0;
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
              
              return (
                <div key={baseName} className="relative">
                  {/* Stacked Cards Container */}
                  <div className="relative" style={{ minHeight: isMultiBuilding ? '320px' : 'auto' }}>
                    {buildings.map((property, index) => {
                      const isVisible = isExpanded || index < 3;
                      const stackOffset = isExpanded ? index * 16 : Math.min(index, 2) * 6;
                      const zIndex = isExpanded ? buildings.length - index : (index === 0 ? 20 : 20 - index);
                      
                      return (
                        <Card 
                          key={property.id} 
                          className={`
                            transition-all duration-300 ease-in-out
                            ${index > 0 && !isExpanded ? 'absolute' : 'relative'}
                            ${isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}
                            ${isMultiBuilding && index === 0 ? 'cursor-pointer' : ''}
                            hover:shadow-lg
                            ${isMultiBuilding && !isExpanded ? 'hover:scale-105' : ''}
                            ${isExpanded && index > 0 ? 'mt-4' : ''}
                          `}
                          style={{
                            zIndex,
                            ...(index > 0 && !isExpanded ? {
                              top: `${stackOffset}px`,
                              left: `${stackOffset}px`,
                              right: `${stackOffset}px`,
                              transform: `translateY(-${stackOffset * 2}px)`,
                              boxShadow: `0 ${index * 2}px ${index * 4}px rgba(0,0,0,0.1)`
                            } : {})
                          }}
                          onClick={() => isMultiBuilding && index === 0 && !isExpanded ? togglePropertyExpansion(baseName) : undefined}
                        >
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="p-2 bg-blue-100 rounded-lg">
                              <Building className="h-6 w-6 text-blue-600" />
                            </div>
                            <div>
                              <CardTitle className="text-lg">
                                {property.propertyName || 'Unnamed Property'}
                              </CardTitle>
                              {property.building && (
                                <p className="text-sm text-gray-600 mt-1">
                                  Building {property.building}
                                </p>
                              )}
                              {buildings.length > 1 && index === 0 && (
                                <div className="flex items-center gap-2 mt-1">
                                  <p className="text-xs text-blue-600 font-medium">
                                    {buildings.length} Buildings
                                  </p>
                                  {!isExpanded && (
                                    <ChevronDown className="h-3 w-3 text-blue-600" />
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          <PropertyFormModal 
                            property={property}
                            trigger={
                              <Button variant="outline" size="sm">
                                <Edit className="h-4 w-4" />
                              </Button>
                            }
                          />
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
                              <p>Added: {new Date(property.createdAt).toLocaleDateString()}</p>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex space-x-2 mt-4">
                          <BayConfigurationManager property={property} />
                        </div>
                        
                        {/* Bay Configuration Summary */}
                        <div className="mt-4 pt-4 border-t">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-600">Bay Configurations:</span>
                            <span className="font-medium">
                              {getBayConfigurationCount(property)} configured
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                      );
                    })}
                  </div>
                    
                    {/* Expand/Collapse Button for Multi-Building Properties */}
                    {isMultiBuilding && (
                      <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 z-30">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => togglePropertyExpansion(baseName)}
                          className="bg-white shadow-md hover:shadow-lg px-3 py-1 text-xs"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp className="h-3 w-3 mr-1" />
                              Stack
                            </>
                          ) : (
                            <>
                              <ChevronDown className="h-3 w-3 mr-1" />
                              Expand ({buildings.length})
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                    
                    {/* Show remaining buildings count if more than 3 and not expanded */}
                    {buildings.length > 3 && !isExpanded && (
                      <div className="absolute top-2 right-2 bg-blue-600 text-white text-xs px-2 py-1 rounded-full z-30 shadow-md">
                        +{buildings.length - 3}
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