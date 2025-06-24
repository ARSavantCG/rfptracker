import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Building, Trash2, Grid } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { nanoid } from "nanoid";
import type { Property, InsertProperty, PropertyBay, ColumnRange } from "@shared/schema";

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
  const [columnRanges, setColumnRanges] = useState<ColumnRange[]>(property?.columnRanges || []);
  const [isSingleBuilding, setIsSingleBuilding] = useState(false);

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

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest(`/api/properties/${property?.id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({
        title: "Property deleted",
        description: "Property has been successfully deleted.",
      });
      setOpen(false);
      onSuccess?.();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete property. Please try again.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      id: undefined,
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
    setColumnRanges([]);
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

  const addColumnRange = () => {
    const newRange: ColumnRange = {
      id: nanoid(),
      startColumn: columnRanges.length + 1,
      endColumn: columnRanges.length + 2,
      squareFootage: 0,
      description: `Between columns ${columnRanges.length + 1}-${columnRanges.length + 2}`
    };
    setColumnRanges([...columnRanges, newRange]);
  };

  const updateColumnRange = (rangeId: string, updates: Partial<ColumnRange>) => {
    setColumnRanges(columnRanges.map(range => range.id === rangeId ? { ...range, ...updates } : range));
  };

  const removeColumnRange = (rangeId: string) => {
    setColumnRanges(columnRanges.filter(range => range.id !== rangeId));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.propertyName || (!isSingleBuilding && !formData.building) || !formData.streetAddress || !formData.city || !formData.state || !formData.zip) {
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
      columnRanges,
    };

    if (isEdit) {
      updateMutation.mutate(submitData);
    } else {
      const { id, ...createData } = submitData;
      createMutation.mutate(createData as InsertProperty);
    }
  };

  const handleInputChange = (field: keyof InsertProperty, value: string) => {
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
            {isEdit && (
              <div className="space-y-2">
                <Label htmlFor="propertyId">Property ID</Label>
                <Input
                  id="propertyId"
                  type="number"
                  value={formData.id || ""}
                  onChange={(e) => setFormData(prev => ({ ...prev, id: parseInt(e.target.value) || undefined }))}
                  placeholder="e.g. 1"
                />
                <p className="text-xs text-gray-500">
                  Current ID: {property?.id}. Change only if needed for organization.
                </p>
              </div>
            )}
            <div className={`space-y-2 ${isEdit ? 'col-span-2' : 'col-span-3'}`}>
              <Label htmlFor="propertyName">Property Name *</Label>
              <Input
                id="propertyName"
                value={formData.propertyName}
                onChange={(e) => handleInputChange("propertyName", e.target.value)}
                placeholder="e.g. MG Westside"
                required
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            
            <div className="space-y-2">
              <div className="flex items-center space-x-2 mb-2">
                <Checkbox
                  id="singleBuilding"
                  checked={isSingleBuilding}
                  onCheckedChange={(checked) => {
                    setIsSingleBuilding(checked as boolean);
                    if (checked) {
                      handleInputChange("building", "");
                    } else {
                      handleInputChange("building", "");
                    }
                  }}
                />
                <Label htmlFor="singleBuilding" className="text-sm">Single building property</Label>
              </div>
              <Label htmlFor="building">{isSingleBuilding ? "Building" : "Building *"}</Label>
              <Input
                id="building"
                value={formData.building}
                onChange={(e) => handleInputChange("building", e.target.value)}
                placeholder={isSingleBuilding ? "Building number (optional)" : "e.g. A, B, 1, 2"}
                required={!isSingleBuilding}
                disabled={isSingleBuilding}
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
              {formData.propertyName && formData.streetAddress && formData.city && formData.state && formData.zip
                ? `${formData.propertyName}${formData.building ? ` - Building ${formData.building}` : ''}, ${formData.streetAddress}, ${formData.city}, ${formData.state} ${formData.zip}`
                : "Complete required fields to see display name preview"
              }
            </p>
          </div>

          {/* Bay Management Section */}
          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">Bay Configuration</Label>
              <Button type="button" variant="outline" size="sm" onClick={addBay}>
                <Plus className="h-4 w-4 mr-1" />
                Add Bay
              </Button>
            </div>
            
            {/* Grid Layout Controls */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gridRows">Grid Rows</Label>
                <Input
                  id="gridRows"
                  type="number"
                  min="1"
                  max="50"
                  value={gridRows}
                  onChange={(e) => updateGridDimensions(parseInt(e.target.value) || 1, gridColumns)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gridColumns">Grid Columns</Label>
                <Input
                  id="gridColumns"
                  type="number"
                  min="1"
                  max="50"
                  value={gridColumns}
                  onChange={(e) => updateGridDimensions(gridRows, parseInt(e.target.value) || 1)}
                />
                <p className="text-xs text-gray-500">
                  Enter up to 50 columns (e.g., 23 for your project)
                </p>
              </div>
            </div>

            {/* Bay List */}
            {bays.length > 0 && (
              <div className="space-y-3 max-h-40 overflow-y-auto">
                <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-600 px-3">
                  <div className="col-span-2">Bay Name</div>
                  <div className="col-span-1">Sq Ft</div>
                  <div className="col-span-2">Type</div>
                  <div className="col-span-2">Area Label</div>
                  <div className="col-span-1">Column</div>
                  <div className="col-span-3">Notes</div>
                  <div className="col-span-1"></div>
                </div>
                {bays.map((bay) => (
                  <div key={bay.id} className="grid grid-cols-12 gap-2 items-center p-3 border rounded-lg">
                    <div className="col-span-2">
                      <Input
                        value={bay.bayNumber}
                        onChange={(e) => updateBay(bay.id, { bayNumber: e.target.value })}
                        placeholder="Bay Name"
                        className="h-8"
                      />
                    </div>
                    <div className="col-span-1">
                      <Input
                        type="number"
                        value={bay.squareFootage}
                        onChange={(e) => updateBay(bay.id, { squareFootage: parseInt(e.target.value) || 0 })}
                        placeholder="Sq Ft"
                        className="h-8"
                      />
                    </div>
                    <div className="col-span-2">
                      <Select
                        value={bay.type}
                        onValueChange={(value: 'office' | 'warehouse' | 'retail' | 'mixed') => 
                          updateBay(bay.id, { type: value })
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="office">Office</SelectItem>
                          <SelectItem value="warehouse">Warehouse</SelectItem>
                          <SelectItem value="retail">Retail</SelectItem>
                          <SelectItem value="mixed">Mixed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Input
                        value={bay.areaLabel || ''}
                        onChange={(e) => updateBay(bay.id, { areaLabel: e.target.value })}
                        placeholder="Area (e.g., Loading Dock)"
                        className="h-8"
                      />
                    </div>
                    <div className="col-span-1">
                      <Input
                        value={bay.columnLabel || ''}
                        onChange={(e) => updateBay(bay.id, { columnLabel: e.target.value })}
                        placeholder="Col (A, 1)"
                        className="h-8"
                      />
                    </div>
                    <div className="col-span-3">
                      <Input
                        value={bay.notes || ''}
                        onChange={(e) => updateBay(bay.id, { notes: e.target.value })}
                        placeholder="Notes"
                        className="h-8"
                      />
                    </div>
                    <div className="col-span-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeBay(bay.id)}
                        className="h-8 w-8 p-0"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Column Range Management Section */}
          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base font-medium">Column Ranges for Rentable Area</Label>
                <p className="text-sm text-gray-600 mt-1">
                  Define column ranges and their square footages for automatic rentable area calculation
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addColumnRange}>
                <Plus className="h-4 w-4 mr-1" />
                Add Range
              </Button>
            </div>

            {/* Column Range List */}
            {columnRanges.length > 0 && (
              <div className="space-y-3 max-h-40 overflow-y-auto">
                <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-600 px-3">
                  <div className="col-span-2">Start Column</div>
                  <div className="col-span-2">End Column</div>
                  <div className="col-span-2">Square Footage</div>
                  <div className="col-span-5">Description</div>
                  <div className="col-span-1"></div>
                </div>
                {columnRanges.map((range) => (
                  <div key={range.id} className="grid grid-cols-12 gap-2 items-center p-3 border rounded-lg">
                    <div className="col-span-2">
                      <Input
                        type="number"
                        value={range.startColumn}
                        onChange={(e) => updateColumnRange(range.id, { startColumn: parseInt(e.target.value) || 1 })}
                        placeholder="Start"
                        className="h-8"
                        min="1"
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number"
                        value={range.endColumn}
                        onChange={(e) => updateColumnRange(range.id, { endColumn: parseInt(e.target.value) || 2 })}
                        placeholder="End"
                        className="h-8"
                        min="1"
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number"
                        value={range.squareFootage}
                        onChange={(e) => updateColumnRange(range.id, { squareFootage: parseInt(e.target.value) || 0 })}
                        placeholder="Square Feet"
                        className="h-8"
                      />
                    </div>
                    <div className="col-span-5">
                      <Input
                        value={range.description || ''}
                        onChange={(e) => updateColumnRange(range.id, { description: e.target.value })}
                        placeholder="e.g., Between columns 1-2"
                        className="h-8"
                      />
                    </div>
                    <div className="col-span-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeColumnRange(range.id)}
                        className="h-8 w-8 p-0"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {columnRanges.length === 0 && (
              <div className="text-center py-6 text-gray-500 border-2 border-dashed border-gray-300 rounded-lg">
                <p className="font-medium">No column ranges defined</p>
                <p className="text-sm">Add column ranges to enable automatic rentable area calculation for RFPs</p>
              </div>
            )}
          </div>

          <div className="flex justify-between pt-4">
            {/* Delete button for edit mode */}
            {isEdit && property && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {deleteMutation.isPending ? "Deleting..." : "Delete Property"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Property</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete "{property.propertyName}
                      {property.building ? ` - Building ${property.building}` : ''}"? 
                      This action cannot be undone and will remove all associated bay configurations.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Delete Property
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            
            <div className="flex space-x-2 ml-auto">
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
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}