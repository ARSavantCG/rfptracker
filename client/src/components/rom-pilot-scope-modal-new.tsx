import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// Removed Select import - using native HTML selects for consistency
import { Trash2, Plus, Calculator, Save, ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import { FormulaInput } from "@/components/formula-input";
import { DragDropContext, Droppable, Draggable, DropResult } from "react-beautiful-dnd";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Utility function to format currency with commas
const formatCurrency = (amount: number | string): string => {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '$0.00';
  
  // Show more precision for values under $1
  const fractionDigits = num < 1 ? 3 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
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
            unitPrice: item.unitPrice || "",
            totalPrice: item.totalPrice || "",
            tenantShare: item.tenantShare || 100, // Default to 100% tenant responsibility
            notes: item.notes || "",
            category: item.category || 'tenant-improvements',
            scopeItem: scopeItem,
          };
          
          console.log('📥 Loading line item:', { id: item.id, quantity: item.quantity, quantityString: String(item.quantity), name: scopeItem?.name });
          
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
      const baseTotal = quantity * unitPrice;
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
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
      console.log("Saving individual ROM line item:", { romPilotId, lineItem });
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
      console.log("Saving ROM line items:", { romPilotId, allItems });
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
                                  onChange={(e) => updateLineItem(category, index, 'scopeItemId', parseInt(e.target.value))}
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
                                value={item.quantity || ""}
                                onChange={(e) => {
                                  const newQuantity = e.target.value;
                                  console.log('✏️ Simple quantity change:', { newQuantity, itemId: item.id });
                                  
                                  // Update quantity immediately
                                  updateLineItem(category, index, 'quantity', newQuantity);
                                  
                                  // Calculate total
                                  const quantityNum = parseFloat(newQuantity) || 0;
                                  const unitPrice = parseFloat(item.unitPrice) || 0;
                                  const tenantShare = item.tenantShare || 100;
                                  const total = (quantityNum * unitPrice * (tenantShare / 100)).toString();
                                  updateLineItem(category, index, 'totalPrice', total);
                                }}
                                onBlur={() => {
                                  // Save when user finishes editing
                                  console.log('💾 Saving quantity on blur:', item.quantity);
                                  saveIndividualLineItem.mutate(item);
                                }}
                                className="h-7 text-xs text-center"
                                placeholder="0"
                              />
                            </td>
                            <td className="py-2 px-3">
                              <Input
                                type="text"
                                value={formatCurrency(parseFloat(item.unitPrice) || 0)}
                                className="h-7 text-xs bg-gray-100 text-right"
                                readOnly
                              />
                            </td>
                            <td className="py-2 px-3">
                              <Input
                                value={formatCurrency(parseFloat(item.totalPrice) || 0)}
                                className="h-7 text-xs bg-gray-100"
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
    </Dialog>
  );
}