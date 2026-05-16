import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Navigation from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FileText, Download, Printer } from "lucide-react";

type BidLineItem = {
  id: number;
  bidCollectionId: number;
  category: string | null;
  description: string;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  totalPrice: string;
  notes: string | null;
  isCleanData: boolean;
  masterCategoryId?: number | null;
};

type BidCollection = {
  id: number;
  rfpId: number;
  contractorName: string;
  contractorCompany: string;
  costCategory: string;
};

type RfpRequest = {
  id: number;
  rfpNumber: string;
  projectName: string;
  tenantName: string;
  property: string;
  totalRentableArea?: number;
  areaBreakdown?: { id: string; areaType: string; description: string; squareFootage: string; notes?: string }[];
};

type LineItemWithContext = BidLineItem & {
  contractorName: string;
  contractorCompany: string;
};

export default function ProjectReportGenerator() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [showCleanDataOnly, setShowCleanDataOnly] = useState(false);

  const { data: rfps = [] } = useQuery<RfpRequest[]>({
    queryKey: ["/api/rfp-requests"],
  });

  const { data: bidCollections = [] } = useQuery<BidCollection[]>({
    queryKey: ["/api/bid-collections"],
  });

  const { data: allLineItems = [] } = useQuery<BidLineItem[]>({
    queryKey: ["/api/bid-line-items/all"],
  });

  const { data: projectAlternates = [] } = useQuery<Array<{
    id: string;
    description: string;
    masterCategoryId: number | null;
  }>>({
    queryKey: [`/api/rfp-requests/${selectedProjectId}/project-alternates`],
    enabled: !!selectedProjectId,
  });

  const selectedProject = rfps.find((r) => r.id === selectedProjectId);

  const projectTotalArea = useMemo(() => {
    if (!selectedProject) return 0;
    if (selectedProject.totalRentableArea) return selectedProject.totalRentableArea;
    if (selectedProject.areaBreakdown && selectedProject.areaBreakdown.length > 0) {
      return selectedProject.areaBreakdown.reduce((sum, item) => {
        return sum + (parseInt(item.squareFootage) || 0);
      }, 0);
    }
    return 0;
  }, [selectedProject]);

  const projectLineItems: LineItemWithContext[] = useMemo(() => {
    if (!selectedProjectId) return [];
    
    const projectBidCollections = bidCollections.filter((bc) => bc.rfpId === selectedProjectId);
    const projectBidCollectionIds = new Set(projectBidCollections.map((bc) => bc.id));
    
    return allLineItems
      .filter((item) => projectBidCollectionIds.has(item.bidCollectionId))
      .filter((item) => !showCleanDataOnly || item.isCleanData)
      .map((item) => {
        const collection = projectBidCollections.find((bc) => bc.id === item.bidCollectionId);
        return {
          ...item,
          contractorName: collection?.contractorName || "Unknown",
          contractorCompany: collection?.contractorCompany || "Unknown",
        };
      });
  }, [selectedProjectId, bidCollections, allLineItems, showCleanDataOnly]);

  const alternateCategoryMap = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const alt of projectAlternates) {
      if (alt.masterCategoryId != null) {
        const arr = map.get(alt.masterCategoryId) || [];
        arr.push(alt.description);
        map.set(alt.masterCategoryId, arr);
      }
    }
    return map;
  }, [projectAlternates]);

  const totals = useMemo(() => {
    const totalCost = projectLineItems.reduce((sum, item) => {
      const price = parseFloat(item.totalPrice) || 0;
      return sum + price;
    }, 0);

    const costPerSqFt = projectTotalArea > 0 ? totalCost / projectTotalArea : 0;

    return { totalCost, costPerSqFt };
  }, [projectLineItems, projectTotalArea]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <main className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Project Report Generator</h1>
            <p className="text-gray-600 mt-1">
              Generate cost reports for your projects with summary totals
            </p>
          </div>
          {selectedProject && (
            <Button onClick={handlePrint} variant="outline">
              <Printer className="h-4 w-4 mr-2" />
              Print Report
            </Button>
          )}
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Report Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="project-select" className="text-sm font-medium mb-2 block">
                  Select Project
                </Label>
                <select
                  id="project-select"
                  value={selectedProjectId || ""}
                  onChange={(e) => setSelectedProjectId(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Select a project --</option>
                  {rfps.map((rfp) => (
                    <option key={rfp.id} value={rfp.id}>
                      {rfp.projectName || `${rfp.tenantName} @ ${rfp.property}`} ({rfp.rfpNumber})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center space-x-3">
                <Switch
                  id="clean-data-filter"
                  checked={showCleanDataOnly}
                  onCheckedChange={setShowCleanDataOnly}
                />
                <Label htmlFor="clean-data-filter" className="text-sm">
                  {showCleanDataOnly ? "Show Analytical Data Only" : "Show All Data"}
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {selectedProject ? (
          <>
            <Card className="mb-6 print:shadow-none">
              <CardHeader className="pb-4 bg-[rgb(0,50,130)] text-white rounded-t-lg print:bg-[rgb(0,50,130)]">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Project Cost Report
                </CardTitle>
                <div className="text-sm opacity-90 mt-1">
                  {selectedProject.projectName || `${selectedProject.tenantName} @ ${selectedProject.property}`}
                </div>
                <div className="text-xs opacity-75 mt-1">
                  RFP: {selectedProject.rfpNumber} | Total Area: {projectTotalArea.toLocaleString()} sq ft
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {projectLineItems.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    {showCleanDataOnly
                      ? "No clean data items found for this project. Try toggling to show all data."
                      : "No cost line items found for this project."}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="border p-3 text-left font-semibold text-[rgb(0,50,130)]">Category</th>
                          <th className="border p-3 text-left font-semibold text-[rgb(0,50,130)]">Contractor</th>
                          <th className="border p-3 text-left font-semibold text-[rgb(0,50,130)]">Description</th>
                          <th className="border p-3 text-right font-semibold text-[rgb(0,50,130)]">Unit Price</th>
                          <th className="border p-3 text-right font-semibold text-[rgb(0,50,130)]">Total Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectLineItems.map((item, index) => (
                          <tr key={item.id} className={index % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                            <td className="border p-3 text-sm">
                              {item.category || "-"}
                              {item.masterCategoryId != null && alternateCategoryMap.has(item.masterCategoryId) && (
                                <div className="text-xs text-indigo-600 italic mt-0.5">
                                  {alternateCategoryMap.get(item.masterCategoryId)!.map(d => `*Alternate available: ${d}`).join('; ')}
                                </div>
                              )}
                            </td>
                            <td className="border p-3 text-sm">
                              <div>{item.contractorName}</div>
                              <div className="text-xs text-gray-500">{item.contractorCompany}</div>
                            </td>
                            <td className="border p-3 text-sm">{item.description}</td>
                            <td className="border p-3 text-sm text-right">
                              {item.unitPrice ? formatCurrency(parseFloat(item.unitPrice)) : "-"}
                            </td>
                            <td className="border p-3 text-sm text-right font-medium">
                              {formatCurrency(parseFloat(item.totalPrice) || 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-[rgb(0,50,130)] text-white print:bg-[rgb(0,50,130)]">
              <CardContent className="py-6">
                <div className="text-lg font-semibold mb-4">Summary Totals</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white/10 rounded-lg p-4">
                    <div className="text-sm opacity-80">Total Line Items</div>
                    <div className="text-2xl font-bold">{projectLineItems.length}</div>
                  </div>
                  <div className="bg-white/10 rounded-lg p-4">
                    <div className="text-sm opacity-80">Total Project Cost</div>
                    <div className="text-2xl font-bold">{formatCurrency(totals.totalCost)}</div>
                  </div>
                  <div className="bg-white/10 rounded-lg p-4">
                    <div className="text-sm opacity-80">Cost per Sq Ft</div>
                    <div className="text-2xl font-bold">
                      {projectTotalArea > 0 ? formatCurrency(totals.costPerSqFt) : "N/A"}
                    </div>
                    {projectTotalArea > 0 && (
                      <div className="text-xs opacity-70 mt-1">
                        Based on {projectTotalArea.toLocaleString()} sq ft
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Select a project above to generate a cost report</p>
            </CardContent>
          </Card>
        )}
      </main>

      <style>{`
        @media print {
          .print\\:shadow-none {
            box-shadow: none !important;
          }
          .print\\:bg-\\[rgb\\(0\\,50\\,130\\)\\] {
            background-color: rgb(0, 50, 130) !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          nav, .no-print {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
