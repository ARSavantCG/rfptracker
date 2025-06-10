import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileDown, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { RfpRequest, BidCollection } from "@shared/schema";

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

  const generatePdfMutation = useMutation({
    mutationFn: async () => {
      if (!rfp) throw new Error("No RFP selected");
      
      const response = await fetch(`/api/rfp-requests/${rfp.id}/financial-summary-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          includeExistingImprovements: budgetData.hasExistingImprovements
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate financial summary PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Financial_Summary_${rfp.rfpNumber}_${rfp.projectName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    },
    onSuccess: () => {
      toast({
        title: "Financial Summary Generated",
        description: "PDF document has been downloaded successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate PDF",
        variant: "destructive",
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
    if (!bidCollection.lineItems) return 0;
    return bidCollection.lineItems.reduce((sum, item) => {
      const total = parseFloat(item.totalPrice) || 0;
      return sum + total;
    }, 0);
  };

  const calculateCategoryTotal = (category: string) => {
    return bidCollections.reduce((sum, bid) => {
      if (!bid.lineItems) return sum;
      const categoryItems = bid.lineItems.filter(item => 
        item.category?.toLowerCase() === category.toLowerCase()
      );
      return sum + categoryItems.reduce((itemSum, item) => {
        return itemSum + (parseFloat(item.totalPrice) || 0);
      }, 0);
    }, 0);
  };

  const tenantImprovementsTotal = calculateCategoryTotal("tenant improvements");
  const designSoftCostsTotal = calculateCategoryTotal("design/soft costs");
  const existingImprovementsTotal = calculateCategoryTotal("existing improvements");
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
              {generatePdfMutation.isPending ? "Generating..." : "Download PDF"}
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
        <CardHeader>
          <CardTitle className="text-lg">Cost Breakdown Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-3 border-b">
              <span className="font-medium">Tenant Improvements</span>
              <span className="text-lg font-bold text-green-600">
                {formatCurrency(tenantImprovementsTotal)}
              </span>
            </div>
            
            <div className="flex justify-between items-center py-3 border-b">
              <span className="font-medium">Design / Soft Costs / Other Fees</span>
              <span className="text-lg font-bold text-blue-600">
                {formatCurrency(designSoftCostsTotal)}
              </span>
            </div>
            
            {existingImprovementsTotal > 0 && (
              <div className="flex justify-between items-center py-3 border-b">
                <span className="font-medium">Existing Improvements</span>
                <span className="text-lg font-bold text-orange-600">
                  {formatCurrency(existingImprovementsTotal)}
                </span>
              </div>
            )}
            
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
                    Submitted: {new Date(bid.submittedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">
                    {formatCurrency(calculateBidTotal(bid))}
                  </p>
                  <p className="text-sm text-gray-600">
                    {bid.lineItems?.length || 0} line items
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