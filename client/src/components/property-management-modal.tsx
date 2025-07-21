import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Edit, Trash2, Plus, Building2 } from "lucide-react";
import { insertPropertySchema, updatePropertySchema, type Property } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

type CreatePropertyFormData = z.infer<typeof insertPropertySchema>;
type EditPropertyFormData = z.infer<typeof updatePropertySchema>;

type BuildingData = {
  building: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
};

type MultiPropertyFormData = {
  propertyName: string;
  buildings: BuildingData[];
};

interface PropertyManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PropertyManagementModal({ isOpen, onClose }: PropertyManagementModalProps) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [buildings, setBuildings] = useState<BuildingData[]>([
    { building: "", streetAddress: "", city: "", state: "", zip: "" }
  ]);
  const [propertyName, setPropertyName] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Check if user has properties delete permissions
  const canDeleteProperties = user?.permissions?.includes('properties.delete') || false;

  const { data: properties = [], isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const createForm = useForm<CreatePropertyFormData>({
    resolver: zodResolver(insertPropertySchema),
    defaultValues: {
      propertyName: "",
      building: "",
      streetAddress: "",
      city: "",
      state: "",
      zip: "",
    },
  });

  const editForm = useForm<EditPropertyFormData>({
    resolver: zodResolver(updatePropertySchema),
    defaultValues: {
      id: 0,
      propertyName: "",
      building: "",
      streetAddress: "",
      city: "",
      state: "",
      zip: "",
    },
  });

  const createMutation = useMutation<Property, Error, CreatePropertyFormData>({
    mutationFn: async (data: CreatePropertyFormData) => {
      const response = await apiRequest("/api/properties", "POST", data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      setIsAddModalOpen(false);
      createForm.reset();
      toast({
        title: "Success",
        description: "Property added successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add property",
        variant: "destructive",
      });
    },
  });

  const createMultiMutation = useMutation({
    mutationFn: async (data: MultiPropertyFormData) => {
      const promises = data.buildings.map(building => {
        const propertyData = {
          propertyName: data.propertyName,
          building: building.building,
          streetAddress: building.streetAddress,
          city: building.city,
          state: building.state,
          zip: building.zip,
        };
        return apiRequest("/api/properties", "POST", propertyData).then(res => res.json());
      });
      return Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      setIsAddModalOpen(false);
      resetMultiForm();
      toast({
        title: "Success",
        description: "Property with buildings added successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add property",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation<Property, Error, EditPropertyFormData>({
    mutationFn: async (data: EditPropertyFormData) => {
      if (!editingProperty) throw new Error("No property selected");
      const response = await apiRequest(`/api/properties/${editingProperty.id}`, "PATCH", data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      setEditingProperty(null);
      editForm.reset();
      toast({
        title: "Success",
        description: "Property updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update property",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest(`/api/properties/${id}`, "DELETE");
      return response.ok;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({
        title: "Success",
        description: "Property deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete property",
        variant: "destructive",
      });
    },
  });

  const onCreateSubmit = (data: CreatePropertyFormData) => {
    createMutation.mutate(data);
  };

  const onEditSubmit = (data: EditPropertyFormData) => {
    updateMutation.mutate(data);
  };

  const resetMultiForm = () => {
    setPropertyName("");
    setBuildings([{ building: "", streetAddress: "", city: "", state: "", zip: "" }]);
  };

  const addBuilding = () => {
    setBuildings([...buildings, { building: "", streetAddress: "", city: "", state: "", zip: "" }]);
  };

  const removeBuilding = (index: number) => {
    if (buildings.length > 1) {
      setBuildings(buildings.filter((_, i) => i !== index));
    }
  };

  const updateBuilding = (index: number, field: keyof BuildingData, value: string) => {
    const updatedBuildings = buildings.map((building, i) => 
      i === index ? { ...building, [field]: value } : building
    );
    setBuildings(updatedBuildings);
  };

  const handleMultiSubmit = () => {
    if (!propertyName.trim()) {
      toast({
        title: "Error",
        description: "Property name is required",
        variant: "destructive",
      });
      return;
    }

    const validBuildings = buildings.filter(building => 
      building.building.trim() && 
      building.streetAddress.trim() && 
      building.city.trim() && 
      building.state.trim() && 
      building.zip.trim()
    );

    if (validBuildings.length === 0) {
      toast({
        title: "Error", 
        description: "At least one complete building is required",
        variant: "destructive",
      });
      return;
    }

    createMultiMutation.mutate({
      propertyName: propertyName.trim(),
      buildings: validBuildings
    });
  };

  const handleEditProperty = (property: Property) => {
    setEditingProperty(property);
    editForm.reset({
      id: property.id,
      propertyName: property.propertyName,
      building: property.building,
      streetAddress: property.streetAddress,
      city: property.city,
      state: property.state,
      zip: property.zip,
    });
  };

  const handleDeleteProperty = (property: Property) => {
    if (confirm(`Are you sure you want to delete "${property.displayName}"?`)) {
      deleteMutation.mutate(property.id);
    }
  };

  const handleAddNew = () => {
    setIsAddModalOpen(true);
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Property Management
            </DialogTitle>
            <DialogDescription>
              Manage your property locations. Add, edit, or remove properties from your database.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">Properties</h3>
              <Button onClick={handleAddNew} className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Property
              </Button>
            </div>

            {isLoading ? (
              <div className="text-center py-8">Loading properties...</div>
            ) : properties.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No properties found. Add your first property to get started.
              </div>
            ) : (
              <div className="space-y-2">
                {properties.map((property) => (
                  <div key={property.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="font-bold text-gray-900">{property.propertyName} - Building {property.building}</h3>
                        <div className="text-sm text-gray-500 mt-1">
                          <div>{property.streetAddress}</div>
                          <div>{property.city}, {property.state} {property.zip}</div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditProperty(property)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        {canDeleteProperties && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteProperty(property)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Property Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Add New Property</DialogTitle>
            <DialogDescription>
              Enter the property name and add buildings. Each building can have its own address.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto space-y-6">
            {/* Property Name */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                Property Name *
              </label>
              <Input
                value={propertyName}
                onChange={(e) => setPropertyName(e.target.value)}
                placeholder="e.g., Corporate Plaza, Metro Center"
                className="w-full"
              />
            </div>

            {/* Buildings */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium text-gray-900">Buildings</h4>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addBuilding}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Another Building
                </Button>
              </div>

              <div className="space-y-6">
                {buildings.map((building, index) => (
                  <div key={index} className="border rounded-lg p-4 space-y-4 bg-gray-50">
                    <div className="flex items-center justify-between">
                      <h5 className="text-sm font-medium text-gray-900">
                        Building {index + 1}
                      </h5>
                      {buildings.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeBuilding(index)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Building Name *
                        </label>
                        <Input
                          value={building.building}
                          onChange={(e) => updateBuilding(index, 'building', e.target.value)}
                          placeholder="e.g., A, B, 1, 2"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Street Address *
                        </label>
                        <Input
                          value={building.streetAddress}
                          onChange={(e) => updateBuilding(index, 'streetAddress', e.target.value)}
                          placeholder="123 Main Street"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            City *
                          </label>
                          <Input
                            value={building.city}
                            onChange={(e) => updateBuilding(index, 'city', e.target.value)}
                            placeholder="New York"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            State *
                          </label>
                          <Input
                            value={building.state}
                            onChange={(e) => updateBuilding(index, 'state', e.target.value)}
                            placeholder="NY"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            ZIP Code *
                          </label>
                          <Input
                            value={building.zip}
                            onChange={(e) => updateBuilding(index, 'zip', e.target.value)}
                            placeholder="10001"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex-shrink-0 flex justify-end space-x-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsAddModalOpen(false);
                resetMultiForm();
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleMultiSubmit}
              disabled={createMultiMutation.isPending}
            >
              {createMultiMutation.isPending ? "Adding..." : "Add Property"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Property Modal */}
      <Dialog open={!!editingProperty} onOpenChange={() => setEditingProperty(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Property</DialogTitle>
            <DialogDescription>
              Update the property details below. The display name will be automatically regenerated.
            </DialogDescription>
          </DialogHeader>
          
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField
                control={editForm.control}
                name="propertyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Property Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Corporate Plaza, Metro Center" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="building"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Building</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., A, B, 1, 2" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="streetAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Street Address</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="123 Main Street" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={editForm.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="New York" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={editForm.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="NY" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={editForm.control}
                  name="zip"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ZIP Code</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="10001" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end space-x-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingProperty(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? "Updating..." : "Update Property"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}