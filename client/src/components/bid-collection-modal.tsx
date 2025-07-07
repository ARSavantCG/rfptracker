import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Upload, FileText, Save, X, Download, ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import { DragDropContext, Droppable, Draggable, DropResult } from "react-beautiful-dnd";
import { FileUpload } from "./file-upload";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { RfpRequest, Contact, BidCollection, BidLineItem } from "@shared/schema";
import * as XLSX from 'xlsx';

const bidCollectionSchema = z.object({
  contractorId: z.number(),
  contractorName: z.string().min(1, "Contractor name is required"),
  contractorCompany: z.string().min(1, "Company name is required"), 
  contractorEmail: z.string().email("Valid email is required"),
  submissionDate: z.string(),
  totalAmount: z.string().optional(),
  status: z.string().default("received"),
  notes: z.string().optional(),
});

const lineItemSchema = z.object({
  category: z.string().default("General"),
  description: z.string().min(1, "Description is required"),
  quantity: z.string(),
  unit: z.string(),
  unitPrice: z.string(),
  totalPrice: z.string(),
  notes: z.string().optional(),
});

type BidCollectionFormData = z.infer<typeof bidCollectionSchema>;
type LineItemFormData = z.infer<typeof lineItemSchema>;

interface BidCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfp: RfpRequest | null;
  bidCollection?: BidCollection | null;
}

