import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Tag, CheckCircle, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { RfpFile } from "@shared/schema";

interface ScopeItem {
  id: number;
  name: string;
  category: string;
  csiDivision?: string;
  unit: string;
}

export interface PrePopulatedLineItem {
  description: string;
  totalPrice?: string;
  unitPrice?: string;
  quantity?: string;
  unit?: string;
}

interface TagRow {
  id: string;
  description: string;
  totalPrice: string;
  unitPrice: string;
  quantity: string;
  unit: string;
  scopeItemId: string;
  quarter: string;
  notes: string;
}

interface BidTaggingModalProps {
  isOpen: boolean;
  onClose: () => void;
  bidCollectionId: number;
  contractorName: string;
  projectName: string;
  submissionDate?: string | Date;
  attachments?: RfpFile[];
  prePopulatedLineItems?: PrePopulatedLineItem[];
}

function buildPdfUrl(p?: string): string {
  if (!p) return "";
  if (p.startsWith("/uploads/")) return p;
  if (p.startsWith("uploads/")) return `/${p}`;
  return `/uploads/${p}`;
}

function getQuarterFromDate(date?: string | Date): string {
  const d = date ? new Date(date) : new Date();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  const q = Math.ceil(month / 3);
  return `Q${q} ${year}`;
}

function makeEmptyRow(quarter: string): TagRow {
  return {
    id: `row-${Date.now()}-${Math.random()}`,
    description: "",
    totalPrice: "",
    unitPrice: "",
    quantity: "",
    unit: "sf",
    scopeItemId: "",
    quarter,
    notes: "",
  };
}

