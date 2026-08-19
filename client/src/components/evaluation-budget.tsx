import { useState, useEffect, useMemo, useCallback } from "react";
import MasterScopeItemPicker, { type MasterScopeSelection } from "@/components/master-scope-item-picker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
// Removed Select import - using native HTML selects for consistency
import { Plus, Edit, Trash2, Save, X, ArrowRight, Copy, FileDown, Upload, Package, Users, ChevronUp, ChevronDown, GripVertical, Check as CheckIcon, FileText, AlertTriangle, Zap, Info, Lock, Unlock, ListChecks } from "lucide-react";
import { EvaluationAttachments } from "./evaluation-attachments";
import { EvaluationLabeledUploads } from "./evaluation-labeled-uploads";
import { EvaluationBudgetHistory } from "./evaluation-budget-history";
import { RecordProjectActuals } from "./record-project-actuals";
import { FormulaInput } from "./formula-input";
import { RfpImportDialog } from "./rfp-import-dialog";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import { nanoid } from "nanoid";
import * as XLSX from "xlsx";
import type { RfpRequest, BidCollection, BidLineItem } from "@shared/schema";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";
import { defaultElectricalAllocation } from "@shared/electrical-utils";
import { computeLineTotal, applyFeeMinimum } from "@shared/line-total";
import { resolveRfpRentableArea, sumBayArea, PROPERTY_LEGAL_TOTALS_BY_ID } from "@shared/area-utils";

interface MasterCategory {
  id: number;
  name: string;
}

interface EvaluationLineItem {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: string;
  totalPrice: string;
  tenantShare: number; // Percentage of cost attributed to tenant (0-100)
  bidCollectionId?: number;
  bidLineItemId?: number;
  isRolledUp?: boolean;
  rollupTarget?: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements';
  assemblyId?: string;
  bucket?: 'ACTUALS' | 'PIPELINE'; // Cost lifecycle bucket for existing improvements
  masterCategoryId?: number | null;
  isFixedAllowance?: boolean; // When true, line displays its exact entered value — exempt from hidden-cost distribution
  masterItemId?: number | null; // Links this line item back to a rom_scope_items catalog entry, when picked from a Scope of Work / ROM catalog selection
  masterItemSnapshot?: { description: string; unit: string; unitPrice: string; calculationBasis?: string | null; minimumCost?: string | null; hasMinimumCost?: boolean | null } | null; // Snapshot of the catalog item at time of selection
  customDescription?: string | null;
}

interface CustomAssembly {
  id: string;
  name: string;
  category: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements';
  items: string[]; // Array of line item IDs
  primaryItemId?: string; // ID of the first-clicked item that defines base quantity and unit
  /**
   * The head's own quantity and unit, when set.
   *
   * The head's PRICE is always the sum of its children - that is the source of
   * truth and is never typed. But the quantity it is expressed in is a
   * presentation choice: $150,000 of switchgear and circuiting can read as
   * 1 LS @ $150,000/LS or 100 LF @ $1,500/LF. Same total, different rate.
   *
   * Unset means keep the existing behaviour of borrowing from primaryItemId.
   */
  headQuantity?: number;
  headUnit?: string;
}

// Multi-voltage electrical allocation entry
interface ElectricalAllocationEntry {
  id: string;
  kva: number; // Kept for backward compatibility, but amps is the source of truth
  amps: number; // Primary value - stored directly to avoid conversion rounding
  voltage: string; // "480" | "208"
}

interface EvaluationBudgetData {
  tenantImprovements: EvaluationLineItem[];
  designSoftCosts: EvaluationLineItem[];
  existingImprovements: EvaluationLineItem[];
  hasExistingImprovements: boolean;
  includeExistingInTotal: boolean;
  separateDesignCosts: boolean;
  totalTenantImprovements: string;
  totalDesignSoftCosts: string;
  totalExistingImprovements: string;
  grandTotal: string;
  notes: string;
  lineItemRollups: Record<string, 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements' | 'tiAndDesign'>;
  customAssemblies: CustomAssembly[];
  assemblies: Record<string, { total: number; components: string[] }>;
  oversizedDoors: number;
  regularDoors: number;
  vehicularParking: number;
  trailerParking: number;
  electricalAllocation: number;
  calculatedElectricalAllocation: number;
  electricalAllocationOverride: number | null;
  // Manual door counts. null = follow the auto-calculation; a number = the user
  // set it deliberately and it must survive recalculation and reload.
  oversizedDoorsOverride: number | null;
  regularDoorsOverride: number | null;
  tenantVoltage: string;
  // Multi-voltage electrical allocations
  electricalAllocations: ElectricalAllocationEntry[];
}

// Voltage options for tenant electrical allocation
const VOLTAGE_OPTIONS = [
  { value: "480", label: "480V (3-Phase)", multiplier: 480 * Math.sqrt(3) },
  { value: "208", label: "208/120V (3-Phase)", multiplier: 208 * Math.sqrt(3) },
] as const;

// Convert AMPS to kVA based on voltage (store with precision to avoid rounding errors)
const ampsToKva = (amps: number, voltage: string = "480"): number => {
  const option = VOLTAGE_OPTIONS.find(v => v.value === voltage);
  const multiplier = option ? option.multiplier : 480 * Math.sqrt(3);
  // Use 2 decimal places to preserve precision for round-trip conversion
  return Math.round(((amps * multiplier) / 1000) * 100) / 100;
};

// Convert kVA to AMPS based on voltage
const kvaToAmps = (kva: number, voltage: string = "480"): number => {
  const option = VOLTAGE_OPTIONS.find(v => v.value === voltage);
  const multiplier = option ? option.multiplier : 480 * Math.sqrt(3);
  // Round to nearest integer for display
  return Math.round((kva * 1000) / multiplier);
};

interface EvaluationBudgetProps {
  rfp: RfpRequest | null;
  isWorkflowCollapsed?: boolean;
  onComplete?: () => void;
}