export function BidCollectionModal({ isOpen, onClose, rfp, bidCollection }: BidCollectionModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [attachments, setAttachments] = useState<File[]>([]);
  const [lineItems, setLineItems] = useState<LineItemFormData[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [originalLineItem, setOriginalLineItem] = useState<LineItemFormData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<BidCollectionFormData>({
    resolver: zodResolver(bidCollectionSchema),
    defaultValues: {
      contractorId: 0,
      contractorName: "",
      contractorCompany: "",
      contractorEmail: "",
      submissionDate: new Date().toISOString().split('T')[0],
      totalAmount: "",
      status: "received",
      notes: "",
    },
  });

  // Fetch all contacts to get contractor details
  const { data: contacts } = useQuery({
    queryKey: ["/api/contacts"],
    enabled: isOpen,
  });

  // Fetch existing line items when editing
  const { data: existingLineItems } = useQuery({
    queryKey: [`/api/bid-collections/${bidCollection?.id}/line-items`],
    enabled: isOpen && !!bidCollection,
  });

  // Fetch ITB scope of work for import functionality
  const { data: invitationToBid } = useQuery({
    queryKey: [`/api/rfp-requests/${rfp?.id}/invitation-to-bid`],
    enabled: isOpen && !!rfp?.id,
  });

  // Get all contractors and architects for bid collection
  const availableContractors = (contacts as Contact[])?.filter(contact => contact.type === "contractor") || [];
  const availableArchitects = (contacts as Contact[])?.filter(contact => contact.type === "architect") || [];
  const allBidders = [...availableContractors, ...availableArchitects];

  // Initialize form with existing bid collection data when editing
  useEffect(() => {
    if (bidCollection && isOpen) {
      form.reset({
        contractorId: bidCollection.contractorId,
        contractorName: bidCollection.contractorName,
        contractorCompany: bidCollection.contractorCompany,
        contractorEmail: bidCollection.contractorEmail,
        submissionDate: bidCollection.submissionDate.toString().split('T')[0],
        totalAmount: bidCollection.totalAmount || "",
        status: bidCollection.status,
        notes: bidCollection.notes || "",
      });
      
      // Load existing line items if available
      if (existingLineItems && Array.isArray(existingLineItems)) {
        const formattedLineItems = existingLineItems.map((item: any) => ({
          category: item.category || "Labor",
          description: item.description || "",
          quantity: item.quantity?.toString() || "",
          unit: item.unit || "",
          unitPrice: item.unitPrice || "",
          totalPrice: item.totalPrice || "",
          notes: item.notes || ""
        }));
        setLineItems(formattedLineItems);
      }

      // Load existing attachments
      if (bidCollection.attachments && Array.isArray(bidCollection.attachments)) {
        const existingFiles = bidCollection.attachments.map((attachment: any) => ({
          ...attachment,
          isExisting: true
        }));
        setAttachments(existingFiles);
      }
    } else if (!bidCollection && isOpen) {
      // Reset form for new bid collection
      form.reset({
        contractorId: 0,
        contractorName: "",
        contractorCompany: "",
        contractorEmail: "",
        submissionDate: new Date().toISOString().split('T')[0],
        totalAmount: "",
        status: "received",
        notes: "",
      });
      setLineItems([]);
      setAttachments([]);
    }
  }, [bidCollection, form, isOpen, existingLineItems]);

  // Reset attachments when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAttachments([]);
    }
  }, [isOpen]);

  const saveBidMutation = useMutation({
    mutationFn: async (data: BidCollectionFormData & { lineItems: LineItemFormData[], attachments: File[] }) => {
      const url = bidCollection 
        ? `/api/rfp-requests/${rfp?.id}/bid-collections/${bidCollection.id}`
        : `/api/rfp-requests/${rfp?.id}/bid-collections`;

      const formData = new FormData();
      
      // Add main bid collection data
      formData.append('contractorId', data.contractorId.toString());
      formData.append('contractorName', data.contractorName);
      formData.append('contractorCompany', data.contractorCompany);
      formData.append('contractorEmail', data.contractorEmail);
      formData.append('submissionDate', data.submissionDate);
      formData.append('totalAmount', data.totalAmount || '');
      formData.append('status', data.status);
      formData.append('notes', data.notes || '');
      
      // Add line items
      formData.append('lineItems', JSON.stringify(data.lineItems));
      
      // Add new file attachments
      const newFiles = data.attachments.filter((file: any) => !file.isExisting);
      newFiles.forEach((file, index) => {
        formData.append(`attachment_${index}`, file);
      });

      // Send information about existing files to keep
      const existingAttachments = data.attachments.filter((file: any) => file.isExisting);
      formData.append('existingAttachments', JSON.stringify(existingAttachments));

      let response;
      if (bidCollection) {
        response = await fetch(url, {
          method: 'PUT',
          body: formData,
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        });
      } else {
        response = await fetch(url, {
          method: 'POST',
          body: formData,
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        });
      }

      if (!response.ok) {
        throw new Error(`Failed to ${bidCollection ? 'update' : 'create'} bid collection`);
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: [`/api/rfp-requests/${rfp?.id}/bid-collections`] });
      toast({
        title: "Success",
        description: `Bid collection ${bidCollection ? 'updated' : 'created'} successfully.`,
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });



  const onSubmit = (data: BidCollectionFormData) => {
    const submissionData = {
      ...data,
      contractorId: parseInt(data.contractorId.toString()),
      lineItems,
      attachments,
    };
    
    saveBidMutation.mutate(submissionData);
  };

  const handleContractorSelect = (bidderId: string) => {
    const bidder = allBidders.find(c => c.id === parseInt(bidderId));
    if (bidder) {
      form.setValue('contractorId', bidder.id);
      form.setValue('contractorName', bidder.name);
      form.setValue('contractorCompany', bidder.company || '');
      form.setValue('contractorEmail', bidder.email || '');
    }
  };

  const addLineItem = () => {
    setLineItems([...lineItems, {
      category: "General",
      description: "",
      quantity: "",
      unit: "",
      unitPrice: "",
      totalPrice: "",
      notes: "",
    }]);
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const moveLineItemUp = (index: number) => {
    if (index === 0) return;
    const updated = [...lineItems];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    setLineItems(updated);
  };

  const moveLineItemDown = (index: number) => {
    if (index === lineItems.length - 1) return;
    const updated = [...lineItems];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    setLineItems(updated);
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const items = Array.from(lineItems);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    setLineItems(items);
  };

  const updateLineItem = (index: number, field: keyof LineItemFormData, value: string) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    
    // Auto-calculate total price when quantity and unit price change
    if (field === 'quantity' || field === 'unitPrice') {
      const qty = parseFloat(updated[index].quantity || '0');
      const price = parseFloat(updated[index].unitPrice || '0');
      if (qty > 0 && price > 0) {
        updated[index].totalPrice = (qty * price).toFixed(2);
      }
    }
    
    setLineItems(updated);
    
    // Update total amount
    const total = updated.reduce((sum, item) => {
      return sum + parseFloat(item.totalPrice || '0');
    }, 0);
    form.setValue('totalAmount', total.toFixed(2));
  };

  const startEditing = (index: number) => {
    setEditingIndex(index);
    setOriginalLineItem({ ...lineItems[index] });
  };

  const cancelEditing = () => {
    if (editingIndex !== null && originalLineItem) {
      const updated = [...lineItems];
      updated[editingIndex] = { ...originalLineItem };
      setLineItems(updated);
      
      // Recalculate total after reverting
      const total = updated.reduce((sum, item) => {
        return sum + parseFloat(item.totalPrice || '0');
      }, 0);
      form.setValue('totalAmount', total.toFixed(2));
    }
    setEditingIndex(null);
    setOriginalLineItem(null);
  };

  const saveEditing = () => {
    setEditingIndex(null);
    setOriginalLineItem(null);
  };

  const calculateTotal = () => {
    return lineItems.reduce((sum, item) => {
      return sum + parseFloat(item.totalPrice || '0');
    }, 0).toFixed(2);
  };

  const formatCurrencyForDisplay = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  };

  const importFromExcelOrCSV = () => {
    fileInputRef.current?.click();
  };

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        let workbook: XLSX.WorkBook;
        
        if (file.name.toLowerCase().endsWith('.csv')) {
          // Parse CSV
          workbook = XLSX.read(data, { type: 'binary' });
        } else {
          // Parse Excel
          workbook = XLSX.read(data, { type: 'array' });
        }
        
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        if (jsonData.length < 2) {
          toast({
            title: "Import Error",
            description: "File must contain at least a header row and one data row.",
            variant: "destructive",
          });
          return;
        }
        
        const headers = jsonData[0].map((h: any) => String(h).toLowerCase().trim());
        const dataRows = jsonData.slice(1);
        
        // Find column indices
        const descIndex = headers.findIndex(h => h.includes('description') || h.includes('desc'));
        const qtyIndex = headers.findIndex(h => h.includes('qty') || h.includes('quantity'));
        const unitIndex = headers.findIndex(h => h.includes('unit'));
        const totalPriceIndex = headers.findIndex(h => h.includes('total') && h.includes('price'));
        const notesIndex = headers.findIndex(h => h.includes('notes') || h.includes('note'));
        
        if (descIndex === -1) {
          toast({
            title: "Import Error",
            description: "Could not find 'Description' column. Please ensure your file has the correct column headers.",
            variant: "destructive",
          });
          return;
        }
        
        const importedItems: LineItemFormData[] = [];
        
        dataRows.forEach((row, rowIndex) => {
          // Skip empty rows
          if (!row || row.every(cell => !cell)) return;
          
          const description = String(row[descIndex] || "").trim();
          if (!description) return; // Skip rows without description
          
          const quantity = qtyIndex !== -1 ? String(row[qtyIndex] || "").replace(/,/g, '') : "";
          const unit = unitIndex !== -1 ? String(row[unitIndex] || "").trim() : "";
          const totalPrice = totalPriceIndex !== -1 ? String(row[totalPriceIndex] || "").replace(/[$,]/g, '') : "";
          const notes = notesIndex !== -1 ? String(row[notesIndex] || "").trim() : "";
          
          // Calculate unit price if we have quantity and total price
          let unitPrice = "";
          if (quantity && totalPrice && parseFloat(quantity) > 0 && parseFloat(totalPrice) > 0) {
            unitPrice = (parseFloat(totalPrice) / parseFloat(quantity)).toFixed(2);
          }
          
          importedItems.push({
            category: "General",
            description,
            quantity,
            unit,
            unitPrice,
            totalPrice,
            notes,
          });
        });
        
        if (importedItems.length === 0) {
          toast({
            title: "Import Warning",
            description: "No valid line items found in the file.",
            variant: "destructive",
          });
          return;
        }
        
        // Add imported items to existing line items
        setLineItems([...lineItems, ...importedItems]);
        
        toast({
          title: "Import Successful",
          description: `Imported ${importedItems.length} line item(s) from ${file.name}`,
        });
        
      } catch (error) {
        console.error('Import error:', error);
        toast({
          title: "Import Error",
          description: "Failed to parse the file. Please check the format and try again.",
          variant: "destructive",
        });
      }
    };
    
    if (file.name.toLowerCase().endsWith('.csv')) {
      reader.readAsBinaryString(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
    
    // Clear the input
    event.target.value = '';
  };

  const importFromScopeOfWork = () => {
    if (!invitationToBid || !(invitationToBid as any)?.scopeOfWork) return;
    
    const scopeItems = (invitationToBid as any).scopeOfWork.map((item: any) => ({
      category: "General",
      description: item.description || "",
      quantity: item.quantity?.toString() || "",
      unit: item.unit || "",
      unitPrice: "",
      totalPrice: "",
      notes: "",
    }));
    
    setLineItems([...scopeItems, ...lineItems]);
  };

  if (!rfp) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[98vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {bidCollection ? 'Edit' : 'New'} Bid Collection - {rfp.projectName}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Contractor Selection */}
              <FormField
                control={form.control}
                name="contractorId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Respondent (Contractor/Architect)</FormLabel>
                    <Select 
                      onValueChange={(value) => {
                        field.onChange(value);
                        handleContractorSelect(value);
                      }}
                      value={field.value?.toString()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select contractor or architect..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {allBidders.map((bidder) => (
                          <SelectItem key={bidder.id} value={bidder.id.toString()}>
                            {bidder.name} ({bidder.company}) - {bidder.type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="submissionDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Submission Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />


            </div>

            {/* Line Items Table */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Pricing Breakdown</h3>
                <div className="flex gap-2">
                  <Button type="button" onClick={importFromExcelOrCSV} variant="outline" size="sm">
                    <Upload className="h-4 w-4 mr-2" />
                    Import from Excel/CSV
                  </Button>
                  {invitationToBid && (invitationToBid as any)?.scopeOfWork?.length > 0 && (
                    <Button type="button" onClick={importFromScopeOfWork} variant="outline" size="sm">
                      <Download className="h-4 w-4 mr-2" />
                      Import from Scope of Work
                    </Button>
                  )}
                  <Button type="button" onClick={addLineItem} variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Line Item
                  </Button>
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead className="w-[70px] text-xs">Order</TableHead>
                        <TableHead className="w-[200px] text-xs">Description</TableHead>
                        <TableHead className="w-[70px] text-xs">Qty</TableHead>
                        <TableHead className="w-[60px] text-xs">Unit</TableHead>
                        <TableHead className="w-[100px] text-xs">Unit Price</TableHead>
                        <TableHead className="w-[110px] text-xs">Total Price</TableHead>
                        <TableHead className="w-[120px] text-xs">Notes</TableHead>
                        <TableHead className="w-[40px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <Droppable droppableId="lineItems">
                      {(provided) => (
                        <TableBody {...provided.droppableProps} ref={provided.innerRef}>
                          {lineItems.map((item, index) => (
                            <Draggable key={`item-${index}`} draggableId={`item-${index}`} index={index}>
                              {(provided) => (
                                <TableRow 
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  className="text-xs"
                                >
                                  <TableCell>
                                    <div className="flex items-center gap-1">
                                      <div className="flex flex-col gap-1">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => moveLineItemUp(index)}
                                          disabled={index === 0}
                                          className="h-6 w-6 p-0"
                                        >
                                          <ChevronUp className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => moveLineItemDown(index)}
                                          disabled={index === lineItems.length - 1}
                                          className="h-6 w-6 p-0"
                                        >
                                          <ChevronDown className="h-3 w-3" />
                                        </Button>
                                      </div>
                                      <div 
                                        {...provided.dragHandleProps}
                                        className="cursor-grab active:cursor-grabbing p-1 hover:bg-gray-100 rounded"
                                      >
                                        <GripVertical className="h-4 w-4 text-gray-400" />
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      value={item.description}
                                      onChange={(e) => {
                                        if (editingIndex === null) startEditing(index);
                                        updateLineItem(index, 'description', e.target.value);
                                      }}
                                      placeholder="Description"
                                      className="w-full text-xs h-8"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      value={item.quantity ? parseFloat(item.quantity || '0').toLocaleString('en-US') : ''}
                                      onChange={(e) => {
                                        if (editingIndex === null) startEditing(index);
                                        const value = e.target.value.replace(/,/g, '');
                                        updateLineItem(index, 'quantity', value);
                                      }}
                                      placeholder=""
                                      type="text"
                                      className="w-full text-xs h-8 text-right [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      style={{ MozAppearance: 'textfield' }}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      value={item.unit}
                                      onChange={(e) => {
                                        if (editingIndex === null) startEditing(index);
                                        updateLineItem(index, 'unit', e.target.value);
                                      }}
                                      placeholder="ea, sf, lf"
                                      className="w-full text-xs h-8"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      value={editingIndex === index ? (item.unitPrice || '') : (item.unitPrice ? `$${parseFloat(item.unitPrice || '0').toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '')}
                                      onChange={(e) => {
                                        if (editingIndex === null) startEditing(index);
                                        const value = e.target.value.replace(/[$,]/g, '');
                                        updateLineItem(index, 'unitPrice', value);
                                      }}
                                      onFocus={() => startEditing(index)}
                                      placeholder="0.00"
                                      type="text"
                                      className="w-full text-xs h-8 text-right"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      value={editingIndex === index ? (item.totalPrice || '') : (item.totalPrice ? `$${parseFloat(item.totalPrice || '0').toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '')}
                                      onChange={(e) => {
                                        if (editingIndex === null) startEditing(index);
                                        const value = e.target.value.replace(/[$,]/g, '');
                                        updateLineItem(index, 'totalPrice', value);
                                      }}
                                      onFocus={() => startEditing(index)}
                                      placeholder="0.00"
                                      type="text"
                                      className="w-full text-xs h-8 text-right"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      value={item.notes}
                                      onChange={(e) => {
                                        if (editingIndex === null) startEditing(index);
                                        updateLineItem(index, 'notes', e.target.value);
                                      }}
                                      placeholder="Notes"
                                      className="w-full text-xs h-8"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    {editingIndex === index ? (
                                      <div className="flex gap-1">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={saveEditing}
                                          className="h-6 w-6 p-0 text-green-600 hover:text-green-700"
                                        >
                                          <Save className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={cancelEditing}
                                          className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                                        >
                                          <X className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    ) : (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeLineItem(index)}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </TableCell>
                                </TableRow>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </TableBody>
                      )}
                    </Droppable>
                  </Table>
                </DragDropContext>
              </div>

              <div className="flex justify-end mt-4 p-3 bg-gray-50 rounded-lg">
                <div className="text-lg font-semibold text-gray-900">
                  Total: {formatCurrencyForDisplay(calculateTotal())}
                </div>
              </div>
            </div>

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea 
                      {...field}
                      placeholder="Additional notes about this bid..."
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* File Attachments - Ultra Compact */}
            <div className="space-y-1">
              <h4 className="text-xs font-medium text-gray-600">Attachments</h4>
              <FileUpload
                key={bidCollection?.id || 'new-bid'}
                onFilesSelected={setAttachments}
                initialFiles={attachments}
                multiple={true}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.msg,.eml"
                className="border border-gray-200 rounded px-2 py-1 text-xs bg-gray-50"
              />
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {attachments.map((file, index) => (
                    <div key={index} className="flex items-center gap-1 px-1 py-0.5 bg-blue-50 border border-blue-200 rounded text-xs">
                      <FileText className="h-2 w-2" />
                      <span className="max-w-[100px] truncate">{file.name}</span>
                      {/* Show download button for existing files */}
                      {bidCollection && file.id && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            const downloadUrl = `/api/bid-collections/${bidCollection.id}/attachments/${file.id}`;
                            window.open(downloadUrl, '_blank');
                          }}
                          className="h-3 w-3 p-0 hover:bg-blue-100"
                          title="Download file"
                        >
                          <Download className="h-2 w-2" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setAttachments(attachments.filter((_, i) => i !== index))}
                        className="h-3 w-3 p-0 hover:bg-red-100"
                      >
                        <X className="h-2 w-2" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Form Actions */}
            <div className="flex justify-between gap-3">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              
              <div className="flex gap-3">
                <Button type="submit" disabled={saveBidMutation.isPending}>
                  {saveBidMutation.isPending ? (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      {bidCollection ? 'Update' : 'Create'} Bid Collection
                    </>
                  )}
                </Button>
                

              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
      
      {/* Hidden file input for Excel/CSV import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFileImport}
        style={{ display: 'none' }}
      />
    </Dialog>
  );
}