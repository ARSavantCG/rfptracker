import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Upload, FileText, ArrowRight, Check, X, ChevronDown } from "lucide-react";

interface ParsedRow {
  cells: string[];
  rowIndex: number;
}

interface ParsedTable {
  headers: string[];
  rows: ParsedRow[];
  rawText: string;
}

interface PdfBidImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  bidCollectionId: number;
  rfpId: number;
}

type ColumnMapping = {
  description?: number;
  quantity?: number;
  unit?: number;
  unitPrice?: number;
  totalPrice?: number;
};

const MAPPING_FIELDS = [
  { key: "description", label: "Description", required: true },
  { key: "quantity", label: "Qty", required: false },
  { key: "unit", label: "Unit", required: false },
  { key: "unitPrice", label: "Unit Price", required: false },
  { key: "totalPrice", label: "Total Price", required: false },
] as const;

export function PdfBidImportModal({ isOpen, onClose, bidCollectionId, rfpId }: PdfBidImportModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [step, setStep] = useState<"upload" | "mapping" | "preview">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  
  const parseMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await fetch("/api/bid-import/parse-pdf", {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to parse PDF");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      if (data.tables && data.tables.length > 0) {
        setParsedData(data.tables[0]);
        setStep("mapping");
        
        const headers = data.tables[0].headers.map((h: string) => h.toLowerCase());
        const autoMapping: ColumnMapping = {};
        
        headers.forEach((header: string, index: number) => {
          if (header.includes("desc") || header.includes("item")) {
            autoMapping.description = index;
          } else if (header.includes("qty") || header.includes("quant")) {
            autoMapping.quantity = index;
          } else if (header === "unit" || header.includes("uom")) {
            autoMapping.unit = index;
          } else if (header.includes("unit") && header.includes("price")) {
            autoMapping.unitPrice = index;
          } else if (header.includes("total") || header.includes("amount") || header.includes("ext")) {
            autoMapping.totalPrice = index;
          }
        });
        
        setMapping(autoMapping);
      } else {
        toast({
          title: "No tables found",
          description: "Could not detect any table data in the PDF",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Parse Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const importMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/bid-import/apply-mapping", "POST", {
        bidCollectionId,
        tableData: parsedData,
        mapping,
      });
      return response;
    },
    onSuccess: (data) => {
      toast({
        title: "Import Successful",
        description: `Imported ${data.itemsCreated} line items from PDF`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/bid-collections/${bidCollectionId}/line-items`] });
      queryClient.invalidateQueries({ queryKey: [`/api/rfp-requests/${rfpId}/bid-collections`] });
      handleClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Import Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== "application/pdf") {
        toast({
          title: "Invalid File",
          description: "Please select a PDF file",
          variant: "destructive",
        });
        return;
      }
      setFile(selectedFile);
    }
  }, [toast]);
  
  const handleUpload = () => {
    if (file) {
      parseMutation.mutate(file);
    }
  };
  
  const handleClose = () => {
    setStep("upload");
    setFile(null);
    setParsedData(null);
    setMapping({});
    onClose();
  };
  
  const handleMappingChange = (field: keyof ColumnMapping, columnIndex: number | undefined) => {
    setMapping(prev => ({
      ...prev,
      [field]: columnIndex,
    }));
    setOpenDropdown(null);
  };
  
  const getMappedPreview = () => {
    if (!parsedData) return [];
    
    return parsedData.rows.slice(0, 5).map(row => ({
      description: mapping.description !== undefined ? row.cells[mapping.description] || "" : "",
      quantity: mapping.quantity !== undefined ? row.cells[mapping.quantity] || "" : "",
      unit: mapping.unit !== undefined ? row.cells[mapping.unit] || "" : "",
      unitPrice: mapping.unitPrice !== undefined ? row.cells[mapping.unitPrice] || "" : "",
      totalPrice: mapping.totalPrice !== undefined ? row.cells[mapping.totalPrice] || "" : "",
    }));
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Import Bid from PDF
          </DialogTitle>
          <DialogDescription>
            {step === "upload" && "Upload a PDF file containing bid pricing data"}
            {step === "mapping" && "Map the PDF columns to your pricing fields"}
            {step === "preview" && "Review the data before importing"}
          </DialogDescription>
        </DialogHeader>
        
        {step === "upload" && (
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <Upload className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <Label htmlFor="pdf-upload" className="cursor-pointer">
                <span className="text-blue-600 hover:underline">Click to upload</span>
                <span className="text-gray-500"> or drag and drop</span>
              </Label>
              <Input
                id="pdf-upload"
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              <p className="text-sm text-gray-500 mt-2">PDF files only</p>
            </div>
            
            {file && (
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-red-500" />
                  <span className="font-medium">{file.name}</span>
                  <span className="text-sm text-gray-500">
                    ({(file.size / 1024).toFixed(1)} KB)
                  </span>
                </div>
                <Button
                  onClick={handleUpload}
                  disabled={parseMutation.isPending}
                >
                  {parseMutation.isPending ? "Parsing..." : "Parse PDF"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}
        
        {step === "mapping" && parsedData && (
          <div className="space-y-4">
            <div className="bg-blue-50 p-3 rounded-lg text-sm">
              <p><strong>Detected {parsedData.rows.length} rows</strong> with {parsedData.headers.length} columns</p>
              <p className="text-gray-600">Map each column to the appropriate field below</p>
            </div>
            
            <div className="grid grid-cols-5 gap-3">
              {MAPPING_FIELDS.map(field => (
                <div key={field.key} className="space-y-1">
                  <Label className="text-xs font-medium">
                    {field.label}
                    {field.required && <span className="text-red-500">*</span>}
                  </Label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenDropdown(openDropdown === field.key ? null : field.key)}
                      className="flex h-9 w-full items-center justify-between rounded-md border bg-background px-2 py-1 text-sm"
                    >
                      <span className={mapping[field.key as keyof ColumnMapping] !== undefined ? "" : "text-gray-400"}>
                        {mapping[field.key as keyof ColumnMapping] !== undefined
                          ? parsedData.headers[mapping[field.key as keyof ColumnMapping]!] || `Column ${mapping[field.key as keyof ColumnMapping]! + 1}`
                          : "Select..."}
                      </span>
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    {openDropdown === field.key && (
                      <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg max-h-48 overflow-y-auto">
                        <div
                          className="px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-100"
                          onClick={() => handleMappingChange(field.key as keyof ColumnMapping, undefined)}
                        >
                          <em className="text-gray-400">None</em>
                        </div>
                        {parsedData.headers.map((header, idx) => (
                          <div
                            key={idx}
                            className="px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-100"
                            onClick={() => handleMappingChange(field.key as keyof ColumnMapping, idx)}
                          >
                            {header || `Column ${idx + 1}`}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-100 px-3 py-2 text-sm font-medium">
                Preview (first 5 rows)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-left">Qty</th>
                      <th className="px-3 py-2 text-left">Unit</th>
                      <th className="px-3 py-2 text-left">Unit Price</th>
                      <th className="px-3 py-2 text-left">Total Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getMappedPreview().map((row, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-3 py-2">{row.description || <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2">{row.quantity || <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2">{row.unit || <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2">{row.unitPrice || <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2">{row.totalPrice || <span className="text-gray-300">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button
                onClick={() => importMutation.mutate()}
                disabled={mapping.description === undefined || importMutation.isPending}
              >
                {importMutation.isPending ? "Importing..." : `Import ${parsedData.rows.length} Items`}
                <Check className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
