import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus, Calculator, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

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
  notes?: string;
  category: 'tenant-improvements' | 'design-soft-costs';
  scopeItem?: ScopeItem;
}

export function RomPilotScopeModal({ isOpen, onClose, romPilotId, romPilotName }: RomPilotScopeModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tenantImprovements, setTenantImprovements] = useState<LineItem[]>([]);
  const [designSoftCosts, setDesignSoftCosts] = useState<LineItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch scope items
  const { data: scopeItems = [] } = useQuery<ScopeItem[]>({
    queryKey: ["/api/rom-scope-items"],
    enabled: isOpen,
  });

  // Fetch existing line items
  const { data: existingLineItems = [] } = useQuery({
    queryKey: ["/api/rom-pilots", romPilotId, "line-items"],
    enabled: isOpen,
  });

  // Load existing line items when modal opens
  useEffect(() => {
    if (isOpen && Array.isArray(existingLineItems) && existingLineItems.length > 0) {
      const tenantItems: LineItem[] = [];
      const designItems: LineItem[] = [];
      
      existingLineItems.forEach((item: any) => {
        const lineItem: LineItem = {
          id: item.id,
          scopeItemId: item.scopeItemId,
          quantity: item.quantity?.toString() || "1",
          unitPrice: item.unitPrice || "0",
          totalPrice: item.totalPrice || "0",
          notes: item.notes || "",
          category: item.category || 'tenant-improvements',
        };
        
        if (lineItem.category === 'tenant-improvements') {
          tenantItems.push(lineItem);
        } else {
          designItems.push(lineItem);
        }
      });
      
      setTenantImprovements(tenantItems);
      setDesignSoftCosts(designItems);
    } else if (isOpen) {
      setTenantImprovements([]);
      setDesignSoftCosts([]);
    }
  }, [isOpen, existingLineItems]);

  const addLineItem = (category: 'tenant-improvements' | 'design-soft-costs') => {
    const newItem: LineItem = {
      scopeItemId: 0,
      quantity: "1",
      unitPrice: "0",
      totalPrice: "0",
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

    // Auto-calculate total price when quantity or unit price changes
    if (field === 'quantity' || field === 'unitPrice') {
      const quantity = parseFloat(field === 'quantity' ? value.toString() : updatedItems[index].quantity) || 0;
      const unitPrice = parseFloat(field === 'unitPrice' ? value.toString() : updatedItems[index].unitPrice) || 0;
      updatedItems[index].totalPrice = (quantity * unitPrice).toFixed(2);
    }

    // When scope item is selected, update unit price
    if (field === 'scopeItemId') {
      const selectedScopeItem = scopeItems.find(item => item.id === Number(value));
      if (selectedScopeItem) {
        updatedItems[index].unitPrice = selectedScopeItem.unitPrice;
        const quantity = parseFloat(updatedItems[index].quantity) || 0;
        const unitPrice = parseFloat(selectedScopeItem.unitPrice) || 0;
        updatedItems[index].totalPrice = (quantity * unitPrice).toFixed(2);
      }
    }

    setItems(updatedItems);
  };

  const removeLineItem = (category: 'tenant-improvements' | 'design-soft-costs', index: number) => {
    if (category === 'tenant-improvements') {
      setTenantImprovements(tenantImprovements.filter((_, i) => i !== index));
    } else {
      setDesignSoftCosts(designSoftCosts.filter((_, i) => i !== index));
    }
  };

  const saveLineItems = useMutation({
    mutationFn: async () => {
      const allLineItems = [...tenantImprovements, ...designSoftCosts];
      return await apiRequest(`/api/rom-pilots/${romPilotId}/line-items`, "POST", { lineItems: allLineItems });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "ROM scope items saved successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/rom-pilots", romPilotId, "line-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rom-pilots"] });
      onClose();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save ROM scope items", variant: "destructive" });
    },
  });

  const calculateCategoryTotal = (items: LineItem[]) => {
    return items.reduce((sum, item) => sum + (parseFloat(item.totalPrice) || 0), 0);
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

      {items.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No items added yet</p>
          <p className="text-sm">Click "Add Item" to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={index} className="grid grid-cols-12 gap-3 items-start p-4 border rounded-lg bg-gray-50">
              <div className="col-span-3">
                <Label className="text-xs font-medium text-gray-600">Scope Item</Label>
                <Select
                  value={item.scopeItemId ? item.scopeItemId.toString() : "0"}
                  onValueChange={(value) => updateLineItem(category, index, 'scopeItemId', parseInt(value))}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select item" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Custom Item</SelectItem>
                    {scopeItems.map((scopeItem) => (
                      <SelectItem key={scopeItem.id} value={scopeItem.id.toString()}>
                        {scopeItem.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2">
                <Label className="text-xs font-medium text-gray-600">Quantity</Label>
                <Input
                  type="number"
                  value={item.quantity || "1"}
                  onChange={(e) => updateLineItem(category, index, 'quantity', e.target.value)}
                  className="h-8 text-xs"
                  placeholder="0"
                />
              </div>

              <div className="col-span-2">
                <Label className="text-xs font-medium text-gray-600">Unit Price</Label>
                <Input
                  type="number"
                  value={item.unitPrice || "0"}
                  onChange={(e) => updateLineItem(category, index, 'unitPrice', e.target.value)}
                  className="h-8 text-xs"
                  placeholder="0.00"
                />
              </div>

              <div className="col-span-2">
                <Label className="text-xs font-medium text-gray-600">Total</Label>
                <Input
                  value={formatCurrency(parseFloat(item.totalPrice) || 0)}
                  className="h-8 text-xs bg-gray-100"
                  readOnly
                />
              </div>

              <div className="col-span-2">
                <Label className="text-xs font-medium text-gray-600">Notes</Label>
                <Input
                  value={item.notes || ""}
                  onChange={(e) => updateLineItem(category, index, 'notes', e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Optional notes"
                />
              </div>

              <div className="col-span-1 flex justify-end pt-5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLineItem(category, index)}
                  className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          {items.length > 0 && (
            <div className="flex justify-end pt-2">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-600">
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