import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, AlertCircle, Download, FileText, ArrowRight, X, Plus, Trash2, Edit2, CalendarIcon } from "lucide-react";
import { nanoid } from "nanoid";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { RfpRequest, Contact } from "@shared/schema";

const areaLineItemSchema = z.object({
  id: z.string(),
  description: z.string().min(1, "Area description is required"),
  squareFootage: z.string().min(1, "Square footage is required"),
  notes: z.string().optional(),
});

const validationFormSchema = z.object({
  contractorDueDate: z.string().min(1, "Contractor due date is required"),
  architectDueDate: z.string().min(1, "Architect due date is required"),
  generalContractor: z.string().optional(),
  architect: z.string().optional(),
  warehouseArea: z.string().optional(),
  warehouseNotes: z.string().optional(),
  areaBreakdown: z.array(areaLineItemSchema),
  requestTypes: z.array(z.string()).min(1, "At least one request type is required"),
  projectDescription: z.string().optional(),
  documentsLink: z.string().optional(),
});

type ValidationFormData = z.infer<typeof validationFormSchema>;

interface RfpValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfp: RfpRequest | null;
  onValidationComplete: () => void;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  completionPercentage: number;
}

export function RfpValidationModal({ isOpen, onClose, rfp, onValidationComplete }: RfpValidationModalProps) {
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isEditingTotalArea, setIsEditingTotalArea] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  // Filter contacts by type
  const contractors = contacts.filter(contact => contact.type === "contractor");
  const architects = contacts.filter(contact => contact.type === "architect");

  const form = useForm<ValidationFormData>({
    resolver: zodResolver(validationFormSchema),
    defaultValues: {
      contractorDueDate: "",
      architectDueDate: "",
      generalContractor: "",
      architect: "",
      warehouseArea: "",
      warehouseNotes: "",
      areaBreakdown: [],
      requestTypes: ["pricing", "schedule", "space-plan"],
      projectDescription: "",
      documentsLink: "",
    },
  });

  // Pre-populate form with existing RFP data
  useEffect(() => {
    if (rfp && isOpen) {
      // Extract numeric value from project area string (e.g., "409,189 SF (calculated...)" -> "409189")
      const projectAreaValue = rfp.projectArea ? 
        rfp.projectArea.replace(/[^\d,]/g, '').replace(/,/g, '') : "";
      
      console.log('Populating form with RFP data:', { 
        projectArea: rfp.projectArea, 
        extracted: projectAreaValue,
        isEmpty: !projectAreaValue 
      });
      
      // Convert existing office areas to area breakdown format
      const areaBreakdown = [];
      if (rfp.officeAreaExisting) {
        areaBreakdown.push({
          id: nanoid(),
          description: "Office Area (Existing)",
          squareFootage: rfp.officeAreaExisting,
          notes: ""
        });
      }
      if (rfp.officeAreaNew) {
        areaBreakdown.push({
          id: nanoid(),
          description: "Office Area (New Construction)",
          squareFootage: rfp.officeAreaNew,
          notes: ""
        });
      }

      form.reset({
        contractorDueDate: rfp.contractorDueDate ? new Date(rfp.contractorDueDate).toISOString().split('T')[0] : "",
        architectDueDate: rfp.architectDueDate ? new Date(rfp.architectDueDate).toISOString().split('T')[0] : "",
        generalContractor: rfp.generalContractor || "",
        architect: rfp.architect || "",
        warehouseArea: rfp.warehouseArea || projectAreaValue,
        warehouseNotes: (rfp as any).warehouseNotes || "",
        areaBreakdown: (rfp as any).areaBreakdown || areaBreakdown,
        requestTypes: rfp.requestTypes || ["pricing", "schedule", "space-plan"],
        projectDescription: rfp.projectDescription || "",
        documentsLink: rfp.documentsLink || "",
      });
      
      // Use saved warehouse area if available, otherwise default to project area
      const warehouseAreaValue = rfp.warehouseArea || projectAreaValue;
      form.setValue('warehouseArea', warehouseAreaValue);
    }
  }, [rfp, isOpen, form]);

  const validateMutation = useMutation({
    mutationFn: async (data: ValidationFormData) => {
      if (!rfp) throw new Error("No RFP selected");
      return apiRequest("/api/rfp-requests/validate", "POST", {
        rfpId: rfp.id,
        ...data,
      });
    },
    onSuccess: async (response) => {
      const result = await response.json();
      setValidationResult(result);
      
      if (result.isValid) {
        // Update the RFP with validation data and advance workflow phase
        const formData = form.getValues();
        await apiRequest(`/api/rfp-requests/${rfp?.id}`, "PATCH", {
          workflowPhase: "invitation-to-bid",
          status: "in-progress",
          contractorDueDate: new Date(formData.contractorDueDate).toISOString(),
          architectDueDate: new Date(formData.architectDueDate).toISOString(),
          generalContractor: formData.generalContractor,
          architect: formData.architect,
          warehouseArea: formData.warehouseArea,
          warehouseNotes: formData.warehouseNotes,
          areaBreakdown: formData.areaBreakdown,
          requestTypes: formData.requestTypes,
          projectDescription: formData.projectDescription,
          documentsLink: formData.documentsLink,
        });
        
        queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
        
        toast({
          title: "Validation Complete",
          description: "RFP validated successfully. Advancing to invitation phase.",
        });
        
        // Close this modal and trigger the invitation modal
        onClose();
        onValidationComplete();
      } else {
        toast({
          title: "Validation Issues Found",
          description: `${result.errors.length} issues need to be addressed before proceeding.`,
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Validation Failed",
        description: "An error occurred during validation.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ValidationFormData) => {
    validateMutation.mutate(data);
  };

  const handleClose = () => {
    setValidationResult(null);
    form.reset();
    onClose();
  };

  if (!rfp) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Step 2: Issuance to General Contractor and/or Architect
          </DialogTitle>
          <DialogDescription>
            Complete the details needed to generate requests for your General Contractor and/or Architect
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Due Dates - Side by Side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="contractorDueDate"
                render={({ field }) => {
                  const internalDueDate = rfp?.internalDueDate ? new Date(rfp.internalDueDate) : null;
                  return (
                    <FormItem className="flex flex-col">
                      <FormLabel>Contractor Due Date</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? (
                                format(new Date(field.value), "PPP")
                              ) : (
                                <span>Pick a date</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value ? (() => {
                              const [year, month, day] = field.value.split('-');
                              return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                            })() : undefined}
                            onSelect={(date) => {
                              if (date) {
                                const year = date.getFullYear();
                                const month = String(date.getMonth() + 1).padStart(2, '0');
                                const day = String(date.getDate()).padStart(2, '0');
                                const dateString = `${year}-${month}-${day}`;
                                field.onChange(dateString);
                                // Auto-populate architect due date if it's empty
                                if (!form.getValues('architectDueDate')) {
                                  form.setValue('architectDueDate', dateString);
                                }
                              } else {
                                field.onChange("");
                              }
                            }}
                            disabled={(date) => {
                              const today = new Date();
                              today.setHours(0, 0, 0, 0);
                              return date < today || date < new Date("1900-01-01");
                            }}
                            initialFocus
                            modifiers={internalDueDate ? {
                              internalDue: (() => {
                                const isoString = internalDueDate.toISOString().split('T')[0];
                                const [year, month, day] = isoString.split('-');
                                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                              })()
                            } : {}}
                            modifiersStyles={internalDueDate ? {
                              internalDue: {
                                border: '2px solid #3b82f6',
                                backgroundColor: '#dbeafe',
                                fontWeight: 'bold'
                              }
                            } : {}}
                          />
                          {internalDueDate && (
                            <div className="p-3 border-t bg-blue-50">
                              <p className="text-xs text-blue-600 font-medium">
                                📅 Internal Due: {format(internalDueDate, "MMM d, yyyy")}
                              </p>
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              <FormField
                control={form.control}
                name="architectDueDate"
                render={({ field }) => {
                  const internalDueDate = rfp?.internalDueDate ? new Date(rfp.internalDueDate) : null;
                  return (
                    <FormItem className="flex flex-col">
                      <FormLabel>Architect Due Date</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? (
                                format(new Date(field.value), "PPP")
                              ) : (
                                <span>Pick a date</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value ? (() => {
                              const [year, month, day] = field.value.split('-');
                              return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                            })() : undefined}
                            onSelect={(date) => {
                              if (date) {
                                const year = date.getFullYear();
                                const month = String(date.getMonth() + 1).padStart(2, '0');
                                const day = String(date.getDate()).padStart(2, '0');
                                const dateString = `${year}-${month}-${day}`;
                                field.onChange(dateString);
                              } else {
                                field.onChange("");
                              }
                            }}
                            disabled={(date) => {
                              const today = new Date();
                              today.setHours(0, 0, 0, 0);
                              return date < today || date < new Date("1900-01-01");
                            }}
                            initialFocus
                            modifiers={internalDueDate ? {
                              internalDue: (() => {
                                const isoString = internalDueDate.toISOString().split('T')[0];
                                const [year, month, day] = isoString.split('-');
                                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                              })()
                            } : {}}
                            modifiersStyles={internalDueDate ? {
                              internalDue: {
                                border: '2px solid #3b82f6',
                                backgroundColor: '#dbeafe',
                                fontWeight: 'bold'
                              }
                            } : {}}
                          />
                          {internalDueDate && (
                            <div className="p-3 border-t bg-blue-50">
                              <p className="text-xs text-blue-600 font-medium">
                                📅 Internal Due: {format(internalDueDate, "MMM d, yyyy")}
                              </p>
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>

            {/* General Contractor and Architect - Side by Side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="generalContractor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>General Contractor</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select general contractor" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {contractors.map((contractor) => (
                          <SelectItem key={contractor.id} value={contractor.name}>
                            {contractor.name} - {contractor.company}
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
                name="architect"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Architect</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select architect" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {architects.map((architect) => (
                          <SelectItem key={architect.id} value={architect.name}>
                            {architect.name} - {architect.company}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Total Rentable Area */}
            <FormField
              control={form.control}
              name="warehouseArea"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Total Rentable Area (What tenant pays rent on)</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="Enter total area in sq ft" 
                        readOnly={!isEditingTotalArea}
                        className={!isEditingTotalArea ? "bg-gray-50" : ""}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditingTotalArea(!isEditingTotalArea)}
                      className="flex items-center gap-1"
                    >
                      <Edit2 className="h-4 w-4" />
                      {isEditingTotalArea ? "Lock" : "Edit"}
                    </Button>
                  </div>
                  <FormMessage />
                  <p className="text-sm text-gray-500">From Step 1: {rfp.projectArea} - use edit button to modify if needed</p>
                </FormItem>
              )}
            />

            {/* Area Breakdown */}
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold">Area Breakdown</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const currentBreakdown = form.getValues('areaBreakdown');
                    form.setValue('areaBreakdown', [
                      ...currentBreakdown,
                      {
                        id: nanoid(),
                        description: '',
                        squareFootage: '',
                        notes: ''
                      }
                    ]);
                  }}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Area
                </Button>
              </div>

              <FormField
                control={form.control}
                name="areaBreakdown"
                render={({ field }) => (
                  <FormItem>
                    <div className="space-y-3">
                      {/* Headers - only show once */}
                      {field.value.length > 0 && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 px-3">
                          <FormLabel className="text-sm font-medium">Area Description</FormLabel>
                          <FormLabel className="text-sm font-medium">Square Footage</FormLabel>
                          <FormLabel className="text-sm font-medium">Notes</FormLabel>
                        </div>
                      )}
                      
                      {field.value.map((item, index) => (
                        <div key={item.id} className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-3 bg-white rounded border">
                          <div>
                            <Input
                              placeholder="e.g., Office Area (Existing), Conference Room, etc."
                              value={item.description}
                              onChange={(e) => {
                                const newBreakdown = [...field.value];
                                newBreakdown[index] = { ...item, description: e.target.value };
                                field.onChange(newBreakdown);
                              }}
                            />
                          </div>
                          <div>
                            <Input
                              placeholder="sq ft"
                              value={item.squareFootage}
                              onChange={(e) => {
                                const newBreakdown = [...field.value];
                                newBreakdown[index] = { ...item, squareFootage: e.target.value };
                                field.onChange(newBreakdown);
                              }}
                            />
                          </div>
                          <div className="flex gap-2 items-end">
                            <div className="flex-1">
                              <Input
                                placeholder="e.g., Clear height requirements TBD, Renovation level TBD"
                                value={item.notes}
                                onChange={(e) => {
                                  const newBreakdown = [...field.value];
                                  newBreakdown[index] = { ...item, notes: e.target.value };
                                  field.onChange(newBreakdown);
                                }}
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                const newBreakdown = field.value.filter((_, i) => i !== index);
                                field.onChange(newBreakdown);
                              }}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      
                      {field.value.length === 0 && (
                        <div className="text-center py-6 text-gray-500">
                          <p className="mb-2">No areas added yet</p>
                          <p className="text-sm">Some tenants don't need any office areas - add as needed</p>
                        </div>
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Area Calculations */}
              <div className="space-y-2 text-sm mt-4 border-t pt-4">
                <div className="flex justify-between font-medium">
                  <span>Total Rentable Area:</span>
                  <span>{form.watch('warehouseArea') || '0'} sq ft</span>
                </div>
                {form.watch('areaBreakdown').map((item, index) => (
                  <div key={item.id} className="grid grid-cols-3 gap-2 text-sm">
                    <span>- {item.description || `Area ${index + 1}`}</span>
                    <span className="text-right">{item.squareFootage || '0'} sq ft</span>
                    <span className="text-gray-600 text-xs">{item.notes || ''}</span>
                  </div>
                ))}
                <div className="flex justify-between font-medium border-t pt-2">
                  <span>Remaining Warehouse Area:</span>
                  <span>
                    {Math.max(0, 
                      parseInt(form.watch('warehouseArea') || '0') - 
                      form.watch('areaBreakdown').reduce((sum, item) => sum + (parseInt(item.squareFootage) || 0), 0)
                    ).toLocaleString()} sq ft
                  </span>
                </div>
              </div>
            </div>

            {/* Warehouse Notes */}
            <FormField
              control={form.control}
              name="warehouseNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Warehouse Notes</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., Clear height requirements TBD" />
                  </FormControl>
                  <FormMessage />
                  <p className="text-sm text-gray-500">Notes that will appear in the PDF for the warehouse area</p>
                </FormItem>
              )}
            />

            {/* Request Types */}
            <FormField
              control={form.control}
              name="requestTypes"
              render={() => (
                <FormItem>
                  <FormLabel>Request (Pricing, Schedule, Space Plan)</FormLabel>
                  <div className="flex flex-wrap gap-4">
                    {[
                      { id: "pricing", label: "Pricing" },
                      { id: "schedule", label: "Schedule" },
                      { id: "space-plan", label: "Space Plan" },
                    ].map((item) => (
                      <FormField
                        key={item.id}
                        control={form.control}
                        name="requestTypes"
                        render={({ field }) => {
                          return (
                            <FormItem
                              key={item.id}
                              className="flex flex-row items-start space-x-3 space-y-0"
                            >
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(item.id)}
                                  onCheckedChange={(checked) => {
                                    return checked
                                      ? field.onChange([...field.value, item.id])
                                      : field.onChange(
                                          field.value?.filter(
                                            (value) => value !== item.id
                                          )
                                        )
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="font-normal">
                                {item.label}
                              </FormLabel>
                            </FormItem>
                          )
                        }}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Project Description */}
            <FormField
              control={form.control}
              name="projectDescription"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Additional project details..." />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Documents Link */}
            <FormField
              control={form.control}
              name="documentsLink"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Documents Link (Optional)</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="https://..." />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Validation Results */}
            {validationResult && (
              <div className={`p-4 rounded-lg border ${
                validationResult.isValid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {validationResult.isValid ? (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-red-600" />
                  )}
                  <h4 className="font-semibold">
                    {validationResult.isValid ? 'Validation Passed' : 'Validation Issues'}
                  </h4>
                </div>
                {!validationResult.isValid && (
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    {validationResult.errors.map((error, index) => (
                      <li key={index} className="text-red-700">{error}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-2">
                  <div className="text-sm text-gray-600">
                    Completion: {validationResult.completionPercentage}%
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                    <div 
                      className={`h-2 rounded-full ${
                        validationResult.isValid ? 'bg-green-600' : 'bg-red-600'
                      }`}
                      style={{ width: `${validationResult.completionPercentage}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4 justify-end">
              <Button 
                type="submit" 
                disabled={validateMutation.isPending}
                size="sm"
              >
                {validateMutation.isPending ? (
                  "Validating..."
                ) : validationResult?.isValid ? (
                  <>
                    <ArrowRight className="h-4 w-4 mr-2" />
                    Proceed to Invitations
                  </>
                ) : (
                  "Validate & Continue"
                )}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleClose}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}