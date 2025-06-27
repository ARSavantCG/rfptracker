import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Plus, Edit, Trash2, Save, X, ArrowRight, Copy, FileDown, Upload, Package, Users, ChevronUp, ChevronDown, GripVertical } from "lucide-react";
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
    notes: ""
  });
  
  // Assembly creation state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showAssemblyCreator, setShowAssemblyCreator] = useState(false);
  const [newAssemblyName, setNewAssemblyName] = useState("");
  const [newAssemblyCategory, setNewAssemblyCategory] = useState<'tenantImprovements' | 'designSoftCosts' | 'existingImprovements' | ''>('');

  const queryClient = useQueryClient();
  const { toast } = useToast();

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
  });

  // Initialize budget with saved data or bid line items data
  useEffect(() => {
    if (existingBudget) {
      // Load saved budget data
      setBudgetData({
        tenantImprovements: (existingBudget as any).tenantImprovements || [],
        designSoftCosts: (existingBudget as any).designSoftCosts || [],
        existingImprovements: (existingBudget as any).existingImprovements || [],
        hasExistingImprovements: (existingBudget as any).hasExistingImprovements || false,
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
        bidCollectionId: item.bidCollectionId,
        bidLineItemId: item.id,
      }));

      setBudgetData(prev => ({
        ...prev,
        tenantImprovements: initialItems as EvaluationLineItem[],
        separateDesignCosts: false,
      }));
    }
  }, [existingBudget, allBidLineItems, bidCollections]);

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
      return total + price;
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
        total += parseFloat(item.totalPrice) || 0;
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
          let amountToAdd = parseFloat(item.totalPrice) || 0;
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
    return calculateCategoryTotal(items);
  };

  // Calculate distributed costs including rolled-up items
  const calculateDistributedCosts = (item: EvaluationLineItem) => {
    const itemCost = parseFloat(item.totalPrice) || 0;
    
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
        .reduce((total, i) => total + (parseFloat(i.totalPrice) || 0), 0);
      
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
            let amountToAdd = parseFloat(rolledItem.totalPrice) || 0;
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

    if (!newAssemblyCategory || newAssemblyCategory === '') {
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
    
    // Calculate grand total for report (sum of category totals with rollups)
    const tiTotal = calculateCategoryTotalWithRollups('tenantImprovements');
    const designTotal = calculateCategoryTotalWithRollups('designSoftCosts');
    const existingTotal = (budgetData.hasExistingImprovements && budgetData.includeExistingInTotal)
      ? calculateCategoryTotalWithRollups('existingImprovements') 
      : 0;
    const grandTotal = tiTotal + designTotal + existingTotal;
    
    // Local calculation functions that use the hideDesignCosts parameter
    const calculateDistributedCostsForPreview = (item: EvaluationLineItem) => {
      if (!hideDesignCosts) {
        // When showing separately, return original cost
        return parseFloat(item.totalPrice) || 0;
      }
      
      // When hiding design costs, distribute them proportionally
      const tiTotal = calculateCategoryTotal(budgetData.tenantImprovements);
      const designTotal = calculateCategoryTotal(budgetData.designSoftCosts);
      const itemCost = parseFloat(item.totalPrice) || 0;
      
      if (tiTotal === 0) return itemCost;
      
      const itemPercentage = itemCost / tiTotal;
      const distributedDesignCost = designTotal * itemPercentage;
      
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
      return calculateCategoryTotal(items);
    };
    
    const renderCategorySection = (title: string, items: EvaluationLineItem[], categoryType?: string) => {
      if (items.length === 0) return '';
      
      // Filter items based on rollup configuration
      const filteredItems = items.filter(item => {
        const rollupTarget = budgetData.lineItemRollups[item.id];
        if (!rollupTarget) {
          // Item is not rolled up, include it in its original category
          return true;
        }
        // Item is rolled up, only include it in the target category
        return rollupTarget === categoryType || 
               (rollupTarget === 'tiAndDesign' && (categoryType === 'tenantImprovements' || categoryType === 'designSoftCosts'));
      });
      
      // Don't add rolled-in items as separate line items - they should be distributed within existing items
      
      const allItemsForCategory = filteredItems;
      if (allItemsForCategory.length === 0) return '';
      
      // Calculate total with rollups
      const total = calculateCategoryTotalWithRollups(categoryType as 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements');
      // Use project area as rentable area
      const totalArea = rfp?.projectArea ? parseInt(rfp.projectArea) : 0;
      const rentableArea = totalArea;
      const isTenantImprovements = categoryType === 'tenantImprovements';
      
      return `
      <div class="section">
          <div class="section-header">
              <h2 class="section-title">
                  ${title}
                  <span class="section-total">${formatCurrency(total)}</span>
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
                          <th>$ / sf</th>
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
                            <td class="currency">${pricePerSf > 0 ? '$' + new Intl.NumberFormat('en-US').format(parseFloat(pricePerSf.toFixed(2))) : 'N/A'}</td>
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
                            <td class="currency">${pricePerSf > 0 ? '$' + new Intl.NumberFormat('en-US').format(parseFloat(pricePerSf.toFixed(2))) : 'N/A'}</td>
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
      const rentableArea = rfp?.projectArea ? parseInt(rfp.projectArea) : 0;
      
      return `
      <div class="section">
          <div class="section-header">
              <h2 class="section-title">
                  Existing Improvements
                  <span class="section-total">${formatCurrency(total)}</span>
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
                          <th>$ / sf</th>
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
                            <td class="currency">${pricePerSf > 0 ? '$' + new Intl.NumberFormat('en-US').format(parseFloat(pricePerSf.toFixed(2))) : 'N/A'}</td>
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
                            <td class="currency">${pricePerSf > 0 ? '$' + new Intl.NumberFormat('en-US').format(parseFloat(pricePerSf.toFixed(2))) : 'N/A'}</td>
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
            color: #495057;
            font-size: 16px;
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .section-total { font-weight: bold; color: #28a745; font-size: 16px; }
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
    
    <div style="text-align: right; margin-bottom: 20px; padding-right: 20px;">
        <p style="margin: 0; font-size: 14px; color: #666;"><strong>Rentable Area:</strong> ${(() => {
          const totalArea = rfp?.projectArea ? parseInt(rfp.projectArea) : 0;
          return totalArea > 0 ? new Intl.NumberFormat('en-US').format(totalArea) + ' sf' : 'N/A';
        })()}</p>
    </div>

    ${renderCategorySection("Tenant Improvements", budgetData.tenantImprovements, "tenantImprovements")}
    ${!hideDesignCosts ? renderCategorySection("Design / Soft Costs / Other Fees", budgetData.designSoftCosts, "designSoftCosts") : ''}

    <div class="grand-total">
        <h2>Grand Total: ${formatCurrency(grandTotal)} <span style="font-size: 50%; font-weight: normal;">${(() => {
          const totalArea = rfp?.projectArea ? parseInt(rfp.projectArea) : 0;
          const pricePerSf = totalArea > 0 ? grandTotal / totalArea : 0;
          return pricePerSf > 0 ? '($' + new Intl.NumberFormat('en-US').format(parseFloat(pricePerSf.toFixed(2))) + '/sf)' : '';
        })()}</span></h2>
        ${budgetData.hasExistingImprovements && !budgetData.includeExistingInTotal ? 
          '<p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">* Existing improvements tracked separately for financial modeling</p>' : ''
        }
    </div>

    ${budgetData.notes ? `
    <div class="notes-section">
        <h3 class="notes-title">Budget Notes</h3>
        <div class="notes-content">${budgetData.notes}</div>
    </div>
    ` : ''}

    ${Object.keys(budgetData.lineItemRollups).length > 0 ? `
    <div class="rollup-summary-section">
        <h3 class="rollup-summary-title">Line Item Rollup Summary</h3>
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

    ${Object.keys(budgetData.assemblies || {}).length > 0 ? `
    <div class="assembly-summary-section">
        <h3 class="assembly-summary-title">Assembly Summary</h3>
        <p class="assembly-summary-description">The following line items are grouped into assemblies:</p>
        <div class="assembly-summary-content">
            ${Object.entries(budgetData.assemblies || {}).map(([assemblyName, assemblyData]) => {
              return `<div class="assembly-summary-item">
                <div class="assembly-name"><strong>${assemblyName}</strong> (${formatCurrency(assemblyData.total)})</div>
                <div class="assembly-components">
                  ${assemblyData.components.map(componentId => {
                    const allItems = [
                      ...budgetData.tenantImprovements,
                      ...budgetData.designSoftCosts,
                      ...budgetData.existingImprovements
                    ];
                    const item = allItems.find(i => i.id === componentId);
                    return item ? `<div class="assembly-component">• ${item.description} (${formatCurrency(item.totalPrice)})</div>` : '';
                  }).join('')}
                </div>
              </div>`;
            }).join('')}
        </div>
    </div>
    ` : ''}

    ${budgetData.hasExistingImprovements ? renderCategorySection("Existing Improvements", budgetData.existingImprovements, "existingImprovements") : ''}
</body>
</html>`;
    
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(reportHtml);
      newWindow.document.close();
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
    };

    setBudgetData(prev => ({
      ...prev,
      [category]: [...prev[category], item],
    }));

    setNewItem({});
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
      };

      await fetch(`/api/rfp-requests/${rfp.id}/evaluation-budget`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(budgetPayload),
      });
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
      };

      await fetch(`/api/rfp-requests/${rfp.id}/evaluation-budget`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(budgetPayload),
      });

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
        description: "Evaluation budget saved and project moved to award phase.",
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
        <CardTitle className="text-lg">{title}</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-green-600">{formatCurrency(totalWithRollups)}</span>
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
            <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
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
              <div className="flex items-end gap-2">
                <Button onClick={() => addNewItem(category)} size="sm">
                  Add
                </Button>
                <Button onClick={() => setNewItemCategory(null)} variant="outline" size="sm">
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
              onCheckedChange={(checked) => setBudgetData(prev => ({ 
                ...prev, 
                hasExistingImprovements: !!checked 
              }))}
            />
            <Label htmlFor="hasExistingImprovements" className="text-lg font-semibold">
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
            <CardTitle className="text-lg text-blue-800">Line Item Rollup Summary</CardTitle>
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

      {/* Action Buttons */}
      <div className="flex gap-3 justify-center">
        <Button 
          onClick={() => saveProgressMutation.mutate()}
          disabled={saveProgressMutation.isPending}
          variant="outline"
          size="sm"
          className="border-blue-500 text-blue-600 hover:bg-blue-50"
        >
          <Save className="h-3 w-3 mr-2" />
          {saveProgressMutation.isPending ? "Saving..." : "Save Progress"}
        </Button>

        <Button 
          onClick={saveAndAdvance} 
          disabled={saveAndAdvanceMutation.isPending}
          size="sm"
          className="bg-green-600 hover:bg-green-700"
        >
          <ArrowRight className="h-3 w-3 mr-2" />
          {saveAndAdvanceMutation.isPending ? "Saving..." : "Save & Continue to Team Review"}
        </Button>
      </div>
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