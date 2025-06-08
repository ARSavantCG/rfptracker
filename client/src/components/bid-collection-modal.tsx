import { useState, useEffect } from "react";
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
import { Plus, Trash2, Upload, FileText, Save, X } from "lucide-react";
import { FileUpload } from "./file-upload";
import { useToast } from "@/hooks/use-toast";
import type { RfpRequest, Contact, BidCollection, BidLineItem } from "@shared/schema";

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
  category: z.string().min(1, "Category is required"),
  description: z.string().min(1, "Description is required"),
  quantity: z.string().optional(),
  unit: z.string().optional(),
  unitPrice: z.string().optional(),
  totalPrice: z.string().min(1, "Total price is required"),
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
  const [lineItems, setLineItems] = useState<LineItemFormData[]>([
    { category: "Labor", description: "", quantity: "", unit: "", unitPrice: "", totalPrice: "", notes: "" }
  ]);

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
        submissionDate: new Date(bidCollection.submissionDate).toISOString().split('T')[0],
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
    } else if (!bidCollection && isOpen) {
      // Reset to defaults for new bid collection
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
      setLineItems([
        { category: "Labor", description: "", quantity: "", unit: "", unitPrice: "", totalPrice: "", notes: "" }
      ]);
    }
  }, [bidCollection, isOpen, form, existingLineItems]);

  // Create/Update bid collection mutation
  const saveBidMutation = useMutation({
    mutationFn: async (data: BidCollectionFormData & { lineItems: LineItemFormData[], attachments: File[] }) => {
      const formData = new FormData();
      
      // Prepare bid data object (excluding lineItems and attachments)
      const bidData = {
        contractorId: data.contractorId,
        contractorName: data.contractorName,
        contractorCompany: data.contractorCompany,
        contractorEmail: data.contractorEmail,
        submissionDate: new Date(data.submissionDate),
        totalAmount: data.totalAmount,
        status: data.status,
        notes: data.notes,
      };
      
      const method = bidCollection ? 'PUT' : 'POST';
      const url = bidCollection 
        ? `/api/rfp-requests/${rfp?.id}/bid-collections/${bidCollection.id}`
        : `/api/rfp-requests/${rfp?.id}/bid-collections`;

      let response;

      if (bidCollection) {
        // For updates, send JSON data
        response = await fetch(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bidData),
        });
      } else {
        // For creation, use FormData for file uploads
        const formData = new FormData();
        
        // Add bid collection data as JSON string
        formData.append('bidData', JSON.stringify(bidData));
        
        // Add line items as JSON string
        formData.append('lineItems', JSON.stringify(data.lineItems));
        
        // Add attachments
        data.attachments.forEach((file, index) => {
          formData.append(`attachment_${index}`, file);
        });

        response = await fetch(url, {
          method: 'POST',
          body: formData,
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
    // Ensure contractorId is a number
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
      category: "Materials",
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

  const calculateTotal = () => {
    return lineItems.reduce((sum, item) => {
      return sum + parseFloat(item.totalPrice || '0');
    }, 0).toFixed(2);
  };

  if (!rfp) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
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
                    <FormLabel>Bidder (Contractor/Architect)</FormLabel>
                    <Select 
                      onValueChange={(value) => {
                        field.onChange(value);
                        handleContractorSelect(value);
                      }}
                      value={field.value?.toString()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select bidder (contractor or architect)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {allBidders.length > 0 ? (
                          allBidders.map((bidder) => (
                            <SelectItem key={bidder.id} value={bidder.id.toString()}>
                              {bidder.name} - {bidder.company} ({bidder.type})
                            </SelectItem>
                          ))
                        ) : (
                          <div className="px-2 py-1 text-sm text-gray-500">
                            No bidders available
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Submission Date */}
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

              {/* Status */}
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="received">Received</SelectItem>
                        <SelectItem value="under-review">Under Review</SelectItem>
                        <SelectItem value="shortlisted">Shortlisted</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                        <SelectItem value="awarded">Awarded</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Total Amount */}
              <FormField
                control={form.control}
                name="totalAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Amount</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="Calculated from line items"
                        value={calculateTotal()}
                        readOnly
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Contractor Details */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="contractorName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contractor Name</FormLabel>
                    <FormControl>
                      <Input {...field} readOnly className="bg-gray-50" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="contractorCompany"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company</FormLabel>
                    <FormControl>
                      <Input {...field} readOnly className="bg-gray-50" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="contractorEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input {...field} readOnly className="bg-gray-50" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Additional notes about this bid..." />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Line Items Table */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Pricing Breakdown</h3>
                <Button type="button" onClick={addLineItem} variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Line Item
                </Button>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Unit Price</TableHead>
                      <TableHead>Total Price</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineItems.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Select 
                            value={item.category} 
                            onValueChange={(value) => updateLineItem(index, 'category', value)}
                          >
                            <SelectTrigger className="min-w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Labor">Labor</SelectItem>
                              <SelectItem value="Materials">Materials</SelectItem>
                              <SelectItem value="Equipment">Equipment</SelectItem>
                              <SelectItem value="Permits">Permits</SelectItem>
                              <SelectItem value="Other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.description}
                            onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                            placeholder="Description"
                            className="min-w-[200px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.quantity}
                            onChange={(e) => updateLineItem(index, 'quantity', e.target.value)}
                            placeholder="0"
                            type="number"
                            className="w-[80px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.unit}
                            onChange={(e) => updateLineItem(index, 'unit', e.target.value)}
                            placeholder="ea, sf, lf"
                            className="w-[80px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.unitPrice}
                            onChange={(e) => updateLineItem(index, 'unitPrice', e.target.value)}
                            placeholder="0.00"
                            type="number"
                            step="0.01"
                            className="w-[100px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.totalPrice}
                            onChange={(e) => updateLineItem(index, 'totalPrice', e.target.value)}
                            placeholder="0.00"
                            type="number"
                            step="0.01"
                            className="w-[100px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.notes}
                            onChange={(e) => updateLineItem(index, 'notes', e.target.value)}
                            placeholder="Notes"
                            className="min-w-[150px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLineItem(index)}
                            disabled={lineItems.length === 1}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end">
                <div className="text-lg font-semibold">
                  Total: ${calculateTotal()}
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
                onFilesSelected={setAttachments}
                multiple={true}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                className="border border-gray-200 rounded px-2 py-1 text-xs bg-gray-50"
              />
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {attachments.map((file, index) => (
                    <div key={index} className="flex items-center gap-1 px-1 py-0.5 bg-blue-50 border border-blue-200 rounded text-xs">
                      <FileText className="h-2 w-2" />
                      <span className="max-w-[100px] truncate">{file.name}</span>
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
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveBidMutation.isPending}>
                {saveBidMutation.isPending ? (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    {bidCollection ? 'Update' : 'Save'} Bid
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}