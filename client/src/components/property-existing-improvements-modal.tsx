import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Trash2, Plus, Edit3, Save, X, Grid } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { 
  EXISTING_IMPROVEMENT_CATEGORIES, 
  ALLOCATION_TYPES,
  type PropertyExistingImprovement,
  type Property,
  type BayConfiguration
} from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";

const formSchema = z.object({
  category: z.string().min(1, "Category is required"),
  description: z.string().min(1, "Description is required"),
  totalCost: z.number().min(0, "Cost must be positive"),
  allocationType: z.enum(["prorated", "bay-specific", "whole-property"]),
  allocationValue: z.number().optional(),
  units: z.string().optional(),
  applicableBays: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface PropertyExistingImprovementsModalProps {
  property: Property;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PropertyExistingImprovementsModal({ 
  property 
}: { property: Property }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      category: "",
      description: "",
      totalCost: 0,
      allocationType: "prorated",
      applicableBays: [],
      notes: "",
    },
  });

  const { data: improvements = [], isLoading } = useQuery({
    queryKey: [`/api/properties/${property.id}/existing-improvements`],
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return await apiRequest(`/api/properties/${property.id}/existing-improvements`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/existing-improvements`] });
      setShowForm(false);
      form.reset();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<FormData> }) => {
      return await apiRequest(`/api/properties/${property.id}/existing-improvements/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/existing-improvements`] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest(`/api/properties/${property.id}/existing-improvements/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/existing-improvements`] });
    },
  });

  const onSubmit = (data: FormData) => {
    console.log('Form submitted with data:', data);
    console.log('Form errors:', form.formState.errors);
    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const startEdit = (improvement: PropertyExistingImprovement) => {
    setEditingId(improvement.id);
    form.reset({
      category: improvement.category,
      description: improvement.description,
      totalCost: improvement.totalCost / 100, // Convert from cents to dollars
      allocationType: improvement.allocationType as "prorated" | "bay-specific" | "whole-property",
      applicableBays: improvement.applicableBays || [],
      notes: improvement.notes || "",
      vendor: improvement.vendor || "",
      installationDate: improvement.installationDate ? 
        new Date(improvement.installationDate).toISOString().split('T')[0] : "",
    });
    setShowForm(true);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setShowForm(false);
    form.reset();
  };

  const allocationType = form.watch("allocationType");

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const calculateTotalValue = () => {
    return improvements.reduce((sum, improvement) => sum + improvement.totalCost, 0);
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="flex items-center gap-2">
        <Grid className="h-4 w-4" />
        Manage Costs in Place
      </Button>
      
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Manage Existing Improvements - {property.propertyName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Summary Statistics */}
          <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="font-medium text-slate-600 dark:text-slate-400">Total Improvements</div>
                <div className="text-lg font-semibold">{improvements.length}</div>
              </div>
              <div>
                <div className="font-medium text-slate-600 dark:text-slate-400">Total Investment</div>
                <div className="text-lg font-semibold">{formatCurrency(calculateTotalValue())}</div>
              </div>
              <div>
                <div className="font-medium text-slate-600 dark:text-slate-400">Active Items</div>
                <div className="text-lg font-semibold">
                  {improvements.filter(i => i.isActive).length}
                </div>
              </div>
            </div>
          </div>

          {/* Add New Improvement Button */}
          {!showForm && (
            <div className="flex justify-center">
              <Button 
                onClick={() => setShowForm(true)} 
                size="sm"
                variant="outline"
                className="px-3 py-1 text-sm"
              >
                <Plus className="mr-1 h-3 w-3" />
                Add Existing Improvement
              </Button>
            </div>
          )}

          {/* Add/Edit Form */}
          {showForm && (
            <div className="border rounded-lg p-4 bg-slate-50 dark:bg-slate-800">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">
                  {editingId ? "Edit" : "Add"} Existing Improvement
                </h3>
                <Button variant="ghost" size="sm" onClick={cancelEdit}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select category" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {Object.entries(EXISTING_IMPROVEMENT_CATEGORIES)
                                .sort(([keyA, labelA], [keyB, labelB]) => {
                                  // Put "Custom" at the end
                                  if (keyA === 'custom') return 1;
                                  if (keyB === 'custom') return -1;
                                  // Sort all others alphabetically by label
                                  return labelA.localeCompare(labelB);
                                })
                                .map(([key, label]) => (
                                  <SelectItem key={key} value={key}>
                                    {label}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="allocationType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Allocation Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select allocation type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {Object.entries(ALLOCATION_TYPES).map(([key, label]) => (
                                <SelectItem key={key} value={key}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g., LED warehouse lighting upgrade" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="totalCost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Total Cost ($)</FormLabel>
                        <FormControl>
                          <Input 
                            type="text"
                            {...field}
                            value={field.value ? field.value.toLocaleString() : ''}
                            onChange={(e) => {
                              const value = e.target.value.replace(/[^0-9.]/g, '');
                              field.onChange(parseFloat(value) || undefined);
                            }}
                            placeholder="Enter cost amount" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {allocationType === "bay-specific" && (
                    <FormField
                      control={form.control}
                      name="applicableBays"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Applicable Bays</FormLabel>
                          <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto border rounded p-2">
                            {property.bayConfigurations?.map((bay: BayConfiguration) => (
                              <div key={bay.id} className="flex items-center space-x-2">
                                <Checkbox
                                  id={bay.id}
                                  checked={field.value?.includes(bay.id)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      field.onChange([...(field.value || []), bay.id]);
                                    } else {
                                      field.onChange(field.value?.filter(id => id !== bay.id));
                                    }
                                  }}
                                />
                                <label htmlFor={bay.id} className="text-sm">
                                  {bay.bayName}
                                </label>
                              </div>
                            ))}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes (Optional)</FormLabel>
                        <FormControl>
                          <Textarea {...field} placeholder="Additional notes..." rows={2} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex gap-2">
                    <Button 
                      type="submit" 
                      disabled={createMutation.isPending || updateMutation.isPending}
                      onClick={(e) => {
                        console.log('Button clicked!');
                        console.log('Form values:', form.getValues());
                        console.log('Form valid:', form.formState.isValid);
                        console.log('Form errors:', form.formState.errors);
                      }}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {editingId ? "Update" : "Add"} Improvement
                    </Button>
                    <Button type="button" variant="outline" onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          )}

          {/* Improvements List */}
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Existing Improvements</h3>
            
            {isLoading ? (
              <div className="text-center py-4">Loading improvements...</div>
            ) : improvements.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                No existing improvements recorded yet.
              </div>
            ) : (
              <div className="space-y-2">
                {improvements.map((improvement: PropertyExistingImprovement) => (
                  <div 
                    key={improvement.id}
                    className="border rounded-lg p-4 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded text-xs font-medium">
                            {EXISTING_IMPROVEMENT_CATEGORIES[improvement.category as keyof typeof EXISTING_IMPROVEMENT_CATEGORIES]}
                          </span>
                          <span className="px-2 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded text-xs">
                            {ALLOCATION_TYPES[improvement.allocationType as keyof typeof ALLOCATION_TYPES]}
                          </span>
                          {!improvement.isActive && (
                            <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded text-xs">
                              Inactive
                            </span>
                          )}
                        </div>
                        
                        <h4 className="font-medium">{improvement.description}</h4>
                        
                        <div className="mt-2 grid grid-cols-2 gap-4 text-sm text-slate-600 dark:text-slate-400">
                          <div>
                            <span className="font-medium">Total Cost: </span>
                            {formatCurrency(improvement.totalCost)}
                          </div>
                          <div>
                            <span className="font-medium">Allocation: </span>
                            {ALLOCATION_TYPES[improvement.allocationType as keyof typeof ALLOCATION_TYPES]}
                          </div>
                        </div>

                        {improvement.applicableBays && improvement.applicableBays.length > 0 && (
                          <div className="mt-2">
                            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                              Applicable Bays: 
                            </span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {improvement.applicableBays.map(bayId => {
                                const bay = property.bayConfigurations?.find(b => b.id === bayId);
                                return bay ? (
                                  <span key={bayId} className="px-2 py-1 bg-slate-200 dark:bg-slate-600 rounded text-xs">
                                    {bay.bayName}
                                  </span>
                                ) : null;
                              })}
                            </div>
                          </div>
                        )}

                        {improvement.notes && (
                          <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                            <span className="font-medium">Notes: </span>
                            {improvement.notes}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2 ml-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => startEdit(improvement)}
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => deleteMutation.mutate(improvement.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}