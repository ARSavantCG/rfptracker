import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileDown, Printer, Edit, Save, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import type { RfpRequest, BidCollection, BidLineItem } from "@shared/schema";

interface FinancialSummaryProps {
  rfp: RfpRequest | null;
}

interface EvaluationLineItem {
  id: string;
  description: string;
  category: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  source: "contractor" | "architect" | "internal";
  bidCollectionId?: number;
}

interface EvaluationBudgetData {
  tenantImprovements: EvaluationLineItem[];
  designSoftCosts: EvaluationLineItem[];
  existingImprovements: EvaluationLineItem[];
  hasExistingImprovements: boolean;
  totalTenantImprovements: string;
  totalDesignSoftCosts: string;
  totalExistingImprovements: string;
  grandTotal: string;
  notes: string;
}

export function FinancialSummary({ rfp }: FinancialSummaryProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editedTotals, setEditedTotals] = useState({
    tenantImprovements: 0,
    designSoftCosts: 0,
    existingImprovements: 0
  });
  const [budgetData] = useState<EvaluationBudgetData>({
    tenantImprovements: [],
    designSoftCosts: [],
    existingImprovements: [],
    hasExistingImprovements: false,
    totalTenantImprovements: "0.00",
    totalDesignSoftCosts: "0.00",
    totalExistingImprovements: "0.00",
    grandTotal: "0.00",
    notes: ""
  });

  // Fetch bid collections to populate financial data
  const { data: bidCollections = [] } = useQuery<BidCollection[]>({
    queryKey: [`/api/rfp-requests/${rfp?.id}/bid-collections`],
    enabled: !!rfp?.id,
  });

  // Fetch all bid line items for calculations
  const { data: allBidLineItems = [] } = useQuery<BidLineItem[]>({
    queryKey: [`/api/rfp-requests/${rfp?.id}/all-bid-line-items`],
    queryFn: async () => {
      if (!rfp?.id) return [];
      const items: BidLineItem[] = [];
      for (const bid of bidCollections) {
        const response = await fetch(`/api/rfp-requests/${rfp.id}/bid-collections/${bid.id}/line-items`);
        if (response.ok) {
          const bidItems = await response.json();
          items.push(...bidItems);
        }
      }
      return items;
    },
    enabled: !!rfp?.id && bidCollections.length > 0,
  });

  const generatePdfMutation = useMutation({
    mutationFn: async () => {
      if (!rfp) throw new Error("No RFP selected");
      
      const response = await fetch(`/api/rfp-requests/${rfp.id}/financial-summary-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          includeExistingImprovements: budgetData.hasExistingImprovements
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate financial summary PDF');
      }

      const htmlContent = await response.text();
      
      // Create a blob URL and trigger download
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const projectName = rfp.projectName || `RFP-${rfp.rfpNumber}`;
      const cacheBuster = Date.now();
      const safeFileName = projectName
        .replace(/[@]/g, '_at_')
        .replace(/[^\w\s\-\.]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
      link.download = `${safeFileName}_Financial_Summary_${cacheBuster}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      // Also show in same window for immediate viewing/printing
      const printFrame = document.createElement('iframe');
      printFrame.style.position = 'fixed';
      printFrame.style.top = '0';
      printFrame.style.left = '0';
      printFrame.style.width = '100%';
      printFrame.style.height = '100%';
      printFrame.style.zIndex = '9999';
      printFrame.style.backgroundColor = 'white';
      
      document.body.appendChild(printFrame);
      printFrame.contentDocument?.write(htmlContent);
      printFrame.contentDocument?.close();
      
      // Add control buttons
      const buttonContainer = document.createElement('div');
      buttonContainer.style.position = 'fixed';
      buttonContainer.style.top = '10px';
      buttonContainer.style.right = '10px';
      buttonContainer.style.zIndex = '10000';
      buttonContainer.style.display = 'flex';
      buttonContainer.style.gap = '10px';
      
      const printBtn = document.createElement('button');
      printBtn.innerHTML = 'Print / Save as PDF';
      printBtn.style.padding = '10px 20px';
      printBtn.style.backgroundColor = '#2563eb';
      printBtn.style.color = 'white';
      printBtn.style.border = 'none';
      printBtn.style.borderRadius = '5px';
      printBtn.style.cursor = 'pointer';
      printBtn.onclick = () => {
        printFrame.contentWindow?.print();
      };
      
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = 'Close Preview';
      closeBtn.style.padding = '10px 20px';
      closeBtn.style.backgroundColor = '#ef4444';
      closeBtn.style.color = 'white';
      closeBtn.style.border = 'none';
      closeBtn.style.borderRadius = '5px';
      closeBtn.style.cursor = 'pointer';
      closeBtn.onclick = () => {
        document.body.removeChild(printFrame);
        document.body.removeChild(buttonContainer);
      };
      
      buttonContainer.appendChild(printBtn);
      buttonContainer.appendChild(closeBtn);
      document.body.appendChild(buttonContainer);
    },
    onSuccess: () => {
      toast({
        title: "Financial Summary Generated",
        description: "HTML file downloaded and preview opened. Use the Print button to save as PDF.",
        duration: 5000,
      });
    },
    onError: (error) => {
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate PDF",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  if (!rfp) {
    return (
      <Card>
        <CardContent className="text-center py-8">
          <p className="text-gray-500">No RFP selected for financial summary.</p>
        </CardContent>
      </Card>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const calculateBidTotal = (bidCollection: BidCollection) => {
    const bidItems = allBidLineItems.filter(item => item.bidCollectionId === bidCollection.id);
    return bidItems.reduce((sum, item) => {
      const total = parseFloat(item.totalPrice) || 0;
      return sum + total;
    }, 0);
  };

  const calculateCategoryTotal = (category: string) => {
    return allBidLineItems.reduce((sum, item) => {
      if (item.category?.toLowerCase() === category.toLowerCase()) {
        return sum + (parseFloat(item.totalPrice) || 0);
      }
      return sum;
    }, 0);
  };

  const calculatedTenantImprovements = calculateCategoryTotal("tenant improvements");
  const calculatedDesignSoftCosts = calculateCategoryTotal("design/soft costs");
  const calculatedExistingImprovements = calculateCategoryTotal("existing improvements");

  // Initialize edited totals with calculated values
  useEffect(() => {
    if (calculatedTenantImprovements || calculatedDesignSoftCosts || calculatedExistingImprovements) {
      setEditedTotals({
        tenantImprovements: calculatedTenantImprovements,
        designSoftCosts: calculatedDesignSoftCosts,
        existingImprovements: calculatedExistingImprovements
      });
    }
  }, [calculatedTenantImprovements, calculatedDesignSoftCosts, calculatedExistingImprovements]);

  // Use edited values if editing, otherwise use calculated values
  const tenantImprovementsTotal = isEditing ? editedTotals.tenantImprovements : calculatedTenantImprovements;
  const designSoftCostsTotal = isEditing ? editedTotals.designSoftCosts : calculatedDesignSoftCosts;
  const existingImprovementsTotal = isEditing ? editedTotals.existingImprovements : calculatedExistingImprovements;
  const grandTotal = tenantImprovementsTotal + designSoftCostsTotal + existingImprovementsTotal;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Financial Summary - {rfp.projectName}</CardTitle>
          <div className="flex gap-2">
            <Button 
              onClick={() => generatePdfMutation.mutate()}
              disabled={generatePdfMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <FileDown className="h-4 w-4 mr-2" />
              {generatePdfMutation.isPending ? "Generating..." : "Export as PDF"}
            </Button>
            <Button 
              variant="outline"
              onClick={() => window.print()}
            >
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Project Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Project Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-gray-600">RFP Number</p>
              <p className="text-lg">{rfp.rfpNumber}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Project Name</p>
              <p className="text-lg">{rfp.projectName}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Tenant</p>
              <p className="text-lg">{rfp.tenantName}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Project Area</p>
              <p className="text-lg">{rfp.projectArea} sq ft</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Financial Summary */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Cost Breakdown Summary</CardTitle>
          <div className="flex gap-2">
            {!isEditing ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(true)}
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit Totals
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsEditing(false);
                    setEditedTotals({
                      tenantImprovements: calculatedTenantImprovements,
                      designSoftCosts: calculatedDesignSoftCosts,
                      existingImprovements: calculatedExistingImprovements
                    });
                  }}
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setIsEditing(false);
                    toast({
                      title: "Totals Updated",
                      description: "Cost breakdown has been saved with your custom values.",
                      duration: 4000,
                    });
                  }}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-3 border-b">
              <span className="font-medium">Tenant Improvements</span>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">$</span>
                  <Input
                    type="number"
                    value={editedTotals.tenantImprovements}
                    onChange={(e) => setEditedTotals(prev => ({
                      ...prev,
                      tenantImprovements: parseFloat(e.target.value) || 0
                    }))}
                    className="w-32 text-right"
                    step="0.01"
                  />
                </div>
              ) : (
                <span className="text-lg font-bold text-green-600">
                  {formatCurrency(tenantImprovementsTotal)}
                </span>
              )}
            </div>
            
            <div className="flex justify-between items-center py-3 border-b">
              <span className="font-medium">Design / Soft Costs / Other Fees</span>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">$</span>
                  <Input
                    type="number"
                    value={editedTotals.designSoftCosts}
                    onChange={(e) => setEditedTotals(prev => ({
                      ...prev,
                      designSoftCosts: parseFloat(e.target.value) || 0
                    }))}
                    className="w-32 text-right"
                    step="0.01"
                  />
                </div>
              ) : (
                <span className="text-lg font-bold text-blue-600">
                  {formatCurrency(designSoftCostsTotal)}
                </span>
              )}
            </div>
            
            <div className="flex justify-between items-center py-3 border-b">
              <span className="font-medium">Existing Improvements</span>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">$</span>
                  <Input
                    type="number"
                    value={editedTotals.existingImprovements}
                    onChange={(e) => setEditedTotals(prev => ({
                      ...prev,
                      existingImprovements: parseFloat(e.target.value) || 0
                    }))}
                    className="w-32 text-right"
                    step="0.01"
                  />
                </div>
              ) : (
                existingImprovementsTotal > 0 && (
                  <span className="text-lg font-bold text-orange-600">
                    {formatCurrency(existingImprovementsTotal)}
                  </span>
                )
              )}
            </div>
            
            <div className="flex justify-between items-center py-4 border-t-2 border-gray-300">
              <span className="text-xl font-bold">Total Project Cost</span>
              <span className="text-2xl font-bold text-gray-900">
                {formatCurrency(grandTotal)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bid Collections Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Submitted Bids</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {bidCollections.map((bid) => (
              <div key={bid.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium">{bid.contractorName}</p>
                  <p className="text-sm text-gray-600">
                    Submitted: {new Date(bid.submissionDate).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">
                    {formatCurrency(calculateBidTotal(bid))}
                  </p>
                  <p className="text-sm text-gray-600">
                    {allBidLineItems.filter(item => item.bidCollectionId === bid.id).length} line items
                  </p>
                </div>
              </div>
            ))}
            {bidCollections.length === 0 && (
              <p className="text-gray-500 text-center py-4">No bids submitted yet</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Export Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Export Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-blue-50 p-4 rounded-lg">
            <p className="text-sm text-blue-800">
              This financial summary contains the evaluated project costs and can be exported as a PDF 
              for integration into your financial modeling systems. The data includes all cost categories 
              and submitted bids for comprehensive project analysis.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}