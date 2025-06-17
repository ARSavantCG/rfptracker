import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit, Trash2, Save, X, ArrowRight, Copy, FileDown, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
}

interface EvaluationBudgetData {
  tenantImprovements: EvaluationLineItem[];
  designSoftCosts: EvaluationLineItem[];
  existingImprovements: EvaluationLineItem[];
  hasExistingImprovements: boolean;
  includeExistingInTotal: boolean;
  totalTenantImprovements: string;
  totalDesignSoftCosts: string;
  totalExistingImprovements: string;
  grandTotal: string;
  notes: string;
}

interface EvaluationBudgetProps {
  rfp: RfpRequest | null;
}

export function EvaluationBudget({ rfp }: EvaluationBudgetProps) {
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [newItemCategory, setNewItemCategory] = useState<string>("");
  const [newItem, setNewItem] = useState<Partial<EvaluationLineItem>>({});

  const queryClient = useQueryClient();
  const { toast } = useToast();

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
    totalTenantImprovements: "0.00",
    totalDesignSoftCosts: "0.00", 
    totalExistingImprovements: "0.00",
    grandTotal: "0.00",
    notes: "",
  });

  // Initialize budget with saved data or bid line items data
  useEffect(() => {
    if (existingBudget) {
      // Load saved budget data
      setBudgetData({
        tenantImprovements: existingBudget.tenantImprovements || [],
        designSoftCosts: existingBudget.designSoftCosts || [],
        existingImprovements: existingBudget.existingImprovements || [],
        hasExistingImprovements: existingBudget.hasExistingImprovements || false,
        includeExistingInTotal: existingBudget.includeExistingInTotal || false,
        totalTenantImprovements: existingBudget.totalTenantImprovements || "0.00",
        totalDesignSoftCosts: existingBudget.totalDesignSoftCosts || "0.00",
        totalExistingImprovements: existingBudget.totalExistingImprovements || "0.00",
        grandTotal: existingBudget.grandTotal || "0.00",
        notes: existingBudget.notes || "",
      });
    } else if (allBidLineItems && Array.isArray(allBidLineItems) && allBidLineItems.length > 0) {
      // Initialize with bid line items if no saved budget exists
      const initialItems = allBidLineItems.map((item: BidLineItem & { bidCollectionId: number }) => ({
        id: `tenant-${item.id}`,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit || "ea",
        unitPrice: item.unitPrice?.toString() || "0.00",
        totalPrice: item.totalPrice?.toString() || "0.00",
        bidCollectionId: item.bidCollectionId,
        bidLineItemId: item.id,
      }));

      setBudgetData(prev => ({
        ...prev,
        tenantImprovements: initialItems,
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
      const price = parseFloat(item.totalPrice) || 0;
      return total + price;
    }, 0);
  };

  const calculateGrandTotal = () => {
    const tiTotal = calculateCategoryTotal(budgetData.tenantImprovements);
    const designTotal = calculateCategoryTotal(budgetData.designSoftCosts);
    const existingTotal = (budgetData.hasExistingImprovements && budgetData.includeExistingInTotal)
      ? calculateCategoryTotal(budgetData.existingImprovements) 
      : 0;
    return tiTotal + designTotal + existingTotal;
  };

  const generatePreview = async () => {
    if (!rfp) return;
    
    const currentDate = new Date().toLocaleDateString();
    const grandTotal = calculateGrandTotal();
    
    const renderCategorySection = (title: string, items: EvaluationLineItem[]) => {
      if (items.length === 0) return '';
      const total = calculateCategoryTotal(items);
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
                      </tr>
                  </thead>
                  <tbody>
                      ${items.map(item => `
                      <tr>
                          <td>${item.description}</td>
                          <td>${item.quantity}</td>
                          <td>${item.unit}</td>
                          <td class="currency">${formatCurrency(parseFloat(item.unitPrice) || 0)}</td>
                          <td class="currency">${formatCurrency(parseFloat(item.totalPrice) || 0)}</td>
                      </tr>
                      `).join('')}
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
                      </tr>
                  </thead>
                  <tbody>
                      ${budgetData.existingImprovements.map(item => `
                      <tr>
                          <td>${item.description}</td>
                          <td>${item.quantity}</td>
                          <td>${item.unit}</td>
                          <td class="currency">${formatCurrency(parseFloat(item.unitPrice) || 0)}</td>
                          <td class="currency">${formatCurrency(parseFloat(item.totalPrice) || 0)}</td>
                      </tr>
                      `).join('')}
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
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f8f9fa;
        }
        .header {
            padding: 15px 20px;
            margin-bottom: 20px;
            text-align: center;
            border-bottom: 2px solid #e9ecef;
        }
        .header h1 { margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #333; }
        .header p { margin: 2px 0; font-size: 14px; color: #666; }
        .section {
            background: white;
            margin-bottom: 25px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .section-header {
            background-color: #f8f9fa;
            padding: 20px;
            border-bottom: 2px solid #e9ecef;
        }
        .section-title {
            margin: 0;
            color: #495057;
            font-size: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .section-total { font-weight: bold; color: #28a745; font-size: 18px; }
        .table-container { padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; table-layout: fixed; }
        th, td { padding: 12px; border-bottom: 1px solid #dee2e6; vertical-align: top; }
        th {
            background-color: #f8f9fa;
            font-weight: 600;
            color: #495057;
            text-transform: uppercase;
        }
        
        /* Consistent column widths for alignment */
        th:nth-child(1), td:nth-child(1) { width: 40%; text-align: left; }    /* Description */
        th:nth-child(2), td:nth-child(2) { width: 12%; text-align: center; }  /* Quantity */
        th:nth-child(3), td:nth-child(3) { width: 8%; text-align: center; }   /* Unit */
        th:nth-child(4), td:nth-child(4) { width: 20%; text-align: right; }   /* Unit Price */
        th:nth-child(5), td:nth-child(5) { width: 20%; text-align: right; }   /* Total Price */
        
        th {
            font-size: 12px;
            letter-spacing: 0.5px;
        }
        tr:hover { background-color: #f8f9fa; }
        .currency { text-align: right; font-weight: 600; }
        .grand-total {
            background: white;
            border: 2px solid #dee2e6;
            color: #333;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            margin: 30px 0;
        }
        .grand-total h2 { margin: 0; font-size: 18px; font-weight: bold; }
        .notes-section {
            background: white;
            padding: 25px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .notes-title { color: #495057; margin: 0 0 15px 0; font-size: 18px; }
        .notes-content {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            border-left: 4px solid #007bff;
            white-space: pre-wrap;
        }
        .existing-improvements-note {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 5px;
            padding: 10px;
            margin-top: 10px;
            font-size: 14px;
            color: #856404;
        }
        @media print {
            body { background-color: white; }
            .section { box-shadow: none; border: 1px solid #ddd; }
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

    ${renderCategorySection("Tenant Improvements", budgetData.tenantImprovements)}
    ${renderCategorySection("Design / Soft Costs / Other Fees", budgetData.designSoftCosts)}
    ${budgetData.hasExistingImprovements ? renderExistingImprovementsSection() : ''}

    <div class="grand-total">
        <h2>Grand Total: ${formatCurrency(grandTotal)}</h2>
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

  const renderCategoryTable = (title: string, items: EvaluationLineItem[], category: string, total: number) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">{title}</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-green-600">{formatCurrency(total)}</span>
          <Button
            size="sm"
            onClick={() => setNewItemCategory(category)}
            className="h-8"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Item
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 && !newItemCategory ? (
          <p className="text-gray-500 text-center py-4">No items added yet</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="w-32">Quantity (Unit)</TableHead>
                <TableHead className="w-24">Unit Price</TableHead>
                {!newItemCategory && <TableHead className="w-24">Total</TableHead>}
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
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
                      <TableCell>{item.description}</TableCell>
                      <TableCell>{item.quantity} {item.unit}</TableCell>
                      <TableCell>{formatCurrency(item.unitPrice)}</TableCell>
                      {!newItemCategory && <TableCell className="font-medium">{formatCurrency(item.totalPrice)}</TableCell>}
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
                                id: `${categoryType}-${Date.now()}`,
                                description: `${item.description} (Copy)`
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
              ))}
            </TableBody>
          </Table>
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
              <div className="md:col-span-1">
                <Label>Unit</Label>
                <Input
                  value={newItem.unit || ""}
                  onChange={(e) => setNewItem(prev => ({ ...prev, unit: e.target.value }))}
                  placeholder="ea, sq ft, lf, etc."
                  className="max-w-20"
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
              <div className="flex items-end gap-2">
                <Button
                  size="sm"
                  onClick={() => addNewItem(category)}
                  className="h-9"
                >
                  <Save className="h-4 w-4 mr-1" />
                  Add
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNewItemCategory("");
                    setNewItem({});
                  }}
                  className="h-9"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

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
          <CardTitle>Budget Evaluation - Oakley & Sons 3 @ MG Westside - A</CardTitle>
        </CardHeader>
      </Card>

      {/* Tenant Improvements */}
      {renderCategoryTable(
        "Tenant Improvements",
        budgetData.tenantImprovements,
        'tenantImprovements',
        calculateCategoryTotal(budgetData.tenantImprovements)
      )}

      {/* Design / Soft Costs / Other Fees */}
      {renderCategoryTable(
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
          onClick={generatePreview}
          variant="outline"
          size="sm"
          className="border-purple-500 text-purple-600 hover:bg-purple-50"
        >
          <FileDown className="h-3 w-3 mr-2" />
          Preview Report
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
    </div>
  );
}