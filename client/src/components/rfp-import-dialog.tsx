import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Copy, CheckCircle2 } from "lucide-react";

interface RfpForImport {
  id: number;
  rfpNumber: string;
  tenantName: string;
  projectName: string;
  property: string;
  itemCount: number;
  tenantImprovementsCount: number;
  designSoftCostsCount: number;
  existingImprovementsCount: number;
  grandTotal: string;
}

interface RfpImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentRfpId?: number;
  onImport: (rfpId: number, categories: string[]) => Promise<void>;
}

export function RfpImportDialog({ open, onOpenChange, currentRfpId, onImport }: RfpImportDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRfpId, setSelectedRfpId] = useState<number | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set(['tenantImprovements']));
  const [isImporting, setIsImporting] = useState(false);

  const { data: availableRfps = [], isLoading } = useQuery<RfpForImport[]>({
    queryKey: ['/api/evaluation-budgets/available-for-import'],
    enabled: open,
  });

  // Filter out current RFP and apply search
  const filteredRfps = availableRfps
    .filter(rfp => rfp.id !== currentRfpId)
    .filter(rfp => {
      if (!searchTerm) return true;
      const search = searchTerm.toLowerCase();
      return (
        rfp.rfpNumber.toLowerCase().includes(search) ||
        rfp.tenantName.toLowerCase().includes(search) ||
        rfp.projectName.toLowerCase().includes(search) ||
        rfp.property.toLowerCase().includes(search)
      );
    });

  const selectedRfp = availableRfps.find(rfp => rfp.id === selectedRfpId);

  const toggleCategory = (category: string) => {
    const newCategories = new Set(selectedCategories);
    if (newCategories.has(category)) {
      newCategories.delete(category);
    } else {
      newCategories.add(category);
    }
    setSelectedCategories(newCategories);
  };

  const handleImport = async () => {
    if (!selectedRfpId || selectedCategories.size === 0) return;
    
    setIsImporting(true);
    try {
      await onImport(selectedRfpId, Array.from(selectedCategories));
      onOpenChange(false);
      setSelectedRfpId(null);
      setSelectedCategories(new Set(['tenantImprovements']));
      setSearchTerm("");
    } catch (error) {
      console.error('Import error:', error);
    } finally {
      setIsImporting(false);
    }
  };

  const formatCurrency = (value: string | number) => {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(numValue)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(numValue / 100);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Evaluation Budget from Another RFP</DialogTitle>
          <DialogDescription>
            Select an RFP to copy its evaluation budget line items
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Search by RFP number, tenant, project, or property..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* RFP List */}
          <div className="flex-1 overflow-y-auto border rounded-md">
            {isLoading ? (
              <div className="p-8 text-center text-gray-500">Loading RFPs...</div>
            ) : filteredRfps.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                {searchTerm ? 'No RFPs match your search' : 'No RFPs with evaluation budgets found'}
              </div>
            ) : (
              <div className="divide-y">
                {filteredRfps.map((rfp) => (
                  <div
                    key={rfp.id}
                    className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedRfpId === rfp.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                    }`}
                    onClick={() => setSelectedRfpId(rfp.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-blue-600">{rfp.rfpNumber}</span>
                          {selectedRfpId === rfp.id && (
                            <CheckCircle2 className="h-4 w-4 text-blue-500" />
                          )}
                        </div>
                        <div className="text-sm text-gray-700 mt-1">
                          <span className="font-medium">{rfp.tenantName}</span> - {rfp.projectName}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">{rfp.property}</div>
                        <div className="flex gap-4 mt-2 text-xs text-gray-600">
                          <span>TI: {rfp.tenantImprovementsCount} items</span>
                          <span>Design: {rfp.designSoftCostsCount} items</span>
                          <span>Existing: {rfp.existingImprovementsCount} items</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-green-600">
                          {formatCurrency(rfp.grandTotal)}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {rfp.itemCount} total items
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Category Selection */}
          {selectedRfp && (
            <div className="border rounded-md p-4 bg-gray-50">
              <Label className="text-sm font-medium mb-3 block">Select categories to import:</Label>
              <div className="space-y-2">
                {selectedRfp.tenantImprovementsCount > 0 && (
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="tenant-improvements"
                      checked={selectedCategories.has('tenantImprovements')}
                      onCheckedChange={() => toggleCategory('tenantImprovements')}
                    />
                    <label
                      htmlFor="tenant-improvements"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Tenant Improvements ({selectedRfp.tenantImprovementsCount} items)
                    </label>
                  </div>
                )}
                {selectedRfp.designSoftCostsCount > 0 && (
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="design-costs"
                      checked={selectedCategories.has('designSoftCosts')}
                      onCheckedChange={() => toggleCategory('designSoftCosts')}
                    />
                    <label
                      htmlFor="design-costs"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Design / Soft Costs ({selectedRfp.designSoftCostsCount} items)
                    </label>
                  </div>
                )}
                {selectedRfp.existingImprovementsCount > 0 && (
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="existing-improvements"
                      checked={selectedCategories.has('existingImprovements')}
                      onCheckedChange={() => toggleCategory('existingImprovements')}
                    />
                    <label
                      htmlFor="existing-improvements"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Existing Improvements ({selectedRfp.existingImprovementsCount} items)
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!selectedRfpId || selectedCategories.size === 0 || isImporting}
          >
            <Copy className="h-4 w-4 mr-2" />
            {isImporting ? 'Importing...' : 'Import Selected Items'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
