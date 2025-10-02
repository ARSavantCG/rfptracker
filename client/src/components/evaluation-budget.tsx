import { useState, useEffect } from "react";
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
import { Plus, Edit, Trash2, Save, X, ArrowRight, Copy, FileDown, Upload, Package, Users, ChevronUp, ChevronDown, GripVertical, Check as CheckIcon, FileText } from "lucide-react";
import { EvaluationAttachments } from "./evaluation-attachments";
import { EvaluationBudgetHistory } from "./evaluation-budget-history";
import { FormulaInput } from "./formula-input";
import { RfpImportDialog } from "./rfp-import-dialog";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import { nanoid } from "nanoid";
import * as XLSX from "xlsx";
import type { RfpRequest, BidCollection, BidLineItem } from "@shared/schema";

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
}

interface CustomAssembly {
  id: string;
  name: string;
  category: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements';
  items: string[]; // Array of line item IDs
  primaryItemId?: string; // ID of the first-clicked item that defines base quantity and unit
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
}

interface EvaluationBudgetProps {
  rfp: RfpRequest | null;
  isWorkflowCollapsed?: boolean;
}

export function EvaluationBudget({ rfp, isWorkflowCollapsed = false }: EvaluationBudgetProps) {
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [newItemCategory, setNewItemCategory] = useState<string>("");
  const [newItem, setNewItem] = useState<Partial<EvaluationLineItem>>({
    description: "",
    quantity: 0,
    unit: "",
    unitPrice: "",
    totalPrice: "",
    tenantShare: 100
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
    mutationFn: async (historyData: { rfpId: number; reportName: string; generatedContent: string; notes?: string }) => {
      const response = await fetch(`/api/rfp-requests/${historyData.rfpId}/evaluation-budget-history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
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
  


  // Load property existing improvements to auto-populate when relevant
  const { data: propertyImprovements, isLoading: isLoadingImprovements } = useQuery({
    queryKey: [`/api/properties/${rfp?.property}/existing-improvements`],
    enabled: !!rfp?.property,
  });



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
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
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

    const importedItems = itemsToImport.map((item: BidLineItem & { bidCollectionId: number }) => ({
      id: `imported-${Date.now()}-${item.id}`,
      description: item.description,
      quantity: typeof item.quantity === 'string' ? parseInt(item.quantity) || 1 : item.quantity || 1,
      unit: item.unit || "ea",
      unitPrice: item.unitPrice?.toString() || "0.00",
      totalPrice: item.totalPrice?.toString() || "0.00",
      tenantShare: 100, // Default to 100% tenant responsibility
      bidCollectionId: item.bidCollectionId,
      bidLineItemId: item.id,
    })) as EvaluationLineItem[];

    setBudgetData(prev => ({
      ...prev,
      tenantImprovements: [...prev.tenantImprovements, ...importedItems],
    }));

    toast({
      title: "Pricing Imported",
      description: `Successfully imported ${importedItems.length} selected line items from contractor/architect pricing.`,
      duration: 4000,
    });

    setShowImportModal(false);
    setSelectedImportItems(new Set());
  };

  // Open scope of work import modal
  const openScopeImportModal = () => {
    if (!rfp?.scopeOfWork || !Array.isArray(rfp.scopeOfWork) || rfp.scopeOfWork.length === 0) {
      toast({
        title: "No Scope of Work Available",
        description: "No scope of work items found to import.",
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
    if (!rfp?.scopeOfWork || selectedScopeItems.size === 0) return;

    const itemsToImport = rfp.scopeOfWork.filter((item: any, index: number) => 
      selectedScopeItems.has(index.toString())
    );

    const importedItems = itemsToImport.map((item: any, index: number) => ({
      id: `scope-${Date.now()}-${index}`,
      description: item.description || item.item || item,
      quantity: 1,
      unit: "ea",
      unitPrice: "0.00",
      totalPrice: "0.00",
      tenantShare: 100, // Default to 100% tenant responsibility
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
        const response = await fetch(`/api/bid-collections/${bid.id}/line-items`);
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
  });

  // Calculate door counts from bay configuration data
  const calculateDoorCounts = () => {
    if (!rfp?.selectedBayConfigurations) return { oversized: 0, regular: 0 };
    
    const oversizedTotal = rfp.selectedBayConfigurations.reduce((sum, bay) => sum + (bay.oversizedDockDoors || 0), 0);
    const regularTotal = rfp.selectedBayConfigurations.reduce((sum, bay) => sum + (bay.standardDockDoors || 0), 0);
    
    return { oversized: oversizedTotal, regular: regularTotal };
  };

  // Calculate parking counts based on tenant's allocated area
  const calculateParkingCounts = () => {
    // For multi-building RFPs, get property data from primary property or multi-building data
    const activePropertyData = rfp?.isMultiBuilding 
      ? (multiBuildingProperties?.[0] || propertyData)
      : propertyData;

    if (!activePropertyData || !rfp?.selectedBayConfigurations) {
      console.log('Parking Calc Debug - Missing data:', { 
        hasProperty: !!activePropertyData, 
        hasBays: !!rfp?.selectedBayConfigurations,
        isMultiBuilding: rfp?.isMultiBuilding,
        propertyId: rfp?.property
      });
      return { vehicular: 0, trailer: 0 };
    }
    
    const property = activePropertyData as any;
    
    // Calculate tenant's rentable area from selected bays
    const tenantRentableArea = rfp.selectedBayConfigurations.reduce((total, bay) => {
      return total + (bay.rentableSquareFootage || 0);
    }, 0) + (rfp.mechanicalRoomArea || 0);
    
    // Get total property rentable area - calculate from bay configurations
    const totalPropertyArea = property.bayConfigurations 
      ? property.bayConfigurations.reduce((total: number, bay: any) => {
          return total + (bay.rentableSquareFootage || bay.squareFootage || 0);
        }, 0)
      : 0;
    
    console.log('Parking Calc Debug - Areas:', { 
      tenantArea: tenantRentableArea, 
      totalArea: totalPropertyArea,
      mechanicalRoom: rfp.mechanicalRoomArea || 0,
      selectedBays: rfp.selectedBayConfigurations.length
    });
    
    if (totalPropertyArea === 0 || tenantRentableArea === 0) {
      console.log('Parking Calc Debug - Zero areas detected');
      return { vehicular: 0, trailer: 0 };
    }
    
    // Calculate tenant's percentage of the property
    const tenantPercentage = tenantRentableArea / totalPropertyArea;
    
    // Calculate proportional parking allocation
    const totalVehicularParking = (property.standardParking || 0) + (property.accessibleParking || 0) + (property.evParking || 0);
    const totalTrailerParking = property.trailerParking || 0;
    
    const allocatedVehicular = Math.round(totalVehicularParking * tenantPercentage);
    const allocatedTrailer = Math.round(totalTrailerParking * tenantPercentage);
    
    console.log('Parking Calc Debug - Results:', { 
      percentage: tenantPercentage,
      totalVehicular: totalVehicularParking,
      totalTrailer: totalTrailerParking,
      allocatedVehicular,
      allocatedTrailer
    });
    
    return { vehicular: allocatedVehicular, trailer: allocatedTrailer };
  };

  // Update budgetData door and parking counts when RFP data changes
  // This must run AFTER initial load to override any saved door counts with current calculation
  useEffect(() => {
    if (rfp && rfp.selectedBayConfigurations) {
      console.log('🔄 Updating door counts from current bay selection...');
      const doorCounts = calculateDoorCounts();
      const parkingCounts = calculateParkingCounts();
      
      console.log('🚪 Door counts calculated:', { oversized: doorCounts.oversized, regular: doorCounts.regular });
      
      setBudgetData(prev => ({
        ...prev,
        oversizedDoors: doorCounts.oversized,
        regularDoors: doorCounts.regular,
        vehicularParking: parkingCounts.vehicular,
        trailerParking: parkingCounts.trailer
      }));
    }
  }, [rfp?.selectedBayConfigurations, propertyData, existingBudget]);

  // Function to auto-populate existing improvements based on selected bays
  const populateExistingImprovements = () => {
    if (!propertyImprovements || !rfp?.selectedBayConfigurations) {
      return [];
    }

    const selectedBayIds = rfp.selectedBayConfigurations.map(bay => bay.id);
    
    // Calculate tenant area using legally compliant totals
    let totalSelectedArea = 0;
    if (rfp?.warehouseArea) {
      totalSelectedArea = parseInt(rfp.warehouseArea);
    } else {
      // Use legal compliance totals based on property name
      const propertyLegalTotals: Record<string, number> = {
        'Bridge Point Gratigny': 409189,
        'Bridge 595': 290307,
        'MG Westside': 794334,
        'Bridge Point Port Everglades': 171983
      };
      
      // Get legally compliant total for this property using property name from propertyData
      const propertyName = propertyData?.propertyName || '';
      const legalTotal = propertyLegalTotals[propertyName];
      if (legalTotal && rfp.selectedBayConfigurations.length > 0) {
        // Use legal total if we have all bays selected or close to full property
        const rawTotal = rfp.selectedBayConfigurations.reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
        // If raw total is close to legal total (within 100 SF), use legal total for accuracy
        if (Math.abs(rawTotal - legalTotal) <= 100) {
          totalSelectedArea = legalTotal;
        } else {
          // For partial selections, use calculated total
          totalSelectedArea = Math.round(rawTotal);
        }
      } else {
        // Fallback to calculated total if no legal total available
        totalSelectedArea = Math.round(rfp.selectedBayConfigurations.reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0));
      }
    }
    
    return propertyImprovements
      .filter((improvement: any) => {
        // Include improvement if it's active and relevant to selected bays
        if (!improvement.isActive) return false;
        
        if (improvement.allocationType === 'whole-property') {
          return true; // Always include whole-property improvements
        }
        
        if (improvement.allocationType === 'bay-specific') {
          // Include if any applicable bays are in our selection
          return improvement.applicableBays?.some((bayId: string) => selectedBayIds.includes(bayId));
        }
        
        if (improvement.allocationType === 'prorated') {
          return true; // Include prorated improvements (will be calculated proportionally)
        }
        
        if (improvement.allocationType === 'demising-wall') {
          // Include demising wall if either the left or right bay is in our selection
          const demisingData = improvement.demisingWallData;
          if (demisingData) {
            const hasLeftBay = demisingData.leftBayId && selectedBayIds.includes(demisingData.leftBayId);
            const hasRightBay = demisingData.rightBayId && selectedBayIds.includes(demisingData.rightBayId);
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
          const propertyLegalTotals: Record<string, number> = {
            'Bridge Point Gratigny': 409189,
            'Bridge 595': 290307,
            'MG Westside': 794334,
            'Bridge Point Port Everglades': 171983
          };
          
          // Use property name from propertyData for legal total lookup
          const propertyName = propertyData?.propertyName || '';
          let propertyTotalArea = propertyLegalTotals[propertyName] || 0;
          
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
          // For bay-specific, only include cost for applicable selected bays
          const applicableBayIds = improvement.applicableBays?.filter((bayId: string) => selectedBayIds.includes(bayId)) || [];
          const applicableBayCount = applicableBayIds.length;
          const totalApplicableBays = improvement.applicableBays?.length || 1;
          
          if (applicableBayCount > 0) {
            quantity = applicableBayCount;
            unit = 'bay';
            allocatedCost = (allocatedCost * applicableBayCount) / totalApplicableBays;
            unitPrice = allocatedCost / quantity;
          } else {
            // No applicable bays selected, skip this improvement
            return null;
          }
        } else if (improvement.allocationType === 'demising-wall') {
          // For demising walls, calculate cost based on which bay(s) are selected
          const demisingData = improvement.demisingWallData;
          if (demisingData) {
            const hasLeftBay = demisingData.leftBayId && selectedBayIds.includes(demisingData.leftBayId);
            const hasRightBay = demisingData.rightBayId && selectedBayIds.includes(demisingData.rightBayId);
            
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
        } as EvaluationLineItem;
      })
      .filter(item => item !== null);
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
      

      
      setBudgetData({
        tenantImprovements: (existingBudget as any).tenantImprovements || [],
        designSoftCosts: (existingBudget as any).designSoftCosts || [],
        existingImprovements: (existingBudget as any).existingImprovements || existingImprovementsFromProperty,
        hasExistingImprovements: (existingBudget as any).hasExistingImprovements || existingImprovementsFromProperty.length > 0,
        includeExistingInTotal: (existingBudget as any).includeExistingInTotal || false,
        separateDesignCosts: (existingBudget as any).separateDesignCosts !== undefined ? (existingBudget as any).separateDesignCosts : false,
        totalTenantImprovements: (existingBudget as any).totalTenantImprovements || "0.00",
        totalDesignSoftCosts: (existingBudget as any).totalDesignSoftCosts || "0.00",
        totalExistingImprovements: (existingBudget as any).totalExistingImprovements || "0.00",
        grandTotal: (existingBudget as any).grandTotal || "0.00",
        notes: (existingBudget as any).notes || "",
        lineItemRollups: (existingBudget as any).lineItemRollups || {},
        customAssemblies: (existingBudget as any).customAssemblies || [],
        assemblies: (existingBudget as any).assemblies || {},
        oversizedDoors: doorCounts.oversized,
        regularDoors: doorCounts.regular,
        vehicularParking: savedVehicular !== undefined ? savedVehicular : 0,
        trailerParking: savedTrailer !== undefined ? savedTrailer : 0,
      });
    } else {
      // Initialize with door counts and existing improvements even if no other data
      const parkingCounts = calculateParkingCounts();
      setBudgetData(prev => ({
        ...prev,
        existingImprovements: existingImprovementsFromProperty,
        hasExistingImprovements: existingImprovementsFromProperty.length > 0,
        oversizedDoors: doorCounts.oversized,
        regularDoors: doorCounts.regular,
        vehicularParking: parkingCounts.vehicular,
        trailerParking: parkingCounts.trailer,
      }));
    }
  }, [existingBudget, allBidLineItems, bidCollections, rfp?.selectedBayConfigurations, propertyImprovements]);

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
    
    // First handle design cost distribution if applicable
    let distributedDesignCost = 0;
    if (budgetData.separateDesignCosts) {
      const tiTotal = calculateCategoryTotal(budgetData.tenantImprovements);
      const designTotal = calculateCategoryTotal(budgetData.designSoftCosts);
      
      if (tiTotal > 0) {
        const itemPercentage = itemCost / tiTotal;
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
      // Calculate base total for this category (excluding rolled-up items AND assembled items)
      const baseCategoryTotal = budgetData[itemCategory]
        .filter(i => !budgetData.lineItemRollups[i.id] && !i.assemblyId)
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
      
      // Distribute rolled-in amount proportionally if this item is not rolled up elsewhere
      if (!budgetData.lineItemRollups[item.id] && !item.assemblyId && baseCategoryTotal > 0 && totalRolledIn > 0) {
        // CORRECTED LOGIC: Calculate item percentage based on what the user expects
        // If item represents 60% of the displayed costs, it should get 60% of the rolled-up amount
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

  const exportToExcel = () => {
    if (!rfp) return;

    // Create workbook
    const workbook = XLSX.utils.book_new();
    
    // Calculate rentable area using legally compliant totals
    let rentableArea = 0;
    if (rfp?.warehouseArea) {
      rentableArea = parseInt(rfp.warehouseArea);
    } else if (rfp?.selectedBayConfigurations && Array.isArray(rfp.selectedBayConfigurations)) {
      // Use legal compliance totals based on property
      const propertyLegalTotals: Record<string, number> = {
        'Bridge Point Gratigny': 409189,
        'Bridge 595': 290307,
        'MG Westside': 794334,
        'Bridge Point Port Everglades': 171983
      };
      
      // Get legally compliant total for this property
      const legalTotal = propertyLegalTotals[rfp.property];
      if (legalTotal && rfp.selectedBayConfigurations.length > 0) {
        // Use legal total if we have all bays selected or close to full property
        const rawTotal = rfp.selectedBayConfigurations.reduce((total, bay) => total + (bay.rentableSquareFootage || 0), 0);
        // If raw total is close to legal total (within 100 SF), use legal total for accuracy
        if (Math.abs(rawTotal - legalTotal) <= 100) {
          rentableArea = legalTotal;
        } else {
          // For partial selections, use calculated total
          rentableArea = Math.round(rawTotal);
        }
      } else {
        // Fallback to calculated total if no legal total available
        rentableArea = Math.round(rfp.selectedBayConfigurations.reduce((total, bay) => {
          return total + (bay.rentableSquareFootage || 0);
        }, 0));
      }
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

    // Combine all data
    let allData = [...tenantImprovementsData, ...designCostsData, ...existingImprovementsData];

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
    let rentableArea = 0;
    if (rfp?.warehouseArea) {
      rentableArea = parseInt(rfp.warehouseArea);
    } else if (rfp?.selectedBayConfigurations && Array.isArray(rfp.selectedBayConfigurations)) {
      // Use legal compliance totals based on property
      const propertyLegalTotals: Record<string, number> = {
        'Bridge Point Gratigny': 409189,
        'Bridge 595': 290307,
        'MG Westside': 794334,
        'Bridge Point Port Everglades': 171983
      };
      
      // Get legally compliant total for this property
      const legalTotal = propertyLegalTotals[rfp.property];
      if (legalTotal && rfp.selectedBayConfigurations.length > 0) {
        // Use legal total if we have all bays selected or close to full property
        const rawTotal = rfp.selectedBayConfigurations.reduce((total, bay) => total + (bay.rentableSquareFootage || 0), 0);
        // If raw total is close to legal total (within 100 SF), use legal total for accuracy
        if (Math.abs(rawTotal - legalTotal) <= 100) {
          rentableArea = legalTotal;
        } else {
          // For partial selections, use calculated total
          rentableArea = Math.round(rawTotal);
        }
      } else {
        // Fallback to calculated total if no legal total available
        rentableArea = Math.round(rfp.selectedBayConfigurations.reduce((total, bay) => {
          return total + (bay.rentableSquareFootage || 0);
        }, 0));
      }
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

    // Combine all data
    let allData = [...tenantImprovementsData, ...designCostsData, ...existingImprovementsData];

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
    
    const currentDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York'
    });

    // Extract property data for use in report - calculate from bay configurations if warehouse_area is null
    // Use legally compliant totals to ensure accurate reporting
    let rentableArea = 0;
    if (rfp?.warehouseArea) {
      rentableArea = parseInt(rfp.warehouseArea);
    } else if (rfp?.selectedBayConfigurations && Array.isArray(rfp.selectedBayConfigurations)) {
      // Use legal compliance totals based on property
      const propertyLegalTotals: Record<string, number> = {
        'Bridge Point Gratigny': 409189,
        'Bridge 595': 290307,
        'MG Westside': 794334,
        'Bridge Point Port Everglades': 171983
      };
      
      // Get legally compliant total for this property
      const legalTotal = propertyLegalTotals[rfp.property];
      if (legalTotal && rfp.selectedBayConfigurations.length > 0) {
        // Use legal total if we have all bays selected or close to full property
        const rawTotal = rfp.selectedBayConfigurations.reduce((total, bay) => total + (bay.rentableSquareFootage || 0), 0);
        // If raw total is close to legal total (within 100 SF), use legal total for accuracy
        if (Math.abs(rawTotal - legalTotal) <= 100) {
          rentableArea = legalTotal;
        } else {
          // For partial selections, use calculated total
          rentableArea = Math.round(rawTotal);
        }
      } else {
        // Fallback to calculated total if no legal total available
        rentableArea = Math.round(rfp.selectedBayConfigurations.reduce((total, bay) => {
          return total + (bay.rentableSquareFootage || 0);
        }, 0));
      }
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
                  <thead>
                      <tr>
                          <th>Description</th>
                          <th>Quantity</th>
                          <th>Unit</th>
                          <th>Unit Price</th>
                          <th>Total Price</th>
                          <th>$/RSF</th>
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
                            <td>${item.description}</td>
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
      const total = calculateCategoryTotal(budgetData.existingImprovements);
      
      return `
      <div class="section">
          <div class="section-header">
              <h2 class="section-title" style="color: #333;">
                  Existing Improvements
                  <span style="color: #0891b2 !important; font-style: italic !important; font-weight: bold !important; font-size: 16px !important;">${formatCurrency(total)} <span style="font-size: 50%; font-weight: normal;">${(() => {
                    const pricePerSf = rentableArea > 0 ? total / rentableArea : 0;
                    return pricePerSf > 0 ? '($' + pricePerSf.toFixed(2) + '/RSF)' : '';
                  })()}</span></span>
              </h2>
          </div>
          <div class="table-container">
              ${budgetData.existingImprovements.length > 0 ? `
              <table>
                  <thead>
                      <tr>
                          <th>Description</th>
                          <th>Quantity</th>
                          <th>Unit</th>
                          <th>Unit Price</th>
                          <th>Total Price</th>
                          <th>$/RSF</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${budgetData.existingImprovements.filter(item => !item.assemblyId).map(item => {
                        const totalPrice = parseFloat(item.totalPrice) || 0;
                        const pricePerSf = rentableArea > 0 ? totalPrice / rentableArea : 0;
                        return `
                        <tr>
                            <td>${item.description}</td>
                            <td>${new Intl.NumberFormat('en-US').format(item.quantity)}</td>
                            <td>${item.unit}</td>
                            <td class="currency">${formatCurrency(parseFloat(item.unitPrice) || 0)}</td>
                            <td class="currency">${formatCurrency(totalPrice)}</td>
                            <td class="currency">${pricePerSf > 0 ? '$' + pricePerSf.toFixed(2) : 'N/A'}</td>
                        </tr>
                        `;
                      }).join('')}
                      
                      ${Object.entries(budgetData.assemblies || {}).filter(([name, data]) => {
                        const assemblyItems = data.components.map(id => {
                          return budgetData.existingImprovements.find(item => item.id === id);
                        }).filter(Boolean);
                        return assemblyItems.length > 0;
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
              ` : '<p style="text-align: center; color: #6c757d; padding: 20px;">No existing improvements added yet</p>'}
              
              <div class="existing-improvements-note">
                  <strong>Note:</strong> These existing improvements are ${budgetData.includeExistingInTotal ? 'included in' : 'excluded from'} the Grand Total calculation.
                  ${!budgetData.includeExistingInTotal ? ' They are tracked separately for financial modeling purposes.' : ''}
              </div>
          </div>
      </div>`;
    };
    
    const reportHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
        @media print {
            body { background-color: white; }
            .section { border: 1px solid #ddd; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div style="flex: 1;">
                <img src="/api/bridge-logo" alt="Bridge Industrial" style="height: 30px; max-width: 200px;" />
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
                      return 'Not specified';
                    })()}</p>
                    <p style="margin: 4px 0; font-size: 13px;"><strong>Door Configuration:</strong> ${budgetData.oversizedDoors + budgetData.regularDoors} doors total (${budgetData.oversizedDoors} oversized, ${budgetData.regularDoors} regular)</p>
                </div>
                <div>
                    <p style="margin: 4px 0; font-size: 13px;"><strong>Vehicular Parking:</strong> ${budgetData.vehicularParking || 0} spaces</p>
                    <p style="margin: 4px 0; font-size: 13px;"><strong>Trailer Parking:</strong> ${budgetData.trailerParking || 0} spaces</p>
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

    ${budgetData.hasExistingImprovements ? renderCategorySection("Existing Improvements", budgetData.existingImprovements, "existingImprovements") : ''}
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
        notes: `Generated on ${currentDate}. Grand Total: ${formatCurrency(grandTotal)}`
      });
    }
  };

  const addNewItem = (category: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', addAnother: boolean = false) => {
    if (!newItem.description || !newItem.unitPrice) return;

    const quantity = newItem.quantity || 1;
    const unitPrice = parseFloat(newItem.unitPrice) || 0;
    const totalPrice = (quantity * unitPrice).toFixed(2);

    const item: EvaluationLineItem = {
      id: `${category}-${Date.now()}`,
      description: newItem.description,
      quantity,
      unit: newItem.unit || "ea",
      unitPrice: unitPrice.toFixed(2),
      totalPrice,
      tenantShare: newItem.tenantShare || 100,
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
      tenantShare: 100
    });
    
    if (!addAnother) {
      setNewItemCategory("");
    } else {
      // Auto-focus on description field for next item
      setTimeout(() => {
        const descInput = document.querySelector('input[placeholder="Enter item description"]') as HTMLInputElement;
        if (descInput) {
          descInput.focus();
        }
      }, 100);
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
    setBudgetData(prev => ({
      ...prev,
      [category]: prev[category].map(item => {
        if (item.id === itemId) {
          const updatedItem = { ...item, ...updates };
          
          // Recalculate total if quantity or unit price changed
          if (updates.quantity !== undefined || updates.unitPrice !== undefined) {
            const quantity = updatedItem.quantity;
            const unitPrice = parseFloat(updatedItem.unitPrice) || 0;
            updatedItem.totalPrice = (quantity * unitPrice).toFixed(2);
          }
          
          return updatedItem;
        }
        return item;
      }),
    }));
  };

  const deleteItem = (category: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', itemId: string) => {
    setBudgetData(prev => ({
      ...prev,
      [category]: prev[category].filter(item => item.id !== itemId),
    }));
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
          trailerParking: budgetData.trailerParking
        },
      };

      await fetch(`/api/rfp-requests/${rfp.id}/evaluation-budget`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
        },
        body: JSON.stringify(budgetPayload),
      });

      // Upload new files if any
      if (attachedFiles.length > 0) {
        const formData = new FormData();
        attachedFiles.forEach((file, index) => {
          formData.append(`attachment_${index}`, file);
        });
        formData.append('rfpId', rfp.id.toString());

        await fetch(`/api/rfp-requests/${rfp.id}/evaluation-budget/attachments`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
          },
          body: formData,
        });
        
        setAttachedFiles([]);
      }
    },
    onSuccess: () => {
      toast({
        title: "Progress Saved",
        description: "Your evaluation has been saved. You can continue editing or proceed to team review when ready.",
      });
    },
    onError: (error) => {
      console.error('Save progress error:', error);
      toast({
        title: "Save Failed",
        description: "There was an error saving your progress. Please try again.",
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
          trailerParking: budgetData.trailerParking
        },
      };

      await fetch(`/api/rfp-requests/${rfp.id}/evaluation-budget`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
        },
        body: JSON.stringify(budgetPayload),
      });

      // Upload new files if any
      if (attachedFiles.length > 0) {
        const formData = new FormData();
        attachedFiles.forEach((file, index) => {
          formData.append(`attachment_${index}`, file);
        });
        formData.append('rfpId', rfp.id.toString());

        await fetch(`/api/rfp-requests/${rfp.id}/evaluation-budget/attachments`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
          },
          body: formData,
        });
        
        setAttachedFiles([]);
      }

      await fetch(`/api/rfp-requests/${rfp.id}/workflow-phase`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phase: 'publish' }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Budget Saved & Workflow Advanced",
        description: "Evaluation budget saved and project moved to publish phase.",
      });
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
      console.log('Drag operation:', {
        draggableId,
        draggedItem,
        allItems: items.map(item => ({ id: item.id, description: item.description, assemblyId: item.assemblyId }))
      });

      // Check if dragged item is an assembly component (has assemblyId)
      const draggedIsComponent = !!draggedItem.assemblyId;
      
      // Check if dragged item is an assembly header (other items reference it)
      const draggedIsHeader = items.some(item => item.assemblyId === draggableId);

      console.log('Assembly check:', { draggedIsComponent, draggedIsHeader });

      if (draggedIsComponent || draggedIsHeader) {
        // Determine the assembly header ID
        const assemblyHeaderId = draggedIsComponent ? draggedItem.assemblyId! : draggableId;
        
        console.log('Assembly header ID:', assemblyHeaderId);
        
        // Find ALL items that belong to this assembly (header + all components)
        const assemblyGroupItems = items.filter(item => 
          item.id === assemblyHeaderId || item.assemblyId === assemblyHeaderId
        );
        
        console.log('Assembly group items:', assemblyGroupItems.map(item => ({ id: item.id, description: item.description })));
        
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
          
          console.log('Move complete - final order:', result.map(item => ({ id: item.id, description: item.description })));
          
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
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg text-black">{title}</CardTitle>
        <div className="flex items-center gap-2">
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
                    disabled={!rfp?.scopeOfWork || !Array.isArray(rfp.scopeOfWork) || rfp.scopeOfWork.length === 0}
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

                              {/* Editable cells vs Display cells */}
                              {editingItem === item.id ? (
                                <>
                                  <TableCell>
                                    <Input
                                      value={item.description}
                                      onChange={(e) => updateItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id, { description: e.target.value })}
                                      className="text-sm"
                                    />
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
                                    />
                                  </TableCell>
                                  {!newItemCategory && <TableCell className="font-medium text-center">{formatCurrency(item.totalPrice)}</TableCell>}
                                  <TableCell className="text-center">
                                    {(() => {
                                      const totalCost = parseFloat(item.totalPrice) || 0;
                                      const tenantShare = (item.tenantShare || 100) / 100;
                                      const tenantCost = totalCost * tenantShare;
                                      const warehouseArea = parseFloat(rfp?.warehouseArea || '0');
                                      if (warehouseArea > 0) {
                                        const perSF = tenantCost / warehouseArea;
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
                                    <div className="flex gap-1 items-center justify-center">
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
                                  </TableCell>
                                </>
                              ) : (
                                <>
                                  <TableCell>
                                    <span className={`${isAssembled ? 'line-through opacity-60' : ''}`}>
                                      {item.description}
                                    </span>
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
                                        const warehouseArea = parseFloat(rfp?.warehouseArea || '0');
                                        if (warehouseArea > 0) {
                                          const perSF = tenantCost / warehouseArea;
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
                <Input
                  value={newItem.description || ""}
                  onChange={(e) => setNewItem(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Enter item description"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.ctrlKey && newItem.description && newItem.unitPrice) {
                      e.preventDefault();
                      addNewItem(category, true);
                    }
                  }}
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
                    onChange={(e) => setBudgetData(prev => ({
                      ...prev,
                      oversizedDoors: parseInt(e.target.value) || 0
                    }))}
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
                    onChange={(e) => setBudgetData(prev => ({
                      ...prev,
                      regularDoors: parseInt(e.target.value) || 0
                    }))}
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
          </div>
        </CardContent>
      </Card>

      {/* File Attachments */}
      <EvaluationAttachments rfpId={rfp?.id} />

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
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Select Scope of Work Items to Import</DialogTitle>
            <DialogDescription>
              Choose which scope of work items from the RFP you want to import into Tenant Improvements.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Select</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rfp?.scopeOfWork && Array.isArray(rfp.scopeOfWork) && rfp.scopeOfWork.map((item: any, index: number) => {
                  const itemKey = index.toString();
                  const description = item.description || item.item || item;
                  return (
                    <TableRow key={itemKey}>
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
                      <TableCell>{description}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="flex justify-between items-center">
            <div className="text-sm text-gray-600">
              {selectedScopeItems.size} item{selectedScopeItems.size !== 1 ? 's' : ''} selected
            </div>
            <div className="flex gap-2">
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
                variant="outline"
                onClick={() => {
                  if (rfp?.scopeOfWork && Array.isArray(rfp.scopeOfWork)) {
                    const allKeys = rfp.scopeOfWork.map((_, index) => index.toString());
                    setSelectedScopeItems(new Set(allKeys));
                  }
                }}
              >
                Select All
              </Button>
              <Button
                onClick={importSelectedScopeItems}
                disabled={selectedScopeItems.size === 0}
              >
                Import Selected ({selectedScopeItems.size})
              </Button>
            </div>
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

      {/* Import from Another RFP Dialog */}
      <RfpImportDialog
        open={showRfpImportModal}
        onOpenChange={setShowRfpImportModal}
        currentRfpId={rfp?.id}
        onImport={handleRfpImport}
      />
    </div>
  );
}