export function EvaluationBudget({ rfp, isWorkflowCollapsed = false, onComplete }: EvaluationBudgetProps) {
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [newItemCategory, setNewItemCategory] = useState<string>("");
  const [pickerKey, setPickerKey] = useState(0);
  const [newItem, setNewItem] = useState<Partial<EvaluationLineItem>>({
    description: "",
    quantity: 0,
    unit: "",
    unitPrice: "",
    totalPrice: "",
    tenantShare: 100,
    masterItemId: null,
    masterItemSnapshot: null,
    customDescription: null,
    isFixedAllowance: false,
  });
  
  // Assembly creation state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [primaryItemId, setPrimaryItemId] = useState<string | null>(null); // Track first-clicked item
  const [itemSelectionOrder, setItemSelectionOrder] = useState<string[]>([]); // Track selection order
  const [showAssemblyCreator, setShowAssemblyCreator] = useState(false);
  const [newAssemblyName, setNewAssemblyName] = useState("");
  const [newAssemblyCategory, setNewAssemblyCategory] = useState<'tenantImprovements' | 'designSoftCosts' | 'existingImprovements' | ''>('');
  
  // File attachment state for Budget Evaluation stage
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<any[]>([]);
  
  // Premises edit mode state
  const [premisesEditMode, setPremisesEditMode] = useState(false);

  // Selective import modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedImportItems, setSelectedImportItems] = useState<Set<string>>(new Set());
  const [showScopeImportModal, setShowScopeImportModal] = useState(false);
  const [selectedScopeItems, setSelectedScopeItems] = useState<Set<string>>(new Set());
  const [showDesignImportModal, setShowDesignImportModal] = useState(false);
  const [selectedDesignItems, setSelectedDesignItems] = useState<Set<string>>(new Set());
  
  // Import from RFP modal state
  const [showRfpImportModal, setShowRfpImportModal] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Mutation for logging evaluation budget history
  const logHistoryMutation = useMutation({
    mutationFn: async (historyData: { rfpId: number; reportName: string; generatedContent: string; notes?: string; budgetData?: any }) => {
      const response = await fetch(`/api/rfp-requests/${historyData.rfpId}/evaluation-budget-history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}`,
        },
        body: JSON.stringify(historyData),
      });
      
      if (!response.ok) {
        throw new Error('Failed to log evaluation budget history');
      }
      
      return response.json();
    },
    onSuccess: () => {
      // Refresh the history list after successful logging
      if (rfp?.id) {
        queryClient.invalidateQueries({ 
          queryKey: [`/api/rfp-requests/${rfp.id}/evaluation-budget-history`] 
        });
      }
    },
    onError: (error) => {
      console.error('Failed to log evaluation budget history:', error);
    },
  });

  // Load existing budget evaluation attachments
  const { data: budgetAttachments } = useQuery({
    queryKey: [`/api/rfp-requests/${rfp?.id}/evaluation-budget/attachments`],
    enabled: !!rfp?.id,
  });

  // Load property data to get total rentable area for prorated calculations
  const { data: propertyData } = useQuery({
    queryKey: [`/api/properties/${rfp?.property}`],
    enabled: !!rfp?.property,
  });

  const { data: propertyByIdData } = useQuery({
    queryKey: [`/api/properties/${rfp?.propertyId}`],
    enabled: !!rfp?.propertyId,
  });

  // For multi-building RFPs, also load all selected properties if they exist
  const { data: multiBuildingProperties } = useQuery({
    queryKey: [`/api/properties`],
    enabled: rfp?.isMultiBuilding && (!rfp?.properties || rfp?.properties?.length === 0),
    select: (allProperties: any[]) => {
      // If no specific properties selected, return the primary property
      if (!rfp?.properties || rfp?.properties.length === 0) {
        return rfp?.property ? [allProperties.find(p => p.id.toString() === rfp.property.toString())] : [];
      }
      return rfp.properties.map((propId: string) => 
        allProperties.find(p => p.id.toString() === propId.toString())
      ).filter(Boolean);
    }
  });
  


  // Load project alternates for Enhanced RFP indicator on line items
  const { data: projectAlternates = [] } = useQuery<Array<{
    id: string;
    description: string;
    masterCategoryId: number | null;
    categoryName: string | null;
  }>>({
    queryKey: [`/api/rfp-requests/${rfp?.id}/project-alternates`],
    enabled: !!rfp?.id,
  });

  // Load invitation-to-bid data to get scope of work items
  const { data: invitationToBidData } = useQuery<any>({
    queryKey: ['/api/rfp-requests', rfp?.id, 'invitation-to-bid'],
    queryFn: async () => {
      if (!rfp?.id) return null;
      const response = await fetch(`/api/rfp-requests/${rfp.id}/invitation-to-bid`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` }
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!rfp?.id,
  });

  // Set of masterCategoryIds that have alternates — used for line item indicators
  const alternateCategoryIds = useMemo(() => {
    const s = new Set<number>();
    for (const alt of projectAlternates) {
      if (alt.masterCategoryId != null) s.add(alt.masterCategoryId);
    }
    return s;
  }, [projectAlternates]);

  const scopeOfWorkItems = useMemo(() => {
    if (invitationToBidData?.scopeOfWork && Array.isArray(invitationToBidData.scopeOfWork)) {
      return invitationToBidData.scopeOfWork;
    }
    if (rfp?.scopeOfWork && Array.isArray(rfp.scopeOfWork)) {
      return rfp.scopeOfWork;
    }
    return [];
  }, [invitationToBidData, rfp]);

  // Load property existing improvements to auto-populate when relevant
  const { data: propertyImprovements, isLoading: isLoadingImprovements } = useQuery({
    queryKey: [`/api/properties/${rfp?.property}/existing-improvements`],
    enabled: !!rfp?.property,
  });

  // Load transformers for property electrical capacity
  const { data: propertyTransformers = [] } = useQuery<any[]>({
    queryKey: [`/api/properties/${rfp?.property}/transformers`],
    enabled: !!rfp?.property,
  });

  // Load main panels to calculate allocated capacity
  const { data: propertyPanels = [] } = useQuery<any[]>({
    queryKey: [`/api/properties/${rfp?.property}/main-panels`],
    enabled: !!rfp?.property,
  });

  // Calculate property electrical capacity from transformers
  // Total transformer capacity is what's available for tenant allocation
  // Panels represent the distribution infrastructure, not a reduction in capacity
  const propertyElectricalCapacity = useMemo(() => {
    const totalTransformerKva = propertyTransformers.reduce((sum: number, t: any) => sum + (t.totalCapacityKva || 0), 0);
    const totalPanelKva = propertyPanels.reduce((sum: number, p: any) => sum + (p.maxCapacityKva || 0), 0);
    
    // Available capacity is the total transformer capacity for tenant allocation
    // Panels represent distribution infrastructure, they don't reduce total capacity
    return {
      totalKva: totalTransformerKva,
      panelKva: totalPanelKva,
      availableKva: totalTransformerKva, // Full transformer capacity available for tenant allocation
      hasCapacity: totalTransformerKva > 0
    };
  }, [propertyTransformers, propertyPanels]);

  // File handling functions
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setAttachedFiles(prev => [...prev, ...files]);
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const deleteExistingAttachment = async (attachmentId: number) => {
    try {
      const response = await fetch(`/api/evaluation-budget-attachments/${attachmentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}`,
        },
      });
      
      if (!response.ok) throw new Error('Failed to delete attachment');
      
      setExistingAttachments(prev => prev.filter(att => att.id !== attachmentId));
      toast({
        title: "File Deleted",
        description: "The attachment has been removed successfully.",
        duration: 4000,
      });
    } catch (error) {
      toast({
        title: "Delete Failed",
        description: "Failed to delete the attachment. Please try again.",
        variant: "destructive",
        duration: 6000,
      });
    }
  };

  // Handle line item rollup
  const handleLineItemRollup = (
    itemId: string, 
    sourceCategory: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements',
    targetCategory: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements' | 'none'
  ) => {
    setBudgetData(prev => {
      const newLineItemRollups = { ...prev.lineItemRollups };
      
      if (targetCategory === 'none') {
        delete newLineItemRollups[itemId];
      } else {
        newLineItemRollups[itemId] = targetCategory;
      }

      return {
        ...prev,
        lineItemRollups: newLineItemRollups,
      };
    });
  };

  // Assembly helper functions with "First Click Rule"
  const handleItemSelection = (itemId: string, checked: boolean) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (checked) {
        // First Click Rule: The first item selected defines the assembly's base quantity and unit
        if (newSet.size === 0) {
          setPrimaryItemId(itemId);
          setItemSelectionOrder([itemId]);
        } else {
          setItemSelectionOrder(order => [...order, itemId]);
        }
        newSet.add(itemId);
      } else {
        newSet.delete(itemId);
        // Reset primary item if it was deselected
        if (itemId === primaryItemId) {
          const remainingItems = Array.from(newSet);
          const newOrder = itemSelectionOrder.filter(id => remainingItems.includes(id));
          setPrimaryItemId(remainingItems.length > 0 ? newOrder[0] : null);
          setItemSelectionOrder(newOrder);
        } else {
          setItemSelectionOrder(order => order.filter(id => id !== itemId));
        }
      }
      return newSet;
    });
  };

  const findItemById = (itemId: string): EvaluationLineItem | null => {
    const allItems = [
      ...budgetData.tenantImprovements,
      ...budgetData.designSoftCosts,
      ...budgetData.existingImprovements
    ];
    return allItems.find(item => item.id === itemId) || null;
  };

  const createAssembly = () => {
    if (!newAssemblyName.trim() || selectedItems.size === 0 || !newAssemblyCategory || !primaryItemId) return;

    const selectedItemsArray = Array.from(selectedItems);
    const categoryItems = budgetData[newAssemblyCategory];
    const itemsToAssemble = categoryItems.filter(item => selectedItemsArray.includes(item.id));
    
    if (itemsToAssemble.length === 0) return;

    // Find the primary item (first-clicked item that defines base quantity and unit)
    const primaryItem = itemsToAssemble.find(item => item.id === primaryItemId);
    if (!primaryItem) return;

    // Calculate totals from selected items based on tenant share percentages
    const totalPrice = itemsToAssemble.reduce((sum, item) => {
      const itemPrice = parseFloat(item.totalPrice) || 0;
      const tenantShare = (item.tenantShare || 100) / 100;
      return sum + (itemPrice * tenantShare);
    }, 0);
    
    // Check if all items have the same unit (fallback to current behavior)
    const allUnits = itemsToAssemble.map(item => item.unit.toLowerCase().trim());
    const hasMixedUnits = new Set(allUnits).size > 1;
    
    let assemblyQuantity: number;
    let assemblyUnit: string;
    let unitPrice: number;
    
    if (hasMixedUnits) {
      // REFINED LOGIC: Use primary item's quantity and unit for mixed units
      // The assembly uses the base quantity and unit from the first-clicked item
      assemblyQuantity = primaryItem.quantity;
      assemblyUnit = primaryItem.unit;
      // Calculate unit price based on total price divided by primary item's quantity
      unitPrice = assemblyQuantity > 0 ? (totalPrice / assemblyQuantity) : totalPrice;
    } else {
      // FALLBACK: For same units, use traditional summation behavior
      assemblyQuantity = itemsToAssemble.reduce((sum, item) => sum + (item.quantity || 0), 0);
      assemblyUnit = primaryItem.unit;
      unitPrice = assemblyQuantity > 0 ? (totalPrice / assemblyQuantity) : totalPrice;
    }

    // Create the assembly line item
    const assemblyLineItem: EvaluationLineItem = {
      id: `assembly_${Date.now()}`,
      description: newAssemblyName.trim(),
      quantity: assemblyQuantity, // Use primary item's quantity, not sum
      unit: assemblyUnit, // Use primary item's unit
      unitPrice: unitPrice.toFixed(2),
      totalPrice: totalPrice.toFixed(2),
      tenantShare: 100, // Assembly cost is already calculated based on tenant shares
      bidCollectionId: primaryItem.bidCollectionId,
      bidLineItemId: primaryItem.bidLineItemId,
      isRolledUp: false,
      assemblyId: undefined
    };

    // Mark selected items as part of this assembly (for visual strikethrough)
    const assemblyId = assemblyLineItem.id;

    setBudgetData(prev => {
      const categoryItems = prev[newAssemblyCategory];
      const nonAssembledItems = categoryItems.filter(item => !selectedItemsArray.includes(item.id));
      const assembledItems = categoryItems.filter(item => selectedItemsArray.includes(item.id)).map(item => ({
        ...item,
        assemblyId: assemblyId
      }));

      // Group items: non-assembled items first, then assembly line item, then assembled items
      const updatedCategory = [
        ...nonAssembledItems,
        assemblyLineItem,
        ...assembledItems
      ];

      return {
        ...prev,
        [newAssemblyCategory]: updatedCategory
      };
    });

    // Clear assembly creation state
    setSelectedItems(new Set());
    setPrimaryItemId(null);
    setItemSelectionOrder([]);
    setNewAssemblyName("");
    setNewAssemblyCategory('');
    setShowAssemblyCreator(false);
  };

  // Open selective import modal
  const openImportModal = () => {
    if (!allBidLineItems || !Array.isArray(allBidLineItems) || allBidLineItems.length === 0) {
      toast({
        title: "No Pricing Available",
        description: "No contractor or architect pricing found to import.",
        variant: "destructive",
        duration: 6000,
      });
      return;
    }
    setSelectedImportItems(new Set());
    setShowImportModal(true);
  };

  // Import selected contractor/architect pricing items
  const importSelectedItems = () => {
    if (!allBidLineItems || selectedImportItems.size === 0) return;

    const itemsToImport = allBidLineItems.filter((item: BidLineItem & { bidCollectionId: number }) => 
      selectedImportItems.has(`${item.bidCollectionId}-${item.id}`)
    );

    // Split into tagged (have masterCategoryId) and untagged
    const tagged = itemsToImport.filter((item: any) => item.masterCategoryId);
    const untagged = itemsToImport.filter((item: any) => !item.masterCategoryId);

    // Group tagged items by masterCategoryId and sum their totals
    const categoryGroups = new Map<number, { categoryName: string; total: number; firstBidCollectionId: number }>();
    for (const item of tagged as any[]) {
      const catId = item.masterCategoryId as number;
      const catName = masterCategories?.find((c: MasterCategory) => c.id === catId)?.name ?? `Category ${catId}`;
      const price = parseFloat(String(item.totalPrice || '0').replace(/[^0-9.-]/g, '')) || 0;
      if (!categoryGroups.has(catId)) {
        categoryGroups.set(catId, { categoryName: catName, total: 0, firstBidCollectionId: item.bidCollectionId });
      }
      categoryGroups.get(catId)!.total += price;
    }

    // One rollup evaluation line item per tagged category
    const taggedItems: EvaluationLineItem[] = Array.from(categoryGroups.entries()).map(([catId, g]) => ({
      id: `imported-cat-${Date.now()}-${catId}`,
      description: g.categoryName,
      quantity: 1,
      unit: "ls",
      unitPrice: g.total.toFixed(2),
      totalPrice: g.total.toFixed(2),
      tenantShare: 100,
      bidCollectionId: g.firstBidCollectionId,
      bidLineItemId: undefined,
    }));

    // Untagged items transfer individually, unchanged
    const untaggedItems: EvaluationLineItem[] = (untagged as (BidLineItem & { bidCollectionId: number })[]).map((item) => ({
      id: `imported-${Date.now()}-${item.id}`,
      description: item.description,
      quantity: typeof item.quantity === 'string' ? parseInt(item.quantity) || 1 : item.quantity || 1,
      unit: item.unit || "ea",
      unitPrice: item.unitPrice?.toString() || "0.00",
      totalPrice: item.totalPrice?.toString() || "0.00",
      tenantShare: 100,
      bidCollectionId: item.bidCollectionId,
      bidLineItemId: item.id,
      masterCategoryId: (item as any).masterCategoryId ?? null,
    }));

    const importedItems = [...taggedItems, ...untaggedItems];

    setBudgetData(prev => ({
      ...prev,
      tenantImprovements: [...prev.tenantImprovements, ...importedItems],
    }));

    const rollupMsg = taggedItems.length > 0 ? `${taggedItems.length} category rollup${taggedItems.length > 1 ? 's' : ''}` : '';
    const individualMsg = untaggedItems.length > 0 ? `${untaggedItems.length} individual item${untaggedItems.length > 1 ? 's' : ''}` : '';
    const description = [rollupMsg, individualMsg].filter(Boolean).join(' and ');

    toast({
      title: "Pricing Imported",
      description: `Successfully imported ${description}.`,
      duration: 4000,
    });

    setShowImportModal(false);
    setSelectedImportItems(new Set());
  };

  // Open scope of work import modal
  const openScopeImportModal = () => {
    if (scopeOfWorkItems.length === 0) {
      toast({
        title: "No Scope of Work Available",
        description: "No scope of work items found. Add scope items in the Invitation to Bid phase first.",
        variant: "destructive",
        duration: 6000,
      });
      return;
    }
    setSelectedScopeItems(new Set());
    setShowScopeImportModal(true);
  };

  // Import selected scope of work items
  const importSelectedScopeItems = () => {
    if (scopeOfWorkItems.length === 0 || selectedScopeItems.size === 0) return;

    const itemsToImport = scopeOfWorkItems.filter((_: any, index: number) => 
      selectedScopeItems.has(index.toString())
    );

    const importedItems = itemsToImport.map((item: any, index: number) => ({
      id: `scope-${Date.now()}-${index}`,
      description: item.description || item.item || item,
      quantity: typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1,
      unit: item.unit || "ea",
      unitPrice: "0.00",
      totalPrice: "0.00",
      tenantShare: 100,
    })) as EvaluationLineItem[];

    setBudgetData(prev => ({
      ...prev,
      tenantImprovements: [...prev.tenantImprovements, ...importedItems],
    }));

    toast({
      title: "Scope Items Imported",
      description: `Successfully imported ${importedItems.length} scope of work items.`,
      duration: 4000,
    });

    setShowScopeImportModal(false);
    setSelectedScopeItems(new Set());
  };

  // Open design cost import modal
  const openDesignImportModal = () => {
    if (!allDesignLineItems || !Array.isArray(allDesignLineItems) || allDesignLineItems.length === 0) {
      toast({
        title: "No Design Costs Available",
        description: "No architectural/design costs found to import.",
        variant: "destructive",
        duration: 6000,
      });
      return;
    }
    setSelectedDesignItems(new Set());
    setShowDesignImportModal(true);
  };

  // Import evaluation budget from another RFP
  const handleRfpImport = async (rfpId: number, categories: string[]) => {
    try {
      const response = await apiRequest(`/api/rfp-requests/${rfpId}/evaluation-budget`, "GET");
      
      if (!response) {
        throw new Error("No budget data found");
      }

      const newItems: { 
        tenantImprovements: EvaluationLineItem[];
        designSoftCosts: EvaluationLineItem[];
        existingImprovements: EvaluationLineItem[];
      } = {
        tenantImprovements: [],
        designSoftCosts: [],
        existingImprovements: [],
      };

      let totalImported = 0;

      categories.forEach(category => {
        if (response[category] && Array.isArray(response[category])) {
          const items = response[category].map((item: EvaluationLineItem, index: number) => ({
            id: `imported-${category}-${Date.now()}-${index}`,
            description: item.description,
            quantity: item.quantity || 1,
            unit: item.unit || "ea",
            unitPrice: item.unitPrice?.toString() || "0.00",
            totalPrice: item.totalPrice?.toString() || "0.00",
            tenantShare: item.tenantShare || 100,
            // Exclude bid-specific references
            bidCollectionId: undefined,
            bidLineItemId: undefined,
            // Preserve other properties
            isRolledUp: item.isRolledUp,
            rollupTarget: item.rollupTarget,
            assemblyId: undefined, // Don't copy assembly references
          }));

          newItems[category as keyof typeof newItems] = items;
          totalImported += items.length;
        }
      });

      setBudgetData(prev => ({
        ...prev,
        tenantImprovements: [...prev.tenantImprovements, ...newItems.tenantImprovements],
        designSoftCosts: [...prev.designSoftCosts, ...newItems.designSoftCosts],
        existingImprovements: [...prev.existingImprovements, ...newItems.existingImprovements],
      }));

      toast({
        title: "Budget Imported Successfully",
        description: `Imported ${totalImported} line items from selected RFP.`,
        duration: 4000,
      });
    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: "Import Failed",
        description: "Failed to import budget from selected RFP.",
        variant: "destructive",
        duration: 6000,
      });
      throw error;
    }
  };

  // Import evaluation budget from template
  const handleTemplateImport = async (templateId: string) => {
    try {
      const response = await apiRequest(`/api/templates/${templateId}/for-import`, "GET");
      
      if (!response) {
        throw new Error("No template data found");
      }

      // Fetch all ROM items for tier matching
      const romItems = await apiRequest("/api/rom-scope-items", "GET");

      // Helper function to match tiered items and select correct tier
      const applyTieredPricing = (item: any) => {
        const snapshot = item.romSnapshot;
        
        if (!snapshot || !snapshot.itemGroup) {
          return item; // No tiered pricing metadata
        }

        const areaBreakdown = rfp?.areaBreakdown || [];
        
        // Find matching area by itemGroup (e.g., "Office Area")
        const matchedArea = areaBreakdown.find((area: any) => 
          area.areaType === snapshot.itemGroup || 
          area.description?.includes(snapshot.itemGroup)
        );


        if (!matchedArea || !matchedArea.squareFootage) {
          return item; // No matching area breakdown
        }

        const sqft = parseInt(matchedArea.squareFootage.replace(/,/g, ""));
        
        // Find all ROM items with the same itemGroup
        const tieredItems = romItems.filter((romItem: any) => 
          romItem.itemGroup === snapshot.itemGroup && romItem.isActive
        );

        tieredItems.forEach((t: any) => {
        });

        // Find the tier that matches this square footage
        const matchingTier = tieredItems.find((tier: any) => {
          const minSf = tier.minSquareFootage ?? -Infinity;
          const maxSf = tier.maxSquareFootage ?? Infinity;
          const matches = sqft >= minSf && sqft <= maxSf;
          return matches;
        });


        if (matchingTier) {
          // Replace with the correct tier's pricing
          // Ensure unitPrice is a string for consistency with form handling
          const tierUnitPrice = typeof matchingTier.unitPrice === 'string' 
            ? matchingTier.unitPrice 
            : matchingTier.unitPrice.toString();
          
          
          const result = {
            ...item,
            name: matchingTier.name,
            description: matchingTier.description || item.description,
            unitPrice: tierUnitPrice,
            romSnapshot: {
              ...snapshot,
              name: matchingTier.name,
              unitPrice: matchingTier.unitPrice,
              minSquareFootage: matchingTier.minSquareFootage,
              maxSquareFootage: matchingTier.maxSquareFootage,
            },
          };
          
          return result;
        }

        return item;
      };

      // Helper function to match item with area breakdown and auto-populate quantity
      // NOTE: Only area matching happens here. Design/Permit/CM auto-calculate in real-time based on budget state.
      const autoPopulateQuantity = (item: any) => {
        const description = (item.description || "").toLowerCase();
        const areaBreakdown = rfp?.areaBreakdown || [];
        
        let quantity = item.quantity;
        // Preserve ROM pilot unit if available, otherwise use item unit
        let unit = item.romSnapshot?.unit || item.unit;
        
        // Match Demising Wall items - auto-populate with building depth
        if (description.includes("demising wall") && propertyData?.buildingDepth) {
          quantity = propertyData.buildingDepth;
          unit = "ft.";
        }
        // Match Office Area items
        else if (description.includes("office area") || description.includes("office space")) {
          const matchedArea = areaBreakdown.find((area: any) => area.areaType === "Office Area");
          if (matchedArea && matchedArea.squareFootage) {
            quantity = parseInt(matchedArea.squareFootage.replace(/,/g, ""));
          }
        }
        // Match Warehouse Office items
        else if (description.includes("warehouse office")) {
          const matchedArea = areaBreakdown.find((area: any) => area.areaType === "Warehouse Office");
          if (matchedArea && matchedArea.squareFootage) {
            quantity = parseInt(matchedArea.squareFootage.replace(/,/g, ""));
          }
        }
        // Set default quantity for Design (will be overridden in real-time)
        else if (description.includes("design") && (description.includes("architectural") || description.includes("architect"))) {
          unit = "sf.";
        }
        // Set default unit for Permit Fees and Construction Management (will be overridden in real-time)
        else if (description.includes("permit") && description.includes("fee")) {
          unit = "$";
        }
        else if (description.includes("construction") && description.includes("management")) {
          unit = "$";
        }
        
        // Normalize unit format: lowercase with period
        if (unit) {
          unit = unit.toLowerCase();
          if (!unit.endsWith('.')) {
            unit = unit + '.';
          }
        }
        
        return {
          ...item,
          quantity,
          unit,
        };
      };

      // Helper function to get sort priority for Design/Soft Costs items
      const getDesignCostPriority = (description: string): number => {
        const desc = description.toLowerCase();
        
        // Fixed ordering:
        // 1. Design (Architectural) - FIRST
        // 2. Builder's Risk Insurance - SECOND
        // 3. Permit Expediter - THIRD
        // 4. Certificate of Occupancy - FOURTH
        // 5. Permit Fees - FIFTH
        // 6. Construction Management - SECOND TO LAST (998)
        // 7. Design & Construction Contingency - LAST (999)
        
        if (desc.includes("design") && (desc.includes("architectural") || desc.includes("architect"))) return 1;
        if (desc.includes("builder") && desc.includes("risk")) return 2;
        if (desc.includes("permit expediter")) return 3;
        if (desc.includes("certificate") && desc.includes("occupancy")) return 4;
        if (desc.includes("permit") && desc.includes("fee")) return 5;
        if (desc.includes("construction") && desc.includes("management")) return 998;
        if (desc.includes("contingency")) return 999;
        
        // Default priority for other items (will be inserted between fixed items)
        return 500;
      };

      // Helper function to calculate current project total for contingency auto-population
      const calculateProjectTotal = (): number => {
        const sumItems = (items: any[]) => items.reduce((sum, item) => {
          const total = parseFloat(item.totalPrice?.toString() || "0");
          return sum + total;
        }, 0);
        
        const tiTotal = sumItems(budgetData.tenantImprovements);
        const dscTotal = sumItems(budgetData.designSoftCosts.filter((item: any) => {
          const desc = (item.description || "").toLowerCase();
          return !desc.includes("contingency"); // Exclude contingency from total
        }));
        const eiTotal = sumItems(budgetData.existingImprovements);
        
        return tiTotal + dscTotal + eiTotal;
      };

      // Auto-populate contingency with correct unit price and zero quantity (will calculate dynamically)
      const autoPopulateContingency = (item: any) => {
        const description = (item.description || "").toLowerCase();
        if (description.includes("contingency")) {
          return {
            ...item,
            unitPrice: "0.05", // 5% rate
            quantity: 0, // Will be calculated dynamically based on budget total
            unit: "$", // Percentage applied to dollar amount
          };
        }
        return item;
      };

      // Helper to recalculate totalPrice after all transformations
      const recalculateTotalPrice = (item: any) => {
        const qty = parseFloat(item.quantity) || 0;
        const unitPx = parseFloat(item.unitPrice) || 0;
        // Catalog minimum travels on romSnapshot (shared/line-total.ts).
        const totalPx = computeLineTotal({
          quantity: qty, unitPrice: unitPx, item: item.romSnapshot,
        }).total;

        return {
          ...item,
          totalPrice: totalPx.toString(),
        };
      };

      const newItems = {
        tenantImprovements: response.tenantImprovements?.map((item: any, index: number) => {
          const processed = autoPopulateQuantity(applyTieredPricing(item));
          return {
            ...recalculateTotalPrice(processed),
            id: `template-ti-${Date.now()}-${index}`,
          };
        }) || [],
        designSoftCosts: (response.designSoftCosts?.map((item: any, index: number) => {
          const processed = autoPopulateContingency(autoPopulateQuantity(applyTieredPricing(item)));
          return {
            ...recalculateTotalPrice(processed),
            id: `template-dsc-${Date.now()}-${index}`,
          };
        }) || []).sort((a: any, b: any) => {
          const priorityA = getDesignCostPriority(a.description || "");
          const priorityB = getDesignCostPriority(b.description || "");
          return priorityA - priorityB;
        }),
        existingImprovements: response.existingImprovements?.map((item: any, index: number) => {
          const processed = autoPopulateQuantity(applyTieredPricing(item));
          return {
            ...recalculateTotalPrice(processed),
            id: `template-ei-${Date.now()}-${index}`,
          };
        }) || [],
      };

      const totalImported = 
        newItems.tenantImprovements.length +
        newItems.designSoftCosts.length +
        newItems.existingImprovements.length;

      setBudgetData(prev => ({
        ...prev,
        tenantImprovements: [...prev.tenantImprovements, ...newItems.tenantImprovements],
        designSoftCosts: [...prev.designSoftCosts, ...newItems.designSoftCosts],
        existingImprovements: [...prev.existingImprovements, ...newItems.existingImprovements],
      }));

      toast({
        title: "Template Imported Successfully",
        description: `Imported ${totalImported} line items from template.`,
        duration: 4000,
      });
    } catch (error) {
      console.error('Template import error:', error);
      toast({
        title: "Import Failed",
        description: "Failed to import template.",
        variant: "destructive",
        duration: 6000,
      });
      throw error;
    }
  };

  // Import priced/unpriced line items from the current RFP's ITB Step 3 Scope of Work.
  // Mirrors handleTemplateImport's client-side post-processing pipeline (tiered pricing,
  // quantity auto-population, contingency defaults, total recalculation) so imported rows
  // behave identically regardless of source. Additive only — does not touch existing
  // handleTemplateImport, handleRfpImport, or evaluation calc bases.
  const handleScopeOfWorkImport = async () => {
    if (!rfp?.id) return;
    try {
      const response = await apiRequest(`/api/rfp-requests/${rfp.id}/evaluation-import/scope-of-work`, "GET");

      if (!response) {
        throw new Error("No scope of work data found");
      }

      if (!response.hasScopeOfWork) {
        toast({
          title: "No Scope of Work Found",
          description: "This RFP's Invitation to Bid (Step 3) has no Scope of Work line items to import.",
          duration: 5000,
        });
        return;
      }

      // Fetch all ROM items for tier matching
      const romItems = await apiRequest("/api/rom-scope-items", "GET");

      const applyTieredPricing = (item: any) => {
        const snapshot = item.romSnapshot;
        if (!snapshot || !snapshot.itemGroup) {
          return item;
        }

        const areaBreakdown = rfp?.areaBreakdown || [];
        const matchedArea = areaBreakdown.find((area: any) =>
          area.areaType === snapshot.itemGroup ||
          area.description?.includes(snapshot.itemGroup)
        );

        if (!matchedArea || !matchedArea.squareFootage) {
          return item;
        }

        const sqft = parseInt(matchedArea.squareFootage.replace(/,/g, ""));
        const tieredItems = romItems.filter((romItem: any) =>
          romItem.itemGroup === snapshot.itemGroup && romItem.isActive
        );

        const matchingTier = tieredItems.find((tier: any) => {
          const minSf = tier.minSquareFootage ?? -Infinity;
          const maxSf = tier.maxSquareFootage ?? Infinity;
          return sqft >= minSf && sqft <= maxSf;
        });

        if (matchingTier) {
          const tierUnitPrice = typeof matchingTier.unitPrice === 'string'
            ? matchingTier.unitPrice
            : matchingTier.unitPrice.toString();

          return {
            ...item,
            name: matchingTier.name,
            description: matchingTier.description || item.description,
            unitPrice: tierUnitPrice,
            romSnapshot: {
              ...snapshot,
              name: matchingTier.name,
              unitPrice: matchingTier.unitPrice,
              minSquareFootage: matchingTier.minSquareFootage,
              maxSquareFootage: matchingTier.maxSquareFootage,
            },
          };
        }

        return item;
      };

      const autoPopulateQuantity = (item: any) => {
        const description = (item.description || "").toLowerCase();
        const areaBreakdown = rfp?.areaBreakdown || [];

        let quantity = item.quantity;
        let unit = item.romSnapshot?.unit || item.unit;

        if (description.includes("demising wall") && propertyData?.buildingDepth) {
          quantity = propertyData.buildingDepth;
          unit = "ft.";
        } else if (description.includes("office area") || description.includes("office space")) {
          const matchedArea = areaBreakdown.find((area: any) => area.areaType === "Office Area");
          if (matchedArea && matchedArea.squareFootage) {
            quantity = parseInt(matchedArea.squareFootage.replace(/,/g, ""));
          }
        } else if (description.includes("warehouse office")) {
          const matchedArea = areaBreakdown.find((area: any) => area.areaType === "Warehouse Office");
          if (matchedArea && matchedArea.squareFootage) {
            quantity = parseInt(matchedArea.squareFootage.replace(/,/g, ""));
          }
        } else if (description.includes("design") && (description.includes("architectural") || description.includes("architect"))) {
          unit = "sf.";
        } else if (description.includes("permit") && description.includes("fee")) {
          unit = "$";
        } else if (description.includes("construction") && description.includes("management")) {
          unit = "$";
        }

        if (unit) {
          unit = unit.toLowerCase();
          if (!unit.endsWith('.')) {
            unit = unit + '.';
          }
        }

        return {
          ...item,
          quantity,
          unit,
        };
      };

      const getDesignCostPriority = (description: string): number => {
        const desc = description.toLowerCase();
        if (desc.includes("design") && (desc.includes("architectural") || desc.includes("architect"))) return 1;
        if (desc.includes("builder") && desc.includes("risk")) return 2;
        if (desc.includes("permit expediter")) return 3;
        if (desc.includes("certificate") && desc.includes("occupancy")) return 4;
        if (desc.includes("permit") && desc.includes("fee")) return 5;
        if (desc.includes("construction") && desc.includes("management")) return 998;
        if (desc.includes("contingency")) return 999;
        return 500;
      };

      const autoPopulateContingency = (item: any) => {
        const description = (item.description || "").toLowerCase();
        if (description.includes("contingency")) {
          return {
            ...item,
            unitPrice: "0.05",
            quantity: 0,
            unit: "$",
          };
        }
        return item;
      };

      const recalculateTotalPrice = (item: any) => {
        const qty = parseFloat(item.quantity) || 0;
        const unitPx = parseFloat(item.unitPrice) || 0;
        // Catalog minimum travels on romSnapshot (shared/line-total.ts).
        const totalPx = computeLineTotal({
          quantity: qty, unitPrice: unitPx, item: item.romSnapshot,
        }).total;
        return {
          ...item,
          totalPrice: totalPx.toString(),
        };
      };

      const newItems = {
        tenantImprovements: response.tenantImprovements?.map((item: any, index: number) => {
          const processed = autoPopulateQuantity(applyTieredPricing(item));
          return {
            ...recalculateTotalPrice(processed),
            id: `scope-ti-${Date.now()}-${index}`,
          };
        }) || [],
        designSoftCosts: (response.designSoftCosts?.map((item: any, index: number) => {
          const processed = autoPopulateContingency(autoPopulateQuantity(applyTieredPricing(item)));
          return {
            ...recalculateTotalPrice(processed),
            id: `scope-dsc-${Date.now()}-${index}`,
          };
        }) || []).sort((a: any, b: any) => {
          const priorityA = getDesignCostPriority(a.description || "");
          const priorityB = getDesignCostPriority(b.description || "");
          return priorityA - priorityB;
        }),
        existingImprovements: response.existingImprovements?.map((item: any, index: number) => {
          const processed = autoPopulateQuantity(applyTieredPricing(item));
          return {
            ...recalculateTotalPrice(processed),
            id: `scope-ei-${Date.now()}-${index}`,
          };
        }) || [],
      };

      const totalImported =
        newItems.tenantImprovements.length +
        newItems.designSoftCosts.length +
        newItems.existingImprovements.length;

      setBudgetData(prev => ({
        ...prev,
        tenantImprovements: [...prev.tenantImprovements, ...newItems.tenantImprovements],
        designSoftCosts: [...prev.designSoftCosts, ...newItems.designSoftCosts],
        existingImprovements: [...prev.existingImprovements, ...newItems.existingImprovements],
      }));

      const unpricedNote = response.unpricedCount > 0
        ? ` ${response.unpricedCount} unpriced item(s) were imported with $0 unit price — please review.`
        : "";

      const unknownCategoryNames: string[] = Array.isArray(response.flaggedUnknownCategory)
        ? response.flaggedUnknownCategory.map((item: any) =>
            typeof item === "string" ? item : (item?.description || item?.name || "Unnamed item")
          )
        : [];
      const unknownCategoryNote = unknownCategoryNames.length > 0
        ? ` ${unknownCategoryNames.length} item(s) had an unrecognized category and were placed in Tenant Improvements: ${unknownCategoryNames.join(", ")}.`
        : "";

      toast({
        title: "Scope of Work Imported",
        description: `Imported ${totalImported} line item(s) from Invitation to Bid Scope of Work.${unpricedNote}${unknownCategoryNote}`,
        duration: 6000,
      });
    } catch (error) {
      console.error('Scope of Work import error:', error);
      toast({
        title: "Import Failed",
        description: "Failed to import from Scope of Work.",
        variant: "destructive",
        duration: 6000,
      });
      throw error;
    }
  };

  // Import selected design costs
  const importSelectedDesignItems = () => {
    if (!allDesignLineItems || selectedDesignItems.size === 0) return;

    const itemsToImport = allDesignLineItems.filter((item: any, index: number) => 
      selectedDesignItems.has(`${item.bidCollectionId}-${item.id}`)
    );

    const importedItems = itemsToImport.map((item: any) => ({
      id: `design-${Date.now()}-${item.id}`,
      description: item.description,
      quantity: parseFloat(item.quantity) || 1,
      unit: item.unit || "ea",
      unitPrice: item.unitPrice || "0.00",
      totalPrice: item.totalPrice || "0.00",
      tenantShare: 100, // Default to 100% tenant responsibility
      bidCollectionId: item.bidCollectionId,
      bidLineItemId: item.id,
    })) as EvaluationLineItem[];

    setBudgetData(prev => ({
      ...prev,
      designSoftCosts: [...prev.designSoftCosts, ...importedItems],
    }));

    toast({
      title: "Design Costs Imported",
      description: `Successfully imported ${importedItems.length} design/architectural cost items.`,
      duration: 4000,
    });

    setShowDesignImportModal(false);
    setSelectedDesignItems(new Set());
  };

  // Load existing evaluation budget data
  const { data: existingBudget } = useQuery({
    queryKey: [`/api/rfp-requests/${rfp?.id}/evaluation-budget`],
    enabled: !!rfp?.id,
  });

  // Load existing bid collections to populate initial budget
  const { data: bidCollections } = useQuery({
    queryKey: [`/api/rfp-requests/${rfp?.id}/bid-collections`],
    enabled: !!rfp?.id,
  });

  // Load bid line items for each bid collection
  const { data: allBidLineItems } = useQuery({
    queryKey: [`/api/bid-line-items`, rfp?.id],
    queryFn: async () => {
      if (!bidCollections || !Array.isArray(bidCollections)) return [];
      
      const lineItemPromises = bidCollections.map(async (bid: BidCollection) => {
        const response = await fetch(`/api/bid-collections/${bid.id}/line-items`, {
          credentials: 'include',
          headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` }
        });
        if (!response.ok) return [];
        const lineItems = await response.json();
        return lineItems.map((item: BidLineItem) => ({ 
          ...item, 
          bidCollectionId: bid.id,
          source: `${bid.contractorName || bid.architectName}`,
          costCategory: bid.costCategory
        }));
      });
      
      const results = await Promise.all(lineItemPromises);
      return results.flat();
    },
    enabled: !!bidCollections && Array.isArray(bidCollections) && bidCollections.length > 0,
  });

  // Fetch master categories for grouped import rollups
  const { data: masterCategories } = useQuery<MasterCategory[]>({
    queryKey: ['/api/master-categories'],
  });

  // Filter only design/architectural costs for design import
  const allDesignLineItems = allBidLineItems?.filter((item: any) => 
    item.costCategory === 'architectural'
  ) || [];

  // State for budget data
  const [budgetData, setBudgetData] = useState<EvaluationBudgetData>({
    tenantImprovements: [],
    designSoftCosts: [],
    existingImprovements: [],
    hasExistingImprovements: false,
    includeExistingInTotal: false,
    separateDesignCosts: false,
    totalTenantImprovements: "0.00",
    totalDesignSoftCosts: "0.00", 
    totalExistingImprovements: "0.00",
    grandTotal: "0.00",
    notes: "",
    lineItemRollups: {},
    customAssemblies: [],
    assemblies: {},
    oversizedDoors: 0,
    regularDoors: 0,
    vehicularParking: 0,
    trailerParking: 0,
    electricalAllocation: 0,
    calculatedElectricalAllocation: 0,
    electricalAllocationOverride: null,
    oversizedDoorsOverride: null,
    regularDoorsOverride: null,
    tenantVoltage: "480",
    electricalAllocations: [],
  });

  // Track which items have been manually overridden (won't auto-calculate)
  const [manualOverrides, setManualOverrides] = useState<Set<string>>(new Set());

  // Helper function to calculate rentable area from selected bays
  const calculateRentableArea = (): number => {
    // Per-bay fallback to squareFootage. rentableSquareFootage is null on plenty
    // of bay records (older and property-sourced ones), and summing only that
    // field returned 0 for the whole RFP - which hid the Rentable Area readout
    // entirely, since it is rendered only when the value is truthy. Every other
    // call site in the app already uses `rentableSquareFootage || squareFootage`.
    if (rfp?.selectedBayConfigurations && Array.isArray(rfp.selectedBayConfigurations) && rfp.selectedBayConfigurations.length > 0) {
      const fromBays = resolveRfpRentableArea({
        selectedBays: rfp.selectedBayConfigurations,
        allPropertyBays: (propertyData as any)?.bayConfigurations,
        mechanicalRoomSf: (propertyData as any)?.mechanicalRoomSquareFootage,
        propertyName: (propertyData as any)?.propertyName,
      }).rentableSf;
      // Fall THROUGH to warehouseArea when the bays sum to nothing, rather than
      // returning 0 - previously an empty bay list short-circuited the fallback.
      if (fromBays > 0) return fromBays;
    }
    if (rfp?.warehouseArea) {
      // parseFloat, not parseInt: "397,164 SF" truncates to 397 under parseInt.
      const parsed = parseFloat(rfp.warehouseArea.toString().replace(/[^0-9.]/g, ''));
      return isNaN(parsed) ? 0 : Math.round(parsed);
    }
    return 0;
  };

  // Auto-calculate special fields (Design, Permit Fees, Construction Management, Contingency)
  useEffect(() => {
    if (budgetData.designSoftCosts.length === 0) return;

    // Use the shared helper so this effect, the header readout, and
    // RecordProjectActuals all agree. The old inline version summed only
    // rentableSquareFootage and returned 0 whenever that field was null.
    const totalRentableArea = calculateRentableArea();

    // Calculate TI total
    const tiTotal = budgetData.tenantImprovements.reduce((sum, item) => {
      const total = parseFloat(item.totalPrice?.toString() || "0");
      return sum + total;
    }, 0);

    // Pre-calculate what Design (Architectural) will be
    const designItem = budgetData.designSoftCosts.find(item => {
      const desc = (item.description || "").toLowerCase();
      return desc.includes("design") && (desc.includes("architectural") || desc.includes("architect"));
    });
    const designUnitPrice = designItem ? parseFloat(designItem.unitPrice || "0") : 0;

    // The Design figure that feeds cmBase must be what the Design line ACTUALLY
    // totals, not what it would total if auto-calculated.
    //
    // Previously this was always totalRentableArea * designUnitPrice. When Design
    // is manually overridden to a lump sum - "1 ls @ $55,000" - that formula
    // re-reads the $55,000 as a per-SF rate and produces 32,025 x 55,000 =
    // $1,761,375,000, which then became the Construction Management base and
    // cascaded into Contingency. Observed 2026-07-31: CM billed $48,480,320.86
    // against a correct value of $44,020.86.
    //
    // When the line is overridden, trust its stored total. Only compute when this
    // effect is actually the thing that will set it.
    const designIsOverridden = designItem ? manualOverrides.has(designItem.id) : false;
    const calculatedDesignTotal = !designItem
      ? 0
      : designIsOverridden
        ? parseFloat(designItem.totalPrice?.toString() || "0")
        : totalRentableArea * designUnitPrice;

    // Calculate DSC total (excluding Design, CM, and Contingency for CM base calculation)
    const dscBeforeCM = budgetData.designSoftCosts
      .filter(item => {
        const desc = (item.description || "").toLowerCase();
        return !desc.includes("contingency") && 
               !(desc.includes("construction") && desc.includes("management")) &&
               !(desc.includes("design") && (desc.includes("architectural") || desc.includes("architect")));
      })
      .reduce((sum, item) => {
        const total = parseFloat(item.totalPrice?.toString() || "0");
        return sum + total;
      }, 0);

    // Base for CM calculation (TI + calculated Design + other DSC before CM)
    const cmBase = tiTotal + calculatedDesignTotal + dscBeforeCM;

    // Update design/soft costs with auto-calculations
    // First pass: update all items except Contingency (which needs CM to be calculated first)
    let updatedDesignSoftCosts = budgetData.designSoftCosts.map(item => {
      const desc = (item.description || "").toLowerCase();
      const itemId = item.id;

      // Skip if manually overridden
      if (manualOverrides.has(itemId)) {
        return item;
      }

      // Design (Architectural) - auto-populate with total rentable area
      if (desc.includes("design") && (desc.includes("architectural") || desc.includes("architect"))) {
        const newQty = totalRentableArea;
        const unitPx = parseFloat(item.unitPrice || "0");
        // These auto-populate branches compute base x rate and ASSIGN over
        // totalPrice, bypassing computeLineTotal — so the catalog minimum has to
        // be applied here too, or it is lost (builder's risk minimum premium,
        // demising wall 200 LF minimum). See shared/line-total.ts.
        const newTotal = applyFeeMinimum(newQty * unitPx, item).total.toString();
        
        // Only update if different
        if (item.quantity !== newQty || item.totalPrice !== newTotal) {
          return {
            ...item,
            quantity: newQty,
            totalPrice: newTotal,
          };
        }
      }

      // Builder's Risk Insurance - auto-populate with TI total (same as Permit Fees)
      // Now basis-aware: if the catalog item has an explicit calculationBasis, honor
      // it (lump-sum/manual = leave quantity alone; pct-* = use the matching total).
      // Falls back to description-matching only when no basis is set.
      if (desc.includes("builder") && desc.includes("risk")) {
        const basis = (item.masterItemSnapshot?.calculationBasis || "").toString();
        // Explicit lump-sum or manual: do NOT auto-populate — respect the user's quantity.
        if (basis === "lump-sum" || basis === "manual") {
          return item;
        }
        // Explicit basis picks the total; otherwise default to TI total (legacy behavior).
        const newQty =
          // Q1 (Adolfo 2026-08-03): "construction total" = TI HARD COSTS ONLY.
          // Was cmBase (TI + design + other soft costs), which contradicted the
          // permit-base decision and disagreed with the server. shared/fee-bases.ts
          basis === "pct-construction-total" ? tiTotal :
          basis === "pct-rentable-sf" ? totalRentableArea :
          tiTotal;
        const unitPx = parseFloat(item.unitPrice || "0");
        // These auto-populate branches compute base x rate and ASSIGN over
        // totalPrice, bypassing computeLineTotal — so the catalog minimum has to
        // be applied here too, or it is lost (builder's risk minimum premium,
        // demising wall 200 LF minimum). See shared/line-total.ts.
        const newTotal = applyFeeMinimum(newQty * unitPx, item).total.toString();

        if (item.quantity !== newQty || item.totalPrice !== newTotal) {
          return {
            ...item,
            quantity: newQty,
            totalPrice: newTotal,
          };
        }
      }

      // Permit Fees - auto-populate with TI total (basis-aware; legacy default = TI total)
      if (desc.includes("permit") && desc.includes("fee")) {
        const basis = (item.masterItemSnapshot?.calculationBasis || "").toString();
        if (basis === "lump-sum" || basis === "manual") {
          return item;
        }
        const newQty =
          // Q1 (Adolfo 2026-08-03): "construction total" = TI HARD COSTS ONLY.
          // Was cmBase (TI + design + other soft costs), which contradicted the
          // permit-base decision and disagreed with the server. shared/fee-bases.ts
          basis === "pct-construction-total" ? tiTotal :
          basis === "pct-rentable-sf" ? totalRentableArea :
          tiTotal;
        const unitPx = parseFloat(item.unitPrice || "0");
        // These auto-populate branches compute base x rate and ASSIGN over
        // totalPrice, bypassing computeLineTotal — so the catalog minimum has to
        // be applied here too, or it is lost (builder's risk minimum premium,
        // demising wall 200 LF minimum). See shared/line-total.ts.
        const newTotal = applyFeeMinimum(newQty * unitPx, item).total.toString();

        if (item.quantity !== newQty || item.totalPrice !== newTotal) {
          return {
            ...item,
            quantity: newQty,
            totalPrice: newTotal,
          };
        }
      }

      // Construction Management - auto-populate with TI + DSC (basis-aware; legacy default = cmBase)
      if (desc.includes("construction") && desc.includes("management")) {
        const basis = (item.masterItemSnapshot?.calculationBasis || "").toString();
        if (basis === "lump-sum" || basis === "manual") {
          return item;
        }
        const newQty =
          basis === "pct-ti-total" ? tiTotal :
          basis === "pct-rentable-sf" ? totalRentableArea :
          cmBase;
        const unitPx = parseFloat(item.unitPrice || "0");
        // These auto-populate branches compute base x rate and ASSIGN over
        // totalPrice, bypassing computeLineTotal — so the catalog minimum has to
        // be applied here too, or it is lost (builder's risk minimum premium,
        // demising wall 200 LF minimum). See shared/line-total.ts.
        const newTotal = applyFeeMinimum(newQty * unitPx, item).total.toString();

        if (item.quantity !== newQty || item.totalPrice !== newTotal) {
          return {
            ...item,
            quantity: newQty,
            totalPrice: newTotal,
          };
        }
      }

      // Skip Contingency in first pass - will calculate after CM is updated
      if (desc.includes("contingency")) {
        return item;
      }

      return item;
    });

    // Second pass: Calculate contingency base including the newly calculated CM AND Design
    // IMPORTANT: Contingency base includes EVERYTHING except Contingency itself
    const dscBeforeContingency = updatedDesignSoftCosts
      .filter(item => {
        const desc = (item.description || "").toLowerCase();
        return !desc.includes("contingency");
      })
      .reduce((sum, item) => {
        const total = parseFloat(item.totalPrice?.toString() || "0");
        return sum + total;
      }, 0);

    // Base for contingency calculation (TI + ALL DSC including Design and CM, excluding only Contingency)
    const contingencyBase = tiTotal + dscBeforeContingency;

    // Update Contingency with the correct base
    updatedDesignSoftCosts = updatedDesignSoftCosts.map(item => {
      const desc = (item.description || "").toLowerCase();
      const itemId = item.id;

      // Only process Contingency in this pass
      if (desc.includes("contingency")) {
        // Skip if manually overridden
        if (manualOverrides.has(itemId)) {
          return item;
        }

        // Basis-aware: lump-sum/manual leave quantity alone; pct-* pick the total.
        // Legacy default = contingencyBase (TI + all DSC except contingency itself).
        const basis = (item.masterItemSnapshot?.calculationBasis || "").toString();
        if (basis === "lump-sum" || basis === "manual") {
          return item;
        }
        const newQty =
          basis === "pct-ti-total" ? tiTotal :
          basis === "pct-rentable-sf" ? totalRentableArea :
          contingencyBase;
        const unitPx = parseFloat(item.unitPrice || "0");
        // These auto-populate branches compute base x rate and ASSIGN over
        // totalPrice, bypassing computeLineTotal — so the catalog minimum has to
        // be applied here too, or it is lost (builder's risk minimum premium,
        // demising wall 200 LF minimum). See shared/line-total.ts.
        const newTotal = applyFeeMinimum(newQty * unitPx, item).total.toString();

        if (item.quantity !== newQty || item.totalPrice !== newTotal) {
          return {
            ...item,
            quantity: newQty,
            totalPrice: newTotal,
          };
        }
      }

      return item;
    });

    // Only update if something actually changed
    const hasChanges = JSON.stringify(updatedDesignSoftCosts) !== JSON.stringify(budgetData.designSoftCosts);
    
    if (hasChanges) {
      setBudgetData(prev => ({
        ...prev,
        designSoftCosts: updatedDesignSoftCosts,
      }));
    }
  }, [
    budgetData.tenantImprovements.length,
    budgetData.tenantImprovements.reduce((sum, i) => sum + parseFloat(i.totalPrice?.toString() || "0"), 0),
    budgetData.existingImprovements.length,
    budgetData.designSoftCosts.length,
    budgetData.designSoftCosts.reduce((sum, i) => sum + parseFloat(i.totalPrice?.toString() || "0"), 0),
    rfp?.selectedBayConfigurations?.length || 0,
    rfp?.selectedBayConfigurations?.reduce((total, bay) => total + (bay.rentableSquareFootage || bay.squareFootage || 0), 0) || 0,
    manualOverrides
  ]);

  // Calculate door counts from bay configuration data
  const calculateDoorCounts = () => {
    if (!rfp?.selectedBayConfigurations) return { oversized: 0, regular: 0 };
    
    let oversizedTotal = rfp.selectedBayConfigurations.reduce((sum, bay) => sum + ((bay as any).oversizedDockDoors || 0), 0);
    let regularTotal = rfp.selectedBayConfigurations.reduce((sum, bay) => sum + ((bay as any).standardDockDoors || 0), 0);

    // First fallback: check split door fields on each bay
    if (oversizedTotal === 0 && regularTotal === 0) {
      oversizedTotal = rfp.selectedBayConfigurations.reduce((sum, bay: any) =>
        sum + (bay.splitNorthOversizedDoors || 0) + (bay.splitSouthOversizedDoors || 0), 0);
      regularTotal = rfp.selectedBayConfigurations.reduce((sum, bay: any) =>
        sum + (bay.splitNorthDockDoors || 0) + (bay.splitSouthDockDoors || 0), 0);
    }

    // Second fallback: proportional share from property-level bay configurations
    if (oversizedTotal === 0 && regularTotal === 0) {
      const activePropertyData = rfp?.isMultiBuilding
        ? (multiBuildingProperties?.[0] || propertyData)
        : propertyData;
      const property = activePropertyData as any;
      if (property?.bayConfigurations && property.bayConfigurations.length > 0) {
        // sumBayArea: dedupes parent+halves and uses raw bay SF, so the door
        // proration is against a real share rather than an inflated one.
        const tenantSF = sumBayArea(rfp.selectedBayConfigurations as any);
        const totalPropertySF = property.bayConfigurations.reduce((total: number, bay: any) => total + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
        if (totalPropertySF > 0 && tenantSF > 0) {
          const proportion = tenantSF / totalPropertySF;
          const totalOversized = property.bayConfigurations.reduce((sum: number, bay: any) => sum + (bay.oversizedDockDoors || 0), 0);
          const totalRegular = property.bayConfigurations.reduce((sum: number, bay: any) => sum + (bay.standardDockDoors || 0), 0);
          return {
            oversized: Math.round(totalOversized * proportion),
            regular: Math.round(totalRegular * proportion),
          };
        }
      }
    }

    // Third fallback: match selectedBayIds against propertyByIdData bay configurations (split-bay RFPs)
    // Handles _north/_south suffixed IDs by reading split-specific door fields
    if (oversizedTotal === 0 && regularTotal === 0 && rfp.selectedBayIds && Array.isArray(rfp.selectedBayIds) && rfp.selectedBayIds.length > 0 && (propertyByIdData as any)?.bayConfigurations) {
      const allPropertyBays = (propertyByIdData as any).bayConfigurations;
      for (const selectedId of rfp.selectedBayIds) {
        const idStr = String(selectedId);
        const isNorth = idStr.endsWith('_north');
        const isSouth = idStr.endsWith('_south');
        if (isNorth || isSouth) {
          const baseId = idStr.replace(/_north$|_south$/, '');
          const bay = allPropertyBays.find((b: any) => String(b.id) === baseId);
          if (bay) {
            if (isNorth) {
              regularTotal += bay.splitNorthDockDoors || 0;
              oversizedTotal += bay.splitNorthOversizedDoors || 0;
            } else {
              regularTotal += bay.splitSouthDockDoors || 0;
              oversizedTotal += bay.splitSouthOversizedDoors || 0;
            }
          }
        } else {
          const bay = allPropertyBays.find((b: any) => String(b.id) === idStr);
          if (bay) {
            regularTotal += bay.standardDockDoors || 0;
            oversizedTotal += bay.oversizedDockDoors || 0;
          }
        }
      }
    }

    return { oversized: oversizedTotal, regular: regularTotal };
  };

  // Calculate parking counts based on tenant's allocated area
  const calculateParkingCounts = () => {
    // For multi-building RFPs, get property data from primary property or multi-building data
    // Fall back to propertyByIdData (fetched by integer propertyId) if property-name query returns nothing
    const activePropertyData = rfp?.isMultiBuilding 
      ? (multiBuildingProperties?.[0] || propertyData)
      : (propertyData || propertyByIdData);

    if (!activePropertyData || !rfp?.selectedBayConfigurations) {
      return { vehicular: 0, trailer: 0 };
    }
    
    const property = activePropertyData as any;
    
    // Calculate tenant's rentable area from selected bays
    // shared/area-utils. This summed rentableSquareFootage - which on split
    // halves ALREADY includes that half's mechanical allocation - and then added
    // rfp.mechanicalRoomArea on top, counting the mechanical room twice.
    const tenantRentableArea = resolveRfpRentableArea({
      selectedBays: rfp.selectedBayConfigurations,
      allPropertyBays: property?.bayConfigurations,
      mechanicalRoomSf: property?.mechanicalRoomSquareFootage,
      propertyName: property?.propertyName,
      propertyId: property?.id,
    }).rentableSf;
    
    // Get total property rentable area - calculate from bay configurations
    const totalPropertyArea = property.bayConfigurations 
      ? property.bayConfigurations.reduce((total: number, bay: any) => {
          return total + (bay.rentableSquareFootage || bay.squareFootage || 0);
        }, 0)
      : 0;
    
    
    // Fallback 1: if tenant area is 0, match selectedBayIds against property bayConfigurations
    let effectiveTenantArea = tenantRentableArea;
    if (effectiveTenantArea === 0 && rfp.selectedBayIds && Array.isArray(rfp.selectedBayIds) && rfp.selectedBayIds.length > 0 && property.bayConfigurations) {
      const matchedBays = property.bayConfigurations.filter((bay: any) => rfp.selectedBayIds!.includes(bay.id));
      effectiveTenantArea = matchedBays.reduce((total: number, bay: any) => total + (bay.rentableSquareFootage || bay.squareFootage || 0), 0) + (rfp.mechanicalRoomArea || 0);
    }
    // Fallback 2: use rfp.projectArea if still 0 (parse string like "258,447 SF (...)" to plain number)
    if (effectiveTenantArea === 0 && (rfp as any).projectArea) {
      const rawProjectArea = (rfp as any).projectArea;
      effectiveTenantArea = typeof rawProjectArea === 'number'
        ? rawProjectArea
        : parseFloat(String(rawProjectArea).replace(/[^0-9.]/g, '')) || 0;
    }
    // Fallback 3: sum selectedBaysPerBuilding if still 0
    if (effectiveTenantArea === 0 && (rfp as any).selectedBaysPerBuilding && Array.isArray((rfp as any).selectedBaysPerBuilding)) {
      effectiveTenantArea = (rfp as any).selectedBaysPerBuilding.reduce((total: number, b: any) => total + (b.rentableSquareFootage || b.squareFootage || 0), 0);
    }

    if (totalPropertyArea === 0 || effectiveTenantArea === 0) {
      return { vehicular: 0, trailer: 0 };
    }
    
    // Calculate tenant's percentage of the property
    const tenantPercentage = effectiveTenantArea / totalPropertyArea;
    
    // Calculate proportional parking allocation
    const totalVehicularParking = (property.standardParking || 0) + (property.accessibleParking || 0) + (property.evParking || 0);
    const totalTrailerParking = property.trailerParking || 0;
    
    const allocatedVehicular = Math.round(totalVehicularParking * tenantPercentage);
    const allocatedTrailer = Math.round(totalTrailerParking * tenantPercentage);
    
    
    return { vehicular: allocatedVehicular, trailer: allocatedTrailer };
  };

  // Calculate proportional electrical allocation based on tenant SF percentage
  const calculateElectricalAllocation = () => {
    const activePropertyData = rfp?.isMultiBuilding 
      ? (multiBuildingProperties?.[0] || propertyData)
      : propertyData;

    if (!activePropertyData || !rfp?.selectedBayConfigurations) {
      return 0;
    }
    
    const property = activePropertyData as any;
    
    // Calculate tenant's rentable area from selected bays
    // shared/area-utils. This summed rentableSquareFootage - which on split
    // halves ALREADY includes that half's mechanical allocation - and then added
    // rfp.mechanicalRoomArea on top, counting the mechanical room twice.
    const tenantRentableArea = resolveRfpRentableArea({
      selectedBays: rfp.selectedBayConfigurations,
      allPropertyBays: property?.bayConfigurations,
      mechanicalRoomSf: property?.mechanicalRoomSquareFootage,
      propertyName: property?.propertyName,
      propertyId: property?.id,
    }).rentableSf;
    
    // Get total property rentable area from bay configurations
    const totalPropertyArea = property.bayConfigurations 
      ? property.bayConfigurations.reduce((total: number, bay: any) => {
          return total + (bay.rentableSquareFootage || bay.squareFootage || 0);
        }, 0)
      : 0;
    
    if (totalPropertyArea === 0 || tenantRentableArea === 0) {
      return 0;
    }
    
    // Calculate tenant's percentage of the property
    const tenantPercentage = tenantRentableArea / totalPropertyArea;
    
    // Delegates to shared/electrical-utils so this screen, the RFP validation
    // modal, and the lease form all produce the same number for the same tenant.
    // This was a fourth independent implementation.
    //
    // It also rounded UP (Math.ceil), where the other surfaces round DOWN, so the
    // same tenant on the same deal read 1,000 A here and 800 A there on a 1,800 A
    // building at 50% with a 200 A increment. Down is correct: rounding up
    // over-commits, and if every tenant is rounded up the building promises more
    // amps than it has. The figure stays editable.
    //
    // Note the unit change - tenantPercentage above is a 0-1 fraction, the helper
    // takes 0-100.
    return defaultElectricalAllocation({
      buildingTotalAmps: property.electricalAllocation || 0,
      tenantSharePercent: tenantPercentage * 100,
      increment: property.electricalAllocationIncrement || 200,
      minimum: property.electricalAllocationMinimum ?? 200,
    });
  };

  // Auto-calculate demising wall quantities when building depth changes or items are added
  useEffect(() => {
    if (!propertyData?.buildingDepth || budgetData.tenantImprovements.length === 0) return;

    const buildingDepth = propertyData.buildingDepth;
    
    // Update tenant improvements with demising wall auto-calculations
    const updatedTenantImprovements = budgetData.tenantImprovements.map(item => {
      const desc = (item.description || "").toLowerCase();
      const itemId = item.id;

      // Skip if manually overridden
      if (manualOverrides.has(itemId)) {
        return item;
      }

      // Demising Wall - auto-populate with building depth
      if (desc.includes("demising wall")) {
        const newQty = buildingDepth;
        const unitPx = parseFloat(item.unitPrice || "0");
        // These auto-populate branches compute base x rate and ASSIGN over
        // totalPrice, bypassing computeLineTotal — so the catalog minimum has to
        // be applied here too, or it is lost (builder's risk minimum premium,
        // demising wall 200 LF minimum). See shared/line-total.ts.
        const newTotal = applyFeeMinimum(newQty * unitPx, item).total.toString();
        
        // Only update if different
        if (item.quantity !== newQty || item.totalPrice !== newTotal) {
          return {
            ...item,
            quantity: newQty,
            unit: "ft.",
            totalPrice: newTotal,
          };
        }
      }

      return item;
    });

    // Only update if something actually changed
    const hasChanges = JSON.stringify(updatedTenantImprovements) !== JSON.stringify(budgetData.tenantImprovements);
    
    if (hasChanges) {
      setBudgetData(prev => ({
        ...prev,
        tenantImprovements: updatedTenantImprovements,
      }));
    }
  }, [
    propertyData?.buildingDepth,
    budgetData.tenantImprovements,
    manualOverrides
  ]);

  // Update budgetData door and parking counts when RFP data changes
  // This must run AFTER initial load to override any saved door counts with current calculation
  useEffect(() => {
    if (rfp && rfp.selectedBayConfigurations) {
      const doorCounts = calculateDoorCounts();
      const parkingCounts = calculateParkingCounts();
      const calculatedElectrical = calculateElectricalAllocation();
      
      
      setBudgetData(prev => {
        // Preserve existing override if set, otherwise use calculated value
        const existingOverride = prev.electricalAllocationOverride;
        const effectiveElectrical = existingOverride !== null ? existingOverride : calculatedElectrical;
        
        // Doors follow the same rule as electrical directly above: a manual entry
        // wins over the recalculated value. Previously doorCounts overwrote them
        // unconditionally, so an edit made in the premises panel was discarded the
        // next time this effect ran - the counts looked right until save.
        return {
          ...prev,
          oversizedDoors: prev.oversizedDoorsOverride ?? doorCounts.oversized,
          regularDoors: prev.regularDoorsOverride ?? doorCounts.regular,
          vehicularParking: parkingCounts.vehicular,
          trailerParking: parkingCounts.trailer,
          calculatedElectricalAllocation: calculatedElectrical,
          electricalAllocation: effectiveElectrical,
        };
      });
    }
  }, [rfp?.selectedBayConfigurations, propertyData, existingBudget]);

  // Function to auto-populate existing improvements based on selected bays
  const populateExistingImprovements = () => {
    if (!propertyImprovements) {
      return [];
    }

    // 🔍 DEBUG: Log property improvements data from API

    const selectedBayIds = ((rfp?.selectedBayConfigurations?.length ?? 0) > 0
      ? rfp!.selectedBayConfigurations!.map(bay => bay.id)
      : rfp?.selectedBayIds) || [];
    const normalizedSelectedBayIds = selectedBayIds.map((id: any) => String(id).replace(/_north$|_south$/i, ''));
    
    // Calculate tenant area using legally compliant totals
    // ALWAYS calculate from LIVE bay configurations (Properties is single source of truth)
    let totalSelectedArea = 0;
    if (rfp?.selectedBayConfigurations && rfp.selectedBayConfigurations.length > 0) {
      // Use legal compliance totals based on property name
      // PROPERTY_LEGAL_TOTALS_BY_ID from shared/area-utils. The inline map here was
      // keyed by NAME and the portfolio has been renamed to Kurv, so it stopped
      // matching entirely and fell through to the raw bay sum - silently.
      
      // Get legally compliant total for this property using property name from propertyData
      const propertyName = propertyData?.propertyName || '';
      const legalTotal = PROPERTY_LEGAL_TOTALS_BY_ID[Number((propertyData as any)?.id)];
      if (legalTotal && rfp.selectedBayConfigurations.length > 0) {
        // Use legal total if we have all bays selected or close to full property
        const rawTotal = resolveRfpRentableArea({
          selectedBays: rfp.selectedBayConfigurations,
          allPropertyBays: (propertyData as any)?.bayConfigurations,
          mechanicalRoomSf: (propertyData as any)?.mechanicalRoomSquareFootage,
        }).rentableSf;
        // If raw total is close to legal total (within 100 SF), use legal total for accuracy
        if (Math.abs(rawTotal - legalTotal) <= 100) {
          totalSelectedArea = legalTotal;
        } else {
          // For partial selections, use calculated total
          totalSelectedArea = Math.round(rawTotal);
        }
      } else {
        // Fallback to calculated total if no legal total available
        totalSelectedArea = resolveRfpRentableArea({
          selectedBays: rfp.selectedBayConfigurations,
          allPropertyBays: (propertyData as any)?.bayConfigurations,
          mechanicalRoomSf: (propertyData as any)?.mechanicalRoomSquareFootage,
          propertyName: (propertyData as any)?.propertyName,
          propertyId: (propertyData as any)?.id,
        }).rentableSf;
      }
    } else if (rfp?.warehouseArea) {
      // Final fallback to stored warehouseArea only if no bay configurations
      totalSelectedArea = parseFloat(rfp.warehouseArea.toString().replace(/[^0-9.]/g, ''));
    }
    
    const seenIds = new Set<number>();
    const result = propertyImprovements
      .filter((improvement: any) => {
        // Include improvement if it's active and relevant to selected bays
        if (!improvement.isActive) return false;
        
        if (improvement.allocationType === 'whole-property') {
          return true; // Always include whole-property improvements
        }
        
        if (improvement.allocationType === 'bay-specific') {
          // Include if any applicable bays are in our selection (normalize IDs to strip _north/_south suffixes)
          const matchFound = improvement.applicableBays?.some((bayId: any) => {
            const rawId = String(bayId);
            const strippedId = rawId.replace(/_north$/i, '').replace(/_south$/i, '');
            return selectedBayIds.map(String).includes(rawId) ||
              selectedBayIds.map(String).includes(strippedId) ||
              normalizedSelectedBayIds.includes(rawId) ||
              normalizedSelectedBayIds.includes(strippedId);
          });
          if (matchFound && seenIds.has(improvement.id)) return false;
          if (matchFound) seenIds.add(improvement.id);
          return matchFound;
        }
        
        if (improvement.allocationType === 'prorated') {
          return true; // Include prorated improvements (will be calculated proportionally)
        }
        
        if (improvement.allocationType === 'demising-wall') {
          // Include demising wall if either the left or right bay is in our selection
          const demisingData = improvement.demisingWallData;
          if (demisingData) {
            const hasLeftBay = demisingData.leftBayId && normalizedSelectedBayIds.includes(String(demisingData.leftBayId));
            const hasRightBay = demisingData.rightBayId && normalizedSelectedBayIds.includes(String(demisingData.rightBayId));
            return hasLeftBay || hasRightBay;
          }
          return false;
        }
        
        return false;
      })
      .map((improvement: any) => {
        let allocatedCost = improvement.totalCost / 100; // Convert from cents to dollars
        let quantity = 1;
        let unit = 'ea';
        let unitPrice = allocatedCost;
        
        if (improvement.allocationType === 'prorated') {
          // Calculate prorated cost based on selected area vs total property area
          // Use total selected area as quantity and calculate unit price per SF
          quantity = Math.round(totalSelectedArea);
          unit = 'sf';
          
          // Get total property area using legally compliant totals
          // PROPERTY_LEGAL_TOTALS_BY_ID from shared/area-utils - see note above.
          
          // Use property name from propertyData for legal total lookup
          const propertyName = propertyData?.propertyName || '';
          let propertyTotalArea = PROPERTY_LEGAL_TOTALS_BY_ID[Number((propertyData as any)?.id)] || 0;
          
          // If no legal total available, calculate from property data
          if (!propertyTotalArea && propertyData) {
            const bayTotalArea = propertyData.bayConfigurations?.reduce((sum: number, bay: any) => {
              return sum + (bay.rentableSquareFootage || bay.squareFootage || 0);
            }, 0) || 0;
            
            const mechanicalArea = propertyData.mechanicalRoomSquareFootage || 0;
            propertyTotalArea = bayTotalArea + mechanicalArea;
          }
          
          if (propertyTotalArea > 0) {
            // Calculate unit price per SF from the original full property cost
            unitPrice = allocatedCost / propertyTotalArea; // Original cost per SF of full property
            
            // Calculate the prorated total cost for this tenant's area
            allocatedCost = unitPrice * totalSelectedArea;
            

          }
        } else if (improvement.allocationType === 'bay-specific') {
          // For bay-specific, always use 100% of improvement.totalCost — never proportional
          quantity = 1;
          unit = 'ea';
          // allocatedCost already set to improvement.totalCost / 100 at the top of this callback
          unitPrice = allocatedCost;
        } else if (improvement.allocationType === 'demising-wall') {
          // For demising walls, calculate cost based on which bay(s) are selected
          const demisingData = improvement.demisingWallData;
          if (demisingData) {
            const hasLeftBay = demisingData.leftBayId && normalizedSelectedBayIds.includes(String(demisingData.leftBayId));
            const hasRightBay = demisingData.rightBayId && normalizedSelectedBayIds.includes(String(demisingData.rightBayId));
            
            // Calculate percentage of cost to include based on selected bays
            let percentageToInclude = 0;
            if (hasLeftBay) {
              percentageToInclude += demisingData.leftPercentage || 50; // Default to 50% if not specified
            }
            if (hasRightBay) {
              percentageToInclude += demisingData.rightPercentage || 50; // Default to 50% if not specified
            }
            
            // Apply the percentage to the total cost
            allocatedCost = (allocatedCost * percentageToInclude) / 100;
            unitPrice = allocatedCost;
            quantity = 1;
            unit = 'ea';
          } else {
            // No demising data, skip this improvement
            return null;
          }
        }
        
        return {
          id: `existing-${improvement.id}`,
          description: improvement.description,
          quantity: quantity,
          unit: unit,
          unitPrice: unitPrice.toFixed(2),
          totalPrice: allocatedCost.toFixed(2),
          tenantShare: 100, // Default to 100% tenant responsibility
          bucket: improvement.bucket, // Preserve bucket for cost lifecycle tracking
        } as EvaluationLineItem;
      })
      .filter((item: any) => item !== null);
    return result;
  };

  // Initialize budget with saved data or bid line items data
  useEffect(() => {
    const doorCounts = calculateDoorCounts();
    const existingImprovementsFromProperty = populateExistingImprovements();
    
    if (existingBudget) {
      // Load saved budget data but override door counts with current bay configuration
      // For parking, ALWAYS use saved metadata values if they exist, never recalculate
      const savedVehicular = (existingBudget as any).metadata?.vehicularParking;
      const savedTrailer = (existingBudget as any).metadata?.trailerParking;
      const savedElectrical = (existingBudget as any).metadata?.electricalAllocation;
      const savedElectricalOverride = (existingBudget as any).metadata?.electricalAllocationOverride;
      const savedOversizedOverride = (existingBudget as any).metadata?.oversizedDoorsOverride;
      const savedRegularOverride = (existingBudget as any).metadata?.regularDoorsOverride;
      const savedCalculatedElectrical = (existingBudget as any).metadata?.calculatedElectricalAllocation;
      const savedTenantVoltage = (existingBudget as any).metadata?.tenantVoltage;
      const savedElectricalAllocations = (existingBudget as any).metadata?.electricalAllocations || [];
      
      // NOTE: Manual overrides are intentionally session-only (component state) and are
      // NOT restored from saved metadata. Reloading the page/evaluation resets them so
      // auto-calculation resumes for CM/Contingency/Permit Fees until the user edits again
      // in the current session.
      
      // Check if saved allocations have the new amps field (not legacy kVA-only data)
      const hasLegacyData = savedElectricalAllocations.length > 0 && 
        savedElectricalAllocations.some((alloc: any) => alloc.amps === undefined);
      
      // If we have legacy data (kVA only) and Step 2 has AMPS data, prefer Step 2 for accuracy
      const step2HasData = rfp && (
        (rfp.tenantElectricalAllocation && rfp.tenantElectricalAllocation > 0) ||
        (rfp.tenantElectricalAdditionalRequest && rfp.tenantElectricalAdditionalRequest > 0)
      );
      
      let electricalAllocationsToUse: ElectricalAllocationEntry[] = [];
      
      if (hasLegacyData && step2HasData) {
        // Re-initialize from Step 2 data for accuracy (legacy kVA data has rounding issues)
        if (rfp.tenantElectricalAllocation && rfp.tenantElectricalAllocation > 0) {
          const baseVoltage = rfp.tenantElectricalVoltage || "480";
          const baseAmps = rfp.tenantElectricalAllocation;
          electricalAllocationsToUse.push({
            id: `step2-base-${Date.now()}`,
            amps: baseAmps,
            kva: ampsToKva(baseAmps, baseVoltage),
            voltage: baseVoltage
          });
        }
        if (rfp.tenantElectricalAdditionalRequest && rfp.tenantElectricalAdditionalRequest > 0) {
          const additionalVoltage = rfp.tenantElectricalAdditionalVoltage || rfp.tenantElectricalVoltage || "480";
          const additionalAmps = rfp.tenantElectricalAdditionalRequest;
          electricalAllocationsToUse.push({
            id: `step2-additional-${Date.now() + 1}`,
            amps: additionalAmps,
            kva: ampsToKva(additionalAmps, additionalVoltage),
            voltage: additionalVoltage
          });
        }
      } else if (savedElectricalAllocations.length > 0) {
        // Use saved allocations (with amps field intact)
        electricalAllocationsToUse = savedElectricalAllocations.map((alloc: any) => ({
          ...alloc,
          amps: alloc.amps ?? kvaToAmps(alloc.kva, alloc.voltage)
        }));
      }
      
      if (electricalAllocationsToUse.length === 0 && rfp) {
        const initialAllocations: ElectricalAllocationEntry[] = [];
        
        // Add base allocation from Step 2 if set - store AMPS directly
        if (rfp.tenantElectricalAllocation && rfp.tenantElectricalAllocation > 0) {
          const baseVoltage = rfp.tenantElectricalVoltage || "480";
          const baseAmps = rfp.tenantElectricalAllocation;
          initialAllocations.push({
            id: `step2-base-${Date.now()}`,
            amps: baseAmps,
            kva: ampsToKva(baseAmps, baseVoltage),
            voltage: baseVoltage
          });
        }
        
        // Add additional request from Step 2 if set - store AMPS directly
        if (rfp.tenantElectricalAdditionalRequest && rfp.tenantElectricalAdditionalRequest > 0) {
          const additionalVoltage = rfp.tenantElectricalAdditionalVoltage || rfp.tenantElectricalVoltage || "480";
          const additionalAmps = rfp.tenantElectricalAdditionalRequest;
          initialAllocations.push({
            id: `step2-additional-${Date.now() + 1}`,
            amps: additionalAmps,
            kva: ampsToKva(additionalAmps, additionalVoltage),
            voltage: additionalVoltage
          });
        }
        
        electricalAllocationsToUse = initialAllocations;
      }
      
      // Calculate current electrical allocation based on tenant SF percentage
      const currentCalculatedElectrical = calculateElectricalAllocation();
      
      // Check if saved existing improvements have the bucket field (added in cost lifecycle tracking)
      // If not, refresh from property to get updated data with bucket field
      const savedExistingImprovements = (existingBudget as any).existingImprovements || [];
      const needsBucketRefresh = savedExistingImprovements.length > 0 && 
                                  savedExistingImprovements.some((item: any) => item.bucket === undefined);
      
      const existingImprovementsToUse = needsBucketRefresh ? existingImprovementsFromProperty : savedExistingImprovements;
      
      // Use saved override if set, otherwise use calculated value
      const effectiveElectricalOverride = savedElectricalOverride !== undefined ? savedElectricalOverride : null;
      const effectiveElectrical = effectiveElectricalOverride !== null ? effectiveElectricalOverride : currentCalculatedElectrical;
      
      // Load saved data
      const savedTI = (existingBudget as any).tenantImprovements || [];
      const savedDSC = (existingBudget as any).designSoftCosts || [];
      const savedEI = existingImprovementsToUse.length > 0 ? existingImprovementsToUse : existingImprovementsFromProperty;
      const savedAssemblies = (existingBudget as any).customAssemblies || [];
      
      // Clean up orphaned assembly items - clear assemblyId if the header doesn't exist
      const allItems = [...savedTI, ...savedDSC, ...savedEI];
      const validAssemblyIds = new Set([
        ...savedAssemblies.map((a: any) => a.id),
        ...allItems.map((item: any) => item.id) // Headers are also valid
      ]);
      
      const cleanOrphanedAssemblyItems = (items: EvaluationLineItem[]): EvaluationLineItem[] => 
        items.map(item => {
          if (item.assemblyId && !allItems.some(other => other.id === item.assemblyId)) {
            // This item references an assembly that no longer exists - release it
            return { ...item, assemblyId: undefined };
          }
          return item;
        });
      
      const cleanedTI = cleanOrphanedAssemblyItems(savedTI);
      const cleanedDSC = cleanOrphanedAssemblyItems(savedDSC);
      const cleanedEI = cleanOrphanedAssemblyItems(savedEI);

      // Demising wall auto-calculation is handled by the dedicated useEffect below.
      // Do NOT apply it here — doing so would require propertyData in this effect's
      // dependency array, which was the original source of the spurious re-runs.
      // Restore manual overrides so user edits (e.g. Builder's Risk changed to a
      // lump sum) survive a reload. Without this, manualOverrides resets to empty
      // on remount and the auto-populate re-forces quantity = TI total, blowing the
      // total up to billions and cascading into CM/contingency. The value is saved
      // under metadata.manualOverrides as an array; rehydrate it into the Set.
      const savedOverrides = (existingBudget as any).metadata?.manualOverrides;
      if (Array.isArray(savedOverrides) && savedOverrides.length > 0) {
        setManualOverrides(new Set(savedOverrides));
      }

      setBudgetData({
        tenantImprovements: cleanedTI,
        designSoftCosts: cleanedDSC,
        existingImprovements: cleanedEI,
        hasExistingImprovements: (existingBudget as any).hasExistingImprovements || existingImprovementsFromProperty.length > 0,
        includeExistingInTotal: (existingBudget as any).includeExistingInTotal || false,
        separateDesignCosts: (existingBudget as any).separateDesignCosts !== undefined ? (existingBudget as any).separateDesignCosts : false,
        totalTenantImprovements: (existingBudget as any).totalTenantImprovements || "0.00",
        totalDesignSoftCosts: (existingBudget as any).totalDesignSoftCosts || "0.00",
        totalExistingImprovements: (existingBudget as any).totalExistingImprovements || "0.00",
        grandTotal: (existingBudget as any).grandTotal || "0.00",
        notes: (existingBudget as any).notes || "",
        lineItemRollups: (existingBudget as any).lineItemRollups || {},
        customAssemblies: savedAssemblies,
        assemblies: (existingBudget as any).assemblies || {},
        oversizedDoors: savedOversizedOverride ?? doorCounts.oversized,
        regularDoors: savedRegularOverride ?? doorCounts.regular,
        oversizedDoorsOverride: savedOversizedOverride ?? null,
        regularDoorsOverride: savedRegularOverride ?? null,
        vehicularParking: savedVehicular !== undefined ? savedVehicular : 0,
        trailerParking: savedTrailer !== undefined ? savedTrailer : 0,
        electricalAllocation: effectiveElectrical,
        calculatedElectricalAllocation: currentCalculatedElectrical,
        electricalAllocationOverride: effectiveElectricalOverride,
        tenantVoltage: savedTenantVoltage || "480",
        electricalAllocations: electricalAllocationsToUse,
      });
    } else {
      // Initialize with door counts and existing improvements even if no other data
      const parkingCounts = calculateParkingCounts();
      const calculatedElectrical = calculateElectricalAllocation();
      
      // Initialize electrical allocations from Step 2 data if available - store AMPS directly
      const initialElectricalAllocations: ElectricalAllocationEntry[] = [];
      if (rfp) {
        // Add base allocation from Step 2 if set
        if (rfp.tenantElectricalAllocation && rfp.tenantElectricalAllocation > 0) {
          const baseVoltage = rfp.tenantElectricalVoltage || "480";
          const baseAmps = rfp.tenantElectricalAllocation;
          initialElectricalAllocations.push({
            id: `step2-base-${Date.now()}`,
            amps: baseAmps,
            kva: ampsToKva(baseAmps, baseVoltage),
            voltage: baseVoltage
          });
        }
        
        // Add additional request from Step 2 if set
        if (rfp.tenantElectricalAdditionalRequest && rfp.tenantElectricalAdditionalRequest > 0) {
          const additionalVoltage = rfp.tenantElectricalAdditionalVoltage || rfp.tenantElectricalVoltage || "480";
          const additionalAmps = rfp.tenantElectricalAdditionalRequest;
          initialElectricalAllocations.push({
            id: `step2-additional-${Date.now() + 1}`,
            amps: additionalAmps,
            kva: ampsToKva(additionalAmps, additionalVoltage),
            voltage: additionalVoltage
          });
        }
      }
      
      setBudgetData(prev => ({
        ...prev,
        existingImprovements: existingImprovementsFromProperty,
        hasExistingImprovements: existingImprovementsFromProperty.length > 0,
        oversizedDoors: doorCounts.oversized,
        regularDoors: doorCounts.regular,
        vehicularParking: parkingCounts.vehicular,
        trailerParking: parkingCounts.trailer,
        electricalAllocation: calculatedElectrical,
        calculatedElectricalAllocation: calculatedElectrical,
        electricalAllocationOverride: null,
        electricalAllocations: initialElectricalAllocations,
      }));
    }
  // Effect A depends only on existingBudget (the server snapshot). Removing
  // allBidLineItems, bidCollections, propertyData, propertyImprovements, and
  // rfp sub-fields from this array was the core Bug #1 fix: those async queries
  // resolved after initial render and triggered full non-partial setBudgetData
  // replacements, silently erasing any line items the user had added since load.
  }, [existingBudget]);

  // Effect B — property/improvements data merge (functional-setter only, never overwrites
  // user-edited line item arrays). Runs when property improvements load or bay config changes.
  // Handles the "needsBucketRefresh" case: if saved existingImprovements predate the
  // bucket field, repopulate from live property data using a safe partial update.
  useEffect(() => {
    if (!propertyImprovements || !existingBudget) return;

    const savedExistingImprovements = (existingBudget as any).existingImprovements || [];
    const needsBucketRefresh = savedExistingImprovements.length > 0 &&
      savedExistingImprovements.some((item: any) => item.bucket === undefined);

    if (!needsBucketRefresh) return;

    const refreshed = populateExistingImprovements();
    if (refreshed.length > 0) {
      setBudgetData(prev => ({
        ...prev,
        existingImprovements: refreshed,
        hasExistingImprovements: true,
      }));
    }
  }, [propertyImprovements, rfp?.selectedBayConfigurations]);

  const formatCurrency = (amount: string | number) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(isNaN(num) ? 0 : num);
  };

  const calculateCategoryTotal = (items: EvaluationLineItem[]) => {
    return items.reduce((total, item) => {
      // Exclude items that are part of an assembly (they have assemblyId)
      if (item.assemblyId) {
        return total;
      }
      const price = parseFloat(item.totalPrice) || 0;
      const tenantShare = (item.tenantShare || 100) / 100;
      return total + (price * tenantShare);
    }, 0);
  };

  // Calculate total including rolled-up items from other categories
  const calculateCategoryTotalWithRollups = (
    category: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements'
  ) => {
    let total = 0;
    
    // Add items from this category that are not rolled up elsewhere and not part of an assembly
    const categoryItems = budgetData[category];
    categoryItems.forEach(item => {
      if (!budgetData.lineItemRollups[item.id] && !item.assemblyId) {
        const price = parseFloat(item.totalPrice) || 0;
        const tenantShare = (item.tenantShare || 100) / 100;
        total += price * tenantShare;
      }
    });
    
    // Add rolled-up items from other categories
    Object.entries(budgetData.lineItemRollups).forEach(([itemId, targetCategory]) => {
      if (targetCategory === category || (targetCategory === 'tiAndDesign' && (category === 'tenantImprovements' || category === 'designSoftCosts'))) {
        // Find the item in any category
        const allItems = [
          ...budgetData.tenantImprovements,
          ...budgetData.designSoftCosts,
          ...budgetData.existingImprovements
        ];
        const item = allItems.find(i => i.id === itemId);
        if (item) {
          const baseAmount = parseFloat(item.totalPrice) || 0;
          const tenantShare = (item.tenantShare || 100) / 100;
          let amountToAdd = baseAmount * tenantShare;
          
          // If rolling to both TI & Design, distribute proportionally based on category sizes
          if (targetCategory === 'tiAndDesign') {
            const tiTotal = calculateCategoryTotal(budgetData.tenantImprovements);
            const designTotal = calculateCategoryTotal(budgetData.designSoftCosts);
            const combinedTotal = tiTotal + designTotal;
            
            if (combinedTotal > 0) {
              const categoryPercentage = category === 'tenantImprovements' 
                ? tiTotal / combinedTotal 
                : designTotal / combinedTotal;
              amountToAdd = amountToAdd * categoryPercentage;
            } else {
              amountToAdd = amountToAdd / 2; // Fallback to 50/50 if no base amounts
            }
          }
          total += amountToAdd;
        }
      }
    });
    
    return total;
  };

  const calculateDisplayedCategoryTotal = (items: EvaluationLineItem[], category: string) => {
    if (category === 'tenantImprovements' && budgetData.separateDesignCosts) {
      // When hiding design costs, show total including distributed design costs
      return items.reduce((total, item) => {
        return total + calculateDistributedCosts(item);
      }, 0);
    }
    
    // Use rollup-aware calculation for accurate totals including rolled-up items
    if (category === 'tenantImprovements') {
      return calculateCategoryTotalWithRollups('tenantImprovements');
    } else if (category === 'designSoftCosts') {
      return calculateCategoryTotalWithRollups('designSoftCosts');
    } else if (category === 'existingImprovements') {
      return calculateCategoryTotalWithRollups('existingImprovements');
    }
    
    return calculateCategoryTotal(items);
  };

  // Calculate distributed costs including rolled-up items
  const calculateDistributedCosts = (item: EvaluationLineItem) => {
    const baseItemCost = parseFloat(item.totalPrice) || 0;
    const tenantShare = (item.tenantShare || 100) / 100;
    const itemCost = baseItemCost * tenantShare;

    // Fixed-allowance items display their exact entered value — exempt from all hidden-cost distribution.
    // The hidden-cost pool that would have gone to this line is redistributed across the remaining
    // non-fixed lines (handled by excluding fixed items from the denominators below).
    if (item.isFixedAllowance) {
      return itemCost;
    }
    
    // First handle design cost distribution if applicable
    let distributedDesignCost = 0;
    if (budgetData.separateDesignCosts) {
      // Distribute design costs only among non-fixed TI items so that fixed lines receive no design
      // allocation. If every TI item is fixed (edge case), fall back to distributing among all.
      const tiTotalNonFixed = budgetData.tenantImprovements
        .filter(i => !i.isFixedAllowance)
        .reduce((sum, i) => sum + (parseFloat(i.totalPrice) || 0) * ((i.tenantShare || 100) / 100), 0);
      const designTotal = calculateCategoryTotal(budgetData.designSoftCosts);
      const effectiveTiTotal = tiTotalNonFixed > 0 ? tiTotalNonFixed : calculateCategoryTotal(budgetData.tenantImprovements);

      if (effectiveTiTotal > 0) {
        const itemPercentage = itemCost / effectiveTiTotal;
        distributedDesignCost = designTotal * itemPercentage;
      }
    }
    
    // Then handle rollup distribution
    let rolledUpDistribution = 0;
    
    // Find the category this item belongs to
    let itemCategory: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements' | null = null;
    if (budgetData.tenantImprovements.find(i => i.id === item.id)) itemCategory = 'tenantImprovements';
    else if (budgetData.designSoftCosts.find(i => i.id === item.id)) itemCategory = 'designSoftCosts';
    else if (budgetData.existingImprovements.find(i => i.id === item.id)) itemCategory = 'existingImprovements';
    
    if (itemCategory) {
      // Base total: non-rolled-up, non-assembled, non-fixed items absorb all hidden-cost distribution.
      // Fixed-allowance items are excluded from the denominator so their share redistributes to peers.
      const baseCategoryTotal = budgetData[itemCategory]
        .filter(i => !budgetData.lineItemRollups[i.id] && !i.assemblyId && !i.isFixedAllowance)
        .reduce((total, i) => {
          const price = parseFloat(i.totalPrice) || 0;
          const tenantShare = (i.tenantShare || 100) / 100;
          return total + (price * tenantShare);
        }, 0);
      
      // Calculate total amount rolled INTO this category
      let totalRolledIn = 0;
      Object.entries(budgetData.lineItemRollups).forEach(([itemId, targetCategory]) => {
        if (targetCategory === itemCategory || (targetCategory === 'tiAndDesign' && (itemCategory === 'tenantImprovements' || itemCategory === 'designSoftCosts'))) {
          const allItems = [
            ...budgetData.tenantImprovements,
            ...budgetData.designSoftCosts,
            ...budgetData.existingImprovements
          ];
          const rolledItem = allItems.find(i => i.id === itemId);
          if (rolledItem) {
            const baseAmount = parseFloat(rolledItem.totalPrice) || 0;
            const tenantShare = (rolledItem.tenantShare || 100) / 100;
            let amountToAdd = baseAmount * tenantShare;
            // If rolling to both TI & Design, distribute proportionally based on category sizes
            if (targetCategory === 'tiAndDesign') {
              const tiTotal = calculateCategoryTotal(budgetData.tenantImprovements);
              const designTotal = calculateCategoryTotal(budgetData.designSoftCosts);
              const combinedTotal = tiTotal + designTotal;
              
              if (combinedTotal > 0) {
                const categoryPercentage = itemCategory === 'tenantImprovements' 
                  ? tiTotal / combinedTotal 
                  : designTotal / combinedTotal;
                amountToAdd = amountToAdd * categoryPercentage;
              } else {
                amountToAdd = amountToAdd / 2; // Fallback to 50/50 if no base amounts
              }
            }
            totalRolledIn += amountToAdd;
          }
        }
      });
      
      // Distribute rolled-in amount proportionally among non-fixed items only
      if (!budgetData.lineItemRollups[item.id] && !item.assemblyId && baseCategoryTotal > 0 && totalRolledIn > 0) {
        const itemPercentage = itemCost / baseCategoryTotal;
        rolledUpDistribution = totalRolledIn * itemPercentage;
      }
    }
    
    return itemCost + distributedDesignCost + rolledUpDistribution;
  };

  // Calculate distributed unit price including rollups
  const calculateDistributedUnitPrice = (item: EvaluationLineItem) => {
    if (item.quantity === 0) {
      return parseFloat(item.unitPrice) || 0;
    }
    
    // Calculate new unit price based on distributed total (includes design costs and rollups)
    const distributedTotal = calculateDistributedCosts(item);
    return distributedTotal / item.quantity;
  };

  const calculateGrandTotal = () => {
    const tiTotal = calculateCategoryTotalWithRollups('tenantImprovements');
    const designTotal = calculateCategoryTotalWithRollups('designSoftCosts');
    const existingTotal = (budgetData.hasExistingImprovements && budgetData.includeExistingInTotal)
      ? calculateCategoryTotalWithRollups('existingImprovements') 
      : 0;
    
    // Simple sum of category totals (rollups are already included in category totals)
    return tiTotal + designTotal + existingTotal;
  };

  // Assembly management functions
  const createCustomAssembly = () => {
    if (!newAssemblyName.trim() || selectedItems.size === 0) {
      toast({
        title: "Error",
        description: "Please enter an assembly name and select at least one item.",
        variant: "destructive",
        duration: 6000,
      });
      return;
    }

    if (!newAssemblyCategory || newAssemblyCategory.trim() === '') {
      toast({
        title: "Error",
        description: "Please select a category for the assembly.",
        variant: "destructive",
        duration: 6000,
      });
      return;
    }

    const assemblyId = `assembly-${Date.now()}`;
    const newAssembly: CustomAssembly = {
      id: assemblyId,
      name: newAssemblyName.trim(),
      category: newAssemblyCategory as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements',
      items: Array.from(selectedItems),
    };

    setBudgetData(prev => ({
      ...prev,
      customAssemblies: [...prev.customAssemblies, newAssembly],
    }));

    // Update selected line items to include assembly ID
    setBudgetData(prev => {
      const updateCategory = (items: EvaluationLineItem[]) => 
        items.map(item => 
          selectedItems.has(item.id) 
            ? { ...item, assemblyId }
            : item
        );

      return {
        ...prev,
        tenantImprovements: updateCategory(prev.tenantImprovements),
        designSoftCosts: updateCategory(prev.designSoftCosts),
        existingImprovements: updateCategory(prev.existingImprovements),
      };
    });

    // Reset form
    setNewAssemblyName("");
    setSelectedItems(new Set());
    setShowAssemblyCreator(false);
    
    toast({
      title: "Assembly Created",
      description: `"${newAssemblyName}" assembly created with ${selectedItems.size} items.`,
    });
  };

  const removeFromAssembly = (itemId: string, assemblyId: string) => {
    setBudgetData(prev => {
      const updateCategory = (items: EvaluationLineItem[]) => 
        items.map(item => 
          item.id === itemId && item.assemblyId === assemblyId
            ? { ...item, assemblyId: undefined }
            : item
        );

      // Check if assembly becomes empty
      const allItems = [
        ...updateCategory(prev.tenantImprovements),
        ...updateCategory(prev.designSoftCosts),
        ...updateCategory(prev.existingImprovements),
      ];
      
      const assemblyHasItems = allItems.some(item => item.assemblyId === assemblyId);
      
      return {
        ...prev,
        tenantImprovements: updateCategory(prev.tenantImprovements),
        designSoftCosts: updateCategory(prev.designSoftCosts),
        existingImprovements: updateCategory(prev.existingImprovements),
        customAssemblies: assemblyHasItems 
          ? prev.customAssemblies 
          : prev.customAssemblies.filter(a => a.id !== assemblyId),
      };
    });
  };

  const deleteAssembly = (assemblyId: string) => {
    setBudgetData(prev => {
      const updateCategory = (items: EvaluationLineItem[]) => 
        items.map(item => 
          item.assemblyId === assemblyId
            ? { ...item, assemblyId: undefined }
            : item
        );

      return {
        ...prev,
        tenantImprovements: updateCategory(prev.tenantImprovements),
        designSoftCosts: updateCategory(prev.designSoftCosts),
        existingImprovements: updateCategory(prev.existingImprovements),
        customAssemblies: prev.customAssemblies.filter(a => a.id !== assemblyId),
      };
    });
  };

  const getAssemblyItems = (assemblyId: string) => {
    const allItems = [
      ...budgetData.tenantImprovements,
      ...budgetData.designSoftCosts,
      ...budgetData.existingImprovements,
    ];
    return allItems.filter(item => item.assemblyId === assemblyId);
  };

  const calculateAssemblyTotal = (assemblyId: string) => {
    const assemblyItems = getAssemblyItems(assemblyId);
    return assemblyItems.reduce((total, item) => {
      return total + (parseFloat(item.totalPrice) || 0);
    }, 0);
  };

  /**
   * Assembly head figures: total from the children, rate from the head's own
   * quantity.
   *
   * The children ARE the source of truth for the money - $100k switchgear plus
   * $50k circuiting is a $150,000 assembly, and the head is never typed. The
   * quantity is separate and presentational: express that same $150,000 as 1 LS
   * and the rate is $150,000/LS; as 100 LF and it is $1,500/LF.
   *
   * Falls back to the primary item's quantity and unit when the head has none,
   * so existing assemblies are unchanged.
   */
  const getAssemblyHead = (assembly: CustomAssembly) => {
    const total = calculateAssemblyTotal(assembly.id);
    const items = getAssemblyItems(assembly.id);
    const primary = items.find((i) => i.id === assembly.primaryItemId) ?? items[0];

    const quantity = assembly.headQuantity ?? primary?.quantity ?? 1;
    const unit = assembly.headUnit ?? primary?.unit ?? 'LS';
    const unitPrice = quantity > 0 ? total / quantity : total;

    return { total, quantity, unit, unitPrice, componentCount: items.length };
  };

  const exportToExcel = () => {
    if (!rfp) return;

    // Create workbook
    const workbook = XLSX.utils.book_new();
    
    // Calculate rentable area using legally compliant totals
    // ALWAYS calculate from LIVE bay configurations (Properties is single source of truth)
    let rentableArea = 0;
    if (rfp?.selectedBayConfigurations && Array.isArray(rfp.selectedBayConfigurations) && rfp.selectedBayConfigurations.length > 0) {
      // Use legal compliance totals based on property
      // shared/area-utils. This block appeared here three times verbatim, each
      // copy carrying the same two faults:
      //   - it summed rentableSquareFootage, which on split halves already
      //     contains that half's mechanical allocation, so mechanical was
      //     double-counted
      //   - it looked the legal total up by rfp.property, which holds the
      //     property ID as TEXT rather than a name, so the lookup NEVER matched
      //     and always fell through to the raw bay sum
      const legalProp = (rfp?.isMultiBuilding
        ? (multiBuildingProperties?.[0] || propertyData)
        : (propertyData || propertyByIdData)) as any;
      rentableArea = resolveRfpRentableArea({
        selectedBays: rfp.selectedBayConfigurations,
        allPropertyBays: legalProp?.bayConfigurations,
        mechanicalRoomSf: legalProp?.mechanicalRoomSquareFootage,
        propertyName: legalProp?.propertyName,
        propertyId: legalProp?.id,
      }).rentableSf;
    } else if (rfp?.warehouseArea) {
      // Final fallback to stored warehouseArea only if no bay configurations
      rentableArea = parseFloat(rfp.warehouseArea.toString().replace(/[^0-9.]/g, ''));
    }

    // Helper function to prepare line items for export
    const prepareLineItemsForExport = (items: EvaluationLineItem[], categoryName: string) => {
      const filteredItems = items.filter(item => {
        const rollupTarget = budgetData.lineItemRollups[item.id];
        return !rollupTarget && !item.assemblyId; // Exclude rolled up and assembled items
      });

      return filteredItems.map(item => {
        const totalPrice = calculateDistributedCosts(item);
        const unitPrice = calculateDistributedUnitPrice(item);
        const pricePerSf = rentableArea > 0 ? totalPrice / rentableArea : 0;
        
        return {
          Category: categoryName,
          Description: item.description,
          Quantity: item.quantity,
          Unit: item.unit,
          'Unit Price': unitPrice,
          'Total Price': totalPrice,
          'Tenant Share %': item.tenantShare || 100,
          '$/RSF': pricePerSf > 0 ? pricePerSf : 0
        };
      });
    };

    // Prepare data for all categories
    const tenantImprovementsData = prepareLineItemsForExport(budgetData.tenantImprovements, 'Tenant Improvements');
    const designCostsData = budgetData.separateDesignCosts ? 
      prepareLineItemsForExport(budgetData.designSoftCosts, 'Design/Soft Costs') : [];
    const existingImprovementsData = budgetData.hasExistingImprovements ? 
      prepareLineItemsForExport(budgetData.existingImprovements, 'Existing Improvements') : [];

    // Combine all data. Rows mix strings (blank cells for non-numeric columns) and
    // numbers (computed totals), so the value type is string | number.
    let allData: Record<string, string | number>[] = [...tenantImprovementsData, ...designCostsData, ...existingImprovementsData];

    // Add assemblies
    Object.entries(budgetData.assemblies || {}).forEach(([assemblyName, assemblyData]) => {
      const pricePerSf = rentableArea > 0 ? assemblyData.total / rentableArea : 0;
      allData.push({
        Category: 'Assembly',
        Description: assemblyName,
        Quantity: 1,
        Unit: 'assembly',
        'Unit Price': assemblyData.total,
        'Total Price': assemblyData.total,
        'Tenant Share %': 100,
        '$/RSF': pricePerSf > 0 ? pricePerSf : 0
      });
    });

    // Add summary totals
    const tiTotal = calculateCategoryTotalWithRollups('tenantImprovements');
    const designTotal = calculateCategoryTotalWithRollups('designSoftCosts');
    const existingTotal = budgetData.hasExistingImprovements && budgetData.includeExistingInTotal ?
      calculateCategoryTotalWithRollups('existingImprovements') : 0;
    const grandTotal = tiTotal + designTotal + existingTotal;

    allData.push({});  // Empty row
    allData.push({
      Category: 'TOTALS',
      Description: 'Tenant Improvements Total',
      Quantity: '',
      Unit: '',
      'Unit Price': '',
      'Total Price': tiTotal,
      'Tenant Share %': '',
      '$/RSF': rentableArea > 0 ? tiTotal / rentableArea : 0
    });

    if (budgetData.separateDesignCosts && designTotal > 0) {
      allData.push({
        Category: 'TOTALS',
        Description: 'Design/Soft Costs Total',
        Quantity: '',
        Unit: '',
        'Unit Price': '',
        'Total Price': designTotal,
        'Tenant Share %': '',
        '$/RSF': rentableArea > 0 ? designTotal / rentableArea : 0
      });
    }

    if (existingTotal > 0) {
      allData.push({
        Category: 'TOTALS',
        Description: 'Existing Improvements Total',
        Quantity: '',
        Unit: '',
        'Unit Price': '',
        'Total Price': existingTotal,
        'Tenant Share %': '',
        '$/RSF': rentableArea > 0 ? existingTotal / rentableArea : 0
      });
    }

    allData.push({
      Category: 'TOTALS',
      Description: 'GRAND TOTAL',
      Quantity: '',
      Unit: '',
      'Unit Price': '',
      'Total Price': grandTotal,
      'Tenant Share %': '',
      '$/RSF': rentableArea > 0 ? grandTotal / rentableArea : 0
    });

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(allData);
    
    // Add project information at the top
    const projectInfo = [
      [`Project: ${rfp.projectName}`],
      [`Property: ${propertyData?.propertyName || 'Unknown'}`],
      [`Rentable Area: ${new Intl.NumberFormat('en-US').format(rentableArea)} SF`],
      [`Export Date: ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`],
      []  // Empty row
    ];

    // Insert project info at the top
    XLSX.utils.sheet_add_aoa(worksheet, projectInfo, { origin: 'A1' });
    
    // Adjust the data range to account for header rows
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:H1');
    range.e.r += projectInfo.length;
    worksheet['!ref'] = XLSX.utils.encode_range(range);

    // Format currency columns - E (Unit Price), F (Total Price), H ($/RSF)
    const dataStartRow = projectInfo.length + 1;
    if (worksheet['!cols']) worksheet['!cols'] = [];
    else worksheet['!cols'] = [];
    
    // Set column formats
    for (let row = dataStartRow; row <= range.e.r; row++) {
      // Unit Price column (E)
      const unitPriceCell = `E${row}`;
      if (worksheet[unitPriceCell] && typeof worksheet[unitPriceCell].v === 'number') {
        worksheet[unitPriceCell].z = '$#,##0.00';
      }
      
      // Total Price column (F)
      const totalPriceCell = `F${row}`;
      if (worksheet[totalPriceCell] && typeof worksheet[totalPriceCell].v === 'number') {
        worksheet[totalPriceCell].z = '$#,##0.00';
      }
      
      // $/RSF column (H)
      const perSfCell = `H${row}`;
      if (worksheet[perSfCell] && typeof worksheet[perSfCell].v === 'number') {
        worksheet[perSfCell].z = '$#,##0.00';
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Evaluation Budget');

    // Generate filename
    const fileName = `${rfp.projectName.replace(/[^a-zA-Z0-9]/g, '_')}_Budget_${new Date().toISOString().split('T')[0]}.xlsx`;

    // Write and download file
    XLSX.writeFile(workbook, fileName);

    toast({
      title: "Export Complete",
      description: `Budget data exported to ${fileName}`,
    });
  };

  const exportAllLineItems = () => {
    if (!rfp) return;

    // Create workbook
    const workbook = XLSX.utils.book_new();
    
    // Calculate rentable area using legally compliant totals
    // ALWAYS calculate from LIVE bay configurations (Properties is single source of truth)
    let rentableArea = 0;
    if (rfp?.selectedBayConfigurations && Array.isArray(rfp.selectedBayConfigurations) && rfp.selectedBayConfigurations.length > 0) {
      // Use legal compliance totals based on property
      // shared/area-utils. This block appeared here three times verbatim, each
      // copy carrying the same two faults:
      //   - it summed rentableSquareFootage, which on split halves already
      //     contains that half's mechanical allocation, so mechanical was
      //     double-counted
      //   - it looked the legal total up by rfp.property, which holds the
      //     property ID as TEXT rather than a name, so the lookup NEVER matched
      //     and always fell through to the raw bay sum
      const legalProp = (rfp?.isMultiBuilding
        ? (multiBuildingProperties?.[0] || propertyData)
        : (propertyData || propertyByIdData)) as any;
      rentableArea = resolveRfpRentableArea({
        selectedBays: rfp.selectedBayConfigurations,
        allPropertyBays: legalProp?.bayConfigurations,
        mechanicalRoomSf: legalProp?.mechanicalRoomSquareFootage,
        propertyName: legalProp?.propertyName,
        propertyId: legalProp?.id,
      }).rentableSf;
    } else if (rfp?.warehouseArea) {
      // Final fallback to stored warehouseArea only if no bay configurations
      rentableArea = parseFloat(rfp.warehouseArea.toString().replace(/[^0-9.]/g, ''));
    }

    // Helper function to prepare ALL line items exactly as entered
    const prepareAllLineItemsForExport = (items: EvaluationLineItem[], categoryName: string) => {
      return items.map(item => {
        const totalPrice = parseFloat(item.totalPrice) || 0;
        const unitPrice = parseFloat(item.unitPrice) || 0;
        const pricePerSf = rentableArea > 0 ? totalPrice / rentableArea : 0;
        
        // Check if item is rolled up
        const rollupTarget = budgetData.lineItemRollups[item.id];
        const isRolledUp = !!rollupTarget;
        const rolledUpTo = isRolledUp ? rollupTarget : '';
        
        // Check if item is part of an assembly
        const isAssembled = !!item.assemblyId;
        const assemblyName = isAssembled ? 
          Object.keys(budgetData.assemblies || {}).find(name => 
            (budgetData.assemblies || {})[name]?.components?.includes(item.id)
          ) || 'Unknown Assembly' : '';

        return {
          Category: categoryName,
          Description: item.description,
          Quantity: item.quantity,
          Unit: item.unit,
          'Unit Price': unitPrice,
          'Total Price': totalPrice,
          'Tenant Share %': item.tenantShare || 100,
          '$/RSF': pricePerSf > 0 ? pricePerSf : 0,
          'Rolled Up': isRolledUp ? 'YES' : 'NO',
          'Rolled Up To': rolledUpTo,
          'In Assembly': isAssembled ? 'YES' : 'NO',
          'Assembly Name': assemblyName,
          'Bid Collection ID': item.bidCollectionId || '',
          'Bid Line Item ID': item.bidLineItemId || '',
          'Notes': `${isRolledUp ? 'ROLLED UP - ' : ''}${isAssembled ? 'ASSEMBLED - ' : ''}Original line item as entered`
        };
      });
    };

    // Prepare data for all categories - ALL items as entered
    const tenantImprovementsData = prepareAllLineItemsForExport(budgetData.tenantImprovements, 'Tenant Improvements');
    const designCostsData = prepareAllLineItemsForExport(budgetData.designSoftCosts, 'Design/Soft Costs');
    const existingImprovementsData = prepareAllLineItemsForExport(budgetData.existingImprovements, 'Existing Improvements');

    // Combine all data. Rows mix strings (blank cells for non-numeric columns) and
    // numbers (computed totals), so the value type is string | number.
    let allData: Record<string, string | number>[] = [...tenantImprovementsData, ...designCostsData, ...existingImprovementsData];

    // Add rollup summary information
    allData.push({});  // Empty row
    allData.push({
      Category: 'ROLLUP SUMMARY',
      Description: 'Line Item Rollup Configuration',
      Quantity: '',
      Unit: '',
      'Unit Price': '',
      'Total Price': '',
      'Tenant Share %': '',
      '$/RSF': '',
      'Rolled Up': '',
      'Rolled Up To': '',
      'In Assembly': '',
      'Assembly Name': '',
      'Bid Collection ID': '',
      'Bid Line Item ID': '',
      'Notes': 'Shows which items are rolled up into other categories'
    });

    // Add rollup details
    Object.entries(budgetData.lineItemRollups || {}).forEach(([itemId, target]) => {
      const allItems = [...budgetData.tenantImprovements, ...budgetData.designSoftCosts, ...budgetData.existingImprovements];
      const item = allItems.find(i => i.id === itemId);
      if (item) {
        allData.push({
          Category: 'ROLLUP DETAIL',
          Description: item.description,
          Quantity: '',
          Unit: '',
          'Unit Price': '',
          'Total Price': parseFloat(item.totalPrice) || 0,
          'Tenant Share %': '',
          '$/RSF': '',
          'Rolled Up': 'YES',
          'Rolled Up To': target,
          'In Assembly': '',
          'Assembly Name': '',
          'Bid Collection ID': '',
          'Bid Line Item ID': '',
          'Notes': `This cost is rolled into the ${target} category`
        });
      }
    });

    // Add assembly summary
    if (Object.keys(budgetData.assemblies || {}).length > 0) {
      allData.push({});  // Empty row
      allData.push({
        Category: 'ASSEMBLY SUMMARY',
        Description: 'Custom Assembly Configuration',
        Quantity: '',
        Unit: '',
        'Unit Price': '',
        'Total Price': '',
        'Tenant Share %': '',
        '$/RSF': '',
        'Rolled Up': '',
        'Rolled Up To': '',
        'In Assembly': '',
        'Assembly Name': '',
        'Bid Collection ID': '',
        'Bid Line Item ID': '',
        'Notes': 'Shows custom assemblies and their component items'
      });

      Object.entries(budgetData.assemblies || {}).forEach(([assemblyName, assemblyData]) => {
        allData.push({
          Category: 'ASSEMBLY',
          Description: assemblyName,
          Quantity: 1,
          Unit: 'assembly',
          'Unit Price': assemblyData.total,
          'Total Price': assemblyData.total,
          'Tenant Share %': 100,
          '$/RSF': rentableArea > 0 ? assemblyData.total / rentableArea : 0,
          'Rolled Up': '',
          'Rolled Up To': '',
          'In Assembly': '',
          'Assembly Name': assemblyName,
          'Bid Collection ID': '',
          'Bid Line Item ID': '',
          'Notes': `Custom assembly containing ${assemblyData.components?.length || 0} component items`
        });
      });
    }

    // Add category totals (original costs as entered)
    allData.push({});  // Empty row
    allData.push({
      Category: 'TOTALS (ORIGINAL)',
      Description: 'Original Category Totals (as entered)',
      Quantity: '',
      Unit: '',
      'Unit Price': '',
      'Total Price': '',
      'Tenant Share %': '',
      '$/RSF': '',
      'Rolled Up': '',
      'Rolled Up To': '',
      'In Assembly': '',
      'Assembly Name': '',
      'Bid Collection ID': '',
      'Bid Line Item ID': '',
      'Notes': 'These are the totals of items as originally entered in each category'
    });

    const originalTiTotal = calculateCategoryTotal(budgetData.tenantImprovements);
    const originalDesignTotal = calculateCategoryTotal(budgetData.designSoftCosts);
    const originalExistingTotal = calculateCategoryTotal(budgetData.existingImprovements);

    allData.push({
      Category: 'ORIGINAL TOTALS',
      Description: 'Tenant Improvements (Original)',
      Quantity: '',
      Unit: '',
      'Unit Price': '',
      'Total Price': originalTiTotal,
      'Tenant Share %': '',
      '$/RSF': rentableArea > 0 ? originalTiTotal / rentableArea : 0,
      'Rolled Up': '',
      'Rolled Up To': '',
      'In Assembly': '',
      'Assembly Name': '',
      'Bid Collection ID': '',
      'Bid Line Item ID': '',
      'Notes': 'Original TI total before any rollups'
    });

    allData.push({
      Category: 'ORIGINAL TOTALS',
      Description: 'Design/Soft Costs (Original)',
      Quantity: '',
      Unit: '',
      'Unit Price': '',
      'Total Price': originalDesignTotal,
      'Tenant Share %': '',
      '$/RSF': rentableArea > 0 ? originalDesignTotal / rentableArea : 0,
      'Rolled Up': '',
      'Rolled Up To': '',
      'In Assembly': '',
      'Assembly Name': '',
      'Bid Collection ID': '',
      'Bid Line Item ID': '',
      'Notes': 'Original Design costs before any rollups'
    });

    if (originalExistingTotal > 0) {
      allData.push({
        Category: 'ORIGINAL TOTALS',
        Description: 'Existing Improvements (Original)',
        Quantity: '',
        Unit: '',
        'Unit Price': '',
        'Total Price': originalExistingTotal,
        'Tenant Share %': '',
        '$/RSF': rentableArea > 0 ? originalExistingTotal / rentableArea : 0,
        'Rolled Up': '',
        'Rolled Up To': '',
        'In Assembly': '',
        'Assembly Name': '',
        'Bid Collection ID': '',
        'Bid Line Item ID': '',
        'Notes': 'Original Existing Improvements total'
      });
    }

    const originalGrandTotal = originalTiTotal + originalDesignTotal + originalExistingTotal;
    allData.push({
      Category: 'ORIGINAL TOTALS',
      Description: 'GRAND TOTAL (Original)',
      Quantity: '',
      Unit: '',
      'Unit Price': '',
      'Total Price': originalGrandTotal,
      'Tenant Share %': '',
      '$/RSF': rentableArea > 0 ? originalGrandTotal / rentableArea : 0,
      'Rolled Up': '',
      'Rolled Up To': '',
      'In Assembly': '',
      'Assembly Name': '',
      'Bid Collection ID': '',
      'Bid Line Item ID': '',
      'Notes': 'Total of all original costs as entered'
    });

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(allData);
    
    // Add project information at the top
    const projectInfo = [
      [`Project: ${rfp.projectName}`],
      [`Property: ${propertyData?.propertyName || 'Unknown'}`],
      [`Rentable Area: ${new Intl.NumberFormat('en-US').format(rentableArea)} SF`],
      [`Export Date: ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`],
      [`Export Type: ALL LINE ITEMS (Raw Data)`],
      [`Notes: This export shows every cost exactly as entered, including rolled up and assembled items`],
      []  // Empty row
    ];

    // Insert project info at the top
    XLSX.utils.sheet_add_aoa(worksheet, projectInfo, { origin: 'A1' });
    
    // Adjust the data range to account for header rows
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:N1');
    range.e.r += projectInfo.length;
    worksheet['!ref'] = XLSX.utils.encode_range(range);

    // Format currency columns - E (Unit Price), F (Total Price), H ($/RSF)
    const dataStartRow = projectInfo.length + 1;
    
    // Set column formats for currency columns
    for (let row = dataStartRow; row <= range.e.r; row++) {
      // Unit Price column (E)
      const unitPriceCell = `E${row}`;
      if (worksheet[unitPriceCell] && typeof worksheet[unitPriceCell].v === 'number') {
        worksheet[unitPriceCell].z = '$#,##0.00';
      }
      
      // Total Price column (F)
      const totalPriceCell = `F${row}`;
      if (worksheet[totalPriceCell] && typeof worksheet[totalPriceCell].v === 'number') {
        worksheet[totalPriceCell].z = '$#,##0.00';
      }
      
      // $/RSF column (H)
      const perSfCell = `H${row}`;
      if (worksheet[perSfCell] && typeof worksheet[perSfCell].v === 'number') {
        worksheet[perSfCell].z = '$#,##0.00';
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'All Line Items Raw Data');

    // Generate filename
    const fileName = `${rfp.projectName.replace(/[^a-zA-Z0-9]/g, '_')}_All_Line_Items_${new Date().toISOString().split('T')[0]}.xlsx`;

    // Write and download file
    XLSX.writeFile(workbook, fileName);

    toast({
      title: "Export Complete",
      description: `All line items exported to ${fileName}`,
    });
  };

  const generateReportPreview = async (hideDesignCosts: boolean) => {
    if (!rfp) return;
    
    // 🔍 DEBUG: Log existing improvements bucket data BEFORE PDF generation
    
    const currentDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York'
    });

    // Extract property data for use in report - calculate from bay configurations if warehouse_area is null
    // Use legally compliant totals to ensure accurate reporting
    // ALWAYS calculate from LIVE bay configurations (Properties is single source of truth)
    let rentableArea = 0;
    if (rfp?.selectedBayConfigurations && Array.isArray(rfp.selectedBayConfigurations) && rfp.selectedBayConfigurations.length > 0) {
      // Use legal compliance totals based on property
      // shared/area-utils. This block appeared here three times verbatim, each
      // copy carrying the same two faults:
      //   - it summed rentableSquareFootage, which on split halves already
      //     contains that half's mechanical allocation, so mechanical was
      //     double-counted
      //   - it looked the legal total up by rfp.property, which holds the
      //     property ID as TEXT rather than a name, so the lookup NEVER matched
      //     and always fell through to the raw bay sum
      const legalProp = (rfp?.isMultiBuilding
        ? (multiBuildingProperties?.[0] || propertyData)
        : (propertyData || propertyByIdData)) as any;
      rentableArea = resolveRfpRentableArea({
        selectedBays: rfp.selectedBayConfigurations,
        allPropertyBays: legalProp?.bayConfigurations,
        mechanicalRoomSf: legalProp?.mechanicalRoomSquareFootage,
        propertyName: legalProp?.propertyName,
        propertyId: legalProp?.id,
      }).rentableSf;
    } else if (rfp?.warehouseArea) {
      // Final fallback to stored warehouseArea only if no bay configurations
      rentableArea = parseFloat(rfp.warehouseArea.toString().replace(/[^0-9.]/g, ''));
    }
    const standardParking = (propertyData as any)?.standardParking || 0;
    const accessibleParking = (propertyData as any)?.accessibleParking || 0;
    const evParking = (propertyData as any)?.evParking || 0;
    const trailerParking = (propertyData as any)?.trailerParking || 0;
    const totalParking = standardParking + accessibleParking + evParking;
    const parkingRatio = rentableArea > 0 ? (totalParking / rentableArea * 1000).toFixed(2) : '0.00';
    
    // Calculate grand total for report (sum of category totals with rollups)
    const tiTotal = calculateCategoryTotalWithRollups('tenantImprovements');
    const designTotal = calculateCategoryTotalWithRollups('designSoftCosts');
    const existingTotal = (budgetData.hasExistingImprovements && budgetData.includeExistingInTotal)
      ? calculateCategoryTotalWithRollups('existingImprovements') 
      : 0;
    const grandTotal = tiTotal + designTotal + existingTotal;
    
    // Local calculation functions that use the hideDesignCosts parameter
    const calculateDistributedCostsForPreview = (item: EvaluationLineItem) => {
      const baseItemCost = parseFloat(item.totalPrice) || 0;
      const tenantShare = (item.tenantShare || 100) / 100;
      const itemCost = baseItemCost * tenantShare;
      
      if (!hideDesignCosts) {
        // When showing separately, return tenant share cost
        return itemCost;
      }
      
      // When hiding design costs, distribute them proportionally
      // Get only the base TI costs (not including rollups) for distribution calculation
      const baseTiItems = budgetData.tenantImprovements.filter(item => {
        const rollupTarget = budgetData.lineItemRollups[item.id];
        return !rollupTarget && !item.assemblyId; // Items not rolled up and not assembled
      });
      const baseTiTotal = baseTiItems.reduce((sum, item) => {
        const baseItemCost = parseFloat(item.totalPrice) || 0;
        const tenantShare = (item.tenantShare || 100) / 100;
        return sum + (baseItemCost * tenantShare);
      }, 0);
      
      // Get the design costs that are rolled into TI
      const rolledUpDesignTotal = budgetData.designSoftCosts
        .filter(item => budgetData.lineItemRollups[item.id] === 'tenantImprovements')
        .reduce((sum, item) => {
          const baseItemCost = parseFloat(item.totalPrice) || 0;
          const tenantShare = (item.tenantShare || 100) / 100;
          return sum + (baseItemCost * tenantShare);
        }, 0);
      
      if (baseTiTotal === 0) return itemCost;
      
      // CORRECTED LOGIC: Proper proportional distribution based on item's percentage of total
      const itemPercentage = itemCost / baseTiTotal;
      const distributedDesignCost = rolledUpDesignTotal * itemPercentage;
      
      return itemCost + distributedDesignCost;
    };

    const calculateDistributedUnitPriceForPreview = (item: EvaluationLineItem) => {
      const distributedTotal = calculateDistributedCostsForPreview(item);
      const quantity = typeof item.quantity === 'string' ? parseInt(item.quantity) || 1 : item.quantity || 1;
      return distributedTotal / quantity;
    };

    const calculateDisplayedCategoryTotalForPreview = (items: EvaluationLineItem[], category: string) => {
      if (category === 'tenantImprovements' && hideDesignCosts) {
        // When hiding design costs, show total including distributed design costs
        return items.reduce((total, item) => {
          return total + calculateDistributedCostsForPreview(item);
        }, 0);
      }
      
      // Use rollup-aware calculation for accurate totals including rolled-up items
      if (category === 'tenantImprovements') {
        return calculateCategoryTotalWithRollups('tenantImprovements');
      } else if (category === 'designSoftCosts') {
        return calculateCategoryTotalWithRollups('designSoftCosts');
      } else if (category === 'existingImprovements') {
        return calculateCategoryTotalWithRollups('existingImprovements');
      }
      
      return calculateCategoryTotal(items);
    };
    
    const renderCategorySection = (title: string, items: EvaluationLineItem[], categoryType?: string) => {
      if (items.length === 0) return '';
      
      // Filter items based on rollup configuration - EXCLUDE rolled up items from main tables
      const filteredItems = items.filter(item => {
        const rollupTarget = budgetData.lineItemRollups[item.id];
        // If item is rolled up, don't show it in any main table
        if (rollupTarget) {
          return false;
        }
        // If item is assembled, don't show it in main table either
        if (item.assemblyId) {
          return false;
        }
        // Only show items that are not rolled up or assembled
        return true;
      });
      
      // Don't add rolled-in items as separate line items - they should be distributed within existing items
      
      const allItemsForCategory = filteredItems;
      if (allItemsForCategory.length === 0) return '';
      
      // Calculate total with rollups
      const total = calculateCategoryTotalWithRollups(categoryType as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements');
      // Use the extracted rentable area
      const isTenantImprovements = categoryType === 'tenantImprovements';
      
      return `
      <div class="section">
          <div class="section-header">
              <h2 class="section-title">
                  ${title}
                  <span style="color: #28a745; font-weight: bold; font-size: 16px;">${formatCurrency(total)} <span style="font-size: 50%; font-weight: normal;">${(() => {
                    const pricePerSf = rentableArea > 0 ? total / rentableArea : 0;
                    return pricePerSf > 0 ? '($' + pricePerSf.toFixed(2) + '/RSF)' : '';
                  })()}</span></span>
              </h2>
          </div>
          <div class="table-container">
              <table>
                  <colgroup>
                      <col style="width:1.80in">
                      <col style="width:0.60in">
                      <col style="width:0.45in">
                      <col style="width:1.15in">
                      <col style="width:1.15in">
                      <col style="width:1.15in">
                  </colgroup>
                  <thead>
                      <tr>
                          <th style="text-align:left">Description</th>
                          <th style="text-align:center">Quantity</th>
                          <th style="text-align:center">Unit</th>
                          <th style="text-align:right">Unit Price</th>
                          <th style="text-align:right">Total Price</th>
                          <th style="text-align:right">$/RSF</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${allItemsForCategory.filter(item => !item.assemblyId).map(item => {
                        // Use distributed costs that include rollups for all items
                        const totalPrice = calculateDistributedCosts(item);
                        // Use distributed unit price that includes rollups
                        const unitPrice = calculateDistributedUnitPrice(item);
                        const pricePerSf = rentableArea > 0 ? totalPrice / rentableArea : 0;
                        return `
                        <tr>
                            <td>${item.isFixedAllowance ? '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="11" viewBox="0 0 14 17" style="display:inline-block;vertical-align:middle;margin-right:3px;opacity:0.55;"><rect x="1" y="7" width="12" height="9" rx="1.5" fill="#64748b"/><path d="M4 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round"/></svg>' : ''}${item.description}</td>
                            <td>${new Intl.NumberFormat('en-US').format(item.quantity)}</td>
                            <td>${item.unit}</td>
                            <td class="currency">${formatCurrency(unitPrice)}</td>
                            <td class="currency">${formatCurrency(totalPrice)}</td>
                            <td class="currency">${pricePerSf > 0 ? '$' + pricePerSf.toFixed(2) : 'N/A'}</td>
                        </tr>
                        `;
                      }).join('')}
                      
                      ${Object.entries(budgetData.assemblies || {}).filter(([name, data]) => {
                        // Show assemblies that belong to this category
                        const assemblyItems = data.components.map(id => {
                          const allItems = [...budgetData.tenantImprovements, ...budgetData.designSoftCosts, ...budgetData.existingImprovements];
                          return allItems.find(item => item.id === id);
                        }).filter(Boolean);
                        return assemblyItems.some(item => item && allItemsForCategory.includes(item));
                      }).map(([assemblyName, assemblyData]) => {
                        const pricePerSf = rentableArea > 0 ? assemblyData.total / rentableArea : 0;
                        return `
                        <tr>
                            <td><strong>${assemblyName}</strong></td>
                            <td>1</td>
                            <td>assembly</td>
                            <td class="currency">${formatCurrency(assemblyData.total)}</td>
                            <td class="currency">${formatCurrency(assemblyData.total)}</td>
                            <td class="currency">${pricePerSf > 0 ? '$' + pricePerSf.toFixed(2) : 'N/A'}</td>
                        </tr>
                        `;
                      }).join('')}
                  </tbody>
              </table>
          </div>
      </div>`;
    };

    const renderExistingImprovementsSection = () => {
      // DEBUG: Log existing improvements data
      
      // Separate improvements by bucket
      const actualsItems = budgetData.existingImprovements.filter((item: any) => item.bucket === 'ACTUALS');
      const pipelineItems = budgetData.existingImprovements.filter((item: any) => item.bucket === 'PIPELINE');
      // Items with no bucket classification (e.g. property-sourced improvements)
      const unbucketedItems = budgetData.existingImprovements.filter((item: any) => !item.bucket || (item.bucket !== 'ACTUALS' && item.bucket !== 'PIPELINE'));
      
      const actualsTotal = calculateCategoryTotal(actualsItems);
      const pipelineTotal = calculateCategoryTotal(pipelineItems);
      const unbucketedTotal = calculateCategoryTotal(unbucketedItems);
      const grandTotal = actualsTotal + pipelineTotal + unbucketedTotal;
      
      const renderSection = (title: string, items: any[], total: number, colorClass: string, description: string) => {
        if (items.length === 0) return '';
        
        return `
        <div class="section" style="margin-bottom: 20px;">
            <div class="section-header">
                <h2 class="section-title" style="color: #333;">
                    ${title}
                    <span style="color: ${colorClass} !important; font-style: italic !important; font-weight: bold !important; font-size: 16px !important;">${formatCurrency(total)} <span style="font-size: 50%; font-weight: normal;">${(() => {
                      const pricePerSf = rentableArea > 0 ? total / rentableArea : 0;
                      return pricePerSf > 0 ? '($' + pricePerSf.toFixed(2) + '/RSF)' : '';
                    })()}</span></span>
                </h2>
                <p style="font-size: 12px; color: #666; margin-top: 5px;">${description}</p>
            </div>
            <div class="table-container">
                <table>
                    <colgroup>
                        <col style="width:1.80in">
                        <col style="width:0.60in">
                        <col style="width:0.45in">
                        <col style="width:1.15in">
                        <col style="width:1.15in">
                        <col style="width:1.15in">
                    </colgroup>
                    <thead>
                        <tr>
                            <th style="text-align:left">Description</th>
                            <th style="text-align:center">Quantity</th>
                            <th style="text-align:center">Unit</th>
                            <th style="text-align:right">Unit Price</th>
                            <th style="text-align:right">Total Price</th>
                            <th style="text-align:right">$/RSF</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.filter(item => {
                          // Always show items that don't belong to an assembly
                          if (!item.assemblyId) return true;
                          
                          // For items in assemblies, check if the assembly spans multiple buckets
                          const assemblyEntry = Object.entries(budgetData.assemblies || {}).find(([name]) => name === item.assemblyId);
                          if (!assemblyEntry) return true; // Show if assembly not found
                          
                          const [_, assemblyData] = assemblyEntry;
                          const allComponentItems = assemblyData.components.map(id => {
                            return budgetData.existingImprovements.find(compItem => compItem.id === id);
                          }).filter(Boolean);
                          
                          // Show individual items if assembly spans multiple buckets
                          const assemblySpansBuckets = !allComponentItems.every(compItem => items.includes(compItem));
                          return assemblySpansBuckets;
                        }).map(item => {
                          const totalPrice = parseFloat(item.totalPrice) || 0;
                          const pricePerSf = rentableArea > 0 ? totalPrice / rentableArea : 0;
                          return `
                          <tr>
                              <td>${item.description}${item.assemblyId ? ' <em>(from mixed-bucket assembly)</em>' : ''}</td>
                              <td>${new Intl.NumberFormat('en-US').format(item.quantity)}</td>
                              <td>${item.unit}</td>
                              <td class="currency">${formatCurrency(parseFloat(item.unitPrice) || 0)}</td>
                              <td class="currency">${formatCurrency(totalPrice)}</td>
                              <td class="currency">${pricePerSf > 0 ? '$' + pricePerSf.toFixed(2) : 'N/A'}</td>
                          </tr>
                          `;
                        }).join('')}
                        
                        ${Object.entries(budgetData.assemblies || {}).filter(([name, data]) => {
                          // Get all component items from the full list to check their buckets
                          const allComponentItems = data.components.map(id => {
                            return budgetData.existingImprovements.find(item => item.id === id);
                          }).filter(Boolean);
                          
                          // Only show assembly row if ALL components belong to this bucket
                          return allComponentItems.length > 0 && allComponentItems.every(item => items.includes(item));
                        }).map(([assemblyName, assemblyData]) => {
                          const pricePerSf = rentableArea > 0 ? assemblyData.total / rentableArea : 0;
                          return `
                          <tr>
                              <td><strong>${assemblyName}</strong></td>
                              <td>1</td>
                              <td>assembly</td>
                              <td class="currency">${formatCurrency(assemblyData.total)}</td>
                              <td class="currency">${formatCurrency(assemblyData.total)}</td>
                              <td class="currency">${pricePerSf > 0 ? '$' + pricePerSf.toFixed(2) : 'N/A'}</td>
                          </tr>
                          `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
      };
      
      if (budgetData.existingImprovements.length === 0) {
        return `
        <div class="section">
            <div class="section-header">
                <h2 class="section-title" style="color: #333;">Existing Improvements</h2>
            </div>
            <div class="table-container">
                <p style="text-align: center; color: #6c757d; padding: 20px;">No existing improvements added yet</p>
            </div>
        </div>`;
      }
      
      // Count how many bucketed sections will render (to decide whether to show combined total)
      const bucketedSectionCount = (actualsItems.length > 0 ? 1 : 0) + (pipelineItems.length > 0 ? 1 : 0);

      return `
      ${renderSection(
        'Cost to Date (Actuals)', 
        actualsItems, 
        actualsTotal, 
        '#10b981', 
        'Confirmed expenditures from lender draws'
      )}
      
      ${renderSection(
        'Committed / Projected Costs', 
        pipelineItems, 
        pipelineTotal, 
        '#0891b2', 
        'Committed or projected costs not yet in draws'
      )}

      ${renderSection(
        'Existing Improvements',
        unbucketedItems,
        unbucketedTotal,
        '#6366f1',
        'Property improvements carried into this evaluation'
      )}
      
      ${bucketedSectionCount > 1 ? `
      <div style="text-align: right; padding: 10px; background-color: #f8f9fa; border-radius: 4px; margin-bottom: 15px;">
          <span style="font-weight: bold; font-size: 16px;">Total Existing Improvements: ${formatCurrency(grandTotal)}</span>
      </div>` : ''}
      
      <div class="existing-improvements-note">
          <strong>Note:</strong> These existing improvements are ${budgetData.includeExistingInTotal ? 'included in' : 'excluded from'} the Grand Total calculation.
          ${!budgetData.includeExistingInTotal ? ' They are tracked separately for financial modeling purposes.' : ''}
      </div>`;
    };
    
    const reportHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=1200">
    <title>Evaluation Budget Report - ${rfp?.projectName}</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.4;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 15px;
            background-color: white;
        }
        .header {
            border-bottom: 3px solid rgb(0,50,130);
            padding-bottom: 20px;
            margin-bottom: 30px;
            position: relative;
        }
        .document-title {
            font-size: 24px;
            font-weight: bold;
            color: white;
            margin-bottom: 10px;
            background: rgb(0,50,130);
            padding: 10px;
            border-radius: 5px;
            text-align: center;
        }
        .project-title {
            font-size: 16px;
            color: #666;
            margin-bottom: 20px;
            text-align: center;
        }
        .header h1 { margin: 0 0 5px 0; font-size: 18px; font-weight: 600; color: #333; }
        .header p { margin: 1px 0; font-size: 12px; color: #666; }
        .section {
            margin-bottom: 15px;
            border: 1px solid #dee2e6;
            border-radius: 4px;
        }
        .section-header {
            background-color: #f8f9fa;
            padding: 8px 12px;
            border-bottom: 1px solid #dee2e6;
        }
        .section-title {
            margin: 0;
            color: #333;
            font-size: 16px;
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .section-total { font-weight: bold; color: #28a745; font-size: 16px; }
        .section-total.existing-improvements { color: #0891b2 !important; font-style: italic !important; }
        .existing-improvements-total { color: #0891b2 !important; font-style: italic !important; font-weight: bold !important; }
        .table-container { padding: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 5px; table-layout: fixed; }
        th, td { padding: 6px 8px; border-bottom: 1px solid #dee2e6; vertical-align: top; font-size: 13px; }
        th {
            background-color: #f8f9fa;
            font-weight: 600;
            color: #495057;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        /* Consistent column widths for alignment */
        th:nth-child(1), td:nth-child(1) { width: 35%; text-align: left; }    /* Description */
        th:nth-child(2), td:nth-child(2) { width: 10%; text-align: center; }  /* Quantity */
        th:nth-child(3), td:nth-child(3) { width: 8%; text-align: center; }   /* Unit */
        th:nth-child(4), td:nth-child(4) { width: 17%; text-align: right; }   /* Unit Price */
        th:nth-child(5), td:nth-child(5) { width: 17%; text-align: right; }   /* Total Price */
        th:nth-child(6), td:nth-child(6) { width: 13%; text-align: right; }   /* $ / sf */
        
        .currency { text-align: right; font-weight: 600; }
        .fixed-lock-icon {
            display: inline-block;
            font-size: 9px;
            color: #94a3b8;
            margin-left: 4px;
            opacity: 0.75;
            vertical-align: middle;
        }
        .grand-total {
            border: 1px solid #dee2e6;
            color: #333;
            padding: 12px;
            border-radius: 4px;
            text-align: center;
            margin: 15px 0;
        }
        .grand-total h2 { margin: 0; font-size: 16px; font-weight: bold; }
        .notes-section {
            border: 1px solid #dee2e6;
            padding: 12px;
            border-radius: 4px;
            margin: 15px 0;
        }
        .notes-title { color: #495057; margin: 0 0 8px 0; font-size: 14px; font-weight: 600; }
        .notes-content {
            background-color: #f8f9fa;
            padding: 10px;
            border-radius: 3px;
            border-left: 3px solid #007bff;
            white-space: pre-wrap;
            font-size: 13px;
        }
        .rollup-summary-section {
            border: 1px solid #dee2e6;
            padding: 12px;
            border-radius: 4px;
            margin: 15px 0;
        }
        .rollup-summary-title { 
            color: #495057; 
            margin: 0 0 6px 0; 
            font-size: 14px; 
            font-weight: 600;
        }
        .rollup-summary-description {
            color: #6c757d;
            margin: 0 0 8px 0;
            font-size: 12px;
        }
        .rollup-summary-content {
            background-color: #f8f9fa;
            padding: 8px;
            border-radius: 3px;
            border-left: 3px solid #17a2b8;
        }
        .rollup-summary-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 0;
            border-bottom: 1px solid #dee2e6;
            font-size: 12px;
        }
        .rollup-summary-item:last-child {
            border-bottom: none;
        }
        .rollup-item-name {
            color: #495057;
        }
        .rollup-item-target {
            color: #17a2b8;
            font-weight: 500;
        }
        .existing-improvements-note {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 3px;
            padding: 8px;
            margin-top: 8px;
            font-size: 12px;
            color: #856404;
        }
        .tenant-share-item {
            background-color: white;
            border: 1px solid #e9ecef;
            border-radius: 3px;
            padding: 10px;
            margin-bottom: 10px;
        }
        .tenant-share-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            padding-bottom: 5px;
            border-bottom: 1px solid #e9ecef;
        }
        .tenant-share-name {
            font-weight: 500;
            color: #495057;
            font-size: 12px;
        }
        .tenant-share-percentage {
            background-color: #fd7e14;
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
        }
        .tenant-share-breakdown {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            font-size: 12px;
        }
        .cost-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
        }
        .cost-label {
            color: #6c757d;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 3px;
        }
        .cost-value {
            font-weight: 600;
            color: #495057;
        }
        .tenant-cost {
            color: #28a745;
        }
        .remaining-cost {
            color: #fd7e14;
        }
        .tenant-share-note {
            background-color: #fdf2e9;
            border: 1px solid #fd7e14;
            border-radius: 3px;
            padding: 8px;
            margin-top: 10px;
            font-size: 12px;
            color: #c1611d;
        }
        @page {
            size: 8.5in 11in;
            margin: 1in;
        }
        @media print {
            /* ── Body / layout ── */
            body {
                background-color: white;
                max-width: 100%;
                width: 6.5in;
                margin: 0;
                padding: 0;
                font-size: 8pt;
            }
            .section { border: 1px solid #ddd; }
            .table-container { padding: 3px; }

            /* ── Table base ── */
            table {
                width: 6.3in;          /* slight inset from section border */
                table-layout: fixed;
                border-collapse: collapse;
                font-size: 8pt;
            }

            /* ── Cell padding & base font ── */
            th, td {
                padding: 5px 5px;
                font-size: 8pt;
                overflow: hidden;
                vertical-align: top;
            }
            th {
                font-size: 7pt;
                letter-spacing: 0;
            }

            /* ── Explicit column widths — sum = 6.3in ── */
            /* Col 1 Description  : 1.80in — wraps if needed; numeric cols get more room */
            /* Col 2 Quantity      : 0.60in — numeric, short                             */
            /* Col 3 Unit          : 0.45in — "EA", "SF" etc.                            */
            /* Col 4 Unit Price    : 1.15in — fits "$13,090,213.61" with breathing room  */
            /* Col 5 Total Price   : 1.15in — same                                       */
            /* Col 6 $/RSF         : 1.15in — even with Unit Price / Total Price         */
            th:nth-child(1), td:nth-child(1) { width: 1.80in; text-align: left;   word-break: break-word; white-space: normal; }
            th:nth-child(2), td:nth-child(2) { width: 0.60in; text-align: center; white-space: nowrap; }
            th:nth-child(3), td:nth-child(3) { width: 0.45in; text-align: center; white-space: nowrap; }
            th:nth-child(4), td:nth-child(4) { width: 1.15in; text-align: right;  white-space: nowrap; }
            th:nth-child(5), td:nth-child(5) { width: 1.15in; text-align: right;  white-space: nowrap; }
            th:nth-child(6), td:nth-child(6) { width: 1.15in; text-align: right;  white-space: nowrap; }

            /* ── Page-break rules ── */
            /* Repeat the thead on every continued page */
            thead { display: table-header-group; }
            /* Never cut a data row across a page break */
            tr { page-break-inside: avoid; }
            /* Keep section headers with the content below them */
            .section { page-break-inside: auto; }
            .section-header { page-break-after: avoid; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div style="flex: 1;">
                <img src="/api/bridge-logo" alt="Kurv Industrial" style="height: 30px; max-width: 200px;" />
            </div>
            <div style="flex: 1; text-align: right; font-size: 10px; color: #666;">
                <p style="margin: 0;">Generated: ${currentDate}</p>
            </div>
        </div>
        
        <div class="document-title">Evaluation Budget Report</div>
        <div class="project-title">
            <strong>Project:</strong> ${rfp?.projectName}<br>
            <strong>RFP Number:</strong> ${rfp?.rfpNumber}
        </div>
    </div>
    
    <!-- Property Summary Section -->
    <div class="section">
        <div class="section-header">
            <h2 class="section-title" style="font-size: 14px;">Property Summary</h2>
        </div>
        <div class="table-container">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 8px;">
                <div>
                    <p style="margin: 4px 0; font-size: 13px;"><strong>Rentable Area:</strong> ${rentableArea > 0 ? new Intl.NumberFormat('en-US').format(rentableArea) + ' sf' : 'Not specified'}</p>
                    <p style="margin: 4px 0; font-size: 13px;"><strong>Bay Count:</strong> ${(() => {
                      if (rfp?.selectedBayConfigurations && rfp.selectedBayConfigurations.length > 0) {
                        return rfp.selectedBayConfigurations.length + ' bays';
                      }
                      if (rfp?.selectedBayIds && Array.isArray(rfp.selectedBayIds) && rfp.selectedBayIds.length > 0) {
                        return rfp.selectedBayIds.length + ' bays';
                      }
                      return 'Not specified';
                    })()}</p>
                    <p style="margin: 4px 0; font-size: 13px;"><strong>Door Configuration:</strong> ${budgetData.oversizedDoors + budgetData.regularDoors} doors total (${budgetData.oversizedDoors} oversized, ${budgetData.regularDoors} regular)</p>
                </div>
                <div>
                    <p style="margin: 4px 0; font-size: 13px;"><strong>Vehicular Parking:</strong> ${budgetData.vehicularParking || 0} spaces</p>
                    <p style="margin: 4px 0; font-size: 13px;"><strong>Trailer Parking:</strong> ${budgetData.trailerParking || 0} spaces</p>
                    <p style="margin: 4px 0; font-size: 13px;"><strong>Electrical Allocation:</strong> ${(() => {
                      // Use AMPS from evaluation budget (allows editing in Step 5)
                      const totalAmps = budgetData.electricalAllocations.reduce((sum, alloc) => {
                        // Use stored amps if available, otherwise calculate from kVA (legacy data)
                        return sum + (alloc.amps ?? kvaToAmps(alloc.kva, alloc.voltage));
                      }, 0);
                      return totalAmps.toLocaleString();
                    })()} AMPS</p>
                </div>
            </div>
        </div>
    </div>

    ${renderCategorySection("Tenant Improvements", budgetData.tenantImprovements, "tenantImprovements")}
    ${!hideDesignCosts ? renderCategorySection("Design / Soft Costs / Other Fees", budgetData.designSoftCosts, "designSoftCosts") : ''}

    <div class="grand-total">
        <h2>Grand Total: ${formatCurrency(grandTotal)} <span style="font-size: 50%; font-weight: normal;">${(() => {
          const pricePerSf = rentableArea > 0 ? grandTotal / rentableArea : 0;
          return pricePerSf > 0 ? '($' + pricePerSf.toFixed(2) + '/RSF)' : '';
        })()}</span></h2>
        ${budgetData.hasExistingImprovements && !budgetData.includeExistingInTotal ? 
          '<p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">* Existing improvements tracked separately for financial modeling</p>' : ''
        }
    </div>



    ${budgetData.notes ? `
    <div class="notes-section">
        <h3 style="color: #333; font-size: 16px; font-weight: 600; margin: 0 0 8px 0;">Budget Notes</h3>
        <div class="notes-content">${budgetData.notes}</div>
    </div>
    ` : ''}

    ${Object.keys(budgetData.lineItemRollups).length > 0 ? `
    <div class="rollup-summary-section">
        <h3 style="color: #333; font-size: 16px; font-weight: 600; margin: 0 0 8px 0;">Line Item Rollup Summary <span style="color: #9333ea; font-style: italic; font-weight: normal;">(${(() => {
          const rollupTotal = Object.entries(budgetData.lineItemRollups).reduce((total, [itemId]) => {
            const allItems = [
              ...budgetData.tenantImprovements,
              ...budgetData.designSoftCosts,
              ...budgetData.existingImprovements
            ];
            const item = allItems.find(i => i.id === itemId);
            return total + (item ? parseFloat(item.totalPrice) || 0 : 0);
          }, 0);
          return formatCurrency(rollupTotal);
        })()})</span></h3>
        <p class="rollup-summary-description">The following items are being redistributed to different categories:</p>
        <div class="rollup-summary-content">
            ${Object.entries(budgetData.lineItemRollups).map(([itemId, targetCategory]) => {
              const allItems = [
                ...budgetData.tenantImprovements,
                ...budgetData.designSoftCosts,
                ...budgetData.existingImprovements
              ];
              const item = allItems.find(i => i.id === itemId);
              if (!item) return '';
              
              const targetName = targetCategory === 'tenantImprovements' ? 'Tenant Improvements' : 
                targetCategory === 'designSoftCosts' ? 'Design/Soft Costs' : 
                targetCategory === 'tiAndDesign' ? (() => {
                  const tiTotal = calculateCategoryTotal(budgetData.tenantImprovements);
                  const designTotal = calculateCategoryTotal(budgetData.designSoftCosts);
                  const combinedTotal = tiTotal + designTotal;
                  if (combinedTotal > 0) {
                    const tiPercent = Math.round((tiTotal / combinedTotal) * 100);
                    const designPercent = Math.round((designTotal / combinedTotal) * 100);
                    return `TI & Design (${tiPercent}%/${designPercent}%)`;
                  }
                  return 'TI & Design (50%/50%)';
                })() : 'Existing Improvements';
              
              return `<div class="rollup-summary-item">
                <span class="rollup-item-name"><strong>${item.description}</strong> (${formatCurrency(item.totalPrice)})</span>
                <span class="rollup-item-target">→ Rolling to ${targetName}</span>
              </div>`;
            }).join('')}
        </div>
    </div>
    ` : ''}

    ${(() => {
      // Check for assembled items across all categories
      const allItems = [
        ...budgetData.tenantImprovements,
        ...budgetData.designSoftCosts,
        ...budgetData.existingImprovements
      ];
      const assembledItems = allItems.filter(item => item.assemblyId);
      const hasAssemblies = assembledItems.length > 0 || (budgetData.customAssemblies && budgetData.customAssemblies.length > 0);
      
      return hasAssemblies;
    })() ? `
    <div class="rollup-summary-section">
        <h3 style="color: #333; font-size: 16px; font-weight: 600; margin: 0 0 8px 0;">Assembly Summary</h3>
        <p class="rollup-summary-description">The following line items are grouped into assemblies:</p>
        <div class="rollup-summary-content">
            ${(() => {
              // Group items by their assembly
              const allItems = [
                ...budgetData.tenantImprovements,
                ...budgetData.designSoftCosts,
                ...budgetData.existingImprovements
              ];
              const assembledItems = allItems.filter(item => item.assemblyId);
              const assembliesByName: Record<string, any[]> = {};
              
              // Group by assembly name/ID and find assembly display names
              assembledItems.forEach(item => {
                const assemblyId = item.assemblyId;
                if (assemblyId) {
                  if (!assembliesByName[assemblyId]) {
                    assembliesByName[assemblyId] = [];
                  }
                  assembliesByName[assemblyId].push(item);
                }
              });
              
              // Find assembly names by looking for the assembly line item itself
              const getAssemblyDisplayName = (assemblyId: string): string => {
                if (!assemblyId) return 'Unknown Assembly';
                
                // Look for the assembly line item in all categories - the assembly line item has the assembly name as its description
                const allCategoryItems = [
                  ...budgetData.tenantImprovements,
                  ...budgetData.designSoftCosts,
                  ...budgetData.existingImprovements
                ];
                
                // Find the assembly line item (the one with id matching assemblyId)
                const assemblyLineItem = allCategoryItems.find(item => item.id === assemblyId);
                if (assemblyLineItem && assemblyLineItem.description) {
                  return assemblyLineItem.description;
                }
                
                // Fallback to a user-friendly name based on timestamp
                const timestamp = assemblyId.replace('assembly_', '');
                return `Custom Assembly ${timestamp.slice(-4)}`;
              };
              
              // Generate summary for each assembly with proper name lookup
              const getAssemblyDisplayNameForPDF = (assemblyId: string): string => {
                if (!assemblyId) return 'Unknown Assembly';
                
                // Look for the assembly line item in all categories - the assembly line item has the assembly name as its description
                const allCategoryItems = [
                  ...budgetData.tenantImprovements,
                  ...budgetData.designSoftCosts,
                  ...budgetData.existingImprovements
                ];
                
                // Find the assembly line item (the one with id matching assemblyId)
                const assemblyLineItem = allCategoryItems.find(item => item.id === assemblyId);
                if (assemblyLineItem && assemblyLineItem.description) {
                  return assemblyLineItem.description;
                }
                
                // Fallback
                const timestamp = assemblyId.replace('assembly_', '');
                return `Custom Assembly ${timestamp.slice(-4)}`;
              };
              
              // Generate summary for each assembly
              return Object.entries(assembliesByName).map(([assemblyId, items]) => {
                const assemblyDisplayName = getAssemblyDisplayNameForPDF(assemblyId);
                return items.map((item: any) => `
                  <div class="rollup-summary-item">
                    <span class="rollup-item-name"><strong>${item.description}</strong> (${formatCurrency(parseFloat(item.totalPrice) || 0)})</span>
                    <span class="rollup-item-target">→ Grouped in ${assemblyDisplayName}</span>
                  </div>
                `).join('');
              }).join('');
            })()}
        </div>
    </div>
    ` : ''}

    ${(() => {
      // Tenant Share Summary for PDF
      const allItems = [
        ...budgetData.tenantImprovements,
        ...budgetData.designSoftCosts,
        ...budgetData.existingImprovements
      ];
      
      const proratedItems = allItems.filter(item => (item.tenantShare || 100) < 100);
      
      if (proratedItems.length === 0) return '';

      return `
      <div class="rollup-summary-section">
          <h3 style="color: #333; font-size: 16px; font-weight: 600; margin: 0 0 8px 0;">Tenant Share Summary</h3>
          <p class="rollup-summary-description">The following items have been prorated based on tenant responsibility percentage:</p>
          <div class="tenant-share-content">
              ${proratedItems.map(item => {
                const totalCost = parseFloat(item.totalPrice) || 0;
                const tenantShare = item.tenantShare || 100;
                const tenantCost = totalCost * (tenantShare / 100);
                const remainingCost = totalCost - tenantCost;
                const remainingPercentage = 100 - tenantShare;
                
                return `
                  <div class="tenant-share-item">
                    <div class="tenant-share-header">
                      <span class="tenant-share-name"><strong>${item.description}</strong></span>
                      <span class="tenant-share-percentage">${tenantShare}% Tenant Share</span>
                    </div>
                    <div class="tenant-share-breakdown">
                      <div class="cost-item">
                        <span class="cost-label">Total Cost</span>
                        <span class="cost-value">${formatCurrency(totalCost)}</span>
                      </div>
                      <div class="cost-item">
                        <span class="cost-label">Tenant Share</span>
                        <span class="cost-value tenant-cost">${formatCurrency(tenantCost)}</span>
                      </div>
                      <div class="cost-item">
                        <span class="cost-label">Outstanding Share</span>
                        <span class="cost-value remaining-cost">${formatCurrency(remainingCost)}</span>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
              <div class="tenant-share-note">
                <strong>Note:</strong> The "Remaining" amounts represent costs that could be attributed to other tenants 
                or additional lease allocations to achieve 100% cost recovery for shared improvements.
              </div>
          </div>
      </div>
      `;
    })()}

    ${budgetData.existingImprovements.length > 0 ? renderExistingImprovementsSection() : ''}
</body>
</html>`;
    
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(reportHtml);
      newWindow.document.close();
    }

    // Automatically log this report generation to history
    if (rfp?.id) {
      logHistoryMutation.mutate({
        rfpId: rfp.id,
        reportName: `Evaluation Budget Report${hideDesignCosts ? ' (Design Costs Hidden)' : ''}`,
        generatedContent: reportHtml,
        notes: `Generated on ${currentDate}. Grand Total: ${formatCurrency(grandTotal)}`,
        budgetData: budgetData // Send current budget data for change tracking
      });
    }
  };

  const addNewItem = (category: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', addAnother: boolean = false) => {
    if (!newItem.description && !newItem.unitPrice) {
      toast({ title: "Missing fields", description: "Select an item from the picker (or choose 'Use as custom entry') and enter a unit price.", variant: "destructive" });
      return;
    }
    if (!newItem.description) {
      toast({ title: "Description required", description: "Select an item from the dropdown or click 'Use as custom entry' to set the description.", variant: "destructive" });
      return;
    }
    if (!newItem.unitPrice) {
      toast({ title: "Unit price required", description: "Enter a unit price before adding this line item.", variant: "destructive" });
      return;
    }

    const quantity = newItem.quantity || 1;
    const unitPrice = parseFloat(newItem.unitPrice) || 0;
    const totalPrice = computeLineTotal({
      quantity, unitPrice, item: (newItem as any).romSnapshot,
    }).total.toFixed(2);

    const item: EvaluationLineItem = {
      id: `${category}-${Date.now()}`,
      description: newItem.description,
      quantity,
      unit: newItem.unit || "ea",
      unitPrice: unitPrice.toFixed(2),
      totalPrice,
      tenantShare: newItem.tenantShare || 100,
      masterItemId: newItem.masterItemId ?? null,
      masterItemSnapshot: newItem.masterItemSnapshot ?? null,
      customDescription: newItem.customDescription ?? null,
    };

    setBudgetData(prev => ({
      ...prev,
      [category]: [...prev[category], item],
    }));

    // Reset form but keep category if adding another
    setNewItem({
      description: "",
      quantity: 1,
      unit: "", // Always reset unit to blank
      unitPrice: "",
      totalPrice: "",
      tenantShare: 100,
      masterItemId: null,
      masterItemSnapshot: null,
      customDescription: null,
    });
    
    if (!addAnother) {
      setNewItemCategory("");
    } else {
      // Increment key to remount the picker with fully fresh internal state
      // (clears query text, results list, open/closed state, Other mode flag)
      setPickerKey(k => k + 1);
      // Auto-focus the picker's input after remount
      setTimeout(() => {
        const pickerInput = document.querySelector('input[placeholder="Type to search scope items…"]') as HTMLInputElement;
        if (pickerInput) {
          pickerInput.focus();
        }
      }, 50);
    }
  };

  // Add multiple blank line items (matching bid collection functionality)
  const addMultipleBlankItems = (category: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', count: number = 1) => {
    const newItems = Array(count).fill(null).map((_, index) => ({
      id: `${category}-${Date.now()}-${index}`,
      description: "",
      quantity: 1,
      unit: "",
      unitPrice: "",
      totalPrice: "",
      tenantShare: 100,
    }));

    setBudgetData(prev => ({
      ...prev,
      [category]: [...prev[category], ...newItems],
    }));

    toast({
      title: "Line Items Added",
      description: `${count} blank line item${count > 1 ? 's' : ''} added to ${category.replace(/([A-Z])/g, ' $1').toLowerCase().trim()}`,
    });
  };

  const updateItem = (category: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', itemId: string, updates: Partial<EvaluationLineItem>) => {
    // Track manual override for auto-calculated items when quantity, unit, or unitPrice is changed
    // This prevents auto-population from overwriting user changes
    if ((updates.quantity !== undefined || updates.unit !== undefined || updates.unitPrice !== undefined) && category === 'designSoftCosts') {
      setBudgetData(prev => {
        const item = prev[category].find(i => i.id === itemId);
        if (item) {
          const desc = (item.description || "").toLowerCase();
          // Check if this is an auto-calculated item
          const isAutoCalcItem = 
            (desc.includes("design") && (desc.includes("architectural") || desc.includes("architect"))) ||
            (desc.includes("builder") && desc.includes("risk")) ||
            (desc.includes("permit") && desc.includes("fee")) ||
            (desc.includes("construction") && desc.includes("management")) ||
            desc.includes("contingency") ||
            desc.includes("demising wall");
          
          if (isAutoCalcItem) {
            setManualOverrides(prev => new Set(prev).add(itemId));
          }
        }
        return prev;
      });
    }
    
    // Also track manual overrides for TI items (like Demising Wall that gets auto-populated)
    if ((updates.quantity !== undefined || updates.unit !== undefined || updates.unitPrice !== undefined) && category === 'tenantImprovements') {
      setBudgetData(prev => {
        const item = prev[category].find(i => i.id === itemId);
        if (item) {
          const desc = (item.description || "").toLowerCase();
          // Check if this is an auto-populated item
          const isAutoPopulatedItem = 
            desc.includes("demising wall") ||
            desc.includes("office area") ||
            desc.includes("warehouse office");
          
          if (isAutoPopulatedItem) {
            setManualOverrides(prev => new Set(prev).add(itemId));
          }
        }
        return prev;
      });
    }

    setBudgetData(prev => ({
      ...prev,
      [category]: prev[category].map(item => {
        if (item.id === itemId) {
          const updatedItem = { ...item, ...updates };
          
          // Recalculate total if quantity or unit price changed
          if (updates.quantity !== undefined || updates.unitPrice !== undefined) {
            const quantity = updatedItem.quantity;
            const unitPrice = parseFloat(updatedItem.unitPrice) || 0;
            updatedItem.totalPrice = computeLineTotal({
              quantity, unitPrice, item: updatedItem.romSnapshot,
            }).total.toFixed(2);
          }
          
          return updatedItem;
        }
        return item;
      }),
    }));
  };

  const deleteItem = (category: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', itemId: string) => {
    setBudgetData(prev => {
      // Check if this item is an assembly header (other items reference it as their assemblyId)
      const isAssemblyHeader = [
        ...prev.tenantImprovements,
        ...prev.designSoftCosts,
        ...prev.existingImprovements,
      ].some(item => item.assemblyId === itemId);
      
      // Function to release items from this assembly if deleting the header
      const releaseFromAssembly = (items: EvaluationLineItem[]) => 
        items.map(item => 
          item.assemblyId === itemId 
            ? { ...item, assemblyId: undefined }
            : item
        );
      
      // Filter out the deleted item and release any orphaned assembly items
      const updatedItems = releaseFromAssembly(prev[category]).filter(item => item.id !== itemId);
      
      // Also release items from other categories if this was an assembly header
      const updatedTI = category === 'tenantImprovements' 
        ? updatedItems 
        : (isAssemblyHeader ? releaseFromAssembly(prev.tenantImprovements) : prev.tenantImprovements);
      const updatedDSC = category === 'designSoftCosts' 
        ? updatedItems 
        : (isAssemblyHeader ? releaseFromAssembly(prev.designSoftCosts) : prev.designSoftCosts);
      const updatedEI = category === 'existingImprovements' 
        ? updatedItems 
        : (isAssemblyHeader ? releaseFromAssembly(prev.existingImprovements) : prev.existingImprovements);
      
      // Remove from custom assemblies if this was an assembly header
      const updatedAssemblies = isAssemblyHeader 
        ? prev.customAssemblies.filter(a => a.id !== itemId)
        : prev.customAssemblies;
      
      return {
        ...prev,
        tenantImprovements: updatedTI,
        designSoftCosts: updatedDSC,
        existingImprovements: updatedEI,
        customAssemblies: updatedAssemblies,
      };
    });
  };

  // Clean up orphaned assembly items
  const cleanupAssemblyMutation = useMutation({
    mutationFn: async () => {
      if (!rfp) throw new Error("No RFP selected");
      
      const response = await apiRequest(`/api/rfp-requests/${rfp.id}/evaluation-budget/cleanup-assemblies`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        throw new Error("Failed to cleanup orphaned assembly items");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Cleanup Complete",
        description: `Cleaned up ${data.cleanupCount} orphaned assembly items`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/rfp-requests/${rfp?.id}/evaluation-budget`] });
    },
    onError: (error) => {
      toast({
        title: "Cleanup Failed",
        description: error instanceof Error ? error.message : "Failed to cleanup orphaned assembly items",
        variant: "destructive",
      });
    }
  });

  // Save progress without advancing workflow
  const saveProgressMutation = useMutation({
    mutationFn: async () => {
      if (!rfp) throw new Error("No RFP selected");
      
      const budgetPayload = {
        rfpId: rfp.id,
        tenantImprovements: budgetData.tenantImprovements,
        designSoftCosts: budgetData.designSoftCosts,
        existingImprovements: budgetData.existingImprovements,
        hasExistingImprovements: budgetData.hasExistingImprovements,
        includeExistingInTotal: budgetData.includeExistingInTotal,
        separateDesignCosts: budgetData.separateDesignCosts,
        totalTenantImprovements: calculateCategoryTotal(budgetData.tenantImprovements).toFixed(2),
        totalDesignSoftCosts: calculateCategoryTotal(budgetData.designSoftCosts).toFixed(2),
        totalExistingImprovements: calculateCategoryTotal(budgetData.existingImprovements).toFixed(2),
        grandTotal: calculateGrandTotal().toFixed(2),
        notes: budgetData.notes,
        lineItemRollups: budgetData.lineItemRollups,
        assemblies: budgetData.assemblies,
        metadata: { 
          oversizedDoors: budgetData.oversizedDoors, 
          regularDoors: budgetData.regularDoors,
          vehicularParking: budgetData.vehicularParking,
          trailerParking: budgetData.trailerParking,
          electricalAllocation: budgetData.electricalAllocation,
          calculatedElectricalAllocation: budgetData.calculatedElectricalAllocation,
          electricalAllocationOverride: budgetData.electricalAllocationOverride,
          // Door overrides persist for the same reason electrical does: a manually
          // entered count that resets on reload is worse than one that cannot be
          // entered at all, because the user believes it was saved.
          oversizedDoorsOverride: budgetData.oversizedDoorsOverride,
          regularDoorsOverride: budgetData.regularDoorsOverride,
          tenantVoltage: budgetData.tenantVoltage,
          electricalAllocations: budgetData.electricalAllocations,
          // Manual overrides are intentionally NOT persisted here - they are session-only
          // (component state) per spec and should reset on reload.
        },
      };


      // Bug #2 fix: use apiRequest which calls throwIfResNotOk internally.
      // Previously a raw fetch() was used — HTTP 4xx/5xx responses did not throw,
      // so onSuccess fired (green toast) even when the server rejected the save.
      await apiRequest(`/api/rfp-requests/${rfp.id}/evaluation-budget`, 'POST', budgetPayload);

      // Upload new files if any
      if (attachedFiles.length > 0) {
        const formData = new FormData();
        attachedFiles.forEach((file, index) => {
          formData.append(`attachment_${index}`, file);
        });
        formData.append('rfpId', rfp.id.toString());

        await apiRequest(`/api/rfp-requests/${rfp.id}/evaluation-budget/attachments`, 'POST', formData);
        
        setAttachedFiles([]);
      }
    },
    onSuccess: () => {
      // Bug #3 fix: invalidate the evaluation budget cache so existingBudget
      // re-fetches fresh server data after save. Without this, existingBudget
      // held stale pre-save data; if Effect A re-fired for any reason it would
      // restore the pre-save snapshot, silently losing newly added line items.
      queryClient.invalidateQueries({ queryKey: [`/api/rfp-requests/${rfp?.id}/evaluation-budget`] });
      // Bust the admin review queue cache so any new Other entries appear immediately
      // on the scope-item-review page without requiring a manual page refresh.
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scope-item-review/pending"] });
      toast({
        title: "Progress Saved",
        description: "Your evaluation has been saved. You can continue editing or proceed to team review when ready.",
      });
    },
    onError: (error) => {
      console.error('Save progress error:', error);
      const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      toast({
        title: isTimeout ? "Save Timed Out" : "Save Failed",
        description: isTimeout
          ? "The request took too long (network may be slow or offline). Click Save Progress again to retry."
          : `There was an error saving your progress. Please try again. (${error instanceof Error ? error.message : "Unknown error"})`,
        variant: "destructive",
      });
    },
  });

  const saveAndAdvanceMutation = useMutation({
    mutationFn: async () => {
      if (!rfp) throw new Error("No RFP selected");
      
      const budgetPayload = {
        rfpId: rfp.id,
        tenantImprovements: budgetData.tenantImprovements,
        designSoftCosts: budgetData.designSoftCosts,
        existingImprovements: budgetData.existingImprovements,
        hasExistingImprovements: budgetData.hasExistingImprovements,
        includeExistingInTotal: budgetData.includeExistingInTotal,
        separateDesignCosts: budgetData.separateDesignCosts,
        totalTenantImprovements: calculateCategoryTotal(budgetData.tenantImprovements).toFixed(2),
        totalDesignSoftCosts: calculateCategoryTotal(budgetData.designSoftCosts).toFixed(2),
        totalExistingImprovements: calculateCategoryTotal(budgetData.existingImprovements).toFixed(2),
        grandTotal: calculateGrandTotal().toFixed(2),
        notes: budgetData.notes,
        lineItemRollups: budgetData.lineItemRollups,
        assemblies: budgetData.assemblies,
        metadata: { 
          oversizedDoors: budgetData.oversizedDoors, 
          regularDoors: budgetData.regularDoors,
          vehicularParking: budgetData.vehicularParking,
          trailerParking: budgetData.trailerParking,
          electricalAllocation: budgetData.electricalAllocation,
          calculatedElectricalAllocation: budgetData.calculatedElectricalAllocation,
          electricalAllocationOverride: budgetData.electricalAllocationOverride,
          // Door overrides persist for the same reason electrical does: a manually
          // entered count that resets on reload is worse than one that cannot be
          // entered at all, because the user believes it was saved.
          oversizedDoorsOverride: budgetData.oversizedDoorsOverride,
          regularDoorsOverride: budgetData.regularDoorsOverride,
          tenantVoltage: budgetData.tenantVoltage,
          electricalAllocations: budgetData.electricalAllocations,
          // Persist manual overrides to prevent auto-population from overwriting user changes
          manualOverrides: Array.from(manualOverrides)
        },
      };


      // Bug #2 fix: use apiRequest which calls throwIfResNotOk internally.
      await apiRequest(`/api/rfp-requests/${rfp.id}/evaluation-budget`, 'POST', budgetPayload);

      // Upload new files if any
      if (attachedFiles.length > 0) {
        const formData = new FormData();
        attachedFiles.forEach((file, index) => {
          formData.append(`attachment_${index}`, file);
        });
        formData.append('rfpId', rfp.id.toString());

        await apiRequest(`/api/rfp-requests/${rfp.id}/evaluation-budget/attachments`, 'POST', formData);
        
        setAttachedFiles([]);
      }

      await apiRequest(`/api/rfp-requests/${rfp.id}/workflow-phase`, 'PATCH', { phase: 'publish' });
    },
    onSuccess: () => {
      // Bug #3 fix: invalidate the evaluation budget cache in addition to the RFP list.
      queryClient.invalidateQueries({ queryKey: [`/api/rfp-requests/${rfp?.id}/evaluation-budget`] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      // Bust the admin review queue cache so any new Other entries appear immediately.
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scope-item-review/pending"] });
      toast({
        title: "Budget Saved & Workflow Advanced",
        description: "Evaluation budget saved and project moved to publish phase.",
      });
      // Auto-advance: Call onComplete to open Publish
      onComplete?.();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save budget or advance workflow.",
        variant: "destructive",
      });
    },
  });

  const saveAndAdvance = () => {
    saveAndAdvanceMutation.mutate();
  };

  // Move item up/down functions
  const moveItemUp = (category: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', index: number) => {
    if (index === 0) return;
    
    setBudgetData(prev => {
      const items = [...prev[category]];
      const item = items[index];
      
      // Check if this item is part of an assembly or is an assembly header
      const assembly = prev.customAssemblies.find(a => a.items.includes(item.id) || item.id === a.id);
      
      if (assembly) {
        // Move entire assembly as a group
        const assemblyItems = [item.id, ...assembly.items];
        const assemblyIndices = assemblyItems.map(id => items.findIndex(i => i.id === id)).sort((a, b) => a - b);
        const minIndex = assemblyIndices[0];
        
        if (minIndex === 0) return prev; // Can't move up if already at top
        
        // Remove assembly items from their current positions
        const assemblyItemsData = assemblyIndices.map(idx => items[idx]);
        const filteredItems = items.filter((_, idx) => !assemblyIndices.includes(idx));
        
        // Insert assembly items at new position
        const newIndex = minIndex - 1;
        filteredItems.splice(newIndex, 0, ...assemblyItemsData);
        
        return { ...prev, [category]: filteredItems };
      } else {
        // Move single item
        [items[index], items[index - 1]] = [items[index - 1], items[index]];
        return { ...prev, [category]: items };
      }
    });
  };

  const moveItemDown = (category: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', index: number) => {
    setBudgetData(prev => {
      const items = [...prev[category]];
      
      if (index === items.length - 1) return prev;
      
      const item = items[index];
      
      // Check if this item is part of an assembly or is an assembly header
      const assembly = prev.customAssemblies.find(a => a.items.includes(item.id) || item.id === a.id);
      
      if (assembly) {
        // Move entire assembly as a group
        const assemblyItems = [item.id, ...assembly.items];
        const assemblyIndices = assemblyItems.map(id => items.findIndex(i => i.id === id)).sort((a, b) => a - b);
        const maxIndex = assemblyIndices[assemblyIndices.length - 1];
        
        if (maxIndex === items.length - 1) return prev; // Can't move down if already at bottom
        
        // Remove assembly items from their current positions
        const assemblyItemsData = assemblyIndices.map(idx => items[idx]);
        const filteredItems = items.filter((_, idx) => !assemblyIndices.includes(idx));
        
        // Insert assembly items at new position
        const newIndex = maxIndex - assemblyIndices.length + 2;
        filteredItems.splice(newIndex, 0, ...assemblyItemsData);
        
        return { ...prev, [category]: filteredItems };
      } else {
        // Move single item
        [items[index], items[index + 1]] = [items[index + 1], items[index]];
        return { ...prev, [category]: items };
      }
    });
  };

  // Drag and drop handler
  const handleDragEnd = (result: any) => {
    if (!result.destination) return;

    const { source, destination, draggableId } = result;
    
    // Extract category from droppableId (format: "category-droppable")
    const sourceCategory = source.droppableId.replace('-droppable', '') as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements';
    const destinationCategory = destination.droppableId.replace('-droppable', '') as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements';

    // Don't allow moving between categories for now
    if (sourceCategory !== destinationCategory) return;

    setBudgetData(prev => {
      const items = [...prev[sourceCategory]];
      const draggedItem = items.find(item => item.id === draggableId);
      if (!draggedItem) return prev;

      // Debug logging

      // Check if dragged item is an assembly component (has assemblyId)
      const draggedIsComponent = !!draggedItem.assemblyId;
      
      // Check if dragged item is an assembly header (other items reference it)
      const draggedIsHeader = items.some(item => item.assemblyId === draggableId);


      if (draggedIsComponent || draggedIsHeader) {
        // Determine the assembly header ID
        const assemblyHeaderId = draggedIsComponent ? draggedItem.assemblyId! : draggableId;
        
        
        // Find ALL items that belong to this assembly (header + all components)
        const assemblyGroupItems = items.filter(item => 
          item.id === assemblyHeaderId || item.assemblyId === assemblyHeaderId
        );
        
        
        if (assemblyGroupItems.length > 1) {
          // Get original indices and sort by position
          const itemsWithIndices = assemblyGroupItems.map(item => ({
            item,
            originalIndex: items.findIndex(i => i.id === item.id)
          }));
          
          // Sort by original index to maintain order
          itemsWithIndices.sort((a, b) => a.originalIndex - b.originalIndex);
          const sortedAssemblyItems = itemsWithIndices.map(x => x.item);
          
          // Remove all assembly items from the list
          const assemblyIndices = itemsWithIndices.map(x => x.originalIndex);
          const nonAssemblyItems = items.filter((_, idx) => !assemblyIndices.includes(idx));
          
          // Calculate adjusted destination index
          let adjustedIndex = destination.index;
          assemblyIndices.sort((a, b) => b - a).forEach(removedIdx => {
            if (removedIdx < destination.index) {
              adjustedIndex--;
            }
          });
          
          // Insert the assembly group at the new position
          const result = [...nonAssemblyItems];
          result.splice(adjustedIndex, 0, ...sortedAssemblyItems);
          
          
          return { ...prev, [sourceCategory]: result };
        }
      }
      
      // Default single item move
      const [movedItem] = items.splice(source.index, 1);
      items.splice(destination.index, 0, movedItem);
      return { ...prev, [sourceCategory]: items };
    });
  };

  const renderCategoryTable = (title: string, items: EvaluationLineItem[], category: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', total: number) => {
    const totalWithRollups = calculateCategoryTotalWithRollups(category);
    
    return (
    <Card>
      {/* flex-wrap and min-w-0, not a fixed row.
          This was `flex flex-row items-center justify-between` with no wrapping
          and no overflow, so on a phone the import buttons extended past the
          right edge with no way to reach them - the row could not scroll and the
          buttons could not be tapped. Reported 2026-08-17. */}
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <CardTitle className="text-lg text-black min-w-0">{title}</CardTitle>
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className={`text-lg font-bold ${category === 'existingImprovements' ? 'text-cyan-600 italic' : 'text-green-600'}`}>{formatCurrency(totalWithRollups)}</span>
          {totalWithRollups !== total && (
            <span className="text-sm text-gray-500">
              (Base: {formatCurrency(total)})
            </span>
          )}
          {/* Show buttons only when workflow is collapsed */}
          {isWorkflowCollapsed && (
            <>
              {/* Import from Another RFP button */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowRfpImportModal(true)}
                className="h-8"
              >
                <Copy className="h-4 w-4 mr-1" />
                Import from RFP
              </Button>

              {/* Import from this RFP's ITB Step 3 Scope of Work */}
              <Button
                size="sm"
                variant="outline"
                onClick={handleScopeOfWorkImport}
                className="h-8"
                title="Import line items from this RFP's Invitation to Bid Scope of Work"
              >
                <ListChecks className="h-4 w-4 mr-1" />
                Import from Scope of Work
              </Button>
              
              {/* Import buttons for Tenant Improvements */}
              {category === 'tenantImprovements' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={openImportModal}
                    className="h-8"
                    disabled={!allBidLineItems || !Array.isArray(allBidLineItems) || allBidLineItems.length === 0}
                  >
                    <Upload className="h-4 w-4 mr-1" />
                    Import Pricing
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={openScopeImportModal}
                    className="h-8"
                    disabled={scopeOfWorkItems.length === 0}
                  >
                    <FileText className="h-4 w-4 mr-1" />
                    Import Scope
                  </Button>
                </>
              )}
              {/* Import button for Design Costs */}
              {category === 'designSoftCosts' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openDesignImportModal}
                  className="h-8"
                  disabled={!allDesignLineItems || !Array.isArray(allDesignLineItems) || allDesignLineItems.length === 0}
                >
                  <Upload className="h-4 w-4 mr-1" />
                  Import Design
                </Button>
              )}
              <div className="flex gap-1 items-center">
                <Button
                  size="sm"
                  onClick={() => setNewItemCategory(category)}
                  className="h-8"
                  variant="outline"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Line Item
                </Button>
                <Button 
                  size="sm" 
                  onClick={() => addMultipleBlankItems(category, 5)} 
                  variant="outline" 
                  className="h-8"
                  title="Add 5 line items at once"
                >
                  +5
                </Button>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setNewAssemblyCategory(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements');
                  setShowAssemblyCreator(true);
                }}
                className="h-8"
                disabled={selectedItems.size === 0}
              >
                <Package className="h-4 w-4 mr-1" />
                Add Assembly
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 && !newItemCategory ? (
          <p className="text-gray-500 text-center py-4">No items added yet</p>
        ) : (
          <div>
            <DragDropContext onDragEnd={handleDragEnd}>
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-center">Order</TableHead>
                  <TableHead className="w-20 text-center">Assembly</TableHead>
                  <TableHead className="w-32 text-center">Assembly Group</TableHead>
                  <TableHead className="w-24 text-center">Rollup</TableHead>
                  <TableHead className="w-64">Description</TableHead>
                  <TableHead className="w-36 text-center">Quantity (Unit)</TableHead>
                  <TableHead className="w-32 text-center">Unit Price</TableHead>
                  {!newItemCategory && <TableHead className="w-32 text-center">Total</TableHead>}
                  <TableHead className="w-24 text-center">$/RSF</TableHead>
                  <TableHead className="w-24 text-center">Tenant %</TableHead>
                  <TableHead className="w-28 text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <Droppable droppableId={`${category}-droppable`}>
                {(provided) => (
                  <TableBody ref={provided.innerRef} {...provided.droppableProps}>
                    {items.map((item, index) => {
                      const isAssembled = item.assemblyId;
                      const isRolledUp = budgetData.lineItemRollups[item.id];
                      // Guard: at least one non-fixed line must remain to absorb hidden costs.
                      // If this item is the only non-rolled-up, non-assembled, non-fixed line
                      // in the section, prevent toggling it to fixed.
                      const nonFixedAbsorbers = items.filter(
                        i => !budgetData.lineItemRollups[i.id] && !i.assemblyId && !i.isFixedAllowance
                      );
                      const isLastNonFixed = !item.isFixedAllowance
                        && nonFixedAbsorbers.length === 1
                        && nonFixedAbsorbers[0].id === item.id;
                      
                      return (
                        <Draggable key={item.id} draggableId={item.id} index={index}>
                          {(provided, snapshot) => (
                            <TableRow 
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              style={{
                                ...provided.draggableProps.style,
                                backgroundColor: snapshot.isDragging ? '#f8f9fa' : 'transparent',
                                textDecoration: (isAssembled || isRolledUp) ? 'line-through' : 'none',
                                fontStyle: isRolledUp ? 'italic' : 'normal',
                                opacity: (isAssembled || isRolledUp) ? 0.6 : 1,
                              }}
                              className={isRolledUp ? 'bg-blue-50' : ''}
                            >
                              {/* Order Controls */}
                              <TableCell className="text-center">
                                <div className="flex flex-col items-center gap-1">
                                  {/* Drag Handle */}
                                  <div 
                                    {...provided.dragHandleProps}
                                    className="cursor-grab active:cursor-grabbing p-1 hover:bg-gray-100 rounded"
                                    title="Drag to reorder"
                                  >
                                    <GripVertical className="h-4 w-4 text-gray-400" />
                                  </div>
                                  {/* Manual reorder buttons */}
                                  <div className="flex flex-col gap-0.5">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => moveItemUp(category, index)}
                                      disabled={index === 0}
                                      className="h-5 w-5 p-0"
                                      title="Move up"
                                    >
                                      <ChevronUp className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => moveItemDown(category, index)}
                                      disabled={index === items.length - 1}
                                      className="h-5 w-5 p-0"
                                      title="Move down"
                                    >
                                      <ChevronDown className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>
                              </TableCell>

                              {/* Assembly Checkbox */}
                              <TableCell className="text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <Checkbox
                                    checked={selectedItems.has(item.id)}
                                    onCheckedChange={(checked) => handleItemSelection(item.id, !!checked)}
                                  />
                                  {item.id === primaryItemId && (
                                    <div className="text-xs bg-blue-100 text-blue-800 px-1 rounded font-medium" title="Primary item - defines assembly quantity and unit">
                                      Base
                                    </div>
                                  )}
                                </div>
                              </TableCell>

                              {/* Assembly Group Column */}
                              <TableCell className="text-sm text-gray-600 text-center">
                                {item.assemblyId ? (
                                  // Find the assembly header name
                                  (() => {
                                    const assemblyHeader = items.find(i => i.id === item.assemblyId);
                                    return assemblyHeader ? assemblyHeader.description : 'Unknown Assembly';
                                  })()
                                ) : ''}
                              </TableCell>

                              {/* Rollup Select */}
                              <TableCell className="text-center w-24">
                                <div className="relative">
                                  <select
                                    value={budgetData.lineItemRollups[item.id] || 'none'}
                                    onChange={(e) => handleLineItemRollup(item.id, category, e.target.value as any)}
                                    className="w-full text-xs bg-background border border-input rounded-md appearance-none pr-6 py-1 px-2 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                  >
                                    <option value="none">None</option>
                                    <option value="tenantImprovements">TI</option>
                                    <option value="designSoftCosts">Design</option>
                                    <option value="tiAndDesign">TI & Design</option>
                                  </select>
                                  <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                                </div>
                              </TableCell>

                              {/* Alternate category indicator */}
                              {item.masterCategoryId != null && alternateCategoryIds.has(item.masterCategoryId) && (
                                <div className="absolute top-1 right-1">
                                  <span title="This category has pricing alternates — review Option A vs Option B">
                                    <Info className="h-3 w-3 text-indigo-500 cursor-help" />
                                  </span>
                                </div>
                              )}

                              {/* Editable cells vs Display cells */}
                              {editingItem === item.id ? (
                                <>
                                  <TableCell>
                                    {item.masterItemId ? (
                                      // Linked item: plain text input for renaming the display label.
                                      // updateItem does a spread merge — only description changes,
                                      // masterItemId is preserved automatically without any picker interaction.
                                      <div className="flex flex-col gap-0.5">
                                        <Input
                                          value={item.description}
                                          onChange={(e) => updateItem(
                                            category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements',
                                            item.id,
                                            { description: e.target.value }
                                          )}
                                          className="text-sm border-green-400 bg-green-50 focus:border-green-500 focus-visible:ring-green-300"
                                          placeholder="Description"
                                        />
                                        <p className="text-xs text-green-600 leading-tight">Linked to library item — ID preserved.</p>
                                      </div>
                                    ) : (
                                      // Unlinked item: picker for library search or custom entry (unchanged).
                                      <MasterScopeItemPicker
                                        searchEndpoint="/api/master-scope-items/search"
                                        value={item.customDescription ?? item.description}
                                        masterItemId={item.masterItemId}
                                        onSelect={(sel: MasterScopeSelection) => {
                                          updateItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id, {
                                            description: sel.description,
                                            unit: sel.unit ?? item.unit,
                                            unitPrice: sel.unitPrice ?? item.unitPrice,
                                            masterItemId: sel.type === "master" ? (sel.masterItemId ?? null) : null,
                                            masterItemSnapshot: sel.type === "master" ? (sel.snapshot ?? null) : null,
                                            customDescription: sel.customDescription ?? null,
                                          });
                                        }}
                                        className="text-sm"
                                      />
                                    )}
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <div className="flex gap-1 justify-center">
                                      <FormulaInput
                                        value={item.quantity}
                                        onChange={(value, evaluatedValue) => {
                                          const quantity = evaluatedValue || parseInt(String(value)) || 1;
                                          updateItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id, { quantity });
                                          
                                          // Auto-calculate total if unit price exists
                                          if (evaluatedValue && item.unitPrice) {
                                            const unitPrice = parseFloat(item.unitPrice);
                                            if (!isNaN(unitPrice)) {
                                              const total = (evaluatedValue * unitPrice).toFixed(2);
                                              updateItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id, { totalPrice: total });
                                            }
                                          }
                                        }}
                                        className="w-16 text-sm text-center"
                                        type="quantity"
                                        decimalPlaces={0}
                                      />
                                      <Input
                                        value={item.unit}
                                        onChange={(e) => updateItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id, { unit: e.target.value })}
                                        className="w-16 text-sm text-center"
                                        placeholder="Unit"
                                      />
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <FormulaInput
                                      value={item.unitPrice}
                                      onChange={(value, evaluatedValue) => {
                                        updateItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id, { unitPrice: String(value) });
                                        
                                        // Auto-calculate total if quantity exists
                                        if (evaluatedValue && item.quantity) {
                                          const total = (item.quantity * evaluatedValue).toFixed(2);
                                          updateItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id, { totalPrice: total });
                                        }
                                      }}
                                      className="text-sm text-center"
                                      type="rate"
                                      formatThousands={true}
                                    />
                                  </TableCell>
                                  {!newItemCategory && <TableCell className="font-medium text-center">{formatCurrency(item.totalPrice)}</TableCell>}
                                  <TableCell className="text-center">
                                    {(() => {
                                      const totalCost = parseFloat(item.totalPrice) || 0;
                                      const tenantShare = (item.tenantShare || 100) / 100;
                                      const tenantCost = totalCost * tenantShare;
                                      const rentableArea = calculateRentableArea();
                                      if (rentableArea > 0) {
                                        const perSF = tenantCost / rentableArea;
                                        return `$${perSF.toFixed(2)}`;
                                      }
                                      return 'N/A';
                                    })()}
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <Input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={item.tenantShare || 100}
                                        onChange={(e) => updateItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id, { tenantShare: parseInt(e.target.value) || 100 })}
                                        className="w-12 text-center text-sm"
                                      />
                                      <span className="text-xs text-gray-500">%</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="w-32">
                                    <div className="flex flex-col gap-1 items-center justify-center">
                                      <div className="flex gap-1">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => setEditingItem(null)}
                                          className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                                          title="Save changes"
                                        >
                                          <Save className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => setEditingItem(null)}
                                          className="h-8 w-8 p-0 text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                                          title="Cancel editing"
                                        >
                                          <X className="h-3 w-3" />
                                        </Button>
                                      </div>
                                      <label
                                        className={`flex items-center gap-1 select-none ${isLastNonFixed ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                                        title={isLastNonFixed ? 'At least one line must remain non-fixed so hidden costs balance to the total' : 'Fixed Allowance — line displays exact entered value, exempt from hidden-cost distribution'}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={!!item.isFixedAllowance}
                                          disabled={isLastNonFixed}
                                          onChange={(e) => !isLastNonFixed && updateItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id, { isFixedAllowance: e.target.checked })}
                                          className="h-3 w-3 accent-amber-500 disabled:cursor-not-allowed"
                                        />
                                        <span className="text-[10px] text-amber-700 font-medium">Fixed</span>
                                      </label>
                                    </div>
                                  </TableCell>
                                </>
                              ) : (
                                <>
                                  <TableCell>
                                    <div className="flex items-center gap-1">
                                      {item.isFixedAllowance && (
                                        <span
                                          className="text-slate-400 flex-shrink-0"
                                          title="Locked — price held, exempt from cost distribution"
                                        >
                                          <Lock className="h-3 w-3" />
                                        </span>
                                      )}
                                      <span className={`${isAssembled ? 'line-through opacity-60' : ''}`}>
                                        {item.description}
                                      </span>
                                      {item.masterCategoryId != null && alternateCategoryIds.has(item.masterCategoryId) && (
                                        <span title="This category has pricing alternates — review Option A vs Option B">
                                          <Info className="h-3 w-3 text-indigo-500 cursor-help flex-shrink-0" />
                                        </span>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <span className={`${isAssembled ? 'line-through opacity-60' : ''}`}>
                                      {new Intl.NumberFormat('en-US').format(item.quantity)} {item.unit}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <span className={`${isAssembled ? 'line-through opacity-60' : ''}`}>
                                      {formatCurrency(calculateDistributedUnitPrice(item))}
                                    </span>
                                  </TableCell>
                                  {!newItemCategory && (
                                    <TableCell className="font-medium text-center">
                                      <span className={`${isAssembled ? 'line-through opacity-60' : ''}`}>
                                        {formatCurrency(calculateDistributedCosts(item))}
                                      </span>
                                    </TableCell>
                                  )}
                                  <TableCell className="text-center">
                                    <span className={`${isAssembled ? 'line-through opacity-60' : ''}`}>
                                      {(() => {
                                        const totalCost = calculateDistributedCosts(item);
                                        const tenantShare = (item.tenantShare || 100) / 100;
                                        const tenantCost = totalCost * tenantShare;
                                        const rentableArea = calculateRentableArea();
                                        if (rentableArea > 0) {
                                          const perSF = tenantCost / rentableArea;
                                          return `$${perSF.toFixed(2)}`;
                                        }
                                        return 'N/A';
                                      })()}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <span className={`${isAssembled ? 'line-through opacity-60' : ''}`}>
                                      {item.tenantShare || 100}%
                                    </span>
                                  </TableCell>
                                  <TableCell className="w-32">
                                    <div className="flex gap-1 items-center justify-center">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => !isLastNonFixed && updateItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id, { isFixedAllowance: !item.isFixedAllowance })}
                                        disabled={isLastNonFixed}
                                        className={`h-8 w-8 p-0 rounded transition-colors ${
                                          isLastNonFixed
                                            ? 'text-gray-300 cursor-not-allowed opacity-50'
                                            : item.isFixedAllowance
                                              ? 'text-amber-600 bg-amber-50 ring-1 ring-amber-300 hover:text-amber-700 hover:bg-amber-100'
                                              : 'text-slate-500 hover:text-amber-600 hover:bg-amber-50 hover:ring-1 hover:ring-amber-200'
                                        }`}
                                        title={isLastNonFixed ? 'At least one line must remain non-fixed so hidden costs balance to the total' : item.isFixedAllowance ? 'Fixed Allowance ON — click to remove (price will rejoin cost distribution)' : 'Mark as fixed allowance (locks price, exempts from cost distribution)'}
                                      >
                                        {item.isFixedAllowance ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setEditingItem(item.id)}
                                        className="h-8 w-8 p-0"
                                        title="Edit item"
                                      >
                                        <Edit className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          const categoryType = category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements';
                                          const duplicatedItem: EvaluationLineItem = {
                                            ...item,
                                            id: nanoid(),
                                            description: `${item.description} (Copy)`,
                                          };
                                          setBudgetData(prev => ({
                                            ...prev,
                                            [categoryType]: [...prev[categoryType], duplicatedItem],
                                          }));
                                        }}
                                        className="h-8 w-8 p-0"
                                        title="Duplicate item"
                                      >
                                        <Copy className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => deleteItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id)}
                                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                        title="Delete item"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </>
                              )}
                            </TableRow>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </TableBody>
                )}
              </Droppable>
            </Table>
          </DragDropContext>
          </div>
        )}

        {newItemCategory === category && (
          <div className="mt-4 p-4 border rounded-lg bg-gray-50">
            <div className="grid grid-cols-1 md:grid-cols-9 gap-4">
              <div className="md:col-span-3">
                <Label>Description</Label>
                <MasterScopeItemPicker
                  key={pickerKey}
                  searchEndpoint="/api/master-scope-items/search"
                  value={newItem.description || ""}
                  masterItemId={newItem.masterItemId}
                  onSelect={(sel: MasterScopeSelection) => {
                    setNewItem(prev => ({
                      ...prev,
                      description: sel.description,
                      unit: sel.unit ?? prev.unit ?? "",
                      unitPrice: sel.unitPrice ?? prev.unitPrice ?? "",
                      masterItemId: sel.masterItemId ?? null,
                      masterItemSnapshot: sel.snapshot ?? null,
                      customDescription: sel.customDescription ?? null,
                    }));
                  }}
                  placeholder="Type to search scope items…"
                />
              </div>
              <div>
                <Label>Quantity</Label>
                <FormulaInput
                  value={newItem.quantity || 1}
                  onChange={(value, evaluatedValue) => {
                    const quantity = evaluatedValue || parseInt(String(value)) || 1;
                    setNewItem(prev => ({ ...prev, quantity }));
                    
                    // Auto-calculate total if unit price exists
                    if (evaluatedValue && newItem.unitPrice) {
                      const unitPrice = parseFloat(newItem.unitPrice);
                      if (!isNaN(unitPrice)) {
                        const total = (evaluatedValue * unitPrice).toFixed(2);
                        setNewItem(prev => ({ ...prev, totalPrice: total }));
                      }
                    }
                  }}
                  type="quantity"
                  decimalPlaces={0}
                />
              </div>
              <div>
                <Label>Unit</Label>
                <Input
                  value={newItem.unit || ""}
                  onChange={(e) => setNewItem(prev => ({ ...prev, unit: e.target.value }))}
                  placeholder="sf, ea, etc."
                />
              </div>
              <div>
                <Label>Unit Price</Label>
                <FormulaInput
                  value={newItem.unitPrice || ""}
                  onChange={(value, evaluatedValue) => {
                    setNewItem(prev => ({ ...prev, unitPrice: String(value) }));
                    
                    // Auto-calculate total if quantity exists
                    if (evaluatedValue && newItem.quantity) {
                      const total = (newItem.quantity * evaluatedValue).toFixed(2);
                      setNewItem(prev => ({ ...prev, totalPrice: total }));
                    }
                  }}
                  placeholder="0.00"
                  type="rate"
                  formatThousands={true}
                />
              </div>
              <div>
                <Label>Total Price</Label>
                <FormulaInput
                  value={newItem.totalPrice || ""}
                  onChange={(value, evaluatedValue) => {
                    setNewItem(prev => ({ ...prev, totalPrice: String(value) }));
                  }}
                  placeholder="0.00"
                  type="total"
                  formatThousands={true}
                />
              </div>
              <div>
                <Label>$/RSF</Label>
                <div className="h-10 flex items-center justify-center text-sm text-gray-500 bg-gray-100 rounded border">
                  {(() => {
                    const totalPrice = parseFloat(newItem.totalPrice || '0');
                    const tenantShare = (newItem.tenantShare || 100) / 100;
                    const tenantCost = totalPrice * tenantShare;
                    const warehouseArea = parseFloat(rfp?.warehouseArea || '0');
                    if (warehouseArea > 0 && tenantCost > 0) {
                      const perSF = tenantCost / warehouseArea;
                      return `$${perSF.toFixed(2)}`;
                    }
                    return 'N/A';
                  })()}
                </div>
              </div>
              <div>
                <Label>Tenant %</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={newItem.tenantShare || 100}
                  onChange={(e) => setNewItem(prev => ({ ...prev, tenantShare: parseInt(e.target.value) || 100 }))}
                  placeholder="100"
                />
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={() => addNewItem(category, false)} size="sm">
                  Add
                </Button>
                <Button onClick={() => addNewItem(category, true)} size="sm" variant="outline" title="Ctrl+Enter to add and continue">
                  Add & Continue
                </Button>
                <Button onClick={() => setNewItemCategory("")} variant="outline" size="sm">
                  Cancel
                </Button>
                <div className="text-xs text-gray-500 self-center ml-2">
                  Tip: Ctrl+Enter to add & continue
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
  };

  if (!rfp) {
    return (
      <Card>
        <CardContent className="text-center py-8">
          <p className="text-gray-500">No RFP selected for evaluation.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Budget Evaluation - {rfp?.projectName || 'Project'}</CardTitle>
          {(() => {
            const area = calculateRentableArea();
            if (!area) {
              return (
                <p className="text-sm text-amber-700 mt-1">
                  Rentable Area unavailable &mdash; no bay areas or warehouse area recorded on this RFP.
                </p>
              );
            }
            return (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm text-muted-foreground">Rentable Area</span>
                <span className="text-base font-semibold tabular-nums text-blue-900 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                  {area.toLocaleString()} SF
                </span>
                <span className="text-xs text-muted-foreground">use as quantity for area-based scope</span>
              </div>
            );
          })()}
        </CardHeader>
      </Card>





      {/* Tenant Improvements */}
      {renderCategoryTable(
        "Tenant Improvements",
        budgetData.tenantImprovements,
        'tenantImprovements',
        calculateCategoryTotal(budgetData.tenantImprovements)
      )}

      {/* Design / Soft Costs / Other Fees - Only show when separateDesignCosts is false (not hidden) */}
      {!budgetData.separateDesignCosts && renderCategoryTable(
        "Design / Soft Costs / Other Fees",
        budgetData.designSoftCosts,
        'designSoftCosts',
        calculateCategoryTotal(budgetData.designSoftCosts)
      )}

      {/* Assembly Breakdown — INTERNAL.
          Assemblies roll up to a single line everywhere a client or broker sees
          them (the Excel export already filters children out). This is the view
          for the conversation Adolfo described: a $375,000 electrical line gets
          questioned, and he needs to show what is inside it without exposing the
          breakdown on the document itself. */}
      {budgetData.customAssemblies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between">
              <span>Assembly Breakdown</span>
              <span className="text-xs font-normal text-muted-foreground">
                Internal only — not included in exports or client documents
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {budgetData.customAssemblies.map((assembly) => {
              const head = getAssemblyHead(assembly);
              const items = getAssemblyItems(assembly.id);
              return (
                <div key={assembly.id} className="border rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">{assembly.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {head.componentCount} component{head.componentCount === 1 ? '' : 's'} ·{' '}
                        {head.quantity.toLocaleString()} {head.unit} @ $
                        {head.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/{head.unit}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold tabular-nums">
                        ${head.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-[10px] text-muted-foreground">sum of components</div>
                    </div>
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id} className="border-t">
                          <td className="px-3 py-1.5">{item.description}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap text-muted-foreground">
                            {item.quantity?.toLocaleString()} {item.unit}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                            ${(parseFloat(item.totalPrice) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr className="border-t">
                          <td colSpan={3} className="px-3 py-2 text-muted-foreground italic">
                            No components — this assembly totals $0 until line items are added to it.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Existing Improvements */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="hasExistingImprovements"
                checked={budgetData.hasExistingImprovements}
                onCheckedChange={(checked) => {
                  setBudgetData(prev => {
                    if (checked) {
                      // Auto-populate existing improvements when checkbox is checked
                      const existingImprovementsFromProperty = populateExistingImprovements();
                      return {
                        ...prev, 
                        hasExistingImprovements: true,
                        existingImprovements: existingImprovementsFromProperty
                      };
                    } else {
                      // Clear existing improvements when checkbox is unchecked
                      return {
                        ...prev, 
                        hasExistingImprovements: false,
                        existingImprovements: []
                      };
                    }
                  });
                }}
              />
              <Label htmlFor="hasExistingImprovements" className="text-lg font-semibold text-black">
                Existing Improvements
              </Label>
            </div>
            {budgetData.hasExistingImprovements && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const existingImprovementsFromProperty = populateExistingImprovements();
                  setBudgetData(prev => ({
                    ...prev,
                    existingImprovements: existingImprovementsFromProperty
                  }));
                  toast({
                    title: "Refreshed from Property",
                    description: `Updated with ${existingImprovementsFromProperty.length} existing improvements from the property.`,
                  });
                }}
                className="text-xs"
              >
                🔄 Refresh from Property
              </Button>
            )}
          </div>
          <p className="text-sm text-gray-600">
            {propertyImprovements && propertyImprovements.length > 0 ? (
              <>
                This property has <span className="font-semibold text-blue-600">{propertyImprovements.length} existing improvements</span> available.
                {budgetData.hasExistingImprovements && budgetData.existingImprovements.length === 0 && (
                  <span className="text-amber-600 ml-1">Click "Refresh from Property" to load them.</span>
                )}
              </>
            ) : (
              "Check this box if there are costs associated with existing improvements that need to be factored into the budget."
            )}
          </p>
        </CardHeader>
        {budgetData.hasExistingImprovements && (
          <CardContent>
            <div className="mb-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includeExistingInTotal"
                  checked={budgetData.includeExistingInTotal}
                  onCheckedChange={(checked) => setBudgetData(prev => ({ 
                    ...prev, 
                    includeExistingInTotal: !!checked 
                  }))}
                />
                <Label htmlFor="includeExistingInTotal" className="text-sm font-medium">
                  Include in Grand Total
                </Label>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Check this box to include existing improvements in the project's Grand Total. 
                Leave unchecked to track for financial modeling only.
              </p>
            </div>
            {renderCategoryTable(
              "",
              budgetData.existingImprovements,
              'existingImprovements',
              calculateCategoryTotal(budgetData.existingImprovements)
            )}
          </CardContent>
        )}
      </Card>

      {/* Grand Total */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex justify-between items-center text-xl font-bold">
            <span>Grand Total:</span>
            <span className="text-green-600">{formatCurrency(calculateGrandTotal())}</span>
          </div>
          <Separator className="my-4" />
          <div>
            <Label htmlFor="notes">Budget Notes</Label>
            <Textarea
              id="notes"
              value={budgetData.notes}
              onChange={(e) => setBudgetData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Add any notes or comments about this budget evaluation..."
              className="mt-2"
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Line Item Rollup Summary */}
      {Object.keys(budgetData.lineItemRollups).length > 0 && (
        <Card className="bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle className="text-lg text-blue-800">
              Line Item Rollup Summary
              <span className="text-purple-600 italic font-normal ml-2">
                ({formatCurrency(Object.entries(budgetData.lineItemRollups).reduce((total, [itemId]) => {
                  const allItems = [
                    ...budgetData.tenantImprovements,
                    ...budgetData.designSoftCosts,
                    ...budgetData.existingImprovements
                  ];
                  const item = allItems.find(i => i.id === itemId);
                  return total + (item ? parseFloat(item.totalPrice) || 0 : 0);
                }, 0))})
              </span>
            </CardTitle>
            <p className="text-sm text-blue-600">
              The following items are being redistributed to different categories:
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(budgetData.lineItemRollups).map(([itemId, targetCategory]) => {
                const allItems = [
                  ...budgetData.tenantImprovements,
                  ...budgetData.designSoftCosts,
                  ...budgetData.existingImprovements
                ];
                const item = allItems.find(i => i.id === itemId);
                if (!item) return null;
                
                return (
                  <div key={itemId} className="flex justify-between items-center text-sm">
                    <span className="text-gray-700">
                      <strong>{item.description}</strong> ({formatCurrency(item.totalPrice)})
                    </span>
                    <span className="text-blue-600">
                      → Rolling to {targetCategory === 'tenantImprovements' ? 'Tenant Improvements' : 
                        targetCategory === 'designSoftCosts' ? 'Design/Soft Costs' : 
                        targetCategory === 'tiAndDesign' ? (() => {
                          const tiTotal = calculateCategoryTotal(budgetData.tenantImprovements);
                          const designTotal = calculateCategoryTotal(budgetData.designSoftCosts);
                          const combinedTotal = tiTotal + designTotal;
                          if (combinedTotal > 0) {
                            const tiPercent = Math.round((tiTotal / combinedTotal) * 100);
                            const designPercent = Math.round((designTotal / combinedTotal) * 100);
                            return `TI & Design (${tiPercent}%/${designPercent}%)`;
                          }
                          return 'TI & Design (50%/50%)';
                        })() : 'Existing Improvements'}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assembly Summary */}
      {(() => {
        const allItems = [
          ...budgetData.tenantImprovements,
          ...budgetData.designSoftCosts,
          ...budgetData.existingImprovements
        ];
        const assembledItems = allItems.filter(item => item.assemblyId);
        
        if (assembledItems.length === 0) return null;
        
        const assembliesByName: Record<string, any[]> = {};
        
        assembledItems.forEach(item => {
          const assemblyId = item.assemblyId;
          if (assemblyId) {
            if (!assembliesByName[assemblyId]) {
              assembliesByName[assemblyId] = [];
            }
            assembliesByName[assemblyId].push(item);
          }
        });
        
        const getAssemblyDisplayName = (assemblyId: string): string => {
          if (!assemblyId) return 'Unknown Assembly';
          
          // Look for the assembly line item in all categories - the assembly line item has the assembly name as its description
          const allCategoryItems = [
            ...budgetData.tenantImprovements,
            ...budgetData.designSoftCosts,
            ...budgetData.existingImprovements
          ];
          
          // Find the assembly line item (the one with id matching assemblyId)
          const assemblyLineItem = allCategoryItems.find(item => item.id === assemblyId);
          if (assemblyLineItem && assemblyLineItem.description) {
            return assemblyLineItem.description;
          }
          
          // Fallback: create a readable name from timestamp
          const timestamp = assemblyId.replace('assembly_', '');
          return `Custom Assembly ${timestamp.slice(-4)}`;
        };
        
        return (
          <Card className="bg-green-50 border-green-200">
            <CardHeader>
              <CardTitle className="text-lg text-green-800">Assembly Summary</CardTitle>
              <p className="text-sm text-green-600">
                The following items are grouped into custom assemblies:
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(assembliesByName).map(([assemblyId, items]) => {
                  const assemblyDisplayName = getAssemblyDisplayName(assemblyId);
                  return items.map((item: any) => (
                    <div key={item.id} className="flex justify-between items-center text-sm">
                      <span className="text-gray-700">
                        <strong>{item.description}</strong> ({formatCurrency(parseFloat(item.totalPrice) || 0)})
                      </span>
                      <span className="text-green-600">
                        → Grouped in {assemblyDisplayName}
                      </span>
                    </div>
                  ));
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Tenant Share Summary */}
      {(() => {
        const allItems = [
          ...budgetData.tenantImprovements,
          ...budgetData.designSoftCosts,
          ...budgetData.existingImprovements
        ];
        
        const proratedItems = allItems.filter(item => (item.tenantShare || 100) < 100);
        
        if (proratedItems.length === 0) return null;

        return (
          <Card className="bg-orange-50 border-orange-200">
            <CardHeader>
              <CardTitle className="text-lg text-orange-800">Tenant Share Summary</CardTitle>
              <p className="text-sm text-orange-600">
                The following items have been prorated based on tenant responsibility percentage:
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {proratedItems.map(item => {
                  const totalCost = parseFloat(item.totalPrice) || 0;
                  const tenantShare = item.tenantShare || 100;
                  const tenantCost = totalCost * (tenantShare / 100);
                  const remainingCost = totalCost - tenantCost;
                  const remainingPercentage = 100 - tenantShare;
                  
                  return (
                    <div key={item.id} className="border rounded-lg p-3 bg-white">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium text-gray-800">{item.description}</span>
                        <span className="text-xs text-orange-600 font-medium bg-orange-100 px-2 py-1 rounded">
                          {tenantShare}% Tenant Share
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div className="text-center">
                          <div className="text-gray-500 text-xs uppercase tracking-wide mb-1">Total Cost</div>
                          <div className="font-semibold text-gray-800">{formatCurrency(totalCost)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-gray-500 text-xs uppercase tracking-wide mb-1">Tenant Share</div>
                          <div className="font-semibold text-green-600">{formatCurrency(tenantCost)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-gray-500 text-xs uppercase tracking-wide mb-1">Outstanding Share</div>
                          <div className="font-semibold text-orange-600">{formatCurrency(remainingCost)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 p-3 bg-orange-100 rounded-lg">
                <div className="text-sm text-orange-800">
                  <strong>Note:</strong> The "Remaining" amounts represent costs that could be attributed to other tenants 
                  or additional lease allocations to achieve 100% cost recovery for shared improvements.
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Tenant Premises Overview */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-lg">Tenant Premises Overview</CardTitle>
              <p className="text-sm text-gray-600">
                Specify premises information to include in the evaluation report
              </p>
            </div>
            <div className="flex gap-2">
              {premisesEditMode && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newDoorCounts = calculateDoorCounts();
                      setBudgetData(prev => ({
                        ...prev,
                        oversizedDoors: newDoorCounts.oversized,
                        regularDoors: newDoorCounts.regular,
                      }));
                    }}
                    title="Reset door counts to calculated values from current bay selection"
                    className="h-8"
                  >
                    Reset Doors
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newParkingCounts = calculateParkingCounts();
                      setBudgetData(prev => ({
                        ...prev,
                        vehicularParking: newParkingCounts.vehicular,
                        trailerParking: newParkingCounts.trailer,
                      }));
                    }}
                    title="Reset parking to calculated values based on tenant area allocation"
                    className="h-8"
                  >
                    Reset Parking
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newElectrical = calculateElectricalAllocation();
                      setBudgetData(prev => ({
                        ...prev,
                        calculatedElectricalAllocation: newElectrical,
                        electricalAllocationOverride: null,
                        electricalAllocation: newElectrical,
                      }));
                    }}
                    title="Reset electrical allocation to calculated value based on tenant area"
                    className="h-8"
                  >
                    Reset Electrical
                  </Button>
                </>
              )}
              <Button
                variant={premisesEditMode ? "default" : "outline"}
                size="sm"
                onClick={() => setPremisesEditMode(!premisesEditMode)}
                className="h-8"
              >
                {premisesEditMode ? (
                  <>
                    <CheckIcon className="h-4 w-4 mr-1" />
                    Done
                  </>
                ) : (
                  <>
                    <Edit className="h-4 w-4 mr-1" />
                    Edit
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Dock Doors Section */}
            <div>
              <Label className="text-base font-medium mb-3 block">Dock Doors</Label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="oversizedDoors">Oversized Doors</Label>
                  <Input
                    id="oversizedDoors"
                    type="number"
                    min="0"
                    value={budgetData.oversizedDoors}
                    onChange={(e) => {
                      // Empty must stay empty. `parseInt(v) || 0` turned a cleared
                      // field into 0 instantly, so the box could never be emptied -
                      // a digit reappeared as fast as it was deleted, and the only
                      // way to change it was to type a new number first.
                      const raw = e.target.value;
                      if (raw === '') {
                        setBudgetData(prev => ({ ...prev, oversizedDoors: 0, oversizedDoorsOverride: 0 }));
                        return;
                      }
                      const n = parseInt(raw, 10);
                      if (Number.isNaN(n)) return;
                      // Record it as an override so the recalculation effect and the
                      // next load both leave it alone.
                      setBudgetData(prev => ({ ...prev, oversizedDoors: n, oversizedDoorsOverride: n }));
                    }}
                    className="mt-1"
                    placeholder="0"
                    readOnly={!premisesEditMode}
                    disabled={!premisesEditMode}
                  />
                </div>
                <div>
                  <Label htmlFor="regularDoors">Regular Doors</Label>
                  <Input
                    id="regularDoors"
                    type="number"
                    min="0"
                    value={budgetData.regularDoors}
                    onChange={(e) => {
                      // Empty must stay empty. `parseInt(v) || 0` turned a cleared
                      // field into 0 instantly, so the box could never be emptied -
                      // a digit reappeared as fast as it was deleted, and the only
                      // way to change it was to type a new number first.
                      const raw = e.target.value;
                      if (raw === '') {
                        setBudgetData(prev => ({ ...prev, regularDoors: 0, regularDoorsOverride: 0 }));
                        return;
                      }
                      const n = parseInt(raw, 10);
                      if (Number.isNaN(n)) return;
                      // Record it as an override so the recalculation effect and the
                      // next load both leave it alone.
                      setBudgetData(prev => ({ ...prev, regularDoors: n, regularDoorsOverride: n }));
                    }}
                    className="mt-1"
                    placeholder="0"
                    readOnly={!premisesEditMode}
                    disabled={!premisesEditMode}
                  />
                </div>
              </div>
            </div>

            {/* Parking Information Section */}
            <div>
              <Label className="text-base font-medium mb-3 block">Parking</Label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="vehicularParking">Vehicular Parking</Label>
                  <Input
                    id="vehicularParking"
                    type="number"
                    min="0"
                    value={budgetData.vehicularParking || 0}
                    onChange={(e) => setBudgetData(prev => ({
                      ...prev,
                      vehicularParking: parseInt(e.target.value) || 0
                    }))}
                    className="mt-1"
                    placeholder="0"
                    readOnly={!premisesEditMode}
                    disabled={!premisesEditMode}
                  />
                </div>
                <div>
                  <Label htmlFor="trailerParking">Trailer Parking</Label>
                  <Input
                    id="trailerParking"
                    type="number"
                    min="0"
                    value={budgetData.trailerParking || 0}
                    onChange={(e) => setBudgetData(prev => ({
                      ...prev,
                      trailerParking: parseInt(e.target.value) || 0
                    }))}
                    className="mt-1"
                    placeholder="0"
                    readOnly={!premisesEditMode}
                    disabled={!premisesEditMode}
                  />
                </div>
              </div>
            </div>

            {/* Electrical Allocation Section */}
            <div>
              {(() => {
                // Calculate totals from multi-voltage allocations
                const totalAllocatedKva = budgetData.electricalAllocations.reduce((sum, alloc) => sum + alloc.kva, 0);
                const availableKva = propertyElectricalCapacity.availableKva;
                const exceedsCapacity = availableKva > 0 && totalAllocatedKva > availableKva;
                const noCapacityAvailable = !propertyElectricalCapacity.hasCapacity;
                
                // Helper to add a new allocation entry - store AMPS as primary value
                const addAllocation = () => {
                  const defaultAmps = 200; // Default to 200 AMPS
                  const defaultVoltage = "480";
                  const newEntry: ElectricalAllocationEntry = {
                    id: `alloc-${Date.now()}`,
                    amps: defaultAmps,
                    kva: ampsToKva(defaultAmps, defaultVoltage),
                    voltage: defaultVoltage
                  };
                  setBudgetData(prev => ({
                    ...prev,
                    electricalAllocations: [...prev.electricalAllocations, newEntry]
                  }));
                };
                
                // Helper to update an allocation entry
                const updateAllocation = (id: string, updates: Partial<ElectricalAllocationEntry>) => {
                  setBudgetData(prev => ({
                    ...prev,
                    electricalAllocations: prev.electricalAllocations.map(alloc =>
                      alloc.id === id ? { ...alloc, ...updates } : alloc
                    )
                  }));
                };
                
                // Helper to remove an allocation entry
                const removeAllocation = (id: string) => {
                  setBudgetData(prev => ({
                    ...prev,
                    electricalAllocations: prev.electricalAllocations.filter(alloc => alloc.id !== id)
                  }));
                };
                
                return (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <Label className="text-base font-medium flex items-center gap-2">
                        <Zap className="h-4 w-4 text-yellow-500" />
                        Electrical Allocation
                      </Label>
                      {propertyElectricalCapacity.hasCapacity && (
                        <span className="text-xs text-gray-500">
                          Property: {propertyElectricalCapacity.totalKva.toLocaleString()} kVA total, {availableKva.toLocaleString()} kVA available
                        </span>
                      )}
                    </div>
                    
                    {/* Capacity Warnings */}
                    {noCapacityAvailable && (
                      <div className="mb-3 p-2 bg-orange-100 border border-orange-300 rounded-lg flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-orange-600" />
                        <p className="text-xs text-orange-700 font-medium">
                          No electrical capacity configured for this property. Set up transformers in Property Management.
                        </p>
                      </div>
                    )}
                    {exceedsCapacity && (
                      <div className="mb-3 p-2 bg-red-100 border border-red-300 rounded-lg flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                        <p className="text-xs text-red-700 font-medium">
                          Total allocation ({totalAllocatedKva.toLocaleString()} kVA) exceeds available capacity ({availableKva.toLocaleString()} kVA).
                          Shortfall: {(totalAllocatedKva - availableKva).toLocaleString()} kVA
                        </p>
                      </div>
                    )}
                    
                    {/* Multi-Voltage Allocations */}
                    <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Zap className="h-4 w-4 text-blue-600" />
                          <div>
                            <p className="text-xs font-medium text-blue-700">Tenant Electrical Services</p>
                            <p className="text-xs text-blue-500">Add multiple services at different voltages (e.g., 100 kVA @ 480V + 50 kVA @ 208V)</p>
                          </div>
                        </div>
                        {premisesEditMode && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={addAllocation}
                            className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
                            data-testid="button-add-electrical-allocation"
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Add Service
                          </Button>
                        )}
                      </div>
                      
                      {/* Allocation Entries */}
                      {budgetData.electricalAllocations.length === 0 ? (
                        <div className="text-center py-4 text-gray-500 text-sm">
                          No electrical allocations defined. Click "Add Service" to allocate power.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {budgetData.electricalAllocations.map((alloc, index) => {
                            // Use stored amps if available, otherwise calculate from kVA (legacy data)
                            const displayAmps = alloc.amps ?? kvaToAmps(alloc.kva, alloc.voltage);
                            const displayKva = alloc.kva ?? ampsToKva(displayAmps, alloc.voltage);
                            const voltageLabel = VOLTAGE_OPTIONS.find(v => v.value === alloc.voltage)?.label || alloc.voltage + "V";
                            
                            return (
                              <div 
                                key={alloc.id} 
                                className="flex items-center gap-3 p-2 bg-white rounded border border-gray-200"
                                data-testid={`electrical-allocation-row-${index}`}
                              >
                                <div className="flex-1 grid grid-cols-4 gap-3 items-center">
                                  <div>
                                    <Label className="text-xs text-gray-500">AMPS</Label>
                                    <Input
                                      type="number"
                                      min="0"
                                      step="50"
                                      value={displayAmps}
                                      onChange={(e) => {
                                        const newAmps = parseInt(e.target.value) || 0;
                                        updateAllocation(alloc.id, { 
                                          amps: newAmps,
                                          kva: ampsToKva(newAmps, alloc.voltage)
                                        });
                                      }}
                                      className="h-8 text-sm"
                                      disabled={!premisesEditMode}
                                      data-testid={`input-allocation-amps-${index}`}
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs text-gray-500">Voltage</Label>
                                    <select
                                      value={alloc.voltage}
                                      onChange={(e) => {
                                        const newVoltage = e.target.value;
                                        updateAllocation(alloc.id, { 
                                          voltage: newVoltage,
                                          kva: ampsToKva(displayAmps, newVoltage)
                                        });
                                      }}
                                      disabled={!premisesEditMode}
                                      className="w-full h-8 rounded-md border border-gray-300 bg-white px-2 text-sm"
                                      data-testid={`select-allocation-voltage-${index}`}
                                    >
                                      {VOLTAGE_OPTIONS.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <Label className="text-xs text-gray-500">Equivalent</Label>
                                    <p className="text-sm font-medium mt-1" data-testid={`text-allocation-kva-${index}`}>
                                      {displayKva.toLocaleString()} kVA
                                    </p>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <Label className="text-xs text-gray-500">Service</Label>
                                      <p className="text-xs text-gray-600 mt-1">
                                        {displayAmps.toLocaleString()} AMPS @ {voltageLabel}
                                      </p>
                                    </div>
                                    {premisesEditMode && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeAllocation(alloc.id)}
                                        className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                                        data-testid={`button-remove-allocation-${index}`}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    
                    {/* Totals Summary */}
                    <div className="grid grid-cols-3 gap-4 p-3 bg-gray-50 rounded-lg">
                      <div>
                        <Label className="text-xs text-gray-500">Total Allocated</Label>
                        <p className={`text-lg font-semibold ${exceedsCapacity ? 'text-red-600' : 'text-blue-600'}`} data-testid="text-total-allocated-kva">
                          {totalAllocatedKva.toLocaleString()} kVA
                          {exceedsCapacity && <AlertTriangle className="inline h-4 w-4 ml-1" />}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-gray-500">Available Capacity</Label>
                        <p className="text-lg font-semibold text-green-600" data-testid="text-available-capacity-kva">
                          {availableKva.toLocaleString()} kVA
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-gray-500">Usage</Label>
                        <p className={`text-lg font-semibold ${exceedsCapacity ? 'text-red-600' : 'text-gray-700'}`} data-testid="text-capacity-usage">
                          {availableKva > 0 ? Math.round((totalAllocatedKva / availableKva) * 100) : 0}%
                        </p>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* File Attachments */}
      <EvaluationAttachments rfpId={rfp?.id} />

      {/* Labeled Upload Slots for Architect and GC Documents */}
      <EvaluationLabeledUploads rfpId={rfp?.id} projectFolder={rfp?.projectFolder || undefined} />

      {/* Preview Report */}
      <Card>
        <CardHeader>
          <div className="text-center">
            <Label className="text-lg font-semibold">Generate Report</Label>
            <p className="text-sm text-gray-600 mt-2">
              Report will reflect your current checkbox settings and rollup configurations
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center space-x-3">
            <Button 
              onClick={() => generateReportPreview(budgetData.separateDesignCosts)}
              variant="outline"
              size="sm"
              className="px-6"
            >
              Generate Budget Report
            </Button>
            <Button 
              onClick={exportToExcel}
              variant="outline"
              size="sm"
              className="px-6"
            >
              <FileDown className="w-4 h-4 mr-2" />
              Export to Excel
            </Button>
            <Button 
              onClick={exportAllLineItems}
              variant="outline"
              size="sm"
              className="px-6"
            >
              <FileDown className="w-4 h-4 mr-2" />
              Export All Line Items
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-2 text-center">
            Report format is based on your "Hide Design Costs" checkbox setting and line item rollups.
          </p>
        </CardContent>
      </Card>

      {/* Evaluation Budget History */}
      <EvaluationBudgetHistory rfpId={rfp?.id} />

      {/* Workflow Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Workflow Actions</CardTitle>
          <p className="text-sm text-gray-600">
            Save your evaluation budget and advance to the publish phase
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center space-x-4">
            <Button
              onClick={() => saveProgressMutation.mutate()}
              disabled={saveProgressMutation.isPending}
              variant="outline"
              className="px-6"
            >
              {saveProgressMutation.isPending ? "Saving..." : "Save Progress"}
            </Button>
            <Button
              onClick={() => cleanupAssemblyMutation.mutate()}
              disabled={cleanupAssemblyMutation.isPending}
              variant="outline" 
              className="px-4 text-red-600 border-red-600 hover:bg-red-50 font-semibold"
              title="Fix orphaned assembly items that appear struck through with 'Unknown Assembly'"
            >
              {cleanupAssemblyMutation.isPending ? "Cleaning..." : "🔧 Fix Assembly Items"}
            </Button>
            <Button
              onClick={saveAndAdvance}
              disabled={saveAndAdvanceMutation.isPending}
              className="px-6 bg-green-600 hover:bg-green-700"
            >
              {saveAndAdvanceMutation.isPending ? "Saving & Advancing..." : "Save & Advance to Publish"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Record Project Actuals.
          Shown ONLY once the project is actually finished. It asks for FINAL
          BUILT COSTS, and evaluation is where a deal is being PRICED - the job
          has not started, so there is nothing to record and the panel reads as a
          form you are supposed to fill in but cannot. Confusing for the whole
          team, per Adolfo 2026-08-17.

          The feedback loop it serves is real (actuals calibrate future ROMs), so
          it is gated rather than removed: it appears when the RFP is marked
          completed, or leased, or already has actuals recorded. */}
      {rfp && (rfp.status === 'completed' || rfp.isLeased === true) && (
        <RecordProjectActuals
          rfpId={rfp.id}
          projectName={rfp.projectName}
          tenantName={rfp.tenantName}
          propertyName={rfp.property}
          totalCostDollars={parseFloat(budgetData.grandTotal || "0")}
          rentableAreaSf={calculateRentableArea()}
          prePopulatedLineItems={(() => {
            const byCategory: Record<string, number> = {};
            const allItems = [...(budgetData.tenantImprovements || []), ...(budgetData.designSoftCosts || [])];
            for (const item of allItems) {
              const cat = item.category || "TI";
              const cost = parseFloat((item.totalPrice ?? "0").toString()) * 100;
              byCategory[cat] = (byCategory[cat] || 0) + cost;
            }
            return Object.entries(byCategory)
              .filter(([, cost]) => cost > 0)
              .map(([category, totalCost]) => ({ category, totalCost }));
          })()}
        />
      )}

      {/* Assembly Creation Dialog */}
      <Dialog open={showAssemblyCreator} onOpenChange={setShowAssemblyCreator}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Custom Assembly</DialogTitle>
            <DialogDescription>
              Group selected line items under a custom assembly name like "Dock Package" or "Demising Wall Package". 
              The first item you selected defines the assembly's quantity and unit - other items contribute their costs proportionally.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="assemblyName">Assembly Name</Label>
              <Input
                id="assemblyName"
                value={newAssemblyName}
                onChange={(e) => setNewAssemblyName(e.target.value)}
                placeholder="e.g., Dock Package, Demising Wall Package"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Selected Items ({selectedItems.size})</Label>
              {selectedItems.size > 1 && (() => {
                const items = Array.from(selectedItems).map(id => findItemById(id)).filter((item): item is EvaluationLineItem => item !== null);
                const units = items.map(item => item.unit.toLowerCase().trim());
                const hasMixedUnits = new Set(units).size > 1;
                const primaryItem = items.find(item => item.id === primaryItemId);
                return hasMixedUnits ? (
                  <div className="mt-1 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded p-2">
                    <strong>Mixed Units Detected:</strong> Assembly will use "{primaryItem?.unit}" from the base item. Other items will contribute costs proportionally.
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">
                    <strong>Same Units:</strong> All items use "{items[0]?.unit}" - quantities will be summed normally.
                  </div>
                );
              })()}
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto border rounded p-2">
                {Array.from(selectedItems).map(itemId => {
                  const item = findItemById(itemId);
                  const isPrimary = itemId === primaryItemId;
                  return item ? (
                    <div key={itemId} className={`text-sm flex items-center justify-between ${isPrimary ? 'font-medium text-blue-800 bg-blue-50 p-1 rounded' : 'text-gray-700'}`}>
                      <span>{item.description}</span>
                      {isPrimary && (
                        <span className="text-xs bg-blue-100 text-blue-800 px-1 rounded">Base: {item.quantity} {item.unit}</span>
                      )}
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAssemblyCreator(false);
                setNewAssemblyName("");
                setNewAssemblyCategory('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={createAssembly}
              disabled={!newAssemblyName.trim() || selectedItems.size === 0}
            >
              Create Assembly
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Selective Import Modal */}
      <Dialog open={showImportModal} onOpenChange={setShowImportModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Select Items to Import</DialogTitle>
            <DialogDescription>
              Choose which contractor/architect pricing items you want to import into Tenant Improvements.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Select</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>Total Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allBidLineItems && Array.isArray(allBidLineItems) && allBidLineItems.map((item: BidLineItem & { bidCollectionId: number }) => {
                  const itemKey = `${item.bidCollectionId}-${item.id}`;
                  const bidCollection = bidCollections?.find((bid: any) => bid.id === item.bidCollectionId);
                  return (
                    <TableRow key={itemKey}>
                      <TableCell>
                        <Checkbox
                          checked={selectedImportItems.has(itemKey)}
                          onCheckedChange={(checked) => {
                            const newSelected = new Set(selectedImportItems);
                            if (checked) {
                              newSelected.add(itemKey);
                            } else {
                              newSelected.delete(itemKey);
                            }
                            setSelectedImportItems(newSelected);
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {bidCollection?.submittedBy || 'Unknown'}
                      </TableCell>
                      <TableCell>{item.description}</TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>{item.unit}</TableCell>
                      <TableCell>{formatCurrency(parseFloat(item.unitPrice) || 0)}</TableCell>
                      <TableCell>{formatCurrency(parseFloat(item.totalPrice) || 0)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="flex-shrink-0 flex justify-between items-center pt-4 border-t">
            <div className="text-sm text-gray-600">
              {selectedImportItems.size} item{selectedImportItems.size !== 1 ? 's' : ''} selected
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowImportModal(false);
                  setSelectedImportItems(new Set());
                }}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (allBidLineItems && Array.isArray(allBidLineItems)) {
                    const allKeys = allBidLineItems.map((item: BidLineItem & { bidCollectionId: number }) => 
                      `${item.bidCollectionId}-${item.id}`
                    );
                    setSelectedImportItems(new Set(allKeys));
                  }
                }}
              >
                Select All
              </Button>
              <Button
                onClick={importSelectedItems}
                disabled={selectedImportItems.size === 0}
              >
                Import Selected ({selectedImportItems.size})
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scope of Work Import Modal */}
      <Dialog open={showScopeImportModal} onOpenChange={setShowScopeImportModal}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Import Scope of Work Items</DialogTitle>
            <DialogDescription>
              Select which scope items from the Invitation to Bid phase to import into Tenant Improvements.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between border-b pb-2">
            <div className="text-sm text-gray-600">
              {selectedScopeItems.size} of {scopeOfWorkItems.length} item{scopeOfWorkItems.length !== 1 ? 's' : ''} selected
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const allKeys = scopeOfWorkItems.map((_: any, index: number) => index.toString());
                  setSelectedScopeItems(new Set(allKeys));
                }}
              >
                <CheckIcon className="h-3 w-3 mr-1" />
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedScopeItems(new Set())}
              >
                <X className="h-3 w-3 mr-1" />
                Deselect All
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-20 text-right">Qty</TableHead>
                  <TableHead className="w-20">Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scopeOfWorkItems.map((item: any, index: number) => {
                  const itemKey = index.toString();
                  const description = item.description || item.item || item;
                  return (
                    <TableRow 
                      key={itemKey} 
                      className={`cursor-pointer ${selectedScopeItems.has(itemKey) ? 'bg-green-50' : ''}`}
                      onClick={() => {
                        const newSelected = new Set(selectedScopeItems);
                        if (newSelected.has(itemKey)) {
                          newSelected.delete(itemKey);
                        } else {
                          newSelected.add(itemKey);
                        }
                        setSelectedScopeItems(newSelected);
                      }}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedScopeItems.has(itemKey)}
                          onCheckedChange={(checked) => {
                            const newSelected = new Set(selectedScopeItems);
                            if (checked) {
                              newSelected.add(itemKey);
                            } else {
                              newSelected.delete(itemKey);
                            }
                            setSelectedScopeItems(newSelected);
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{description}</TableCell>
                      <TableCell className="text-right">{item.quantity || '—'}</TableCell>
                      <TableCell>{item.unit || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="flex justify-between items-center pt-2 border-t">
            <Button
              variant="outline"
              onClick={() => {
                setShowScopeImportModal(false);
                setSelectedScopeItems(new Set());
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={importSelectedScopeItems}
              disabled={selectedScopeItems.size === 0}
            >
              <Package className="h-4 w-4 mr-1" />
              Import Selected ({selectedScopeItems.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Design Costs Import Modal */}
      <Dialog open={showDesignImportModal} onOpenChange={setShowDesignImportModal}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Select Design/Architectural Costs to Import</DialogTitle>
            <DialogDescription>
              Choose which design/architectural costs from flagged bid collections you want to import into Design fees.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Select</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24">Quantity</TableHead>
                  <TableHead className="w-20">Unit</TableHead>
                  <TableHead className="w-32">Unit Price</TableHead>
                  <TableHead className="w-32">Total Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allDesignLineItems && Array.isArray(allDesignLineItems) && allDesignLineItems.map((item: any) => {
                  const itemKey = `${item.bidCollectionId}-${item.id}`;
                  return (
                    <TableRow key={itemKey}>
                      <TableCell>
                        <Checkbox
                          checked={selectedDesignItems.has(itemKey)}
                          onCheckedChange={(checked) => {
                            const newSelected = new Set(selectedDesignItems);
                            if (checked) {
                              newSelected.add(itemKey);
                            } else {
                              newSelected.delete(itemKey);
                            }
                            setSelectedDesignItems(newSelected);
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{item.source}</TableCell>
                      <TableCell>{item.description}</TableCell>
                      <TableCell>{item.quantity || '1'}</TableCell>
                      <TableCell>{item.unit || 'ea'}</TableCell>
                      <TableCell>{formatCurrency(item.unitPrice || '0')}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(item.totalPrice || '0')}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="flex justify-between items-center">
            <div className="text-sm text-gray-600">
              {selectedDesignItems.size} item{selectedDesignItems.size !== 1 ? 's' : ''} selected
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDesignImportModal(false);
                  setSelectedDesignItems(new Set());
                }}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (allDesignLineItems && Array.isArray(allDesignLineItems)) {
                    const allKeys = allDesignLineItems.map((item: any) => `${item.bidCollectionId}-${item.id}`);
                    setSelectedDesignItems(new Set(allKeys));
                  }
                }}
              >
                Select All
              </Button>
              <Button
                onClick={importSelectedDesignItems}
                disabled={selectedDesignItems.size === 0}
              >
                Import Selected ({selectedDesignItems.size})
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import from Another RFP or Template Dialog */}
      <RfpImportDialog
        open={showRfpImportModal}
        onOpenChange={setShowRfpImportModal}
        currentRfpId={rfp?.id}
        onImport={handleRfpImport}
        onTemplateImport={handleTemplateImport}
      />
    </div>
  );
}