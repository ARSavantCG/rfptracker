import { useState, useEffect, useRef } from "react";
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
import { Trash2, Plus, Edit3, Save, X, Grid, Printer, ChevronDown } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { FormulaInput } from "@/components/formula-input";
import { useAuth } from "@/hooks/useAuth";
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
  allocationType: z.enum(["prorated", "bay-specific", "whole-property", "demising-wall"]),
  allocationValue: z.number().optional(),
  units: z.string().optional(),
  applicableBays: z.array(z.string()).optional(),
  notes: z.string().optional(),
  demisingWallData: z.object({
    leftBayId: z.string().optional(),
    rightBayId: z.string().optional(),
    leftPercentage: z.number().min(0).max(100).optional(),
    rightPercentage: z.number().min(0).max(100).optional(),
    wallLocation: z.string().optional(),
  }).optional(),
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
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [allocationDropdownOpen, setAllocationDropdownOpen] = useState(false);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const allocationDropdownRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  
  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target as Node)) {
        setCategoryDropdownOpen(false);
      }
      if (allocationDropdownRef.current && !allocationDropdownRef.current.contains(event.target as Node)) {
        setAllocationDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  const { user } = useAuth();

  // Check if user has properties delete permissions
  const canDeleteProperties = user?.permissions?.includes('properties.delete') || false;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      category: "",
      description: "",
      totalCost: 0,
      allocationType: "prorated",
      applicableBays: [],
      notes: "",
      demisingWallData: {
        leftPercentage: 50,
        rightPercentage: 50,
      },
    },
  });

  const { data: improvements = [], isLoading } = useQuery<PropertyExistingImprovement[]>({
    queryKey: [`/api/properties/${property.id}/existing-improvements`],
    enabled: !!property.id, // Always load data, not just when modal is open
  });

  // Check for spec office mismatch - more sophisticated logic
  const getSpecOfficeMismatch = () => {
    const baysWithSpecOffice = property.bayConfigurations?.filter(bay => bay.hasSpeculativeOffice) || [];
    const specOfficeImprovements = improvements.filter(imp => imp.category === 'spec-office');
    
    const baysCount = baysWithSpecOffice.length;
    const costsCount = specOfficeImprovements.length;
    
    // Determine mismatch types
    const hasNoCosts = baysCount > 0 && costsCount === 0;
    const hasFewerCosts = baysCount > costsCount && costsCount > 0;
    const hasMoreCosts = costsCount > baysCount && costsCount > 0;  // Fixed: only need costsCount > 0
    const hasMismatch = hasNoCosts || hasFewerCosts || hasMoreCosts;
    
    // Generate appropriate warning message
    let warningMessage = '';
    if (hasNoCosts) {
      warningMessage = `You have ${baysCount} bay${baysCount !== 1 ? 's' : ''} marked with spec offices but no spec office costs entered.`;
    } else if (hasFewerCosts) {
      warningMessage = `You have ${baysCount} bay${baysCount !== 1 ? 's' : ''} with spec offices but only ${costsCount} cost entr${costsCount !== 1 ? 'ies' : 'y'}. Consider if additional cost entries are needed.`;
    } else if (hasMoreCosts) {
      warningMessage = `You have ${costsCount} spec office cost entr${costsCount !== 1 ? 'ies' : 'y'} but only ${baysCount} bay${baysCount !== 1 ? 's' : ''} marked with spec offices.`;
    }
    
    return {
      baysWithSpecOffice: baysCount,
      specOfficeImprovements: costsCount,
      hasMismatch,
      hasNoCosts,
      hasFewerCosts,
      hasMoreCosts,
      warningMessage,
      bayNames: baysWithSpecOffice.map(bay => bay.bayName)
    };
  };

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return await apiRequest("POST", `/api/properties/${property.id}/existing-improvements`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/existing-improvements`] });
      setShowForm(false);
      form.reset();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<FormData> }) => {
      return await apiRequest("PATCH", `/api/properties/${property.id}/existing-improvements/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/existing-improvements`] });
      setEditingId(null);
      setShowForm(false);
      form.reset(); // Clear form after successful update
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/properties/${property.id}/existing-improvements/${id}`);
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
      allocationType: improvement.allocationType as "prorated" | "bay-specific" | "whole-property" | "demising-wall",
      applicableBays: improvement.applicableBays || [],
      notes: improvement.notes || "",
      demisingWallData: improvement.demisingWallData || undefined,
    });
    setShowForm(true);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setShowForm(false);
    form.reset();
  };

  const handlePrint = async () => {
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/properties/${property.id}/existing-improvements/print`, {
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
      console.error('Existing improvements print error:', error);
    }
  };

  const allocationType = form.watch("allocationType");

  // Generate all available bay options including split configurations
  const getAllAvailableBays = () => {
    const sortedBayConfigs = [...(property.bayConfigurations || [])].sort((a, b) => {
      const aMatch = a.bayName.match(/Bay (\d+)-(\d+)/);
      const bMatch = b.bayName.match(/Bay (\d+)-(\d+)/);
      if (!aMatch || !bMatch) return a.bayName.localeCompare(b.bayName);
      const aStart = parseInt(aMatch[1]);
      const bStart = parseInt(bMatch[1]);
      const aEnd = parseInt(aMatch[2]);
      const bEnd = parseInt(bMatch[2]);
      // Sort by starting bay number first, then by ending bay number
      return aStart !== bStart ? aStart - bStart : aEnd - bEnd;
    });

    // First, get all regular bays (non-splittable)
    const regularBays = sortedBayConfigs
      .filter(bayConfig => !bayConfig.canBeSplit)
      .map(bayConfig => {
        const squareFootage = typeof bayConfig.squareFootage === 'string' 
          ? parseInt(bayConfig.squareFootage) || 0 
          : bayConfig.squareFootage || 0;
        
        return {
          id: bayConfig.id,
          bayName: bayConfig.bayName,
          squareFootage: squareFootage,
          hasSpeculativeOffice: bayConfig.hasSpeculativeOffice || false,
          isSplitBay: false
        };
      });

    // Then, get split bay options for splittable bays (no original bay)
    const splitBays = sortedBayConfigs
      .filter(bayConfig => bayConfig.canBeSplit)
      .flatMap(bayConfig => {
        const squareFootage = typeof bayConfig.squareFootage === 'string' 
          ? parseInt(bayConfig.squareFootage) || 0 
          : bayConfig.squareFootage || 0;
        
        if (!bayConfig || !bayConfig.bayName || !squareFootage || squareFootage === 0) {
          return [];
        }
        
        return [
          {
            id: `${bayConfig.id}_north`,
            bayName: `${bayConfig.bayName} North`,
            squareFootage: bayConfig.splitNorthSquareFootage || Math.floor(squareFootage / 2),
            hasSpeculativeOffice: bayConfig.splitNorthOffice === true,
            isSplitBay: true,
            splitSide: 'north' as const,
            parentBayId: bayConfig.id
          },
          {
            id: `${bayConfig.id}_south`,
            bayName: `${bayConfig.bayName} South`,
            squareFootage: bayConfig.splitSouthSquareFootage || Math.ceil(squareFootage / 2),
            hasSpeculativeOffice: bayConfig.splitSouthOffice === true,
            isSplitBay: true,
            splitSide: 'south' as const,
            parentBayId: bayConfig.id
          }
        ];
      });

    // Combine regular and split bays
    return [...regularBays, ...splitBays];
  };

  const availableBays = getAllAvailableBays();

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
      <Button variant="outline" size="sm" onClick={() => {
        setOpen(true);
        // Reset form when opening modal for new entries
        form.reset();
        setShowForm(false);
        setEditingId(null);
      }} className={`flex items-center gap-1 text-xs px-2 py-1 h-6 ${
        // Add visual indicator if there's a mismatch (only when data is loaded)
        (() => {
          if (isLoading) return ''; // Don't show warning while loading
          const baysWithSpecOffice = property.bayConfigurations?.filter(bay => bay.hasSpeculativeOffice) || [];
          const specOfficeImprovements = (improvements || []).filter(imp => imp.category === 'spec-office');
          const baysCount = baysWithSpecOffice.length;
          const costsCount = specOfficeImprovements.length;
          const hasMismatch = (baysCount > 0 && costsCount === 0) || (baysCount > costsCount && costsCount > 0) || (costsCount > baysCount && costsCount > 0);
          return hasMismatch ? 'border-yellow-300 bg-yellow-50 text-yellow-800 hover:bg-yellow-100' : '';
        })()
      }`}>
        <Grid className="h-3 w-3" />
        Manage Costs in Place
        {(() => {
          if (isLoading) return null; // Don't show warning icon while loading
          const baysWithSpecOffice = property.bayConfigurations?.filter(bay => bay.hasSpeculativeOffice) || [];
          const specOfficeImprovements = (improvements || []).filter(imp => imp.category === 'spec-office');
          const baysCount = baysWithSpecOffice.length;
          const costsCount = specOfficeImprovements.length;
          const hasMismatch = (baysCount > 0 && costsCount === 0) || (baysCount > costsCount && costsCount > 0) || (costsCount > baysCount && costsCount > 0);
          return hasMismatch ? (
            <span className="text-yellow-600 text-[10px] ml-1">⚠️</span>
          ) : null;
        })()}
      </Button>
      
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between pr-12">
          <DialogTitle>
            Manage Existing Improvements - {property.propertyName}
          </DialogTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="flex items-center gap-1 mr-2 mt-1"
          >
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </DialogHeader>

        <div className="space-y-6">
          {/* Spec Office Mismatch Warning */}
          {(() => {
            const mismatch = getSpecOfficeMismatch();
            return mismatch.hasMismatch ? (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="text-yellow-600 dark:text-yellow-400 mt-0.5">
                    ⚠️
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                      {mismatch.hasNoCosts ? "Spec Office Cost Missing" : 
                       mismatch.hasFewerCosts ? "Possible Missing Spec Office Costs" :
                       "Spec Office Count Mismatch"}
                    </h3>
                    <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-3">
                      {mismatch.warningMessage}
                      {mismatch.bayNames.length > 0 && (
                        <span> Bay{mismatch.bayNames.length !== 1 ? 's' : ''}: {mismatch.bayNames.join(', ')}</span>
                      )}
                    </p>
                    {(mismatch.hasNoCosts || mismatch.hasFewerCosts) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-yellow-300 text-yellow-800 hover:bg-yellow-100 dark:border-yellow-600 dark:text-yellow-200 dark:hover:bg-yellow-800/20"
                        onClick={() => {
                          setShowForm(true);
                          form.reset({
                            category: "spec-office",
                            description: `Spec Office Costs for ${mismatch.bayNames.join(', ')}`,
                            totalCost: 0,
                            allocationType: "bay-specific",
                            applicableBays: availableBays.filter(bay => bay.hasSpeculativeOffice).map(bay => bay.id) || [],
                            notes: "Auto-suggested based on bay configuration",
                          });
                        }}
                      >
                        + Add Spec Office Costs
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : null;
          })()}

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
                onClick={() => {
                  setShowForm(true);
                  form.reset(); // Clear form when adding new improvement
                }} 
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
                  <div className="grid grid-cols-4 gap-4">
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem className="relative">
                          <FormLabel>Category</FormLabel>
                          <FormControl>
                            <div className="relative" ref={categoryDropdownRef}>
                              <button
                                type="button"
                                onClick={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
                                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <span className={field.value ? "text-foreground" : "text-muted-foreground"}>
                                  {field.value ? EXISTING_IMPROVEMENT_CATEGORIES[field.value as keyof typeof EXISTING_IMPROVEMENT_CATEGORIES] : "Select category"}
                                </span>
                                <ChevronDown className={`h-4 w-4 transition-transform ${categoryDropdownOpen ? "rotate-180" : ""}`} />
                              </button>
                              {categoryDropdownOpen && (
                                <div className="absolute z-50 mt-1 w-full rounded-md border bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-lg">
                                  <div className="max-h-60 overflow-auto p-1">
                                    {Object.entries(EXISTING_IMPROVEMENT_CATEGORIES)
                                      .sort(([keyA, labelA], [keyB, labelB]) => {
                                        // Put "Custom" at the end
                                        if (keyA === 'custom') return 1;
                                        if (keyB === 'custom') return -1;
                                        // Sort all others alphabetically by label
                                        return labelA.localeCompare(labelB);
                                      })
                                      .map(([key, label]) => (
                                        <div
                                          key={key}
                                          className="flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-2 text-sm outline-none hover:bg-blue-50 dark:hover:bg-slate-700 focus:bg-blue-50 dark:focus:bg-slate-700"
                                          onClick={() => {
                                            field.onChange(key);
                                            setCategoryDropdownOpen(false);
                                          }}
                                        >
                                          {label}
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="allocationType"
                      render={({ field }) => (
                        <FormItem className="relative">
                          <FormLabel>Allocation Type</FormLabel>
                          <FormControl>
                            <div className="relative" ref={allocationDropdownRef}>
                              <button
                                type="button"
                                onClick={() => setAllocationDropdownOpen(!allocationDropdownOpen)}
                                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <span className={field.value ? "text-foreground" : "text-muted-foreground"}>
                                  {field.value ? ALLOCATION_TYPES[field.value as keyof typeof ALLOCATION_TYPES] : "Select allocation type"}
                                </span>
                                <ChevronDown className={`h-4 w-4 transition-transform ${allocationDropdownOpen ? "rotate-180" : ""}`} />
                              </button>
                              {allocationDropdownOpen && (
                                <div className="absolute z-50 mt-1 w-full rounded-md border bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-lg">
                                  <div className="max-h-60 overflow-auto p-1">
                                    {Object.entries(ALLOCATION_TYPES).map(([key, label]) => (
                                      <div
                                        key={key}
                                        className="flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-2 text-sm outline-none hover:bg-blue-50 dark:hover:bg-slate-700 focus:bg-blue-50 dark:focus:bg-slate-700"
                                        onClick={() => {
                                          field.onChange(key);
                                          setAllocationDropdownOpen(false);
                                        }}
                                      >
                                        {label}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

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
                            <FormulaInput
                              value={field.value || 0}
                              onChange={(rawValue, evaluatedValue) => {
                                console.log('📝 FormulaInput onChange:', { rawValue, evaluatedValue });
                                // Use evaluatedValue (the calculated result) for the form
                                field.onChange(evaluatedValue);
                              }}
                              onBlur={() => {
                                // Save the form when formula input loses focus
                                field.onBlur();
                              }}
                              placeholder="Enter cost amount or formula (press Enter to save)"
                              className="w-full"
                              decimalPlaces={2}
                              type="rate"
                            />
                          </FormControl>
                          <div className="text-xs text-muted-foreground mt-1">
                            💡 <strong>Formula support:</strong> Enter formulas like =123*5 or =15000/12. Press Enter or click away to save.
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {allocationType === "bay-specific" && (
                    <FormField
                      control={form.control}
                      name="applicableBays"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Applicable Bays</FormLabel>
                          <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto border rounded p-2">
                            {availableBays.map((bay) => (
                              <div key={bay.id} className="flex items-center space-x-2">
                                <Checkbox
                                  id={bay.id}
                                  checked={field.value?.includes(bay.id)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      field.onChange([...(field.value || []), bay.id]);
                                    } else {
                                      field.onChange(field.value?.filter((id: string) => id !== bay.id) || []);
                                    }
                                  }}
                                />
                                <label htmlFor={bay.id} className="text-sm text-left">
                                  {bay.bayName}
                                  {bay.hasSpeculativeOffice && (
                                    <span className="text-blue-600 ml-1" title="Has Speculative Office">🏢</span>
                                  )}
                                </label>
                              </div>
                            ))}
                          </div>
                          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                            💡 <strong>Split bays:</strong> For bays with North/South configurations, select individual halves to track costs separately.
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {allocationType === "demising-wall" && (
                    <div className="space-y-4 p-4 border rounded-lg bg-blue-50 dark:bg-blue-900/20">
                      <div className="text-sm font-medium text-blue-800 dark:text-blue-200">
                        Demising Wall Cost Allocation
                      </div>
                      
                      <FormField
                        control={form.control}
                        name="demisingWallData.wallLocation"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Wall Location Description</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="e.g., North wall between Bay 5-6 and Bay 6-7" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="demisingWallData.leftBayId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Left Bay</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select left bay" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {availableBays.map((bay) => (
                                    <SelectItem key={bay.id} value={bay.id}>
                                      {bay.bayName}
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
                          name="demisingWallData.rightBayId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Right Bay</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select right bay" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {availableBays.map((bay) => (
                                    <SelectItem key={bay.id} value={bay.id}>
                                      {bay.bayName}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="demisingWallData.leftPercentage"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Left Bay Percentage (%)</FormLabel>
                              <FormControl>
                                <Input 
                                  type="number"
                                  min="0"
                                  max="100"
                                  {...field}
                                  value={field.value ?? 50}
                                  onChange={(e) => {
                                    const leftPercentage = parseInt(e.target.value) || 0;
                                    field.onChange(leftPercentage);
                                    // Auto-calculate right percentage
                                    const rightPercentage = 100 - leftPercentage;
                                    form.setValue('demisingWallData.rightPercentage', rightPercentage);
                                  }}
                                  placeholder="50" 
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="demisingWallData.rightPercentage"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Right Bay Percentage (%)</FormLabel>
                              <FormControl>
                                <Input 
                                  type="number"
                                  min="0"
                                  max="100"
                                  {...field}
                                  value={field.value ?? 50}
                                  onChange={(e) => {
                                    const rightPercentage = parseInt(e.target.value) || 0;
                                    field.onChange(rightPercentage);
                                    // Auto-calculate left percentage
                                    const leftPercentage = 100 - rightPercentage;
                                    form.setValue('demisingWallData.leftPercentage', leftPercentage);
                                  }}
                                  placeholder="50" 
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        Cost will be split between the selected bays based on the percentages above. 
                        Percentages must total 100%.
                      </div>
                    </div>
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
                                // First check if it's a split bay in our available bays list
                                const splitBay = availableBays.find(b => b.id === bayId);
                                if (splitBay) {
                                  return (
                                    <span key={bayId} className="px-2 py-1 bg-slate-200 dark:bg-slate-600 rounded text-xs">
                                      {splitBay.bayName}
                                      {splitBay.hasSpeculativeOffice && (
                                        <span className="text-blue-600 ml-1" title="Has Speculative Office">🏢</span>
                                      )}
                                    </span>
                                  );
                                }
                                
                                // If not found in available bays, check if it's an original bay configuration
                                // (this handles legacy improvements that might reference original bay IDs)
                                const bay = property.bayConfigurations?.find(b => b.id === bayId);
                                if (bay) {
                                  return (
                                    <span key={bayId} className="px-2 py-1 bg-slate-200 dark:bg-slate-600 rounded text-xs">
                                      {bay.bayName}
                                    </span>
                                  );
                                }
                                
                                return null;
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
                        {canDeleteProperties && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => deleteMutation.mutate(improvement.id)}
                            disabled={deleteMutation.isPending}
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
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}