export function BidTaggingModal({
  isOpen,
  onClose,
  bidCollectionId,
  contractorName,
  projectName,
  submissionDate,
  attachments = [],
  prePopulatedLineItems = [],
}: BidTaggingModalProps) {
  const { toast } = useToast();
  const defaultQuarter = getQuarterFromDate(submissionDate);
  const [rows, setRows] = useState<TagRow[]>([]);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [activePdfUrl, setActivePdfUrl] = useState<string>("");

  // Reset state whenever the modal opens
  useEffect(() => {
    if (!isOpen) return;
    setSavedCount(null);

    // Set first PDF attachment as active
    const firstPdf = attachments.find(a => a.type === "application/pdf" || a.name?.endsWith(".pdf"));
    if (firstPdf?.path) {
      setActivePdfUrl(buildPdfUrl(firstPdf.path));
    } else {
      setActivePdfUrl("");
    }

    // Pre-populate rows from existing line items
    if (prePopulatedLineItems.length > 0) {
      setRows(
        prePopulatedLineItems.map(item => ({
          id: `row-${Date.now()}-${Math.random()}`,
          description: item.description || "",
          totalPrice: item.totalPrice || "",
          unitPrice: item.unitPrice || "",
          quantity: item.quantity || "",
          unit: item.unit || "sf",
          scopeItemId: "",
          quarter: defaultQuarter,
          notes: "",
        }))
      );
    } else {
      setRows([makeEmptyRow(defaultQuarter)]);
    }
  }, [isOpen]);

  // Fetch ROM scope items for dropdown
  const { data: scopeItemsRaw = [] } = useQuery<ScopeItem[]>({
    queryKey: ["/api/rom-scope-items"],
    enabled: isOpen,
  });

  const scopeItems = Array.isArray(scopeItemsRaw) ? scopeItemsRaw as ScopeItem[] : [];

  // Group scope items by category for the dropdown
  const grouped = scopeItems.reduce<Record<string, ScopeItem[]>>((acc, item) => {
    const key = item.category || "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const saveMutation = useMutation({
    mutationFn: async (tags: object[]) => {
      return apiRequest(`/api/proposals/${bidCollectionId}/tag-line-items`, "POST", { tags });
    },
    onSuccess: (data: any) => {
      const count = data?.saved ?? 0;
      setSavedCount(count);
      toast({ title: `${count} quote${count !== 1 ? "s" : ""} saved to pricing database` });
    },
    onError: () => {
      toast({ title: "Failed to save tags", variant: "destructive" });
    },
  });

  function updateRow(id: string, field: keyof TagRow, value: string) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  function addRow() {
    setRows(prev => [...prev, makeEmptyRow(defaultQuarter)]);
  }

  function removeRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id));
  }

  function handleSave() {
    const tags = rows
      .filter(r => r.scopeItemId)
      .map(r => ({
        description: r.description,
        totalPrice: r.totalPrice,
        unitPrice: r.unitPrice,
        quantity: r.quantity,
        unit: r.unit || "sf",
        scopeItemId: parseInt(r.scopeItemId),
        contractorName,
        quarter: r.quarter,
        notes: r.notes,
        price: r.unitPrice || r.totalPrice,
      }));

    if (tags.length === 0) {
      toast({ title: "No rows have a Scope Item selected", variant: "destructive" });
      return;
    }

    saveMutation.mutate(tags);
  }

  const hasPdf = !!activePdfUrl;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${hasPdf ? "max-w-7xl" : "max-w-4xl"} max-h-[90vh] flex flex-col`}>
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-blue-600" />
            Tag Prices — {contractorName}
          </DialogTitle>
          <p className="text-sm text-gray-500 mt-1">
            Project: <span className="font-medium text-gray-700">{projectName}</span>
          </p>
        </DialogHeader>

        {savedCount !== null ? (
          // Success state
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <CheckCircle className="h-12 w-12 text-green-500" />
            <p className="text-lg font-semibold text-gray-800">
              {savedCount} quote{savedCount !== 1 ? "s" : ""} saved to pricing database
            </p>
            <p className="text-sm text-gray-500 text-center max-w-sm">
              Prices are now available in the ROM Pilot quarterly pricing panel for each scope item.
            </p>
            <div className="flex gap-3 mt-2">
              <Button
                variant="outline"
                onClick={() => window.open("/rom-pilot", "_blank")}
                className="flex items-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                View in ROM Pilot
              </Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <div className={`flex gap-4 flex-1 overflow-hidden min-h-0 ${hasPdf ? "flex-row" : "flex-col"}`}>
            {/* Left: PDF viewer */}
            {hasPdf && (
              <div className="flex flex-col w-1/2 min-w-0 flex-shrink-0">
                <div className="flex gap-2 mb-2 flex-wrap">
                  {attachments
                    .filter(a => a.type === "application/pdf" || a.name?.endsWith(".pdf"))
                    .map(a => (
                      <button
                        key={a.id}
                        onClick={() => setActivePdfUrl(buildPdfUrl(a.path))}
                        className={`text-xs px-2 py-1 rounded border truncate max-w-[200px] ${
                          activePdfUrl === buildPdfUrl(a.path)
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
                        }`}
                        title={a.name}
                      >
                        {a.name}
                      </button>
                    ))}
                </div>
                <iframe
                  src={activePdfUrl}
                  className="flex-1 border rounded-lg w-full"
                  title="Bid PDF"
                  style={{ minHeight: "500px" }}
                />
              </div>
            )}

            {/* Right: Tagging panel */}
            <div className={`flex flex-col ${hasPdf ? "w-1/2" : "w-full"} overflow-hidden min-h-0`}>
              <div className="overflow-auto flex-1">
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr>
                      <th className="text-left p-2 border-b font-medium text-gray-600 min-w-[140px]">Description</th>
                      <th className="text-left p-2 border-b font-medium text-gray-600 w-24">Total $</th>
                      <th className="text-left p-2 border-b font-medium text-gray-600 w-24">Unit $</th>
                      <th className="text-left p-2 border-b font-medium text-gray-600 w-16">Qty</th>
                      <th className="text-left p-2 border-b font-medium text-gray-600 w-16">Unit</th>
                      <th className="text-left p-2 border-b font-medium text-gray-600 min-w-[180px]">Scope Item *</th>
                      <th className="text-left p-2 border-b font-medium text-gray-600 w-24">Quarter</th>
                      <th className="text-left p-2 border-b font-medium text-gray-600 w-24">Notes</th>
                      <th className="w-8 border-b"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.id} className="border-b hover:bg-gray-50">
                        <td className="p-1">
                          <Input
                            value={row.description}
                            onChange={e => updateRow(row.id, "description", e.target.value)}
                            placeholder="Description"
                            className="h-8 text-xs"
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            value={row.totalPrice}
                            onChange={e => updateRow(row.id, "totalPrice", e.target.value)}
                            placeholder="0.00"
                            className="h-8 text-xs"
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            value={row.unitPrice}
                            onChange={e => updateRow(row.id, "unitPrice", e.target.value)}
                            placeholder="0.00"
                            className="h-8 text-xs"
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            value={row.quantity}
                            onChange={e => updateRow(row.id, "quantity", e.target.value)}
                            placeholder="1"
                            className="h-8 text-xs"
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            value={row.unit}
                            onChange={e => updateRow(row.id, "unit", e.target.value)}
                            placeholder="sf"
                            className="h-8 text-xs"
                          />
                        </td>
                        <td className="p-1">
                          <Select
                            value={row.scopeItemId}
                            onValueChange={val => updateRow(row.id, "scopeItemId", val)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Select scope item..." />
                            </SelectTrigger>
                            <SelectContent className="max-h-64">
                              {Object.entries(grouped)
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([category, items]) => (
                                  <div key={category}>
                                    <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 sticky top-0">
                                      {category}
                                    </div>
                                    {items.map(item => (
                                      <SelectItem key={item.id} value={String(item.id)} className="text-xs pl-4">
                                        {item.name} ({item.unit})
                                      </SelectItem>
                                    ))}
                                  </div>
                                ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-1">
                          <Input
                            value={row.quarter}
                            onChange={e => updateRow(row.id, "quarter", e.target.value)}
                            placeholder="Q1 2025"
                            className="h-8 text-xs"
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            value={row.notes}
                            onChange={e => updateRow(row.id, "notes", e.target.value)}
                            placeholder="Notes"
                            className="h-8 text-xs"
                          />
                        </td>
                        <td className="p-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeRow(row.id)}
                            className="h-8 w-8 p-0 text-gray-400 hover:text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex-shrink-0 pt-3 border-t mt-3">
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" onClick={addRow} className="flex items-center gap-1.5">
                    <Plus className="h-3.5 w-3.5" />
                    Add Row
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={onClose}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={saveMutation.isPending}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
                    >
                      {saveMutation.isPending ? "Saving..." : (
                        <>
                          <Tag className="h-4 w-4" />
                          Save All Tags
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  * Only rows with a Scope Item selected will be saved. Contractor: <strong>{contractorName}</strong>
                </p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
