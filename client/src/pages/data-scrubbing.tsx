import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Navigation from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Search, CheckCircle2, XCircle, Filter, Save } from "lucide-react";

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
};

type LineItemWithContext = BidLineItem & {
  contractorName: string;
  contractorCompany: string;
  projectName: string;
  rfpNumber: string;
};

export default function DataScrubbing() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "clean" | "unclean">("all");
  const [pendingChanges, setPendingChanges] = useState<Record<number, boolean>>({});

  const { data: lineItems = [], isLoading: loadingLineItems } = useQuery<BidLineItem[]>({
    queryKey: ["/api/bid-line-items/all"],
  });

  const { data: bidCollections = [] } = useQuery<BidCollection[]>({
    queryKey: ["/api/bid-collections"],
  });

  const { data: rfps = [] } = useQuery<RfpRequest[]>({
    queryKey: ["/api/rfp-requests"],
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: { id: number; isCleanData: boolean }[]) => {
      return apiRequest("/api/bid-line-items/bulk-update-clean-data", "PATCH", { updates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bid-line-items/all"] });
      setPendingChanges({});
      toast({
        title: "Changes saved",
        description: "Line item clean data status updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error saving changes",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const enrichedLineItems: LineItemWithContext[] = lineItems.map((item) => {
    const collection = bidCollections.find((bc) => bc.id === item.bidCollectionId);
    const rfp = collection ? rfps.find((r) => r.id === collection.rfpId) : null;
    return {
      ...item,
      contractorName: collection?.contractorName || "Unknown",
      contractorCompany: collection?.contractorCompany || "Unknown",
      projectName: rfp?.projectName || rfp?.tenantName || "Unknown Project",
      rfpNumber: rfp?.rfpNumber || "N/A",
    };
  });

  const filteredItems = enrichedLineItems.filter((item) => {
    const currentValue = pendingChanges[item.id] !== undefined ? pendingChanges[item.id] : item.isCleanData;
    
    if (filterMode === "clean" && !currentValue) return false;
    if (filterMode === "unclean" && currentValue) return false;

    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        item.description.toLowerCase().includes(search) ||
        item.category?.toLowerCase().includes(search) ||
        item.contractorName.toLowerCase().includes(search) ||
        item.contractorCompany.toLowerCase().includes(search) ||
        item.projectName.toLowerCase().includes(search) ||
        item.rfpNumber.toLowerCase().includes(search)
      );
    }
    return true;
  });

  const handleToggleCleanData = (itemId: number, currentValue: boolean) => {
    const originalValue = lineItems.find((i) => i.id === itemId)?.isCleanData ?? false;
    const newValue = !currentValue;
    
    if (newValue === originalValue) {
      const newChanges = { ...pendingChanges };
      delete newChanges[itemId];
      setPendingChanges(newChanges);
    } else {
      setPendingChanges({ ...pendingChanges, [itemId]: newValue });
    }
  };

  const handleSaveChanges = () => {
    const updates = Object.entries(pendingChanges).map(([id, isCleanData]) => ({
      id: parseInt(id),
      isCleanData,
    }));
    updateMutation.mutate(updates);
  };

  const handleMarkAllClean = () => {
    const newChanges = { ...pendingChanges };
    filteredItems.forEach((item) => {
      const originalValue = item.isCleanData;
      if (!originalValue) {
        newChanges[item.id] = true;
      } else {
        delete newChanges[item.id];
      }
    });
    setPendingChanges(newChanges);
  };

  const handleMarkAllUnclean = () => {
    const newChanges = { ...pendingChanges };
    filteredItems.forEach((item) => {
      const originalValue = item.isCleanData;
      if (originalValue) {
        newChanges[item.id] = false;
      } else {
        delete newChanges[item.id];
      }
    });
    setPendingChanges(newChanges);
  };

  const pendingCount = Object.keys(pendingChanges).length;
  const cleanCount = enrichedLineItems.filter((item) => {
    const value = pendingChanges[item.id] !== undefined ? pendingChanges[item.id] : item.isCleanData;
    return value;
  }).length;
  const totalCount = enrichedLineItems.length;

  const formatCurrency = (value: string | null) => {
    if (!value) return "-";
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(num);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <main className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Data Scrubbing</h1>
            <p className="text-gray-600 mt-1">
              Mark line items as "clean" for use in analytical reports and benchmarking
            </p>
          </div>
          {pendingCount > 0 && (
            <Button onClick={handleSaveChanges} disabled={updateMutation.isPending}>
              <Save className="h-4 w-4 mr-2" />
              Save {pendingCount} Change{pendingCount !== 1 ? "s" : ""}
            </Button>
          )}
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 bg-gray-100 rounded-lg">
                <div className="text-3xl font-bold text-gray-900">{totalCount}</div>
                <div className="text-sm text-gray-600">Total Line Items</div>
              </div>
              <div className="text-center p-4 bg-green-100 rounded-lg">
                <div className="text-3xl font-bold text-green-700">{cleanCount}</div>
                <div className="text-sm text-green-600">Clean Data Items</div>
              </div>
              <div className="text-center p-4 bg-yellow-100 rounded-lg">
                <div className="text-3xl font-bold text-yellow-700">{totalCount - cleanCount}</div>
                <div className="text-sm text-yellow-600">Unclean Items</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <CardTitle className="text-lg">Line Items</CardTitle>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search line items..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-64"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-gray-500" />
                  <select
                    value={filterMode}
                    onChange={(e) => setFilterMode(e.target.value as "all" | "clean" | "unclean")}
                    className="border rounded-md px-3 py-2 text-sm"
                  >
                    <option value="all">All Items</option>
                    <option value="clean">Clean Only</option>
                    <option value="unclean">Unclean Only</option>
                  </select>
                </div>
                <Button variant="outline" size="sm" onClick={handleMarkAllClean}>
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Mark Filtered Clean
                </Button>
                <Button variant="outline" size="sm" onClick={handleMarkAllUnclean}>
                  <XCircle className="h-4 w-4 mr-1" />
                  Mark Filtered Unclean
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingLineItems ? (
              <div className="text-center py-8 text-gray-500">Loading line items...</div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {searchTerm || filterMode !== "all"
                  ? "No line items match your search criteria"
                  : "No line items found in the database"}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border p-2 text-left w-16">Clean</th>
                      <th className="border p-2 text-left">Project</th>
                      <th className="border p-2 text-left">Contractor</th>
                      <th className="border p-2 text-left">Category</th>
                      <th className="border p-2 text-left">Description</th>
                      <th className="border p-2 text-right">Unit Price</th>
                      <th className="border p-2 text-right">Total Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => {
                      const currentValue =
                        pendingChanges[item.id] !== undefined
                          ? pendingChanges[item.id]
                          : item.isCleanData;
                      const hasChange = pendingChanges[item.id] !== undefined;

                      return (
                        <tr
                          key={item.id}
                          className={`hover:bg-gray-50 ${hasChange ? "bg-yellow-50" : ""}`}
                        >
                          <td className="border p-2 text-center">
                            <Checkbox
                              checked={currentValue}
                              onCheckedChange={() => handleToggleCleanData(item.id, currentValue)}
                            />
                          </td>
                          <td className="border p-2">
                            <div className="font-medium text-sm">{item.projectName}</div>
                            <div className="text-xs text-gray-500">{item.rfpNumber}</div>
                          </td>
                          <td className="border p-2">
                            <div className="font-medium text-sm">{item.contractorName}</div>
                            <div className="text-xs text-gray-500">{item.contractorCompany}</div>
                          </td>
                          <td className="border p-2 text-sm">{item.category || "-"}</td>
                          <td className="border p-2 text-sm">{item.description}</td>
                          <td className="border p-2 text-right text-sm">
                            {formatCurrency(item.unitPrice)}
                          </td>
                          <td className="border p-2 text-right text-sm font-medium">
                            {formatCurrency(item.totalPrice)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
