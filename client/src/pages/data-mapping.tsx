import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Navigation from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Search, FileText, CheckSquare, ChevronDown } from "lucide-react";

type MasterCategory = {
  id: number;
  name: string;
  description: string | null;
  sortOrder: number;
};

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
  masterCategoryId: number | null;
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

export default function DataMapping() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState<number | null>(null);

  const { data: categories = [] } = useQuery<MasterCategory[]>({
    queryKey: ["/api/master-categories"],
  });

  const { data: lineItems = [], isLoading: loadingLineItems } = useQuery<BidLineItem[]>({
    queryKey: ["/api/bid-line-items/unmapped"],
  });

  const { data: bidCollections = [] } = useQuery<BidCollection[]>({
    queryKey: ["/api/bid-collections"],
  });

  const { data: rfps = [] } = useQuery<RfpRequest[]>({
    queryKey: ["/api/rfp-requests"],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: number; masterCategoryId: number | null; isCleanData: boolean }) => {
      return apiRequest(`/api/bid-line-items/${data.id}/mapping`, "PATCH", {
        masterCategoryId: data.masterCategoryId,
        isCleanData: data.isCleanData,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bid-line-items/unmapped"] });
      toast({
        title: "Item updated",
        description: "Line item has been mapped and saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async (updates: { id: number; masterCategoryId: number | null; isCleanData: boolean }[]) => {
      return apiRequest("/api/bid-line-items/bulk-mapping", "PATCH", { updates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bid-line-items/unmapped"] });
      setSelectedRows(new Set());
      setBulkCategoryId(null);
      toast({
        title: "Bulk update complete",
        description: "Selected line items have been mapped.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
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
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        (item.description || "").toLowerCase().includes(search) ||
        item.category?.toLowerCase().includes(search) ||
        (item.contractorName || "").toLowerCase().includes(search) ||
        (item.contractorCompany || "").toLowerCase().includes(search) ||
        (item.projectName || "").toLowerCase().includes(search) ||
        (item.rfpNumber || "").toLowerCase().includes(search)
      );
    }
    return true;
  });

  const handleCategoryChange = (itemId: number, categoryId: number, isCleanData: boolean) => {
    updateMutation.mutate({ id: itemId, masterCategoryId: categoryId, isCleanData });
  };

  const handleRowSelect = (itemId: number, checked: boolean) => {
    const newSelected = new Set(selectedRows);
    if (checked) {
      newSelected.add(itemId);
    } else {
      newSelected.delete(itemId);
    }
    setSelectedRows(newSelected);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRows(new Set(filteredItems.map((item) => item.id)));
    } else {
      setSelectedRows(new Set());
    }
  };

  const handleBulkApply = () => {
    if (bulkCategoryId === null || selectedRows.size === 0) {
      toast({
        title: "Cannot apply",
        description: "Please select rows and a category first.",
        variant: "destructive",
      });
      return;
    }
    const updates = Array.from(selectedRows).map((id) => ({
      id,
      masterCategoryId: bulkCategoryId,
      isCleanData: true,
    }));
    bulkUpdateMutation.mutate(updates);
  };

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

  const unmappedCount = lineItems.length;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <main className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Data Scrubbing & Mapping</h1>
            <p className="text-gray-600 mt-1">
              Assign master categories to line items and mark them as clean data for analytics
            </p>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <div className="text-center p-4 bg-amber-100 rounded-lg flex-1">
                <div className="text-3xl font-bold text-amber-700">{unmappedCount}</div>
                <div className="text-sm text-amber-600">Items Remaining to Map</div>
              </div>
              {unmappedCount === 0 && (
                <div className="text-center p-4 bg-green-100 rounded-lg flex-1">
                  <CheckSquare className="h-8 w-8 mx-auto text-green-600 mb-2" />
                  <div className="text-sm text-green-600">All items have been mapped!</div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {selectedRows.size > 0 && (
          <Card className="mb-6 border-blue-200 bg-blue-50">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="text-blue-800 font-medium">
                  {selectedRows.size} item{selectedRows.size !== 1 ? "s" : ""} selected
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <select
                      value={bulkCategoryId || ""}
                      onChange={(e) => setBulkCategoryId(e.target.value ? parseInt(e.target.value) : null)}
                      className="appearance-none border rounded-md px-3 py-2 pr-8 text-sm bg-white"
                    >
                      <option value="">Select Category...</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                  </div>
                  <Button
                    onClick={handleBulkApply}
                    disabled={!bulkCategoryId || bulkUpdateMutation.isPending}
                    size="sm"
                  >
                    Apply to Selected
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSelectedRows(new Set())}>
                    Clear Selection
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <CardTitle className="text-lg">Unmapped Line Items</CardTitle>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by project, contractor, description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-80"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingLineItems ? (
              <div className="text-center py-8 text-gray-500">Loading line items...</div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {searchTerm
                  ? "No items match your search criteria"
                  : "No unmapped line items. All items have been categorized!"}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border p-2 w-10">
                        <Checkbox
                          checked={selectedRows.size === filteredItems.length && filteredItems.length > 0}
                          onCheckedChange={(checked) => handleSelectAll(!!checked)}
                        />
                      </th>
                      <th className="border p-2 text-left">Project</th>
                      <th className="border p-2 text-left">Contractor</th>
                      <th className="border p-2 text-left">Raw Description</th>
                      <th className="border p-2 text-right">Cost</th>
                      <th className="border p-2 text-left w-48">Master Category</th>
                      <th className="border p-2 text-center w-16">Clean</th>
                      <th className="border p-2 text-center w-12">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => (
                      <LineItemRow
                        key={item.id}
                        item={item}
                        categories={categories}
                        isSelected={selectedRows.has(item.id)}
                        onSelect={(checked) => handleRowSelect(item.id, checked)}
                        onCategoryChange={handleCategoryChange}
                        formatCurrency={formatCurrency}
                        isPending={updateMutation.isPending}
                      />
                    ))}
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

function LineItemRow({
  item,
  categories,
  isSelected,
  onSelect,
  onCategoryChange,
  formatCurrency,
  isPending,
}: {
  item: LineItemWithContext;
  categories: MasterCategory[];
  isSelected: boolean;
  onSelect: (checked: boolean) => void;
  onCategoryChange: (itemId: number, categoryId: number, isCleanData: boolean) => void;
  formatCurrency: (value: string | null) => string;
  isPending: boolean;
}) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(item.masterCategoryId);
  const [isCleanData, setIsCleanData] = useState(item.isCleanData);

  const handleCategorySelect = (categoryId: number) => {
    setSelectedCategoryId(categoryId);
    if (isCleanData) {
      onCategoryChange(item.id, categoryId, true);
    }
  };

  const handleCleanDataChange = (checked: boolean) => {
    setIsCleanData(checked);
    if (checked && selectedCategoryId) {
      onCategoryChange(item.id, selectedCategoryId, true);
    }
  };

  return (
    <tr className={`hover:bg-gray-50 ${isSelected ? "bg-blue-50" : ""}`}>
      <td className="border p-2 text-center">
        <Checkbox checked={isSelected} onCheckedChange={(checked) => onSelect(!!checked)} />
      </td>
      <td className="border p-2">
        <div className="font-medium text-sm">{item.projectName}</div>
        <div className="text-xs text-gray-500">{item.rfpNumber}</div>
      </td>
      <td className="border p-2">
        <div className="font-medium text-sm">{item.contractorName}</div>
        <div className="text-xs text-gray-500">{item.contractorCompany}</div>
      </td>
      <td className="border p-2">
        <div className="text-sm">{item.description}</div>
        {item.category && (
          <div className="text-xs text-gray-500 mt-1">Original: {item.category}</div>
        )}
      </td>
      <td className="border p-2 text-right text-sm font-medium">
        {formatCurrency(item.totalPrice)}
      </td>
      <td className="border p-2">
        <div className="relative">
          <select
            value={selectedCategoryId || ""}
            onChange={(e) => handleCategorySelect(parseInt(e.target.value))}
            className="appearance-none border rounded-md px-2 py-1 pr-7 text-sm w-full bg-white"
            disabled={isPending}
          >
            <option value="">Select...</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-500 pointer-events-none" />
        </div>
      </td>
      <td className="border p-2 text-center">
        <Checkbox
          checked={isCleanData}
          onCheckedChange={(checked) => handleCleanDataChange(!!checked)}
          disabled={isPending}
        />
      </td>
      <td className="border p-2 text-center">
        {item.notes ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <FileText className="h-4 w-4 text-blue-600" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Notes</h4>
                <p className="text-sm text-gray-600">{item.notes}</p>
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          <span className="text-gray-300">-</span>
        )}
      </td>
    </tr>
  );
}
