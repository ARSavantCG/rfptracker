import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, AlertCircle, Download, FileText, ArrowRight, X } from "lucide-react";
import type { RfpRequest } from "@shared/schema";

const validationFormSchema = z.object({
  dueDate: z.string().min(1, "Due date is required"),
  generalContractor: z.string().optional(),
  architect: z.string().optional(),
  officeAreaExisting: z.string().optional(),
  officeAreaNew: z.string().optional(),
  warehouseArea: z.string().optional(),
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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const form = useForm<ValidationFormData>({
    resolver: zodResolver(validationFormSchema),
    defaultValues: {
      dueDate: "",
      generalContractor: "",
      architect: "",
      officeAreaExisting: "",
      officeAreaNew: "",
      warehouseArea: "",
      requestTypes: ["pricing", "schedule", "space-plan"],
      projectDescription: "",
      documentsLink: "",
    },
  });

  // Pre-populate form with existing RFP data
  useEffect(() => {
    if (rfp && isOpen) {
      form.reset({
        dueDate: "",
        generalContractor: "",
        architect: "",
        officeAreaExisting: "",
        officeAreaNew: "",
        warehouseArea: rfp.projectArea || "",
        requestTypes: rfp.requestTypes || ["pricing", "schedule", "space-plan"],
        projectDescription: "",
        documentsLink: "",
      });
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
        await apiRequest(`/api/rfp-requests/${rfp?.id}`, "PATCH", {
          workflowPhase: "invitation-to-bid",
          status: "in-progress",
          ...form.getValues()
        });
        
        queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
        queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
        
        toast({
          title: "Validation Complete",
          description: "RFP has been validated and advanced to Invitation phase",
        });
        onValidationComplete();
        onClose();
      } else {
        toast({
          title: "Validation Failed",
          description: `Please complete the required fields: ${result.errors.join(", ")}`,
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Validation Error",
        description: error instanceof Error ? error.message : "Failed to validate RFP",
        variant: "destructive",
      });
    },
  });

  const generatePdfMutation = useMutation({
    mutationFn: async (recipientType: "architect" | "contractor") => {
      if (!rfp) throw new Error("No RFP selected");
      
      const response = await apiRequest(`/api/rfp-requests/${rfp.id}/generate-pdf`, "POST", {
        recipientType,
        validationData: form.getValues(),
      });
      
      return response.blob();
    },
    onSuccess: (blob, recipientType) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${rfp?.rfpNumber}-${recipientType}-request.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "PDF Generated",
        description: `${recipientType.charAt(0).toUpperCase() + recipientType.slice(1)} request PDF downloaded successfully`,
      });
    },
    onError: (error) => {
      toast({
        title: "PDF Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate PDF",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ValidationFormData) => {
    validateMutation.mutate(data);
  };

  if (!rfp) return null;

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
            {/* Due Date */}
            <FormField
              control={form.control}
              name="dueDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Due Date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* General Contractor */}
            <FormField
              control={form.control}
              name="generalContractor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>General Contractor</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter general contractor name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Architect */}
            <FormField
              control={form.control}
              name="architect"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Architect</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter architect name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Total Rentable Area */}
            <FormField
              control={form.control}
              name="warehouseArea"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Total Rentable Area (What tenant pays rent on)</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="sq ft" 
                      {...field} 
                      className="bg-gray-50 font-medium"
                      readOnly
                    />
                  </FormControl>
                  <p className="text-sm text-gray-600">This is the total area from Step 1</p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Office Areas within the Rentable Area */}
            <div className="border rounded-lg p-4 bg-blue-50">
              <h4 className="font-medium text-blue-900 mb-3">Office Areas (within the total rentable area)</h4>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="officeAreaExisting"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Office Area (Existing)</FormLabel>
                      <FormControl>
                        <Input placeholder="sq ft" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="officeAreaNew"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Office Area (New Construction)</FormLabel>
                      <FormControl>
                        <Input placeholder="sq ft" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              {/* Calculation Display */}
              <div className="mt-3 p-3 bg-white rounded border text-sm">
                <div className="flex justify-between">
                  <span>Total Rentable Area:</span>
                  <span className="font-medium">{form.watch('warehouseArea') || '0'} sq ft</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>- Office (Existing):</span>
                  <span>{form.watch('officeAreaExisting') || '0'} sq ft</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>- Office (New):</span>
                  <span>{form.watch('officeAreaNew') || '0'} sq ft</span>
                </div>
                <div className="border-t pt-2 mt-2 flex justify-between font-medium">
                  <span>Remaining Warehouse Area:</span>
                  <span>
                    {(() => {
                      const total = parseInt(form.watch('warehouseArea')?.replace(/,/g, '') || '0');
                      const existing = parseInt(form.watch('officeAreaExisting')?.replace(/,/g, '') || '0');
                      const newOffice = parseInt(form.watch('officeAreaNew')?.replace(/,/g, '') || '0');
                      const remaining = total - existing - newOffice;
                      return remaining.toLocaleString();
                    })()} sq ft
                  </span>
                </div>
              </div>
            </div>

            {/* Request Types */}
            <FormField
              control={form.control}
              name="requestTypes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Request (Pricing, Schedule, Space Plan)</FormLabel>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {["pricing", "schedule", "space-plan"].map((type) => (
                      <div key={type} className="flex items-center space-x-2">
                        <Checkbox
                          id={type}
                          checked={field.value?.includes(type)}
                          onCheckedChange={(checked) => {
                            const currentTypes = field.value || [];
                            if (checked) {
                              field.onChange([...currentTypes, type]);
                            } else {
                              field.onChange(currentTypes.filter((t) => t !== type));
                            }
                          }}
                        />
                        <label
                          htmlFor={type}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 capitalize"
                        >
                          {type.replace("-", " ")}
                        </label>
                      </div>
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
                  <FormLabel>Project Description</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Detailed description of the project scope, requirements, and deliverables" 
                      className="min-h-[100px]" 
                      {...field} 
                    />
                  </FormControl>
                  <p className="text-sm text-gray-600">This description will be used in contractor and architect invitations</p>
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
                  <FormLabel>Documents Link</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="https://sharepoint.com/project-documents or similar link" 
                      {...field} 
                    />
                  </FormControl>
                  <p className="text-sm text-gray-600">Link to project drawings, specifications, and related documents</p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Validation Result */}
            {validationResult && (
              <div className={`p-4 rounded-lg border ${
                validationResult.isValid 
                  ? "bg-green-50 border-green-200" 
                  : "bg-red-50 border-red-200"
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {validationResult.isValid ? (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-red-600" />
                  )}
                  <span className={`font-medium ${
                    validationResult.isValid ? "text-green-800" : "text-red-800"
                  }`}>
                    {validationResult.isValid ? "Validation Successful" : "Validation Failed"}
                  </span>
                </div>
                {!validationResult.isValid && validationResult.errors.length > 0 && (
                  <ul className="text-sm text-red-700 list-disc list-inside">
                    {validationResult.errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-2">
                  <div className="text-sm text-gray-600 mb-1">
                    Completion: {validationResult.completionPercentage}%
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full ${
                        validationResult.isValid ? "bg-green-600" : "bg-red-600"
                      }`}
                      style={{ width: `${validationResult.completionPercentage}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between pt-4">
              <div className="flex space-x-2">
                {validationResult?.isValid && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => generatePdfMutation.mutate("architect")}
                      disabled={generatePdfMutation.isPending}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Generate Architect PDF
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => generatePdfMutation.mutate("contractor")}
                      disabled={generatePdfMutation.isPending}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Generate Contractor PDF
                    </Button>
                  </>
                )}
              </div>

              <div className="flex space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={validateMutation.isPending}
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={validateMutation.isPending}
                >
                  <ArrowRight className="h-4 w-4 mr-2" />
                  {validateMutation.isPending ? "Validating..." : "Validate & Advance"}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}