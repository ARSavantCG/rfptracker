import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Building, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { Property, InsertProperty } from "@shared/schema";

interface PropertyFormModalProps {
  property?: Property;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

export function PropertyFormModal({ property, trigger, onSuccess }: PropertyFormModalProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<InsertProperty>>({
    id: property?.id || undefined,
    propertyName: property?.propertyName || "",
    building: property?.building || "",
    isSingleBuilding: property?.isSingleBuilding || false,
    streetAddress: property?.streetAddress || "",
    city: property?.city || "",
    state: property?.state || "",
    zip: property?.zip || "",
    standardParking: property?.standardParking || 0,
    accessibleParking: property?.accessibleParking || 0,
    evParking: property?.evParking || 0,
    trailerParking: property?.trailerParking || 0,
    electricalAllocation: property?.electricalAllocation || 0,
    electricalAllocationIncrement: property?.electricalAllocationIncrement || 200,
  });

  // Calculate parking ratio
  const calculateParkingRatio = () => {
    const totalRegularParking = (formData.standardParking || 0) + (formData.accessibleParking || 0) + (formData.evParking || 0);
    
    // Calculate rentable square footage from bay configurations and mechanical rooms
    const bayConfigurations = property?.bayConfigurations || [];
    const baySquareFootage = bayConfigurations.reduce((total, bay) => {
      return total + (bay.squareFootage || 0);
    }, 0);
    const mechanicalRoomSquareFootage = property?.mechanicalRoomSquareFootage || 0;
    const totalRentableSquareFootage = baySquareFootage + mechanicalRoomSquareFootage;

    if (totalRentableSquareFootage === 0) return "0.00";
    
    const ratio = totalRegularParking / totalRentableSquareFootage;
    return (ratio * 1000).toFixed(2); // Convert to per 1000 sf format
  };

  // Fetch next property ID for new properties
  const { data: nextIdData } = useQuery({
    queryKey: ["/api/properties/next-id"],
    enabled: !property && open, // Only fetch when creating new property and modal is open
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!property;

  const createMutation = useMutation({
    mutationFn: (data: InsertProperty) => apiRequest("/api/properties", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({
        title: "Success",
        description: "Property created successfully",
        duration: 4000,
      });
      setOpen(false);
      resetForm();
      onSuccess?.();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create property",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: InsertProperty) => apiRequest(`/api/properties/${property?.id}`, "PATCH", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({
        title: "Success",
        description: "Property updated successfully",
        duration: 4000,
      });
      setOpen(false);
      onSuccess?.();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update property",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest(`/api/properties/${property?.id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({
        title: "Success",
        description: "Property deleted successfully",
        duration: 4000,
      });
      setOpen(false);
      onSuccess?.();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete property",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const resetForm = () => {
    setFormData({
      id: undefined,
      propertyName: "",
      building: "",
      isSingleBuilding: false,
      streetAddress: "",
      city: "",
      state: "",
      zip: "",
      standardParking: 0,
      accessibleParking: 0,
      evParking: 0,
      trailerParking: 0,
      electricalAllocation: 0,
      electricalAllocationIncrement: 200,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.propertyName || (!formData.isSingleBuilding && !formData.building) || !formData.streetAddress || !formData.city || !formData.state || !formData.zip) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    // Generate display name
    const displayName = `${formData.propertyName}${formData.building ? ` - Building ${formData.building}` : ''}, ${formData.streetAddress}, ${formData.city}, ${formData.state} ${formData.zip}`;

    const propertyData: InsertProperty = {
      id: formData.id,
      propertyName: formData.propertyName!,
      building: formData.building || "",
      isSingleBuilding: formData.isSingleBuilding || false,
      streetAddress: formData.streetAddress!,
      city: formData.city!,
      state: formData.state!,
      zip: formData.zip!,
      standardParking: formData.standardParking || 0,
      accessibleParking: formData.accessibleParking || 0,
      evParking: formData.evParking || 0,
      trailerParking: formData.trailerParking || 0,
      electricalAllocation: formData.electricalAllocation || 0,
      electricalAllocationIncrement: formData.electricalAllocationIncrement || 200,
    };

    if (isEdit) {
      updateMutation.mutate(propertyData);
    } else {
      createMutation.mutate(propertyData);
    }
  };

  const handleInputChange = (field: keyof InsertProperty, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleDelete = () => {
    if (property?.id) {
      deleteMutation.mutate();
    }
  };

  const defaultTrigger = isEdit ? (
    <Button variant="outline" size="sm">
      <Edit className="h-4 w-4 mr-1" />
      Edit
    </Button>
  ) : (
    <Button className="bg-blue-600 hover:bg-blue-700">
      <Plus className="h-4 w-4 mr-2" />
      Add Property
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Building className="h-5 w-5 text-blue-600" />
            <span>{isEdit ? "Edit Property" : "Add New Property"}</span>
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="propertyId">Property ID</Label>
              <Input
                id="propertyId"
                type="number"
                value={formData.id || (!isEdit && nextIdData?.nextId ? nextIdData.nextId : "")}
                onChange={(e) => setFormData(prev => ({ ...prev, id: parseInt(e.target.value) || undefined }))}
                placeholder={!isEdit ? "Auto-assigned" : "Enter ID"}
                readOnly={!isEdit && !!nextIdData?.nextId}
              />
              <p className="text-xs text-gray-500">
                {isEdit 
                  ? `Current ID: ${property?.id}. Change only if needed for organization.`
                  : `Next available ID: ${nextIdData?.nextId || 'Loading...'}`
                }
              </p>
            </div>
            
            <div className="col-span-2 space-y-2">
              <Label htmlFor="propertyName">Property Name *</Label>
              <Input
                id="propertyName"
                value={formData.propertyName}
                onChange={(e) => handleInputChange("propertyName", e.target.value)}
                placeholder="Bridge Point Gratigny"
                required
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            
            <div className="space-y-2">
              <div className="flex items-center space-x-2 mb-2">
                <Checkbox
                  id="singleBuilding"
                  checked={formData.isSingleBuilding}
                  onCheckedChange={(checked) => {
                    setFormData(prev => ({ 
                      ...prev, 
                      isSingleBuilding: checked as boolean,
                      building: checked ? "" : prev.building
                    }));
                  }}
                />
                <Label htmlFor="singleBuilding" className="text-sm">Single building property</Label>
              </div>
              <Label htmlFor="building">{formData.isSingleBuilding ? "Building" : "Building *"}</Label>
              <Input
                id="building"
                value={formData.building}
                onChange={(e) => handleInputChange("building", e.target.value)}
                placeholder={formData.isSingleBuilding ? "Building number (optional)" : "e.g. A, B, 1, 2"}
                required={!formData.isSingleBuilding}
                disabled={formData.isSingleBuilding}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="streetAddress">Street Address *</Label>
              <Input
                id="streetAddress"
                value={formData.streetAddress}
                onChange={(e) => handleInputChange("streetAddress", e.target.value)}
                placeholder="4700 NW 135th Ave"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City *</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => handleInputChange("city", e.target.value)}
                placeholder="Miami"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="state">State *</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => handleInputChange("state", e.target.value)}
                placeholder="FL"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="zip">ZIP Code *</Label>
              <Input
                id="zip"
                value={formData.zip}
                onChange={(e) => handleInputChange("zip", e.target.value)}
                placeholder="33313"
                required
              />
            </div>
          </div>

          {/* Parking Information */}
          <div className="space-y-4">
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-900 mb-3">Parking Information</h4>
              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="standardParking">Standard Parking</Label>
                  <Input
                    id="standardParking"
                    type="number"
                    min="0"
                    value={formData.standardParking || 0}
                    onChange={(e) => setFormData(prev => ({ ...prev, standardParking: parseInt(e.target.value) || 0 }))}
                    placeholder="0"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="accessibleParking">Accessible Parking</Label>
                  <Input
                    id="accessibleParking"
                    type="number"
                    min="0"
                    value={formData.accessibleParking || 0}
                    onChange={(e) => setFormData(prev => ({ ...prev, accessibleParking: parseInt(e.target.value) || 0 }))}
                    placeholder="0"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="evParking">EV Parking</Label>
                  <Input
                    id="evParking"
                    type="number"
                    min="0"
                    value={formData.evParking || 0}
                    onChange={(e) => setFormData(prev => ({ ...prev, evParking: parseInt(e.target.value) || 0 }))}
                    placeholder="0"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="trailerParking">Trailer Parking</Label>
                  <Input
                    id="trailerParking"
                    type="number"
                    min="0"
                    value={formData.trailerParking || 0}
                    onChange={(e) => setFormData(prev => ({ ...prev, trailerParking: parseInt(e.target.value) || 0 }))}
                    placeholder="0"
                  />
                </div>
              </div>
              
              
              {/* Parking Ratio Display */}
              <div className="mt-3 pt-3 border-t border-gray-200">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-gray-700">Parking Ratio:</span>
                  <span className="text-gray-900 font-mono">
                    {calculateParkingRatio()} spaces per 1,000 SF
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Based on {((formData.standardParking || 0) + (formData.accessibleParking || 0) + (formData.evParking || 0))} parking spaces 
                  (excludes trailer parking)
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-3 rounded-lg">
            <Label className="text-sm font-medium text-gray-700">Preview Display Name</Label>
            <p className="text-sm text-gray-600 mt-1">
              {formData.propertyName && formData.streetAddress && formData.city && formData.state && formData.zip
                ? `${formData.propertyName}${formData.building ? ` - Building ${formData.building}` : ''}, ${formData.streetAddress}, ${formData.city}, ${formData.state} ${formData.zip}`
                : "Complete required fields to see display name preview"
              }
            </p>
          </div>

          <div className="flex justify-between pt-4">
            <div>
              {isEdit && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" size="sm">
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete Property
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Property</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete "{property?.propertyName}"? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction 
                        className="bg-red-600 hover:bg-red-700"
                        onClick={handleDelete}
                        disabled={deleteMutation.isPending}
                      >
                        {deleteMutation.isPending ? "Deleting..." : "Delete"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
            
            <div className="flex space-x-2">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={createMutation.isPending || updateMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {createMutation.isPending || updateMutation.isPending
                  ? (isEdit ? "Updating..." : "Creating...")
                  : (isEdit ? "Update Property" : "Create Property")
                }
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}