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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit, Trash2, Save, X, ArrowRight, Copy, FileDown, Upload, Package, Users, ChevronUp, ChevronDown, GripVertical, Check as CheckIcon } from "lucide-react";
import { EvaluationAttachments } from "./evaluation-attachments";
import { EvaluationBudgetHistory } from "./evaluation-budget-history";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import { nanoid } from "nanoid";
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
}

export function EvaluationBudget({ rfp }: EvaluationBudgetProps) {
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
  const [showAssemblyCreator, setShowAssemblyCreator] = useState(false);
  const [newAssemblyName, setNewAssemblyName] = useState("");
  const [newAssemblyCategory, setNewAssemblyCategory] = useState<'tenantImprovements' | 'designSoftCosts' | 'existingImprovements' | ''>('');
  
  // File attachment state for Budget Evaluation stage
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<any[]>([]);
  
  // Premises edit mode state
  const [premisesEditMode, setPremisesEditMode] = useState(false);

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
      });
    } catch (error) {
      toast({
        title: "Delete Failed",
        description: "Failed to delete the attachment. Please try again.",
        variant: "destructive",
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

  // Assembly helper functions
  const handleItemSelection = (itemId: string, checked: boolean) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(itemId);
      } else {
        newSet.delete(itemId);
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
    if (!newAssemblyName.trim() || selectedItems.size === 0 || !newAssemblyCategory) return;

    const selectedItemsArray = Array.from(selectedItems);
    const categoryItems = budgetData[newAssemblyCategory];
    const itemsToAssemble = categoryItems.filter(item => selectedItemsArray.includes(item.id));
    
    if (itemsToAssemble.length === 0) return;

    // Calculate totals from selected items
    const totalPrice = itemsToAssemble.reduce((sum, item) => sum + (parseFloat(item.totalPrice) || 0), 0);
    const firstItem = itemsToAssemble[0];
    const quantity = firstItem.quantity;
    const unitPrice = quantity > 0 ? (totalPrice / quantity) : totalPrice;

    // Create the assembly line item
    const assemblyLineItem: EvaluationLineItem = {
      id: `assembly_${Date.now()}`,
      description: newAssemblyName.trim(),
      quantity: quantity,
      unit: firstItem.unit,
      unitPrice: unitPrice.toFixed(2),
      totalPrice: totalPrice.toFixed(2),
      tenantShare: 100, // Default to 100% tenant responsibility
      bidCollectionId: firstItem.bidCollectionId,
      bidLineItemId: firstItem.bidLineItemId,
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
    setNewAssemblyName("");
    setNewAssemblyCategory('');
    setShowAssemblyCreator(false);
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
        return lineItems.map((item: BidLineItem) => ({ ...item, bidCollectionId: bid.id }));
      });
      
      const results = await Promise.all(lineItemPromises);
      return results.flat();
    },
    enabled: !!bidCollections && Array.isArray(bidCollections) && bidCollections.length > 0,
  });

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
    if (!propertyData || !rfp?.selectedBayConfigurations) return { vehicular: 0, trailer: 0 };
    
    const property = propertyData as any;
    
    // Calculate tenant's rentable area from selected bays
    const tenantRentableArea = rfp.selectedBayConfigurations.reduce((total, bay) => {
      return total + (bay.rentableSquareFootage || 0);
    }, 0) + (rfp.mechanicalRoomArea || 0);
    
    // Get total property rentable area
    const totalPropertyArea = parseFloat(property.rentableSquareFootage || '0');
    
    if (totalPropertyArea === 0 || tenantRentableArea === 0) {
      return { vehicular: 0, trailer: 0 };
    }
    
    // Calculate tenant's percentage of the property
    const tenantPercentage = tenantRentableArea / totalPropertyArea;
    
    // Calculate proportional parking allocation
    const totalVehicularParking = (property.standardParking || 0) + (property.accessibleParking || 0) + (property.evParking || 0);
    const totalTrailerParking = property.trailerParking || 0;
    
    const allocatedVehicular = Math.round(totalVehicularParking * tenantPercentage);
    const allocatedTrailer = Math.round(totalTrailerParking * tenantPercentage);
    
    return { vehicular: allocatedVehicular, trailer: allocatedTrailer };
  };

  // Function to auto-populate existing improvements based on selected bays
  const populateExistingImprovements = () => {
    if (!propertyImprovements || !rfp?.selectedBayConfigurations) {
      return [];
    }

    const selectedBayIds = rfp.selectedBayConfigurations.map(bay => bay.id);
    const totalSelectedArea = rfp.selectedBayConfigurations.reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
    
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
          
          // Get total property area from the property data
          let propertyTotalArea = 409189; // Default fallback for Bridge Point Gratigny
          
          if (propertyData) {
            // Calculate total rentable area: sum of bay areas + mechanical room area
            const bayTotalArea = propertyData.bayConfigurations?.reduce((sum: number, bay: any) => {
              return sum + (bay.rentableSquareFootage || bay.squareFootage || 0);
            }, 0) || 0;
            
            const mechanicalArea = propertyData.mechanicalRoomSquareFootage || 0;
            propertyTotalArea = bayTotalArea + mechanicalArea;
          }
          
          if (propertyTotalArea > 0) {
            // Calculate the prorated total cost for this tenant's area
            const proratedTotalCost = (allocatedCost * totalSelectedArea) / propertyTotalArea;
            unitPrice = proratedTotalCost / quantity; // Per square foot cost
            allocatedCost = proratedTotalCost;
            

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
    const parkingCounts = calculateParkingCounts();
    const existingImprovementsFromProperty = populateExistingImprovements();
    
    if (existingBudget) {
      // Load saved budget data but override door counts with current bay configuration
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
        vehicularParking: (existingBudget as any).metadata?.vehicularParking !== undefined ? (existingBudget as any).metadata.vehicularParking : parkingCounts.vehicular,
        trailerParking: (existingBudget as any).metadata?.trailerParking !== undefined ? (existingBudget as any).metadata.trailerParking : parkingCounts.trailer,
      });
    } else if (allBidLineItems && Array.isArray(allBidLineItems) && allBidLineItems.length > 0) {
      // Initialize with bid line items if no saved budget exists
      const initialItems = allBidLineItems.map((item: BidLineItem & { bidCollectionId: number }) => ({
        id: `tenant-${item.id}`,
        description: item.description,
        quantity: typeof item.quantity === 'string' ? parseInt(item.quantity) || 1 : item.quantity || 1,
        unit: item.unit || "ea",
        unitPrice: item.unitPrice?.toString() || "0.00",
        totalPrice: item.totalPrice?.toString() || "0.00",
        tenantShare: 100, // Default to 100% tenant responsibility
        bidCollectionId: item.bidCollectionId,
        bidLineItemId: item.id,
      }));

      setBudgetData(prev => ({
        ...prev,
        tenantImprovements: initialItems as EvaluationLineItem[],
        existingImprovements: existingImprovementsFromProperty,
        hasExistingImprovements: existingImprovementsFromProperty.length > 0,
        separateDesignCosts: false,
        oversizedDoors: doorCounts.oversized,
        regularDoors: doorCounts.regular,
        vehicularParking: parkingCounts.vehicular,
        trailerParking: parkingCounts.trailer,
      }));
    } else {
      // Initialize with door counts and existing improvements even if no other data
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
  }, [existingBudget, allBidLineItems, bidCollections, rfp?.selectedBayConfigurations, propertyImprovements, propertyData]);

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
      // Calculate base total for this category (excluding rolled-up items)
      const baseCategoryTotal = budgetData[itemCategory]
        .filter(i => !budgetData.lineItemRollups[i.id])
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
      if (!budgetData.lineItemRollups[item.id] && baseCategoryTotal > 0 && totalRolledIn > 0) {
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
      });
      return;
    }

    if (!newAssemblyCategory || newAssemblyCategory.trim() === '') {
      toast({
        title: "Error",
        description: "Please select a category for the assembly.",
        variant: "destructive",
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

  const generateReportPreview = async (hideDesignCosts: boolean) => {
    if (!rfp) return;
    
    const currentDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York'
    });

    // Extract property data for use in report - calculate from bay configurations if warehouse_area is null
    let rentableArea = 0;
    if (rfp?.warehouseArea) {
      rentableArea = parseInt(rfp.warehouseArea);
    } else if (rfp?.selectedBayConfigurations && Array.isArray(rfp.selectedBayConfigurations)) {
      // Calculate from bay configurations
      rentableArea = Math.round(rfp.selectedBayConfigurations.reduce((total, bay) => {
        return total + (bay.rentableSquareFootage || 0);
      }, 0));
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
            padding: 10px 0;
            margin-bottom: 15px;
            text-align: center;
            border-bottom: 1px solid #dee2e6;
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
        <h1>Evaluation Budget Report</h1>
        <p><strong>Project:</strong> ${rfp?.projectName}</p>
        <p><strong>RFP Number:</strong> ${rfp?.rfpNumber}</p>
        <p><strong>Generated:</strong> ${currentDate}</p>
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

  const addNewItem = (category: 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements') => {
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

    setNewItem({
      description: "",
      quantity: 0,
      unit: "",
      unitPrice: "",
      totalPrice: "",
      tenantShare: 100
    });
    setNewItemCategory("");
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
          <Button
            size="sm"
            onClick={() => setNewItemCategory(category)}
            className="h-8"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Item
          </Button>
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
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 && !newItemCategory ? (
          <p className="text-gray-500 text-center py-4">No items added yet</p>
        ) : (
          <div className="overflow-x-auto">
            <DragDropContext onDragEnd={handleDragEnd}>
              <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">Order</TableHead>
                  <TableHead className="w-12 text-center">Assembly</TableHead>
                  <TableHead className="w-36">Assembly Group</TableHead>
                  <TableHead className="w-16 text-center">Rollup</TableHead>
                  <TableHead className="min-w-48">Description</TableHead>
                  <TableHead className="w-36">Quantity (Unit)</TableHead>
                  <TableHead className="w-32">Unit Price</TableHead>
                  {!newItemCategory && <TableHead className="w-32">Total</TableHead>}
                  <TableHead className="w-24 text-center">$/RSF</TableHead>
                  <TableHead className="w-24 text-center">Tenant %</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
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
                                <div className="flex flex-col items-center gap-1" {...provided.dragHandleProps}>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => moveItemUp(category, index)}
                                    disabled={index === 0}
                                    className="h-6 w-6 p-0"
                                  >
                                    <ChevronUp className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => moveItemDown(category, index)}
                                    disabled={index === items.length - 1}
                                    className="h-6 w-6 p-0"
                                  >
                                    <ChevronDown className="h-3 w-3" />
                                  </Button>
                                </div>
                              </TableCell>

                              {/* Assembly Checkbox */}
                              <TableCell className="text-center">
                                <div className="flex items-center justify-center">
                                  <Checkbox
                                    checked={selectedItems.has(item.id)}
                                    onCheckedChange={(checked) => handleItemSelection(item.id, !!checked)}
                                  />
                                </div>
                              </TableCell>

                              {/* Assembly Group Column */}
                              <TableCell className="text-sm text-gray-600">
                                {item.assemblyId ? (
                                  // Find the assembly header name
                                  (() => {
                                    const assemblyHeader = items.find(i => i.id === item.assemblyId);
                                    return assemblyHeader ? assemblyHeader.description : 'Unknown Assembly';
                                  })()
                                ) : ''}
                              </TableCell>

                              {/* Rollup Select */}
                              <TableCell className="text-center">
                                <Select
                                  value={budgetData.lineItemRollups[item.id] || 'none'}
                                  onValueChange={(value) => handleLineItemRollup(item.id, category, value as any)}
                                >
                                  <SelectTrigger className="w-full text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
                                    <SelectItem value="tenantImprovements">TI</SelectItem>
                                    <SelectItem value="designSoftCosts">Design</SelectItem>
                                    <SelectItem value="tiAndDesign">TI & Design</SelectItem>
                                  </SelectContent>
                                </Select>
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
                                  <TableCell>
                                    <div className="flex gap-1">
                                      <Input
                                        type="number"
                                        value={item.quantity}
                                        onChange={(e) => {
                                          const quantity = parseInt(e.target.value) || 1;
                                          updateItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id, { quantity });
                                        }}
                                        className="w-16 text-sm"
                                      />
                                      <Input
                                        value={item.unit}
                                        onChange={(e) => updateItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id, { unit: e.target.value })}
                                        className="w-16 text-sm"
                                        placeholder="Unit"
                                      />
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      value={item.unitPrice}
                                      onChange={(e) => updateItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id, { unitPrice: e.target.value })}
                                      className="text-sm"
                                    />
                                  </TableCell>
                                  {!newItemCategory && <TableCell className="font-medium">{formatCurrency(item.totalPrice)}</TableCell>}
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
                                  <TableCell>
                                    <div className="flex gap-1">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setEditingItem(null)}
                                      >
                                        <Save className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setEditingItem(null)}
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
                                  <TableCell>
                                    <span className={`${isAssembled ? 'line-through opacity-60' : ''}`}>
                                      {new Intl.NumberFormat('en-US').format(item.quantity)} {item.unit}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <span className={`${isAssembled ? 'line-through opacity-60' : ''}`}>
                                      {formatCurrency(calculateDistributedUnitPrice(item))}
                                    </span>
                                  </TableCell>
                                  {!newItemCategory && (
                                    <TableCell className="font-medium">
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
                                  <TableCell>
                                    <div className="flex gap-1">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setEditingItem(item.id)}
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
                                      >
                                        <Copy className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => deleteItem(category as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements', item.id)}
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
                  placeholder="Item description"
                />
              </div>
              <div>
                <Label>Quantity</Label>
                <Input
                  type="number"
                  value={newItem.quantity || 1}
                  onChange={(e) => setNewItem(prev => ({ ...prev, quantity: parseInt(e.target.value) || 1 }))}
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
                <Input
                  type="number"
                  step="0.01"
                  value={newItem.unitPrice || ""}
                  onChange={(e) => setNewItem(prev => ({ ...prev, unitPrice: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Total Price</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newItem.totalPrice || ""}
                  onChange={(e) => setNewItem(prev => ({ ...prev, totalPrice: e.target.value }))}
                  placeholder="0.00"
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
                <Button onClick={() => addNewItem(category)} size="sm">
                  Add
                </Button>
                <Button onClick={() => setNewItemCategory("")} variant="outline" size="sm">
                  Cancel
                </Button>
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
    <div className="space-y-6 w-full max-w-none">
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
          <p className="text-sm text-gray-600">
            Check this box if there are costs associated with existing improvements that need to be factored into the budget.
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
          <div className="flex justify-center">
            <Button 
              onClick={() => generateReportPreview(budgetData.separateDesignCosts)}
              variant="outline"
              size="sm"
              className="px-8"
            >
              Generate Budget Report
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
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto border rounded p-2">
                {Array.from(selectedItems).map(itemId => {
                  const item = findItemById(itemId);
                  return item ? (
                    <div key={itemId} className="text-sm text-gray-700">
                      {item.description}
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
    </div>
  );
}