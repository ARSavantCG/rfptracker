import React, { useState, useEffect } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// Removed Select import - using native HTML selects for consistency
import { Trash2, Plus, Calculator, Save, ChevronUp, ChevronDown, GripVertical, RotateCcw } from "lucide-react";
import { FormulaInput } from "@/components/formula-input";
import { DragDropContext, Droppable, Draggable, DropResult } from "react-beautiful-dnd";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Utility function to format currency with commas
const formatCurrency = (amount: number | string): string => {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '$0.00';
  
  // Use standard currency formatting (2 decimal places for all amounts)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

// Utility function to format numbers with commas
const formatNumber = (amount: number | string): string => {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '0';
  
  return new Intl.NumberFormat('en-US').format(num);
};

interface RomPilotScopeModalProps {
  isOpen: boolean;
  onClose: () => void;
  romPilotId: number;
  romPilotName: string;
}

interface ScopeItem {
  id: number;
  name: string;
  description: string;
  unit: string;
  unitPrice: string;
  minimumCost?: string;
  hasMinimumCost?: boolean;
  category: string;
}

interface LineItem {
  id?: number;
  scopeItemId: number;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
  tenantShare: number; // Tenant percentage (0-100%)
  notes?: string;
  category: 'tenant-improvements' | 'design-soft-costs';
  scopeItem?: ScopeItem;
}

export function RomPilotScopeModal({ isOpen, onClose, romPilotId, romPilotName }: RomPilotScopeModalProps) {
  // Non-admin UX (JJ runway): the server enforces catalog-only for non-admins
  // (403 on catalog-less rows). Surface that as friendly guidance + a pre-save
  // check, so a leasing user never hits a raw permission wall.
  const { isAdmin } = usePermissions();
  const canAddCustomItems = isAdmin();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tenantImprovements, setTenantImprovements] = useState<LineItem[]>([]);
  const [designSoftCosts, setDesignSoftCosts] = useState<LineItem[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch scope items
  const { data: scopeItems = [] } = useQuery<ScopeItem[]>({
    queryKey: ["/api/rom-scope-items"],
    enabled: isOpen,
    staleTime: 0, // Always fetch fresh data
    gcTime: 0, // Don't cache
  });

  // Filter scope items by category
  const tenantImprovementItems = scopeItems.filter(item => item.category === 'Tenant Improvements');
  const designSoftCostItems = scopeItems.filter(item => item.category === 'Design / Soft Costs / Other Fees');

  // Fetch existing line items
  const { data: existingLineItems = [] } = useQuery({
    queryKey: [`/api/rom-pilots/${romPilotId}/line-items`],
    enabled: isOpen,
  });

  // Load existing line items when modal opens
  useEffect(() => {
    if (isOpen && scopeItems.length > 0 && !isInitialized) {
      if (Array.isArray(existingLineItems) && existingLineItems.length > 0) {
        const tenantItems: LineItem[] = [];
        const designItems: LineItem[] = [];
        
        existingLineItems.forEach((item: any) => {
          const scopeItem = scopeItems.find(si => si.id === item.scopeItemId);
          
          const lineItem: LineItem = {
            id: item.id,
            scopeItemId: item.scopeItemId,
            quantity: String(item.quantity || ""), // Ensure string conversion
            unitPrice: item.unitPrice || scopeItem?.unitPrice || "", // Use scope item price if stored price is empty
            totalPrice: item.totalPrice || "",
            tenantShare: item.tenantShare || 100, // Default to 100% tenant responsibility
            notes: item.notes || "",
            category: item.category || 'tenant-improvements',
            scopeItem: scopeItem,
          };
          
          if (lineItem.category === 'tenant-improvements') {
            tenantItems.push(lineItem);
          } else if (lineItem.category === 'design-soft-costs') {
            designItems.push(lineItem);
          }
        });
        
        setTenantImprovements(tenantItems);
        setDesignSoftCosts(designItems);
      } else {
        // Auto-populate with default scope items marked as includeByDefault
        const defaultTenantItems: LineItem[] = [];
        const defaultDesignItems: LineItem[] = [];
        
        const defaultItems = scopeItems.filter(item => (item as any).includeByDefault === true);
        
        defaultItems.forEach(scopeItem => {
          const lineItem: LineItem = {
            scopeItemId: scopeItem.id,
            quantity: "1", // Default quantity
            unitPrice: scopeItem.unitPrice,
            totalPrice: scopeItem.unitPrice,
            tenantShare: 100,
            notes: "",
            category: scopeItem.category.includes('Design') || scopeItem.category.includes('Soft Costs') ? 'design-soft-costs' : 'tenant-improvements',
            scopeItem: scopeItem,
          };
          
          if (lineItem.category === 'tenant-improvements') {
            defaultTenantItems.push(lineItem);
          } else if (lineItem.category === 'design-soft-costs') {
            defaultDesignItems.push(lineItem);
          }
        });
        
        setTenantImprovements(defaultTenantItems);
        setDesignSoftCosts(defaultDesignItems);
      }
      setIsInitialized(true);
    } else if (!isOpen) {
      // Reset state when modal closes
      setTenantImprovements([]);
      setDesignSoftCosts([]);
      setIsInitialized(false);
    }
  }, [isOpen, existingLineItems, scopeItems, isInitialized]);

  // Force refresh scope items data when modal opens to get latest updates
  useEffect(() => {
    if (isOpen) {
      // Force fresh data fetch
      queryClient.removeQueries({ queryKey: ["/api/rom-scope-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rom-scope-items"] });
    }
  }, [isOpen, queryClient]);

  const addLineItem = (category: 'tenant-improvements' | 'design-soft-costs') => {
    const newItem: LineItem = {
      scopeItemId: 0,
      quantity: "",
      unitPrice: "0",
      totalPrice: "0",
      tenantShare: 100, // Default to 100% tenant responsibility
      notes: "",
      category,
    };

    if (category === 'tenant-improvements') {
      setTenantImprovements([...tenantImprovements, newItem]);
    } else {
      setDesignSoftCosts([...designSoftCosts, newItem]);
    }
  };

  // ── Spec-tag refresh (DESIGN-context-aware-pricing.md) ─────────────────────
  // Quantities resolve from property specs at FORK time; user edits then stand
  // permanently. This is the way back: recompute from the property AS IT IS NOW
  // (so a spec corrected after forking can be pulled in). It is "recompute",
  // not "undo".
  // ISOLATION: the server only returns proposals for rows whose catalog item
  // carries a quantity tag. Untagged scope — parking, electrical, anything
  // hand-priced — is never proposed and cannot be touched here.
  const [specProposals, setSpecProposals] = useState<any[]>([]);
  const [specDialogOpen, setSpecDialogOpen] = useState(false);
  const [specSelected, setSpecSelected] = useState<Record<string, boolean>>({});
  const [specLoading, setSpecLoading] = useState(false);
  const [specMeta, setSpecMeta] = useState<{ propertyResolved: boolean; bayCount: number } | null>(null);

  const proposalKey = (p: any) => `${p.lineItemId ?? "x"}:${p.scopeItemId}`;
  const matchesRow = (li: LineItem, p: any) =>
    (li.id != null && p.lineItemId != null && li.id === p.lineItemId) ||
    (li.id == null && li.scopeItemId === p.scopeItemId);

  const fetchSpecProposals = async (): Promise<any[]> => {
    setSpecLoading(true);
    try {
      const res: any = await apiRequest(`/api/rom-pilots/${romPilotId}/spec-tags/preview`, "GET");
      const list = Array.isArray(res?.proposals) ? res.proposals : [];
      setSpecProposals(list);
      setSpecMeta({ propertyResolved: !!res?.propertyResolved, bayCount: res?.bayCount ?? 0 });
      return list;
    } catch (err) {
      toast({ title: "Couldn't read property specs", description: "The refresh preview failed. Your quantities are unchanged.", variant: "destructive" });
      return [];
    } finally {
      setSpecLoading(false);
    }
  };

  // Batched apply. One functional setState per category — applying row by row
  // through updateLineItem would read a stale items array on every call after
  // the first.
  const applyProposals = (toApply: any[]) => {
    if (!toApply.length) return;
    const applyTo = (items: LineItem[]) => items.map(li => {
      const p = toApply.find(pp => matchesRow(li, pp));
      if (!p || p.proposedQuantity === null || p.proposedQuantity === undefined) return li;
      const qty = String(p.proposedQuantity);
      let baseTotal = (parseFloat(qty) || 0) * (parseFloat(li.unitPrice) || 0);
      const si = li.scopeItem;
      if (si?.hasMinimumCost && si.minimumCost) {
        baseTotal = Math.max(baseTotal, parseFloat(si.minimumCost) || 0);
      }
      const share = (typeof li.tenantShare === "number" ? li.tenantShare : parseFloat(String(li.tenantShare)) || 100);
      return { ...li, quantity: qty, totalPrice: (baseTotal * (share / 100)).toString() };
    });
    setTenantImprovements(prev => applyTo(prev));
    setDesignSoftCosts(prev => applyTo(prev));
    toast({ title: "Quantities recomputed", description: `${toApply.length} row${toApply.length === 1 ? "" : "s"} updated from property specs. Review, then Save All Items to commit.` });
  };

  const openSpecDialog = async () => {
    const list = await fetchSpecProposals();
    // Pre-check only rows that would actually change and resolved cleanly.
    const preset: Record<string, boolean> = {};
    list.forEach((p: any) => { preset[proposalKey(p)] = !!p.changed && !p.unresolved; });
    setSpecSelected(preset);
    setSpecDialogOpen(true);
  };

  const resetSingleRow = async (li: LineItem) => {
    const list = specProposals.length ? specProposals : await fetchSpecProposals();
    const p = list.find((pp: any) => matchesRow(li, pp));
    if (!p) {
      toast({ title: "No spec tag on this item", description: "This scope item has no quantity tag, so there is nothing to recompute." });
      return;
    }
    if (p.proposedQuantity === null || p.proposedQuantity === undefined) {
      toast({ title: "Property spec unavailable", description: `This row is tagged to ${p.propertySpec}, but that spec isn't populated on the property yet.`, variant: "destructive" });
      return;
    }
    applyProposals([p]);
  };

  const updateLineItem = (
    category: 'tenant-improvements' | 'design-soft-costs',
    index: number,
    field: keyof LineItem,
    value: string | number
  ) => {
    const items = category === 'tenant-improvements' ? tenantImprovements : designSoftCosts;
    const setItems = category === 'tenant-improvements' ? setTenantImprovements : setDesignSoftCosts;
    
    const updatedItems = [...items];
    updatedItems[index] = { ...updatedItems[index], [field]: value };

    // Auto-populate data when scope item changes
    if (field === 'scopeItemId' && typeof value === 'number' && value > 0) {
      const scopeItem = scopeItems.find(item => item.id === value);
      if (scopeItem) {
        updatedItems[index].unitPrice = scopeItem.unitPrice;
        updatedItems[index].scopeItem = scopeItem;
      }
    }

    // Recalculate total when quantity, unit price, or tenant share changes
    if (field === 'quantity' || field === 'unitPrice' || field === 'tenantShare') {
      const quantity = parseFloat(field === 'quantity' ? value.toString() : updatedItems[index].quantity) || 0;
      const unitPrice = parseFloat(field === 'unitPrice' ? value.toString() : updatedItems[index].unitPrice) || 0;
      const tenantShare = parseFloat(field === 'tenantShare' ? value.toString() : updatedItems[index].tenantShare.toString()) || 100;
      
      // Calculate base total
      let baseTotal = quantity * unitPrice;
      
      // Check for minimum cost if scope item has it enabled
      const scopeItem = updatedItems[index].scopeItem;
      if (scopeItem?.hasMinimumCost && scopeItem.minimumCost) {
        const minimumCost = parseFloat(scopeItem.minimumCost) || 0;
        if (baseTotal < minimumCost) {
          baseTotal = minimumCost;
        }
      }
      
      const tenantPortion = baseTotal * (tenantShare / 100);
      updatedItems[index].totalPrice = tenantPortion.toString();
    }

    setItems(updatedItems);
  };

  const removeLineItem = (category: 'tenant-improvements' | 'design-soft-costs', index: number) => {
    if (category === 'tenant-improvements') {
      const updatedItems = tenantImprovements.filter((_, i) => i !== index);
      setTenantImprovements(updatedItems);
    } else {
      const updatedItems = designSoftCosts.filter((_, i) => i !== index);
      setDesignSoftCosts(updatedItems);
    }
  };

  const moveLineItemUp = (category: 'tenant-improvements' | 'design-soft-costs', index: number) => {
    if (index === 0) return;
    
    if (category === 'tenant-improvements') {
      const updatedItems = [...tenantImprovements];
      [updatedItems[index], updatedItems[index - 1]] = [updatedItems[index - 1], updatedItems[index]];
      setTenantImprovements(updatedItems);
    } else {
      const updatedItems = [...designSoftCosts];
      [updatedItems[index], updatedItems[index - 1]] = [updatedItems[index - 1], updatedItems[index]];
      setDesignSoftCosts(updatedItems);
    }
  };

  const moveLineItemDown = (category: 'tenant-improvements' | 'design-soft-costs', index: number) => {
    const items = category === 'tenant-improvements' ? tenantImprovements : designSoftCosts;
    if (index === items.length - 1) return;
    
    if (category === 'tenant-improvements') {
      const updatedItems = [...tenantImprovements];
      [updatedItems[index], updatedItems[index + 1]] = [updatedItems[index + 1], updatedItems[index]];
      setTenantImprovements(updatedItems);
    } else {
      const updatedItems = [...designSoftCosts];
      [updatedItems[index], updatedItems[index + 1]] = [updatedItems[index + 1], updatedItems[index]];
      setDesignSoftCosts(updatedItems);
    }
  };

  const calculateCategoryTotal = (items: LineItem[]) => {
    return items.reduce((sum, item) => {
      // Total price already includes tenant share calculation
      return sum + (parseFloat(item.totalPrice) || 0);
    }, 0);
  };

  const calculateGrandTotal = () => {
    return calculateCategoryTotal(tenantImprovements) + calculateCategoryTotal(designSoftCosts);
  };


  const formatQuantity = (quantity: string) => {
    const num = parseFloat(quantity);
    if (isNaN(num)) return quantity;
    return new Intl.NumberFormat('en-US').format(num);
  };

  // Drag and drop handlers
  const handleTenantImprovementsDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    
    const reorderedItems = Array.from(tenantImprovements);
    const [removed] = reorderedItems.splice(result.source.index, 1);
    reorderedItems.splice(result.destination.index, 0, removed);
    
    setTenantImprovements(reorderedItems);
  };

  const handleDesignSoftCostsDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    
    const reorderedItems = Array.from(designSoftCosts);
    const [removed] = reorderedItems.splice(result.source.index, 1);
    reorderedItems.splice(result.destination.index, 0, removed);
    
    setDesignSoftCosts(reorderedItems);
  };

  // Individual line item save mutation
  const saveIndividualLineItem = useMutation({
    mutationFn: async (lineItem: LineItem) => {
      return await apiRequest("/api/rom-pilots/" + romPilotId + "/line-items/individual", "POST", { lineItem });
    },
    onSuccess: () => {
      toast({
        title: "Success", 
        description: "Line item saved successfully",
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/rom-pilots/${romPilotId}/line-items`] });
      queryClient.invalidateQueries({ queryKey: ["/api/rom-pilots"] });
    },
    onError: (error) => {
      console.error("Failed to save individual line item:", error);
      toast({
        title: "Error",
        description: "Failed to save line item",
        variant: "destructive",
        duration: 4000,
      });
    },
  });

  // Save line items mutation  
  const saveLineItems = useMutation({
    mutationFn: async () => {
      const allItems = [...tenantImprovements, ...designSoftCosts];
      if (!canAddCustomItems) {
        const unlinked = allItems.filter((it) => !it.scopeItemId);
        if (unlinked.length > 0) {
          throw new Error(
            `${unlinked.length} row${unlinked.length === 1 ? " has" : "s have"} no catalog item selected. ROM pricing is catalog-only — pick an item from the dropdown, or ask the development team to add that scope to the catalog.`
          );
        }
      }
      return await apiRequest(`/api/rom-pilots/${romPilotId}/line-items`, "POST", { lineItems: allItems });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "ROM scope items saved successfully",
        duration: 4000,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/rom-pilots/${romPilotId}/line-items`] });
      queryClient.invalidateQueries({ queryKey: ["/api/rom-pilots"] });
      onClose();
    },
    onError: (error: any) => {
      console.error("Save error:", error);
      toast({
        title: "Error",
        description: `Failed to save ROM scope items: ${error.message || 'Unknown error'}`,
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const renderLineItemsSection = (
    title: string,
    items: LineItem[],
    category: 'tenant-improvements' | 'design-soft-costs'
  ) => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => addLineItem(category)}
          className="flex items-center space-x-1"
        >
          <Plus className="h-4 w-4" />
          <span>Add Item</span>
        </Button>
      </div>
      {!canAddCustomItems && (
        <p className="text-xs text-gray-500">
          Every item comes from the ROM catalog — pick from the dropdown. Need scope that isn't listed?
          Ask the development team to add it.
        </p>
      )}

      {!isInitialized || items.length === 0 ? (
        <div className="text-center py-8 text-gray-500 border border-dashed border-gray-300 rounded-lg">
          <Calculator className="h-8 w-8 mx-auto mb-3 text-gray-400" />
          <p>No items added yet</p>
          <p className="text-sm">Click "Add Item" to get started</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-700 w-16">Order</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-700">Scope Item</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-700 w-24">Quantity</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-700 w-28">Unit Price</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-700 w-28">Total</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-700 w-24 bg-green-100">Tenant %</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-700 w-40">Notes</th>
                <th className="text-center py-2 px-3 text-xs font-medium text-gray-700 w-20">Actions</th>
              </tr>
            </thead>
            <DragDropContext onDragEnd={category === 'tenant-improvements' ? handleTenantImprovementsDragEnd : handleDesignSoftCostsDragEnd}>
              <Droppable droppableId={`${category}-items`}>
                {(provided) => (
                  <tbody {...provided.droppableProps} ref={provided.innerRef}>
                    {items.map((item, index) => (
                      <Draggable key={`${category}-${index}`} draggableId={`${category}-${index}`} index={index}>
                        {(provided) => (
                          <tr 
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className="border-b border-gray-100 hover:bg-gray-50"
                          >
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-1">
                                <div className="flex flex-col">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => moveLineItemUp(category, index)}
                                    disabled={index === 0}
                                    className="h-4 w-4 p-0"
                                  >
                                    <ChevronUp className="h-2.5 w-2.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => moveLineItemDown(category, index)}
                                    disabled={index === items.length - 1}
                                    className="h-4 w-4 p-0"
                                  >
                                    <ChevronDown className="h-2.5 w-2.5" />
                                  </Button>
                                </div>
                                <div 
                                  {...provided.dragHandleProps}
                                  className="cursor-grab active:cursor-grabbing p-1 hover:bg-gray-100 rounded"
                                >
                                  <GripVertical className="h-3 w-3 text-gray-400" />
                                </div>
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              <div className="relative">
                                <select
                                  value={item.scopeItemId ? item.scopeItemId.toString() : "0"}
                                  onChange={(e) => {
                                    const newScopeItemId = parseInt(e.target.value);
                                    updateLineItem(category, index, 'scopeItemId', newScopeItemId);
                                  }}
                                  className="w-full h-7 px-2 py-1 text-xs bg-background border border-input rounded-md appearance-none pr-6 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                >
                                  <option value="0">Custom Item</option>
                                  {(category === 'tenant-improvements' ? tenantImprovementItems : designSoftCostItems).map((scopeItem) => (
                                    <option key={scopeItem.id} value={scopeItem.id.toString()}>
                                      {scopeItem.name}
                                    </option>
                                  ))}
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              <Input
                                type="text"
                                value={formatQuantity(item.quantity || "")}
                                onChange={(e) => {
                                  // Remove commas when saving the value
                                  const cleanValue = e.target.value.replace(/,/g, '');
                                  // Update quantity immediately - this is the key fix
                                  updateLineItem(category, index, 'quantity', cleanValue);
                                }}
                                onBlur={(e) => {
                                  // Get the current value from the input field, remove commas
                                  const currentQuantity = e.target.value.replace(/,/g, '');
                                  // Only save if there's actually a value
                                  if (currentQuantity.trim() !== '') {
                                    // Update state first with the clean value
                                    updateLineItem(category, index, 'quantity', currentQuantity);
                                    
                                    // Create updated item with current input value
                                    const updatedItem = {
                                      ...item,
                                      quantity: currentQuantity,
                                      totalPrice: ((parseFloat(currentQuantity) || 0) * (parseFloat(item.unitPrice) || 0) * ((item.tenantShare || 100) / 100)).toString()
                                    };
                                    
                                    saveIndividualLineItem.mutate(updatedItem);
                                  }
                                }}
                                className="h-7 text-xs text-center w-20"
                                placeholder="0"
                              />
                              {/* Recompute this row's quantity from property specs.
                                  Only meaningful on tagged items; resetSingleRow
                                  explains itself if the row has no tag. */}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                tabIndex={-1}
                                title="Recompute quantity from property specs"
                                aria-label="Recompute quantity from property specs"
                                onClick={() => resetSingleRow(item)}
                                className="h-7 w-7 p-0 ml-1 text-gray-400 hover:text-purple-700"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                            <td className="py-2 px-3">
                              <Input
                                type="text"
value={(() => {
                                  // Get the correct unit price - prioritize scope item price for accuracy
                                  let price = item.scopeItem?.unitPrice || item.unitPrice || "0";
                                  
                                  return formatCurrency(parseFloat(price));
                                })()}
                                className="h-7 text-xs bg-gray-100 text-right w-24"
                                readOnly
                              />
                            </td>
                            <td className="py-2 px-3">
                              <Input
                                value={formatCurrency(parseFloat(item.totalPrice) || 0)}
                                className="h-7 text-xs bg-gray-100 text-right w-28"
                                readOnly
                              />
                            </td>
                            <td className="py-2 px-3">
                              <Input
                                type="number"
                                value={item.tenantShare || 100}
                                onChange={(e) => updateLineItem(category, index, 'tenantShare', parseInt(e.target.value) || 100)}
                                className="h-7 text-xs"
                                min="0"
                                max="100"
                                placeholder="100"
                              />
                            </td>
                            <td className="py-2 px-3">
                              <Input
                                value={item.notes || ""}
                                onChange={(e) => updateLineItem(category, index, 'notes', e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Tab' && !e.shiftKey) {
                                    e.preventDefault();
                                    // Check if this is the last item in the list
                                    if (index === items.length - 1) {
                                      // Add new line item and focus it
                                      const addButton = document.querySelector(`button:contains("Add ${category === 'tenant-improvements' ? 'Tenant Improvement' : 'Design/Soft Cost'} Item")`) as HTMLButtonElement;
                                      if (addButton) {
                                        addButton.click();
                                        // Focus will be set to new row after creation
                                        setTimeout(() => {
                                          const newSelect = document.querySelector(`select:nth-of-type(${index + 2})`) as HTMLSelectElement;
                                          if (newSelect) {
                                            newSelect.focus();
                                          }
                                        }, 50);
                                      }
                                    } else {
                                      // Focus next row's select
                                      const nextSelect = document.querySelector(`select:nth-of-type(${index + 2})`) as HTMLSelectElement;
                                      if (nextSelect) {
                                        nextSelect.focus();
                                      }
                                    }
                                  } else if (e.key === 'Tab' && e.shiftKey) {
                                    e.preventDefault();
                                    // Focus previous input (quantity)
                                    const prevInput = document.querySelector(`input[class*="h-7 text-xs"]:nth-of-type(${index * 2 + 1})`) as HTMLInputElement;
                                    if (prevInput) {
                                      prevInput.focus();
                                      prevInput.select();
                                    }
                                  }
                                }}
                                className="h-7 text-xs"
                                placeholder="Optional notes"
                              />
                            </td>
                            <td className="py-2 px-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    const lineItem = item;
                                    saveIndividualLineItem.mutate(lineItem);
                                  }}
                                  className="h-6 w-6 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                                  title="Save this line item"
                                >
                                  <Save className="h-3 w-3" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeLineItem(category, index)}
                                  className="h-6 w-6 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </tbody>
                )}
              </Droppable>
            </DragDropContext>
          </table>
          
          {items.length > 0 && (
            <div className="bg-gray-50 border-t border-gray-200 px-3 py-2">
              <div className="flex justify-end">
                <p className="text-sm font-semibold text-gray-900">
                  {title} Subtotal: {formatCurrency(calculateCategoryTotal(items))}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Calculator className="h-5 w-5 text-blue-600" />
            <span>Manage ROM Scope - {romPilotName}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-8 py-4">
          {renderLineItemsSection("Tenant Improvements", tenantImprovements, 'tenant-improvements')}
          {renderLineItemsSection("Design / Soft Costs / Other Fees", designSoftCosts, 'design-soft-costs')}

          {/* Grand Total */}
          <div className="border-t pt-4">
            <div className="flex justify-end">
              <div className="text-right">
                <p className="text-lg font-bold text-gray-900">
                  Grand Total: {formatCurrency(calculateGrandTotal())}
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={openSpecDialog}
              disabled={specLoading || saveLineItems.isPending}
              className="mr-auto flex items-center space-x-2"
              data-testid="rom-spec-refresh"
            >
              <RotateCcw className="h-4 w-4" />
              <span>{specLoading ? "Reading property specs…" : "Refresh from property specs"}</span>
            </Button>
            <Button variant="outline" onClick={onClose} disabled={saveLineItems.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => saveLineItems.mutate()}
              disabled={saveLineItems.isPending}
              className="flex items-center space-x-2"
            >
              {saveLineItems.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  <span>Save All Items</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* Spec-tag refresh preview — nothing is written until Apply, and only
          checked rows are touched. Untagged scope never appears here at all. */}
      <Dialog open={specDialogOpen} onOpenChange={setSpecDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Refresh quantities from property specs</DialogTitle>
          </DialogHeader>

          {specMeta && !specMeta.propertyResolved && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This pilot's property record could not be resolved, so no spec can be computed.
            </div>
          )}
          {specMeta && specMeta.propertyResolved && specMeta.bayCount === 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              No bays are recorded on this pilot, so bay-derived specs (rentable SF, office SF,
              dock doors, bay count) can't be computed. Building depth and clear height still can.
            </div>
          )}

          {specProposals.length === 0 ? (
            <p className="text-sm text-gray-600">
              No scope items on this pilot carry a quantity spec tag, so there's nothing to
              recompute. Tag a catalog item in Manage Scope Items to enable this.
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-500">
                Only tagged items appear below. Everything else on this pilot is left alone.
                Values are computed from the property as it is <span className="font-medium">now</span>.
              </p>
              <div className="max-h-80 overflow-y-auto divide-y border rounded-md">
                {specProposals.map((p: any) => {
                  const key = proposalKey(p);
                  const disabled = p.unresolved || !p.changed;
                  return (
                    <label
                      key={key}
                      className={`flex items-center gap-3 px-3 py-2 text-sm ${disabled ? "opacity-60" : "cursor-pointer hover:bg-gray-50"}`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        disabled={disabled}
                        checked={!!specSelected[key]}
                        onChange={(e) => setSpecSelected(prev => ({ ...prev, [key]: e.target.checked }))}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900">{p.name}</span>
                        <span className="block text-xs text-gray-500">from {p.propertySpec}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        {p.unresolved ? (
                          <span className="text-xs text-amber-700">spec not populated</span>
                        ) : p.changed ? (
                          <span className="font-mono text-xs">
                            {p.currentQuantity} <span className="text-gray-400">→</span>{" "}
                            <span className="font-semibold text-purple-700">
                              {Number(p.proposedQuantity).toLocaleString()}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">already matches</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setSpecDialogOpen(false)}>Cancel</Button>
            <Button
              className="bg-purple-600 text-white hover:bg-purple-700"
              disabled={!specProposals.some((p: any) => specSelected[proposalKey(p)])}
              onClick={() => {
                applyProposals(specProposals.filter((p: any) => specSelected[proposalKey(p)]));
                setSpecDialogOpen(false);
              }}
            >
              Apply selected
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}