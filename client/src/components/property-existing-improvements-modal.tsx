import { useState, useEffect, useRef, useMemo } from "react";
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
import { Trash2, Plus, Edit3, Save, X, Grid, Printer, ChevronDown, ArrowRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { FormulaInput } from "@/components/formula-input";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { 
  EXISTING_IMPROVEMENT_CATEGORIES, 
  ALLOCATION_TYPES,
  type PropertyExistingImprovement,
  type Property,
  type BayConfiguration
} from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";

// Cost stage labels for UI display
const COST_STAGE_LABELS = {
  FORECAST: 'Forecast',
  COMMITTED: 'Committed',
  ACTUALS: 'Actuals',
  PIPELINE: 'Forecast', // Legacy mapping
} as const;

const formSchema = z.object({
  category: z.string().min(1, "Category is required"),
  description: z.string().min(1, "Description is required"),
  totalCost: z.number().min(0, "Cost must be positive"),
  // Per-stage cost fields (in dollars for form entry)
  forecastCost: z.coerce.number().min(0).default(0),
  committedCost: z.coerce.number().min(0).default(0),
  actualsCost: z.coerce.number().min(0).default(0),
  allocationType: z.enum(["prorated", "bay-specific", "whole-property", "demising-wall"]),
  // Kept as a string in form state (users may type "1,200"); converted to an
  // integer or null in onSubmit via regex-strip + parseFloat.
  areaSf: z.string().optional(),
  allocationValue: z.number().optional(),
  units: z.string().optional(),
  applicableBays: z.array(z.string()).optional(),
  notes: z.string().optional(),
  bucket: z.enum(["ACTUALS", "COMMITTED", "FORECAST", "PIPELINE"]).default("FORECAST"),
  drawCaptured: z.boolean().default(false),
  originalCommitment: z.coerce.number().min(0).optional(),
  addedAmount: z.coerce.number().min(0).optional(),
  drawRef: z.string().optional(),
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

// Inline editable cell for direct cost editing in table
function InlineEditableCell({ 
  value, 
  improvementId,
  field,
  colorClass,
  onSave
}: { 
  value: number;
  improvementId: number;
  field: 'forecastCost' | 'committedCost' | 'actualsCost';
  colorClass: string;
  onSave: (improvementId: number, field: string, value: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  
  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  };
  
  const startEditing = () => {
    setEditValue(value > 0 ? (value / 100).toString() : '');
    setIsEditing(true);
  };
  
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);
  
  const handleSave = () => {
    const numValue = parseFloat(editValue) || 0;
    onSave(improvementId, field, numValue);
    setIsEditing(false);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };
  
  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={`w-24 px-2 py-1 text-right font-mono border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${colorClass}`}
        data-testid={`inline-edit-${field}-${improvementId}`}
      />
    );
  }
  
  return (
    <span
      onClick={startEditing}
      className={`cursor-pointer hover:underline hover:bg-slate-100 dark:hover:bg-slate-700 px-2 py-1 rounded ${colorClass}`}
      title="Click to edit"
      data-testid={`cell-${field}-${improvementId}`}
    >
      {value > 0 ? formatCurrency(value) : '-'}
    </span>
  );
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
  const { toast } = useToast();
  
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
      forecastCost: 0,
      committedCost: 0,
      actualsCost: 0,
      allocationType: "prorated",
      areaSf: "",
      applicableBays: [],
      notes: "",
      bucket: "FORECAST",
      drawCaptured: false,
      originalCommitment: 0,
      addedAmount: 0,
      drawRef: "",
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

  // Calculate totals from per-stage cost fields
  const { forecastTotal, committedTotal, actualsTotal, grandTotal } = useMemo(() => {
    // Sum per-stage costs across all improvements (values are in cents)
    const forecastTotal = improvements.reduce((sum, imp) => sum + ((imp as any).forecastCost || 0), 0);
    const committedTotal = improvements.reduce((sum, imp) => sum + ((imp as any).committedCost || 0), 0);
    const actualsTotal = improvements.reduce((sum, imp) => sum + ((imp as any).actualsCost || 0), 0);
    const grandTotal = forecastTotal + committedTotal + actualsTotal;
    
    return { 
      forecastTotal,
      committedTotal,
      actualsTotal,
      grandTotal
    };
  }, [improvements]);

  // Fetch fresh property data to get current bay configurations
  const { data: freshProperty } = useQuery<Property>({
    queryKey: [`/api/properties/${property.id}`],
    enabled: !!property.id && open, // Only fetch when modal is open
  });

  // Use fresh property data if available, otherwise fall back to prop
  const currentProperty = freshProperty || property;

  // Check for spec office mismatch - more sophisticated logic including split bays
  const getSpecOfficeMismatch = () => {
    const bayConfigs = currentProperty.bayConfigurations || [];
    const specOfficeImprovements = improvements.filter(imp => imp.category === 'spec-office');
    
    // Count all bays with spec office (including split bays)
    const bayNamesWithSpecOffice: string[] = [];
    bayConfigs.forEach(bay => {
      if (bay.hasSpeculativeOffice) {
        bayNamesWithSpecOffice.push(bay.bayName);
      }
      // Also count split bays with spec office
      if (bay.splitNorthOffice) {
        bayNamesWithSpecOffice.push(`${bay.bayName} North`);
      }
      if (bay.splitSouthOffice) {
        bayNamesWithSpecOffice.push(`${bay.bayName} South`);
      }
    });
    
    const baysCount = bayNamesWithSpecOffice.length;
    const costsCount = specOfficeImprovements.length;
    
    // Determine mismatch types
    const hasNoCosts = baysCount > 0 && costsCount === 0;
    const hasFewerCosts = baysCount > costsCount && costsCount > 0;
    const hasMoreCosts = costsCount > baysCount && costsCount > 0;
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
      bayNames: bayNamesWithSpecOffice
    };
  };

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return await apiRequest(`/api/properties/${property.id}/existing-improvements`, "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/existing-improvements`] });
      setShowForm(false);
      form.reset();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<FormData> }) => {
      return await apiRequest(`/api/properties/${property.id}/existing-improvements/${id}`, "PATCH", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/existing-improvements`] });
      setEditingId(null);
      setShowForm(false);
      form.reset(); // Clear form after successful update
    },
  });

  // Inline cost update mutation for quick editing in table
  const inlineUpdateMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: number; field: string; value: number }) => {
      return await apiRequest(`/api/properties/${property.id}/existing-improvements/${id}`, "PATCH", {
        [field]: value
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/existing-improvements`] });
      toast({
        title: "Cost Updated",
        description: "The cost has been updated successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: "Failed to update the cost. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Handler for inline cost cell edits
  const handleInlineCostSave = (improvementId: number, field: string, value: number) => {
    inlineUpdateMutation.mutate({ id: improvementId, field, value });
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest(`/api/properties/${property.id}/existing-improvements/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/existing-improvements`] });
    },
  });

  // Stage promotion mutation: Forecast → Committed → Actuals
  const promoteStageMutation = useMutation({
    mutationFn: async ({ id, newBucket }: { id: number; newBucket: 'COMMITTED' | 'ACTUALS' }) => {
      return await apiRequest(`/api/properties/${property.id}/existing-improvements/${id}`, "PATCH", { bucket: newBucket });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/existing-improvements`] });
      toast({
        title: "Stage Updated",
        description: `Cost promoted to ${COST_STAGE_LABELS[variables.newBucket]}`,
      });
    },
  });

  const onSubmit = (data: FormData) => {
    // Convert areaSf from form string to integer-or-null. parseFloat + regex strip
    // (not parseInt) so "1,200" doesn't silently truncate at the comma.
    const areaSfRaw = (data.areaSf || "").replace(/[^0-9.]/g, "");
    const areaSfNum = parseFloat(areaSfRaw);
    const payload = {
      ...data,
      areaSf: !isNaN(areaSfNum) && areaSfNum > 0 ? Math.round(areaSfNum) : null,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload as any });
    } else {
      createMutation.mutate(payload as any);
    }
  };

  const startEdit = (improvement: PropertyExistingImprovement) => {
    setEditingId(improvement.id);
    // Map PIPELINE to FORECAST for backward compatibility
    let bucket = improvement.bucket || "ACTUALS";
    if (bucket === "PIPELINE") bucket = "FORECAST";
    const typedBucket = bucket as "ACTUALS" | "COMMITTED" | "FORECAST";
    
    // Update previousBucketRef to match the record being edited to prevent unwanted bucket switching logic
    previousBucketRef.current = bucket;
    
    // Get per-stage costs from the improvement (cast to any to access dynamic fields)
    const imp = improvement as any;
    
    form.reset({
      category: improvement.category,
      description: improvement.description,
      totalCost: improvement.totalCost / 100, // Convert from cents to dollars
      // Per-stage costs - convert from cents to dollars
      forecastCost: imp.forecastCost ? imp.forecastCost / 100 : 0,
      committedCost: imp.committedCost ? imp.committedCost / 100 : 0,
      actualsCost: imp.actualsCost ? imp.actualsCost / 100 : 0,
      allocationType: improvement.allocationType as "prorated" | "bay-specific" | "whole-property" | "demising-wall",
      areaSf: imp.areaSf != null ? String(imp.areaSf) : "",
      applicableBays: improvement.applicableBays || [],
      notes: improvement.notes || "",
      bucket: bucket,
      drawCaptured: improvement.drawCaptured || false,
      originalCommitment: improvement.originalCommitment ? improvement.originalCommitment / 100 : 0, // Convert from cents to dollars
      addedAmount: improvement.addedAmount ? improvement.addedAmount / 100 : 0, // Convert from cents to dollars
      drawRef: improvement.drawRef || "",
      demisingWallData: improvement.demisingWallData || undefined,
    });
    setShowForm(true);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setShowForm(false);
    form.reset();
    // Reset previousBucketRef to default bucket when canceling
    previousBucketRef.current = "FORECAST";
  };

  const handlePrint = async () => {
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
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
  
  // Track previous bucket to handle bucket switching
  const previousBucketRef = useRef<"ACTUALS" | "COMMITTED" | "FORECAST" | "PIPELINE">(form.getValues("bucket"));
  
  // Watch form values for cost lifecycle logic
  const currentBucket = form.watch("bucket");
  const originalCommitment = form.watch("originalCommitment");
  const addedAmount = form.watch("addedAmount");
  
  // Auto-calculate totalCost for FORECAST/COMMITTED bucket and handle bucket switching
  useEffect(() => {
    const previousBucket = previousBucketRef.current;
    
    // Handle bucket switching
    if (previousBucket !== currentBucket) {
      if (currentBucket === "ACTUALS") {
        // Switching to ACTUALS: preserve totalCost, clear commitment fields
        form.setValue("originalCommitment", 0, { shouldDirty: true, shouldValidate: true });
        form.setValue("addedAmount", 0, { shouldDirty: true, shouldValidate: true });
        form.setValue("drawCaptured", false, { shouldDirty: true, shouldValidate: true });
        form.setValue("drawRef", "", { shouldDirty: true, shouldValidate: true });
      } else if (currentBucket === "FORECAST" || currentBucket === "COMMITTED" || currentBucket === "PIPELINE") {
        // Switching to FORECAST/COMMITTED: reset totalCost to 0, prompt for commitments
        form.setValue("totalCost", 0, { shouldDirty: true, shouldValidate: true });
      }
      previousBucketRef.current = currentBucket;
    }
    
    // Auto-calculate totalCost for FORECAST/COMMITTED/PIPELINE bucket
    if (currentBucket === "FORECAST" || currentBucket === "COMMITTED" || currentBucket === "PIPELINE") {
      const calculatedTotal = (Number(originalCommitment) || 0) + (Number(addedAmount) || 0);
      form.setValue("totalCost", calculatedTotal, { shouldDirty: true, shouldValidate: true });
    }
  }, [currentBucket, originalCommitment, addedAmount, form]);

  // Generate all available bay options including split configurations
  const getAllAvailableBays = () => {
    const sortedBayConfigs = [...(currentProperty.bayConfigurations || [])].sort((a, b) => {
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

    // Then, get splittable bays (includes full bay + split options)
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
          // Include the full original bay
          {
            id: bayConfig.id,
            bayName: bayConfig.bayName,
            squareFootage: squareFootage,
            hasSpeculativeOffice: bayConfig.hasSpeculativeOffice || false,
            isSplitBay: false
          },
          // Include the north split option
          {
            id: `${bayConfig.id}_north`,
            bayName: `${bayConfig.bayName} North`,
            squareFootage: bayConfig.splitNorthSquareFootage || Math.floor(squareFootage / 2),
            hasSpeculativeOffice: bayConfig.splitNorthOffice === true,
            isSplitBay: true,
            splitSide: 'north' as const,
            parentBayId: bayConfig.id
          },
          // Include the south split option
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
        // Reset form when opening modal for new entries with explicit blank values
        form.reset({
          category: "",
          description: "",
          totalCost: 0,
          forecastCost: 0,
          committedCost: 0,
          actualsCost: 0,
          allocationType: "prorated",
          applicableBays: [],
          notes: "",
          bucket: "FORECAST",
          drawCaptured: false,
          originalCommitment: 0,
          addedAmount: 0,
          drawRef: "",
          demisingWallData: {
            leftPercentage: 50,
            rightPercentage: 50,
          },
        });
        setShowForm(false);
        setEditingId(null);
      }} className={`flex items-center gap-1 text-xs px-2 py-1 h-6 ${
        // Add visual indicator if there's a mismatch (only when data is loaded)
        (() => {
          if (isLoading) return ''; // Don't show warning while loading
          const bayConfigs = currentProperty.bayConfigurations || [];
          const specOfficeImprovements = (improvements || []).filter(imp => imp.category === 'spec-office');
          
          // Count all bays with spec office (including split bays)
          let baysCount = 0;
          bayConfigs.forEach(bay => {
            if (bay.hasSpeculativeOffice) baysCount++;
            if (bay.splitNorthOffice) baysCount++;
            if (bay.splitSouthOffice) baysCount++;
          });
          
          const costsCount = specOfficeImprovements.length;
          const hasMismatch = (baysCount > 0 && costsCount === 0) || (baysCount > costsCount && costsCount > 0) || (costsCount > baysCount && costsCount > 0);
          return hasMismatch ? 'border-yellow-300 bg-yellow-50 text-yellow-800 hover:bg-yellow-100' : '';
        })()
      }`}>
        <Grid className="h-3 w-3" />
        Manage Costs in Place
        {(() => {
          if (isLoading) return null; // Don't show warning icon while loading
          const bayConfigs = currentProperty.bayConfigurations || [];
          const specOfficeImprovements = (improvements || []).filter(imp => imp.category === 'spec-office');
          
          // Count all bays with spec office (including split bays)
          let baysCount = 0;
          bayConfigs.forEach(bay => {
            if (bay.hasSpeculativeOffice) baysCount++;
            if (bay.splitNorthOffice) baysCount++;
            if (bay.splitSouthOffice) baysCount++;
          });
          
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
            Manage Improvements - {property.propertyName}
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
                    <div className="flex gap-2">
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
                      {mismatch.hasMoreCosts && (
                        <div className="space-y-2">
                          <p className="text-xs text-yellow-700 dark:text-yellow-300">
                            💡 <strong>Suggestion:</strong> You have extra spec office cost entries. Delete the duplicate entries or mark additional bays as having spec offices.
                          </p>
                          {(() => {
                            const specOfficeImprovements = improvements.filter(imp => imp.category === 'spec-office');
                            const bayConfigs = currentProperty.bayConfigurations || [];
                            
                            // Build set of all valid bay IDs (including split bays)
                            // IMPORTANT: Add split bay IDs regardless of base hasSpeculativeOffice flag
                            const validBayIds = new Set<string>();
                            bayConfigs.forEach(bay => {
                              // Add base bay ID if it has spec office OR if any split section has spec office
                              // (legacy data may reference parent ID even when only splits have spec office)
                              if (bay.hasSpeculativeOffice || bay.splitNorthOffice || bay.splitSouthOffice) {
                                validBayIds.add(bay.id);
                              }
                              // ALWAYS check split flags independently of base flag
                              if (bay.splitNorthOffice) {
                                validBayIds.add(`${bay.id}_north`);
                              }
                              if (bay.splitSouthOffice) {
                                validBayIds.add(`${bay.id}_south`);
                              }
                            });
                            
                            // Find entries that don't match any bay with spec office (including split bays)
                            const unmatchedEntries = specOfficeImprovements.filter(imp => {
                              if (imp.allocationType !== 'bay-specific' || !imp.applicableBays) return false;
                              return imp.applicableBays.some(bayId => !validBayIds.has(bayId));
                            });

                            if (unmatchedEntries.length > 0) {
                              return (
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="text-yellow-700 dark:text-yellow-300">
                                    {unmatchedEntries.length} entr{unmatchedEntries.length > 1 ? 'ies' : 'y'} assigned to bays without spec office designation
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="h-6 text-xs px-2"
                                    onClick={async () => {
                                      if (confirm(`Remove ${unmatchedEntries.length} mismatched spec office cost entr${unmatchedEntries.length > 1 ? 'ies' : 'y'}?`)) {
                                        for (const entry of unmatchedEntries) {
                                          await deleteMutation.mutateAsync(entry.id);
                                        }
                                        toast({
                                          title: "Success",
                                          description: `Removed ${unmatchedEntries.length} mismatched entr${unmatchedEntries.length > 1 ? 'ies' : 'y'}`,
                                        });
                                      }
                                    }}
                                  >
                                    Auto-Fix: Remove Mismatched
                                  </Button>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      )}
                    </div>
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
                  setEditingId(null);
                  // Explicitly reset form with blank default values
                  form.reset({
                    category: "",
                    description: "",
                    totalCost: 0,
                    forecastCost: 0,
                    committedCost: 0,
                    actualsCost: 0,
                    allocationType: "prorated",
                    applicableBays: [],
                    notes: "",
                    bucket: "FORECAST",
                    drawCaptured: false,
                    originalCommitment: 0,
                    addedAmount: 0,
                    drawRef: "",
                    demisingWallData: {
                      leftPercentage: 50,
                      rightPercentage: 50,
                    },
                  });
                  // Reset previousBucketRef to default bucket when adding new
                  previousBucketRef.current = "ACTUALS";
                }} 
                size="sm"
                variant="outline"
                className="px-3 py-1 text-sm"
              >
                <Plus className="mr-1 h-3 w-3" />
                Add Improvement Cost(s)
              </Button>
            </div>
          )}

          {/* Add/Edit Form */}
          {showForm && (
            <div className="border rounded-lg p-4 bg-slate-50 dark:bg-slate-800">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">
                  {editingId ? "Edit" : "Add"} Improvement
                </h3>
                <Button variant="ghost" size="sm" onClick={cancelEdit}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  {/* Cost Lifecycle Tracking Fields - Per-Stage Entry */}
                  <div className="space-y-4 p-4 border rounded-lg bg-gradient-to-r from-purple-50 via-blue-50 to-green-50 dark:from-purple-900/20 dark:via-blue-900/20 dark:to-green-900/20">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      💼 Cost Lifecycle Tracking - Enter amounts for each stage
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4">
                      {/* Budget (Forecast) */}
                      <FormField
                        control={form.control}
                        name="forecastCost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-purple-700 dark:text-purple-400 font-semibold">
                              Budget (Forecast) $
                            </FormLabel>
                            <FormControl>
                              <FormulaInput
                                value={field.value || 0}
                                onChange={(rawValue, evaluatedValue) => {
                                  field.onChange(evaluatedValue);
                                }}
                                placeholder="0.00"
                                className="w-full border-purple-300 focus:border-purple-500"
                                decimalPlaces={2}
                                type="rate"
                                formatThousands={true}
                              />
                            </FormControl>
                            <div className="text-xs text-purple-600 dark:text-purple-400">
                              Budgeted/projected costs
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Committed */}
                      <FormField
                        control={form.control}
                        name="committedCost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-blue-700 dark:text-blue-400 font-semibold">
                              Committed $
                            </FormLabel>
                            <FormControl>
                              <FormulaInput
                                value={field.value || 0}
                                onChange={(rawValue, evaluatedValue) => {
                                  field.onChange(evaluatedValue);
                                }}
                                placeholder="0.00"
                                className="w-full border-blue-300 focus:border-blue-500"
                                decimalPlaces={2}
                                type="rate"
                                formatThousands={true}
                              />
                            </FormControl>
                            <div className="text-xs text-blue-600 dark:text-blue-400">
                              Contracted but not yet drawn
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Paid (Actuals) */}
                      <FormField
                        control={form.control}
                        name="actualsCost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-green-700 dark:text-green-400 font-semibold">
                              Paid (Actuals) $
                            </FormLabel>
                            <FormControl>
                              <FormulaInput
                                value={field.value || 0}
                                onChange={(rawValue, evaluatedValue) => {
                                  field.onChange(evaluatedValue);
                                }}
                                placeholder="0.00"
                                className="w-full border-green-300 focus:border-green-500"
                                decimalPlaces={2}
                                type="rate"
                                formatThousands={true}
                              />
                            </FormControl>
                            <div className="text-xs text-green-600 dark:text-green-400">
                              Confirmed from lender draws
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    {/* Computed Total */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                        Total Cost (auto-calculated):
                      </span>
                      <span className="text-lg font-bold text-slate-800 dark:text-slate-200">
                        ${((Number(form.watch('forecastCost')) || 0) + (Number(form.watch('committedCost')) || 0) + (Number(form.watch('actualsCost')) || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    
                    <div className="text-xs text-muted-foreground">
                      💡 <strong>Tip:</strong> Enter costs directly into any column. Formulas supported: =123*5 or =15000/12
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
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
                                        if (keyA === 'custom') return 1;
                                        if (keyB === 'custom') return -1;
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

                    {allocationType !== "demising-wall" && (
                      <FormField
                        control={form.control}
                        name="areaSf"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Area (SF) — optional</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                inputMode="numeric"
                                placeholder="e.g., 2,400 (for $/SF on Costs-in-Place report)"
                              />
                            </FormControl>
                            <div className="text-xs text-slate-500">
                              Enter for area-specific items like office buildouts. Leave blank to use the property's rentable SF for $/SF.
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
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

                      {/* Bay Boundary convenience picker — adjacent pairs only */}
                      {(() => {
                        const sorted = availableBays
                          .filter(b => !b.isSplitBay)
                          .sort((a, b) => {
                            const an = parseInt(a.bayName.match(/(\d+)/)?.[1] || '0');
                            const bn = parseInt(b.bayName.match(/(\d+)/)?.[1] || '0');
                            return an - bn;
                          });
                        const pairs = sorted.slice(0, -1).map((b, i) => ({
                          key: `${b.id}|${sorted[i + 1].id}`,
                          leftId: b.id,
                          rightId: sorted[i + 1].id,
                          label: `${b.bayName} – ${sorted[i + 1].bayName}`,
                        }));
                        const curLeft = form.watch('demisingWallData.leftBayId');
                        const curRight = form.watch('demisingWallData.rightBayId');
                        const selKey = pairs.find(p => p.leftId === curLeft && p.rightId === curRight)?.key || '';
                        return (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Bay Boundary{' '}
                              <span className="text-gray-400 font-normal">(adjacent bays only)</span>
                            </label>
                            <select
                              value={selKey}
                              onChange={(e) => {
                                if (!e.target.value) return;
                                const [l, r] = e.target.value.split('|');
                                form.setValue('demisingWallData.leftBayId', l);
                                form.setValue('demisingWallData.rightBayId', r);
                              }}
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                              <option value="">— Select boundary —</option>
                              {pairs.map(p => (
                                <option key={p.key} value={p.key}>{p.label}</option>
                              ))}
                            </select>
                            <p className="text-xs text-gray-500 mt-1">
                              For split-bay walls, use the Left / Right Bay selects below.
                            </p>
                          </div>
                        );
                      })()}

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="demisingWallData.leftBayId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Left Bay</FormLabel>
                              <FormControl>
                                <select
                                  {...field}
                                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <option value="">Select left bay</option>
                                  {availableBays.map((bay) => (
                                    <option key={bay.id} value={bay.id}>
                                      {bay.bayName}
                                    </option>
                                  ))}
                                </select>
                              </FormControl>
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
                              <FormControl>
                                <select
                                  {...field}
                                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <option value="">Select right bay</option>
                                  {availableBays.map((bay) => (
                                    <option key={bay.id} value={bay.id}>
                                      {bay.bayName}
                                    </option>
                                  ))}
                                </select>
                              </FormControl>
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

          {/* Improvements List - Table with per-improvement cost breakdown */}
          <div className="space-y-6">
            {isLoading ? (
              <div className="text-center py-4">Loading improvements...</div>
            ) : improvements.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                No existing improvements recorded yet.
              </div>
            ) : (
              <>
                {/* Grand Total Summary */}
                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                  <div className="flex flex-wrap justify-between items-center gap-4">
                    <div className="flex flex-wrap gap-4 text-sm">
                      <span className="text-purple-600 dark:text-purple-400">
                        <strong>Budget:</strong> {formatCurrency(forecastTotal)}
                      </span>
                      <span className="text-blue-600 dark:text-blue-400">
                        <strong>Committed:</strong> {formatCurrency(committedTotal)}
                      </span>
                      <span className="text-green-600 dark:text-green-400">
                        <strong>Paid:</strong> {formatCurrency(actualsTotal)}
                      </span>
                    </div>
                    <span className="font-bold text-lg text-slate-700 dark:text-slate-300">
                      Total: {formatCurrency(grandTotal)}
                    </span>
                  </div>
                </div>

                {/* Improvements Table with Per-Item Cost Breakdown */}
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 dark:bg-slate-800">
                      <tr>
                        <th className="text-left p-3 font-medium">Description</th>
                        <th className="text-left p-3 font-medium">Category</th>
                        <th className="text-right p-3 font-medium text-purple-600 dark:text-purple-400">Budget</th>
                        <th className="text-right p-3 font-medium text-blue-600 dark:text-blue-400">Committed</th>
                        <th className="text-right p-3 font-medium text-green-600 dark:text-green-400">Paid</th>
                        <th className="text-right p-3 font-bold">Total Cost</th>
                        <th className="text-center p-3 w-24">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {improvements.map((improvement: PropertyExistingImprovement) => {
                        const imp = improvement as any;
                        const forecastCost = imp.forecastCost || 0;
                        const committedCost = imp.committedCost || 0;
                        const actualsCost = imp.actualsCost || 0;
                        const totalCost = forecastCost + committedCost + actualsCost;
                        
                        return (
                          <tr key={improvement.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                            <td className="p-3">
                              <div className="font-medium">{improvement.description}</div>
                              <div className="flex gap-1 mt-1">
                                <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-xs text-slate-600 dark:text-slate-400">
                                  {ALLOCATION_TYPES[improvement.allocationType as keyof typeof ALLOCATION_TYPES]}
                                </span>
                                {!improvement.isActive && (
                                  <span className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-400">
                                    Inactive
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-3">
                              <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded text-xs font-medium">
                                {EXISTING_IMPROVEMENT_CATEGORIES[improvement.category as keyof typeof EXISTING_IMPROVEMENT_CATEGORIES]}
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <InlineEditableCell
                                value={forecastCost}
                                improvementId={improvement.id}
                                field="forecastCost"
                                colorClass="font-mono text-purple-600 dark:text-purple-400"
                                onSave={handleInlineCostSave}
                              />
                            </td>
                            <td className="p-3 text-right">
                              <InlineEditableCell
                                value={committedCost}
                                improvementId={improvement.id}
                                field="committedCost"
                                colorClass="font-mono text-blue-600 dark:text-blue-400"
                                onSave={handleInlineCostSave}
                              />
                            </td>
                            <td className="p-3 text-right">
                              <InlineEditableCell
                                value={actualsCost}
                                improvementId={improvement.id}
                                field="actualsCost"
                                colorClass="font-mono text-green-600 dark:text-green-400"
                                onSave={handleInlineCostSave}
                              />
                            </td>
                            <td className="p-3 text-right font-mono font-bold">
                              {formatCurrency(totalCost > 0 ? totalCost : improvement.totalCost)}
                            </td>
                            <td className="p-3">
                              <div className="flex gap-1 justify-center">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => startEdit(improvement)}
                                  className="h-8 w-8 p-0"
                                >
                                  <Edit3 className="h-4 w-4" />
                                </Button>
                                {canDeleteProperties && (
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => deleteMutation.mutate(improvement.id)}
                                    disabled={deleteMutation.isPending}
                                    className="h-8 w-8 p-0"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-100 dark:bg-slate-800 font-medium">
                      <tr>
                        <td className="p-3 font-bold" colSpan={2}>Totals</td>
                        <td className="p-3 text-right font-mono text-purple-600 dark:text-purple-400">
                          {formatCurrency(forecastTotal)}
                        </td>
                        <td className="p-3 text-right font-mono text-blue-600 dark:text-blue-400">
                          {formatCurrency(committedTotal)}
                        </td>
                        <td className="p-3 text-right font-mono text-green-600 dark:text-green-400">
                          {formatCurrency(actualsTotal)}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-lg">
                          {formatCurrency(grandTotal)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}