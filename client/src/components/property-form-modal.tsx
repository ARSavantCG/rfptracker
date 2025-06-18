import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Building, Trash2, Grid } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { nanoid } from "nanoid";
import type { Property, InsertProperty, PropertyBay } from "@shared/schema";

interface PropertyFormModalProps {
  property?: Property;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

export function PropertyFormModal({ property, trigger, onSuccess }: PropertyFormModalProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<InsertProperty>>({
    propertyName: property?.propertyName || "",
    building: property?.building || "",
    streetAddress: property?.streetAddress || "",
    city: property?.city || "",
    state: property?.state || "",
    zip: property?.zip || "",
    bays: property?.bays || [],
    gridLayout: property?.gridLayout || { rows: 1, columns: 1 },
  });

  const [bays, setBays] = useState<PropertyBay[]>(property?.bays || []);
  const [gridRows, setGridRows] = useState(property?.gridLayout?.rows || 1);
  const [gridColumns, setGridColumns] = useState(property?.gridLayout?.columns || 1);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!property;

  const createMutation = useMutation({
    mutationFn: (data: InsertProperty) => apiRequest("/api/properties", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({
        title: "Property created",
        description: "Property has been successfully created.",
      });
      setOpen(false);
      onSuccess?.();
      resetForm();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create property. Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<InsertProperty>) => apiRequest(`/api/properties/${property?.id}`, "PATCH", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({
        title: "Property updated",
        description: "Property has been successfully updated.",
      });
      setOpen(false);
      onSuccess?.();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update property. Please try again.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      propertyName: "",
      building: "",
      streetAddress: "",
      city: "",
      state: "",
      zip: "",
      bays: [],
      gridLayout: { rows: 1, columns: 1 },
    });
    setBays([]);
    setGridRows(1);
    setGridColumns(1);
  };

  const addBay = () => {
    const newBay: PropertyBay = {
      id: nanoid(),
      bayNumber: `Bay ${bays.length + 1}`,
      squareFootage: 0,
      type: 'warehouse',
    };
    setBays([...bays, newBay]);
  };

  const updateBay = (bayId: string, updates: Partial<PropertyBay>) => {
    setBays(bays.map(bay => bay.id === bayId ? { ...bay, ...updates } : bay));
  };

  const removeBay = (bayId: string) => {
    setBays(bays.filter(bay => bay.id !== bayId));
  };

  const updateGridDimensions = (rows: number, columns: number) => {
    setGridRows(rows);
    setGridColumns(columns);
    setFormData(prev => ({
      ...prev,
      gridLayout: { rows, columns }
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.propertyName || !formData.building || !formData.streetAddress || !formData.city || !formData.state || !formData.zip) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    const submitData = {
      ...formData,
      bays,
      gridLayout: { rows: gridRows, columns: gridColumns },
    };

    if (isEdit) {
      updateMutation.mutate(submitData);
    } else {
      createMutation.mutate(submitData as InsertProperty);
    }
  };

  const handleInputChange = (field: keyof InsertProperty, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Building className="h-5 w-5 text-blue-600" />
            <span>{isEdit ? "Edit Property" : "Add New Property"}</span>
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="propertyName">Property Name *</Label>
              <Input
                id="propertyName"
                value={formData.propertyName}
                onChange={(e) => handleInputChange("propertyName", e.target.value)}
                placeholder="e.g. MG Westside"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="building">Building *</Label>
              <Input
                id="building"
                value={formData.building}
                onChange={(e) => handleInputChange("building", e.target.value)}
                placeholder="e.g. A, B, 1, 2"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="streetAddress">Street Address *</Label>
            <Input
              id="streetAddress"
              value={formData.streetAddress}
              onChange={(e) => handleInputChange("streetAddress", e.target.value)}
              placeholder="123 Main Street"
              required
            />
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
                maxLength={2}
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

          <div className="bg-gray-50 p-3 rounded-lg">
            <Label className="text-sm font-medium text-gray-700">Preview Display Name</Label>
            <p className="text-sm text-gray-600 mt-1">
              {formData.propertyName && formData.building && formData.streetAddress && formData.city && formData.state && formData.zip
                ? `${formData.propertyName} - Building ${formData.building}, ${formData.streetAddress}, ${formData.city}, ${formData.state} ${formData.zip}`
                : "Complete all fields to see display name preview"
              }
            </p>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
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
                ? "Saving..."
                : isEdit
                ? "Update Property"
                : "Create Property"
              }
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}