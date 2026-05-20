import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ContractorPricing {
  id: number;
  scopeItemId: number;
  contractorId: number | null;
  contractorName: string;
  price: string;
  unit: string;
  quotedDate: string;
  quarter: string;
  notes: string | null;
  isActive: boolean;
}

interface Contact {
  id: number;
  name: string;
  company: string | null;
  type: string;
}

interface QuarterlyPricingPanelProps {
  scopeItemId: number;
  scopeItemUnit: string;
  pricingMode?: string | null;
  selectedContractorName?: string | null;
  manualOverridePrice?: string | null;
  manualOverrideReason?: string | null;
  activePrice?: string | null;
}

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1];

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}

function defaultQuarter() {
  const q = Math.ceil((new Date().getMonth() + 1) / 3);
  return `Q${q} ${CURRENT_YEAR}`;
}

export function QuarterlyPricingPanel({
  scopeItemId,
  scopeItemUnit,
  pricingMode: initialMode,
  selectedContractorName: initialContractor,
  manualOverridePrice: initialManualPrice,
  manualOverrideReason: initialManualReason,
  activePrice: initialActivePrice,
}: QuarterlyPricingPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [quoteForm, setQuoteForm] = useState({
    contractorName: "",
    customName: "",
    price: "",
    unit: scopeItemUnit,
    quarter: defaultQuarter(),
    notes: "",
  });

  const [pricingMode, setPricingMode] = useState(initialMode || "average");
  const [selectedContractorName, setSelectedContractorName] = useState(initialContractor || "");
  const [manualPrice, setManualPrice] = useState(initialManualPrice || "");
  const [manualReason, setManualReason] = useState(initialManualReason || "");

  const { data: contractorPricing = [] } = useQuery<ContractorPricing[]>({
    queryKey: [`/api/scope-items/${scopeItemId}/contractor-pricing`],
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const contractorContacts = contacts.filter((c) => c.type === "contractor");

  const activePrices = contractorPricing
    .filter((p) => p.isActive)
    .map((p) => parseFloat(p.price))
    .filter((n) => !isNaN(n));

  const avg = activePrices.length ? activePrices.reduce((a, b) => a + b, 0) / activePrices.length : 0;
  const minPrice = activePrices.length ? Math.min(...activePrices) : 0;
  const maxPrice = activePrices.length ? Math.max(...activePrices) : 0;
  const spread = avg > 0 ? ((maxPrice - minPrice) / avg) * 100 : 0;

  const minEntry = contractorPricing.find((p) => parseFloat(p.price) === minPrice);
  const maxEntry = contractorPricing.find((p) => parseFloat(p.price) === maxPrice);

  const spreadColor = spread < 10 ? "text-green-600" : spread < 20 ? "text-yellow-600" : "text-red-600";

  const currentActivePrice = initialActivePrice ? parseFloat(initialActivePrice) : avg;

  const modeBasis =
    pricingMode === "average"
      ? `Based on average of ${activePrices.length} quote${activePrices.length !== 1 ? "s" : ""}`
      : pricingMode === "contractor"
      ? selectedContractorName || initialContractor || "—"
      : `Manual — ${manualReason || initialManualReason || "no reason given"}`;

  const addQuoteMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest(`/api/scope-items/${scopeItemId}/contractor-pricing`, "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/scope-items/${scopeItemId}/contractor-pricing`] });
      queryClient.invalidateQueries({ queryKey: ["/api/rom-scope-items"] });
      setQuoteForm({ contractorName: "", customName: "", price: "", unit: scopeItemUnit, quarter: defaultQuarter(), notes: "" });
      toast({ title: "Quote saved" });
    },
    onError: () => toast({ title: "Failed to save quote", variant: "destructive" }),
  });

  const deleteQuoteMutation = useMutation({
    mutationFn: (pricingId: number) =>
      apiRequest(`/api/scope-items/${scopeItemId}/contractor-pricing/${pricingId}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/scope-items/${scopeItemId}/contractor-pricing`] });
      queryClient.invalidateQueries({ queryKey: ["/api/rom-scope-items"] });
    },
    onError: () => toast({ title: "Failed to delete quote", variant: "destructive" }),
  });

  const updateModeMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest(`/api/scope-items/${scopeItemId}/pricing-mode`, "PATCH", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rom-scope-items"] });
      toast({ title: "Pricing mode saved" });
    },
    onError: () => toast({ title: "Failed to save pricing mode", variant: "destructive" }),
  });

  const handleAddQuote = () => {
    const name = quoteForm.contractorName === "__custom__" ? quoteForm.customName : quoteForm.contractorName;
    if (!name || !quoteForm.price || !quoteForm.quarter) return;
    addQuoteMutation.mutate({
      contractorName: name,
      price: quoteForm.price,
      unit: quoteForm.unit,
      quotedDate: new Date().toISOString(),
      quarter: quoteForm.quarter,
      notes: quoteForm.notes || null,
    });
  };

  const handleSaveMode = () => {
    updateModeMutation.mutate({
      pricingMode,
      selectedContractorName: pricingMode === "contractor" ? selectedContractorName : null,
      manualOverridePrice: pricingMode === "manual" ? manualPrice : null,
      manualOverrideReason: pricingMode === "manual" ? manualReason : null,
    });
  };

  const uniqueContractorNames = [...new Set(contractorPricing.map((p) => p.contractorName))];

  return (
    <div className="border-t bg-amber-50 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h5 className="font-semibold text-amber-900 text-sm">Quarterly Pricing</h5>
        {spread > 20 && activePrices.length > 1 && (
          <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
            <AlertTriangle className="h-3 w-3" /> High variance — verify scope
          </span>
        )}
      </div>

      {/* Active Price */}
      <div className="bg-white rounded-md border p-3 flex items-center justify-between">
        <div>
          <div className="text-2xl font-bold text-gray-900">{formatCurrency(currentActivePrice)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{modeBasis}</div>
        </div>
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">ROM Price</div>
      </div>

      {/* Price Intelligence Summary */}
      {activePrices.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-white rounded-md border p-2 text-center">
            <div className="text-xs text-gray-500">Average</div>
            <div className="text-sm font-semibold">{formatCurrency(avg)}</div>
          </div>
          <div className="bg-green-50 rounded-md border border-green-200 p-2 text-center">
            <div className="text-xs text-gray-500">Low</div>
            <div className="text-sm font-semibold text-green-700">{formatCurrency(minPrice)}</div>
            <div className="text-xs text-gray-400 truncate">{minEntry?.contractorName}</div>
          </div>
          <div className="bg-red-50 rounded-md border border-red-200 p-2 text-center">
            <div className="text-xs text-gray-500">High</div>
            <div className="text-sm font-semibold text-red-700">{formatCurrency(maxPrice)}</div>
            <div className="text-xs text-gray-400 truncate">{maxEntry?.contractorName}</div>
          </div>
          <div className="bg-white rounded-md border p-2 text-center">
            <div className="text-xs text-gray-500">Spread</div>
            <div className={`text-sm font-semibold ${spreadColor}`}>{spread.toFixed(1)}%</div>
          </div>
        </div>
      )}

      {/* Quote Table */}
      {contractorPricing.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="border-b px-2 py-1 text-left">Contractor</th>
                <th className="border-b px-2 py-1 text-right">Price</th>
                <th className="border-b px-2 py-1 text-center">Unit</th>
                <th className="border-b px-2 py-1 text-center">Quarter</th>
                <th className="border-b px-2 py-1 text-center">Date</th>
                <th className="border-b px-2 py-1 text-left">Notes</th>
                <th className="border-b px-2 py-1 w-6"></th>
              </tr>
            </thead>
            <tbody>
              {contractorPricing.map((p, idx) => {
                const price = parseFloat(p.price);
                const isLow = activePrices.length > 1 && price === minPrice;
                const isHigh = activePrices.length > 1 && price === maxPrice;
                return (
                  <tr
                    key={p.id}
                    className={isLow ? "bg-green-50" : isHigh ? "bg-red-50" : idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                  >
                    <td className="border-b px-2 py-1">{p.contractorName}</td>
                    <td className={`border-b px-2 py-1 text-right font-medium ${isLow ? "text-green-700" : isHigh ? "text-red-700" : ""}`}>
                      {formatCurrency(price)}
                    </td>
                    <td className="border-b px-2 py-1 text-center">{p.unit}</td>
                    <td className="border-b px-2 py-1 text-center">{p.quarter}</td>
                    <td className="border-b px-2 py-1 text-center">{new Date(p.quotedDate).toLocaleDateString()}</td>
                    <td className="border-b px-2 py-1 text-gray-500">{p.notes || "—"}</td>
                    <td className="border-b px-2 py-1 text-center">
                      <button
                        onClick={() => deleteQuoteMutation.mutate(p.id)}
                        className="text-red-400 hover:text-red-600"
                        disabled={deleteQuoteMutation.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">No contractor quotes yet — add your first quote below</p>
      )}

      {/* Add Quote Form */}
      <div className="bg-white rounded-md border p-3 space-y-2">
        <div className="text-xs font-semibold text-gray-600">Add Quote</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Contractor</Label>
            <select
              value={quoteForm.contractorName}
              onChange={(e) => setQuoteForm({ ...quoteForm, contractorName: e.target.value })}
              className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md"
            >
              <option value="">Select contractor</option>
              {contractorContacts.map((c) => (
                <option key={c.id} value={c.company || c.name}>{c.company || c.name}</option>
              ))}
              <option value="__custom__">Other…</option>
            </select>
            {quoteForm.contractorName === "__custom__" && (
              <Input
                className="mt-1 h-8 text-xs"
                placeholder="Enter contractor name"
                value={quoteForm.customName}
                onChange={(e) => setQuoteForm({ ...quoteForm, customName: e.target.value })}
              />
            )}
          </div>
          <div>
            <Label className="text-xs">Price</Label>
            <Input
              className="h-8 text-xs"
              type="number"
              step="0.01"
              min="0"
              value={quoteForm.price}
              onChange={(e) => setQuoteForm({ ...quoteForm, price: e.target.value })}
              placeholder="0.00"
            />
          </div>
          <div>
            <Label className="text-xs">Unit</Label>
            <Input
              className="h-8 text-xs"
              value={quoteForm.unit}
              onChange={(e) => setQuoteForm({ ...quoteForm, unit: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Quarter</Label>
            <select
              value={quoteForm.quarter}
              onChange={(e) => setQuoteForm({ ...quoteForm, quarter: e.target.value })}
              className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md"
            >
              {YEARS.flatMap((y) =>
                QUARTERS.map((q) => (
                  <option key={`${q} ${y}`} value={`${q} ${y}`}>{q} {y}</option>
                ))
              )}
            </select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Notes (optional)</Label>
            <Input
              className="h-8 text-xs"
              value={quoteForm.notes}
              onChange={(e) => setQuoteForm({ ...quoteForm, notes: e.target.value })}
              placeholder="e.g., includes fixtures, excludes permits"
            />
          </div>
        </div>
        <Button
          size="sm"
          className="w-full h-8 text-xs"
          onClick={handleAddQuote}
          disabled={
            addQuoteMutation.isPending ||
            !quoteForm.price ||
            !quoteForm.quarter ||
            (!quoteForm.contractorName || (quoteForm.contractorName === "__custom__" && !quoteForm.customName))
          }
        >
          {addQuoteMutation.isPending ? "Saving…" : "Save Quote"}
        </Button>
      </div>

      {/* Active Price Mode Selector */}
      <div className="bg-white rounded-md border p-3 space-y-2">
        <div className="text-xs font-semibold text-gray-600">Active Price Mode</div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name={`mode-${scopeItemId}`}
              value="average"
              checked={pricingMode === "average"}
              onChange={() => setPricingMode("average")}
            />
            Use Average
            {avg > 0 && <span className="text-gray-400">({formatCurrency(avg)})</span>}
          </label>

          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name={`mode-${scopeItemId}`}
              value="contractor"
              checked={pricingMode === "contractor"}
              onChange={() => setPricingMode("contractor")}
            />
            Use Specific Contractor
          </label>
          {pricingMode === "contractor" && (
            <div className="ml-5">
              <select
                value={selectedContractorName}
                onChange={(e) => setSelectedContractorName(e.target.value)}
                className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md"
              >
                <option value="">Select contractor</option>
                {uniqueContractorNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name={`mode-${scopeItemId}`}
              value="manual"
              checked={pricingMode === "manual"}
              onChange={() => setPricingMode("manual")}
            />
            Manual Override
          </label>
          {pricingMode === "manual" && (
            <div className="ml-5 space-y-2">
              <Input
                className="h-8 text-xs"
                type="number"
                step="0.01"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                placeholder="Override price"
              />
              <Input
                className="h-8 text-xs"
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
                placeholder="Reason for override"
              />
            </div>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full h-8 text-xs mt-1"
          onClick={handleSaveMode}
          disabled={updateModeMutation.isPending}
        >
          {updateModeMutation.isPending ? "Saving…" : "Save Price Mode"}
        </Button>
      </div>
    </div>
  );
}
