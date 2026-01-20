import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Upload, FileText, ArrowRight, Check, X, ChevronDown, Save, Trash2, Edit2, AlertTriangle } from "lucide-react";

interface ParsedRow {
  cells: string[];
  rowIndex: number;
  confidence?: number;
}

interface ParsedTable {
  headers: string[];
  rows: ParsedRow[];
  rawText: string;
  headerSignature?: string;
  suggestedMapping?: ColumnMapping;
}

interface PdfMappingTemplate {
  id: number;
  contractorId: number | null;
  templateName: string;
  headerSignature: string | null;
  columnCount: number | null;
  sampleHeaders: string[] | null;
  mapping: ColumnMapping;
  isDefault: boolean;
  usageCount: number;
}

interface PdfBidImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  bidCollectionId: number;
  rfpId: number;
  contractorId?: number;
  contractorName?: string;
}

type ColumnMapping = {
  description?: number;
  quantity?: number;
  unit?: number;
  unitPrice?: number;
  totalPrice?: number;
};

interface PreviewRow {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  totalPrice: string;
  included: boolean;
  confidence: number;
}

const MAPPING_FIELDS = [
  { key: "description", label: "Description", required: true },
  { key: "quantity", label: "Qty", required: false },
  { key: "unit", label: "Unit", required: false },
  { key: "unitPrice", label: "Unit Price", required: false },
  { key: "totalPrice", label: "Total Price", required: false },
] as const;

