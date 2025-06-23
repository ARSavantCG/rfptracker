import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus, Calculator } from "lucide-react";
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
  scopeItem?: ScopeItem;
}

export function RomPilotScopeModal({ isOpen, onClose, romPilotId, romPilotName }: RomPilotScopeModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch scope items
  const { data: scopeItems = [] } = useQuery<ScopeItem[]>({
    queryKey: ["/api/rom-scope-items"],
    enabled: isOpen,
  });

  // Fetch existing line items for this ROM Pilot
  const { data: existingLineItems = [] } = useQuery<LineItem[]>({
    queryKey: [`/api/rom-pilots/${romPilotId}/line-items`],
    enabled: isOpen && romPilotId > 0,
  });

  // Initialize line items when data loads
  useEffect(() => {
    if (existingLineItems.length > 0) {
      setLineItems(existingLineItems);
    } else {
      setLineItems([]);
    }
  }, [existingLineItems]);

  // Add new line item
  const addLineItem = () => {
    const newItem: LineItem = {
      scopeItemId: 0,
      quantity: "0",
      unitPrice: "0",
      totalPrice: "0",
      notes: "",
    };
    setLineItems([...lineItems, newItem]);
  };

  // Remove line item
  const removeLineItem = (index: number) => {
    const newItems = lineItems.filter((_, i) => i !== index);
    setLineItems(newItems);
  };

  // Update line item
  const updateLineItem = (index: number, field: keyof LineItem, value: string | number) => {
    const newItems = [...lineItems];
    newItems[index] = { ...newItems[index], [field]: value };

    // Auto-calculate total price when quantity or unit price changes
    if (field === "quantity" || field === "unitPrice") {
      const quantity = parseFloat(field === "quantity" ? value.toString() : newItems[index].quantity) || 0;
      const unitPrice = parseFloat(field === "unitPrice" ? value.toString() : newItems[index].unitPrice) || 0;
      newItems[index].totalPrice = (quantity * unitPrice).toFixed(2);
    }

    // When scope item changes, update unit price from the scope item
    if (field === "scopeItemId") {
      const scopeItem = scopeItems.find(item => item.id === value);
      if (scopeItem) {
        newItems[index].unitPrice = scopeItem.unitPrice;
        newItems[index].scopeItem = scopeItem;
        const quantity = parseFloat(newItems[index].quantity) || 0;
        const unitPrice = parseFloat(scopeItem.unitPrice) || 0;
        newItems[index].totalPrice = (quantity * unitPrice).toFixed(2);
      }
    }

    setLineItems(newItems);
  };

  // Save line items
  const saveLineItems = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/rom-pilots/${romPilotId}/line-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineItems }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Scope items saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/rom-pilots/${romPilotId}/line-items`] });
      queryClient.invalidateQueries({ queryKey: ["/api/rom-pilots"] });
      onClose();
    },
    onError: (error) => {
      console.error("Error saving scope items:", error);
      toast({
        title: "Error",
        description: "Failed to save scope items. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await saveLineItems.mutateAsync();
    } finally {
      setIsSubmitting(false);
    }
  };

  const grandTotal = lineItems.reduce((sum, item) => sum + (parseFloat(item.totalPrice) || 0), 0);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Calculator className="h-5 w-5" />
            <span>Scope of Work - {romPilotName}</span>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Line Items</h3>
              <Button type="button" onClick={addLineItem} variant="outline" size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Item
              </Button>
            </div>

            {lineItems.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No scope items added yet. Click "Add Item" to get started.
              </div>
            ) : (
              <div className="space-y-4">
                {lineItems.map((item, index) => (
                  <div key={index} className="border rounded-lg p-4 bg-gray-50">
                    <div className="grid grid-cols-12 gap-4 items-start">
                      {/* Scope Item Selection */}
                      <div className="col-span-3">
                        <Label>Scope Item</Label>
                        <Select
                          value={item.scopeItemId.toString()}
                          onValueChange={(value) => updateLineItem(index, "scopeItemId", parseInt(value))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select item" />
                          </SelectTrigger>
                          <SelectContent>
                            {scopeItems.map((scopeItem) => (
                              <SelectItem key={scopeItem.id} value={scopeItem.id.toString()}>
                                {scopeItem.name} ({scopeItem.category})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Quantity */}
                      <div className="col-span-2">
                        <Label>Quantity</Label>
                        <Input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateLineItem(index, "quantity", e.target.value)}
                          placeholder="0"
                          step="0.01"
                        />
                      </div>

                      {/* Unit */}
                      <div className="col-span-1">
                        <Label>Unit</Label>
                        <div className="text-sm text-gray-600 pt-2">
                          {item.scopeItem?.unit || "-"}
                        </div>
                      </div>

                      {/* Unit Price */}
                      <div className="col-span-2">
                        <Label>Unit Price</Label>
                        <Input
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) => updateLineItem(index, "unitPrice", e.target.value)}
                          placeholder="0.00"
                          step="0.01"
                        />
                      </div>

                      {/* Total Price */}
                      <div className="col-span-2">
                        <Label>Total Price</Label>
                        <div className="font-semibold text-lg pt-2">
                          ${parseFloat(item.totalPrice || "0").toLocaleString()}
                        </div>
                      </div>

                      {/* Remove Button */}
                      <div className="col-span-1">
                        <Label>&nbsp;</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeLineItem(index)}
                          className="text-red-600 hover:text-red-800 mt-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>

                      {/* Notes */}
                      <div className="col-span-12">
                        <Label>Notes (Optional)</Label>
                        <Textarea
                          value={item.notes || ""}
                          onChange={(e) => updateLineItem(index, "notes", e.target.value)}
                          placeholder="Additional notes for this line item..."
                          rows={2}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Grand Total */}
            {lineItems.length > 0 && (
              <div className="border-t pt-4">
                <div className="flex justify-end">
                  <div className="text-right">
                    <div className="text-lg font-semibold">
                      Grand Total: ${grandTotal.toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-600">
                      {lineItems.length} item{lineItems.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || lineItems.length === 0}>
              {isSubmitting ? "Saving..." : "Save Scope Items"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}