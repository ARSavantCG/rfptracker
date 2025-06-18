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
  const [expandedProperty, setExpandedProperty] = useState<number | null>(null);

  const { data: properties, isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const filteredProperties = properties?.filter(property =>
    property.propertyName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    property.building?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    property.streetAddress?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    property.city?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const formatAddress = (property: Property) => {
    const parts = [
      property.streetAddress,
      property.city,
      property.state,
      property.zip
    ].filter(Boolean);
    return parts.join(', ');
  };

  const togglePropertyExpansion = (propertyId: number) => {
    setExpandedProperty(expandedProperty === propertyId ? null : propertyId);
  };

  // Generate sample bay data based on property
  const generateSampleBays = (property: Property): PropertyBay[] => {
    const bays = property.bays || [];
    const gridLayout = property.gridLayout || { rows: 2, columns: 10 };
    
    // If no bays defined, create sample bays based on the attached image pattern
    if (bays.length === 0) {
      const sampleBays: PropertyBay[] = [];
      for (let row = 0; row < gridLayout.rows; row++) {
        for (let col = 0; col < gridLayout.columns; col++) {
          // Skip some bays to create realistic layout
          if (Math.random() > 0.15) { // 85% chance of having a bay
            const width = 50 + Math.floor(Math.random() * 30); // 50-80 width
            const length = 80 + Math.floor(Math.random() * 40); // 80-120 length
            sampleBays.push({
              id: `${property.id}-${row}-${col}`,
              bayNumber: `${width}.${length < 100 ? '0' : ''}${length}`,
              squareFootage: width * length,
              type: 'warehouse' as const,
              notes: `Row ${row + 1}, Col ${col + 1}`,
              areaLabel: col < 5 ? 'Loading Dock' : col < 15 ? 'Warehouse' : 'Office Area',
              columnLabel: String.fromCharCode(65 + col) // A, B, C, etc.
            });
          }
        }
      }
      return sampleBays;
    }
    return bays;
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProperties.map((property) => (
              <Card key={property.id} className="hover:shadow-md transition-shadow">
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
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => togglePropertyExpansion(property.id)}
                    >
                      <Grid className="h-4 w-4 mr-2" />
                      Bay Grid
                      {expandedProperty === property.id ? 
                        <ChevronUp className="h-4 w-4 ml-2" /> : 
                        <ChevronDown className="h-4 w-4 ml-2" />
                      }
                    </Button>
                  </div>
                </CardContent>
                
                {/* Expandable Bay Grid Section */}
                {expandedProperty === property.id && (
                  <div className="border-t">
                    <PropertyBayGrid
                      propertyId={property.id}
                      propertyName={property.propertyName || 'Unnamed Property'}
                      bays={generateSampleBays(property)}
                      gridLayout={property.gridLayout || { rows: 2, columns: 10 }}
                    />
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}