export function PdfBidImportModal({ isOpen, onClose, bidCollectionId, rfpId, contractorId, contractorName }: PdfBidImportModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [step, setStep] = useState<"upload" | "mapping" | "preview">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);

  const { data: contractorTemplates } = useQuery<PdfMappingTemplate[]>({
    queryKey: ['/api/pdf-mapping-templates/contractor', contractorId],
    queryFn: async () => {
      const response = await fetch(`/api/pdf-mapping-templates/contractor/${contractorId}`);
      if (!response.ok) throw new Error('Failed to fetch templates');
      return response.json();
    },
    enabled: isOpen && !!contractorId,
  });

  const { data: allTemplates } = useQuery<PdfMappingTemplate[]>({
    queryKey: ['/api/pdf-mapping-templates'],
    enabled: isOpen,
  });
  
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
    onSuccess: async (data) => {
      if (data.tables && data.tables.length > 0) {
        const table = data.tables[0] as ParsedTable;
        setParsedData(table);
        
        let appliedMapping: ColumnMapping = {};
        let matchedTemplate: PdfMappingTemplate | null = null;
        
        if (table.headerSignature && contractorTemplates?.length) {
          matchedTemplate = contractorTemplates.find(t => t.headerSignature === table.headerSignature) || null;
        }
        
        if (!matchedTemplate && table.headerSignature && allTemplates?.length) {
          matchedTemplate = allTemplates.find(t => t.headerSignature === table.headerSignature) || null;
        }
        
        if (matchedTemplate) {
          appliedMapping = matchedTemplate.mapping;
          setSelectedTemplateId(matchedTemplate.id);
          toast({
            title: "Template Matched",
            description: `Using saved template: "${matchedTemplate.templateName}"`,
          });
          
          await fetch(`/api/pdf-mapping-templates/${matchedTemplate.id}/use`, { method: 'POST' });
        } else if (table.suggestedMapping) {
          appliedMapping = table.suggestedMapping;
        } else {
          const headers = table.headers.map((h: string) => h.toLowerCase());
          headers.forEach((header: string, index: number) => {
            if (header.includes("desc") || header.includes("item") || header.includes("scope")) {
              if (appliedMapping.description === undefined) appliedMapping.description = index;
            } else if (header.includes("qty") || header.includes("quant")) {
              if (appliedMapping.quantity === undefined) appliedMapping.quantity = index;
            } else if (header === "unit" || header.includes("uom") || header.includes("u/m")) {
              if (appliedMapping.unit === undefined) appliedMapping.unit = index;
            } else if ((header.includes("unit") && header.includes("price")) || header.includes("rate")) {
              if (appliedMapping.unitPrice === undefined) appliedMapping.unitPrice = index;
            } else if (header.includes("total") || header.includes("amount") || header.includes("ext")) {
              if (appliedMapping.totalPrice === undefined) appliedMapping.totalPrice = index;
            }
          });
        }
        
        setMapping(appliedMapping);
        setStep("mapping");
        
        if (contractorName) {
          setTemplateName(`${contractorName} - Standard Format`);
        }
      } else {
        toast({
          title: "No tables found",
          description: "Could not detect any table data in the PDF. Try a different PDF format.",
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

  const saveTemplateMutation = useMutation({
    mutationFn: async (template: { templateName: string; contractorId?: number; headerSignature?: string; columnCount?: number; sampleHeaders?: string[]; mapping: ColumnMapping }) => {
      return await apiRequest("/api/pdf-mapping-templates", "POST", template);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pdf-mapping-templates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/pdf-mapping-templates/contractor', contractorId] });
      toast({
        title: "Template Saved",
        description: "This mapping will be automatically applied to similar PDFs in the future.",
      });
    },
  });
  
  const importMutation = useMutation({
    mutationFn: async () => {
      const itemsToImport = previewRows.filter(row => row.included);
      
      if (itemsToImport.length === 0) {
        throw new Error("No items selected for import");
      }

      const response = await apiRequest("/api/bid-import/apply-mapping", "POST", {
        bidCollectionId,
        tableData: {
          headers: parsedData?.headers || [],
          rows: itemsToImport.map((row, idx) => ({
            cells: [row.description, row.quantity, row.unit, row.unitPrice, row.totalPrice],
            rowIndex: idx,
          })),
        },
        mapping: {
          description: 0,
          quantity: 1,
          unit: 2,
          unitPrice: 3,
          totalPrice: 4,
        },
      });
      return { ...response, importedCount: itemsToImport.length };
    },
    onSuccess: async (data) => {
      if (saveTemplate && templateName && parsedData) {
        await saveTemplateMutation.mutateAsync({
          templateName,
          contractorId: contractorId || undefined,
          headerSignature: parsedData.headerSignature || undefined,
          columnCount: parsedData.headers.length,
          sampleHeaders: parsedData.headers,
          mapping,
        });
      }
      
      toast({
        title: "Import Successful",
        description: `Imported ${data.importedCount} line items from PDF`,
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
    setPreviewRows([]);
    setSaveTemplate(false);
    setTemplateName("");
    setSelectedTemplateId(null);
    setEditingRowIndex(null);
    onClose();
  };
  
  const handleMappingChange = (field: keyof ColumnMapping, columnIndex: number | undefined) => {
    setMapping(prev => ({
      ...prev,
      [field]: columnIndex,
    }));
    setOpenDropdown(null);
    setSelectedTemplateId(null);
  };

  const handleProceedToPreview = () => {
    if (!parsedData) return;
    
    const rows: PreviewRow[] = parsedData.rows.map(row => {
      const desc = mapping.description !== undefined ? row.cells[mapping.description] || "" : "";
      const qty = mapping.quantity !== undefined ? row.cells[mapping.quantity] || "" : "";
      const unit = mapping.unit !== undefined ? row.cells[mapping.unit] || "" : "";
      const unitPrice = mapping.unitPrice !== undefined ? row.cells[mapping.unitPrice] || "" : "";
      const totalPrice = mapping.totalPrice !== undefined ? row.cells[mapping.totalPrice] || "" : "";
      
      const hasDescription = desc.trim().length > 0;
      const hasPrice = unitPrice.trim().length > 0 || totalPrice.trim().length > 0;
      
      return {
        description: desc,
        quantity: qty,
        unit: unit,
        unitPrice: unitPrice,
        totalPrice: totalPrice,
        included: hasDescription && (hasPrice || qty.trim().length > 0),
        confidence: row.confidence || (hasDescription && hasPrice ? 0.9 : hasDescription ? 0.6 : 0.3),
      };
    });
    
    setPreviewRows(rows);
    setStep("preview");
  };

  const toggleRowInclusion = (index: number) => {
    setPreviewRows(prev => prev.map((row, i) => 
      i === index ? { ...row, included: !row.included } : row
    ));
  };

  const updatePreviewRow = (index: number, field: keyof PreviewRow, value: string) => {
    setPreviewRows(prev => prev.map((row, i) => 
      i === index ? { ...row, [field]: value } : row
    ));
  };

  const removeRow = (index: number) => {
    setPreviewRows(prev => prev.filter((_, i) => i !== index));
  };

  const includedCount = previewRows.filter(r => r.included).length;
  const lowConfidenceCount = previewRows.filter(r => r.included && r.confidence < 0.7).length;
  
  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Import Bid from PDF
            {contractorName && <span className="text-sm font-normal text-gray-500">- {contractorName}</span>}
          </DialogTitle>
          <DialogDescription>
            {step === "upload" && "Upload a PDF file containing bid pricing data"}
            {step === "mapping" && "Map the PDF columns to your pricing fields"}
            {step === "preview" && "Review and edit the data before importing"}
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

            {contractorTemplates && contractorTemplates.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm text-green-800">
                  <Check className="inline h-4 w-4 mr-1" />
                  {contractorTemplates.length} saved template(s) available for this contractor
                </p>
              </div>
            )}
          </div>
        )}
        
        {step === "mapping" && parsedData && (
          <div className="space-y-4">
            <div className="bg-blue-50 p-3 rounded-lg text-sm flex justify-between items-center">
              <div>
                <p><strong>Detected {parsedData.rows.length} rows</strong> with {parsedData.headers.length} columns</p>
                <p className="text-gray-600">Map each column to the appropriate field below</p>
              </div>
              {selectedTemplateId && (
                <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                  Using saved template
                </span>
              )}
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
                    {parsedData.rows.slice(0, 5).map((row, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-3 py-2">{mapping.description !== undefined ? row.cells[mapping.description] || <span className="text-gray-300">—</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2">{mapping.quantity !== undefined ? row.cells[mapping.quantity] || <span className="text-gray-300">—</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2">{mapping.unit !== undefined ? row.cells[mapping.unit] || <span className="text-gray-300">—</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2">{mapping.unitPrice !== undefined ? row.cells[mapping.unitPrice] || <span className="text-gray-300">—</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2">{mapping.totalPrice !== undefined ? row.cells[mapping.totalPrice] || <span className="text-gray-300">—</span> : <span className="text-gray-300">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
            <div className="flex justify-between items-center">
              <Button variant="outline" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button
                onClick={handleProceedToPreview}
                disabled={mapping.description === undefined}
              >
                Review All Items
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="bg-blue-50 p-3 rounded-lg text-sm flex-1">
                <p><strong>{includedCount}</strong> of {previewRows.length} items selected for import</p>
              </div>
              {lowConfidenceCount > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <span className="text-yellow-800">{lowConfidenceCount} items may need review</span>
                </div>
              )}
            </div>

            <div className="border rounded-lg overflow-hidden max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-2 text-left w-10">
                      <Checkbox
                        checked={previewRows.every(r => r.included)}
                        onCheckedChange={(checked) => {
                          setPreviewRows(prev => prev.map(row => ({ ...row, included: !!checked })));
                        }}
                      />
                    </th>
                    <th className="px-2 py-2 text-left">Description</th>
                    <th className="px-2 py-2 text-left w-20">Qty</th>
                    <th className="px-2 py-2 text-left w-16">Unit</th>
                    <th className="px-2 py-2 text-left w-24">Unit Price</th>
                    <th className="px-2 py-2 text-left w-24">Total</th>
                    <th className="px-2 py-2 text-left w-16">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, idx) => (
                    <tr key={idx} className={`border-t ${!row.included ? 'opacity-50 bg-gray-50' : ''} ${row.confidence < 0.7 ? 'bg-yellow-50' : ''}`}>
                      <td className="px-2 py-1">
                        <Checkbox
                          checked={row.included}
                          onCheckedChange={() => toggleRowInclusion(idx)}
                        />
                      </td>
                      <td className="px-2 py-1">
                        {editingRowIndex === idx ? (
                          <Input
                            value={row.description}
                            onChange={(e) => updatePreviewRow(idx, 'description', e.target.value)}
                            className="h-7 text-xs"
                          />
                        ) : (
                          <span className={row.description ? '' : 'text-gray-300'}>{row.description || '—'}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {editingRowIndex === idx ? (
                          <Input
                            value={row.quantity}
                            onChange={(e) => updatePreviewRow(idx, 'quantity', e.target.value)}
                            className="h-7 text-xs w-16"
                          />
                        ) : (
                          <span className={row.quantity ? '' : 'text-gray-300'}>{row.quantity || '—'}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {editingRowIndex === idx ? (
                          <Input
                            value={row.unit}
                            onChange={(e) => updatePreviewRow(idx, 'unit', e.target.value)}
                            className="h-7 text-xs w-14"
                          />
                        ) : (
                          <span className={row.unit ? '' : 'text-gray-300'}>{row.unit || '—'}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {editingRowIndex === idx ? (
                          <Input
                            value={row.unitPrice}
                            onChange={(e) => updatePreviewRow(idx, 'unitPrice', e.target.value)}
                            className="h-7 text-xs w-20"
                          />
                        ) : (
                          <span className={row.unitPrice ? '' : 'text-gray-300'}>{row.unitPrice || '—'}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {editingRowIndex === idx ? (
                          <Input
                            value={row.totalPrice}
                            onChange={(e) => updatePreviewRow(idx, 'totalPrice', e.target.value)}
                            className="h-7 text-xs w-20"
                          />
                        ) : (
                          <span className={row.totalPrice ? '' : 'text-gray-300'}>{row.totalPrice || '—'}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => setEditingRowIndex(editingRowIndex === idx ? null : idx)}
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                            onClick={() => removeRow(idx)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!selectedTemplateId && (
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="save-template"
                    checked={saveTemplate}
                    onCheckedChange={(checked) => setSaveTemplate(!!checked)}
                  />
                  <Label htmlFor="save-template" className="text-sm cursor-pointer">
                    Save this mapping as a template for future imports
                  </Label>
                </div>
                {saveTemplate && (
                  <div className="flex gap-2 items-center pl-6">
                    <Label className="text-sm text-gray-600 whitespace-nowrap">Template name:</Label>
                    <Input
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="e.g., ABC Contractors - Standard Bid Format"
                      className="h-8 text-sm"
                    />
                  </div>
                )}
              </div>
            )}
            
            <div className="flex justify-between items-center">
              <Button variant="outline" onClick={() => setStep("mapping")}>
                Back to Mapping
              </Button>
              <Button
                onClick={() => importMutation.mutate()}
                disabled={includedCount === 0 || importMutation.isPending || (saveTemplate && !templateName)}
              >
                {importMutation.isPending ? "Importing..." : `Import ${includedCount} Items`}
                <Check className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
