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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, AlertCircle, Download, FileText, ArrowRight, X } from "lucide-react";
import type { RfpRequest } from "@shared/schema";

const validationFormSchema = z.object({
  projectAddress: z.string().min(1, "Project address is required"),
  projectSize: z.string().min(1, "Project size is required"),
  estimatedValue: z.string().min(1, "Estimated value is required"),
  timelineRequirements: z.string().min(1, "Timeline requirements are required"),
  specialRequirements: z.string().optional(),
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
      projectAddress: "",
      projectSize: "",
      estimatedValue: "",
      timelineRequirements: "",
      specialRequirements: "",
    },
  });

  // Pre-populate form with existing RFP data
  useEffect(() => {
    if (rfp && isOpen) {
      form.reset({
        projectAddress: rfp.projectAddress || "",
        projectSize: rfp.projectSize || "",
        estimatedValue: rfp.estimatedValue || "",
        timelineRequirements: rfp.timelineRequirements || "",
        specialRequirements: rfp.specialRequirements || "",
      });
    }
  }, [rfp, isOpen, form]);

  // Validate RFP on form changes
  useEffect(() => {
    if (rfp) {
      validateCurrentData();
    }
  }, [rfp, form.watch()]);

  const validateCurrentData = async () => {
    if (!rfp) return;

    const formData = form.getValues();
    const updatedRfp = { ...rfp, ...formData };

    try {
      const response = await fetch("/api/rfp-requests/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedRfp),
      });

      if (response.ok) {
        const result = await response.json();
        setValidationResult(result);
      }
    } catch (error) {
      console.error("Validation failed:", error);
    }
  };

  const updateRfpMutation = useMutation({
    mutationFn: async (data: ValidationFormData) => {
      if (!rfp) throw new Error("No RFP selected");
      
      return apiRequest(`/api/rfp-requests/${rfp.id}`, "PATCH", {
        ...data,
        isValidated: validationResult?.isValid || false,
        validationErrors: validationResult?.errors || [],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      toast({
        title: "RFP Updated",
        description: "RFP information has been saved successfully",
      });
      onValidationComplete();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update RFP information",
        variant: "destructive",
      });
    },
  });

  const generatePdfMutation = useMutation({
    mutationFn: async ({ recipientType }: { recipientType: "architect" | "contractor" }) => {
      if (!rfp) throw new Error("No RFP selected");
      
      setIsGeneratingPdf(true);
      const response = await fetch(`/api/rfp-requests/${rfp.id}/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientType }),
      });

      if (!response.ok) throw new Error("Failed to generate PDF");
      
      const blob = await response.blob();
      return { blob, recipientType };
    },
    onSuccess: ({ blob, recipientType }) => {
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${rfp?.rfpNumber}_${recipientType}_communication.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "PDF Generated",
        description: `Communication document for ${recipientType} has been downloaded`,
      });
      setIsGeneratingPdf(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to generate PDF document",
        variant: "destructive",
      });
      setIsGeneratingPdf(false);
    },
  });

  const onSubmit = (data: ValidationFormData) => {
    updateRfpMutation.mutate(data);
  };

  const handleAdvanceWorkflow = async () => {
    if (!rfp || !validationResult?.isValid) return;

    try {
      await apiRequest(`/api/rfp-requests/${rfp.id}/workflow-phase`, "PATCH", {
        phase: "invitation-to-bid"
      });
      
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      toast({
        title: "Workflow Advanced",
        description: "RFP has been moved to Invitation to Bid phase",
      });
      
      onClose();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to advance workflow phase",
        variant: "destructive",
      });
    }
  };

  const handleClose = () => {
    form.reset();
    setValidationResult(null);
    onClose();
  };

  if (!rfp) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            RFP Validation & Progression - {rfp.rfpNumber}
          </DialogTitle>
          <DialogDescription>
            Complete all required fields to validate the RFP and advance to the next workflow phase
          </DialogDescription>
        </DialogHeader>

        {/* Validation Status */}
        {validationResult && (
          <div className={`p-4 rounded-lg border ${
            validationResult.isValid 
              ? 'bg-green-50 border-green-200' 
              : 'bg-orange-50 border-orange-200'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              {validationResult.isValid ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-orange-600" />
              )}
              <span className={`font-medium ${
                validationResult.isValid ? 'text-green-800' : 'text-orange-800'
              }`}>
                {validationResult.isValid ? 'RFP is Valid' : 'RFP Validation Required'}
              </span>
              <span className="text-sm text-gray-600">
                ({validationResult.completionPercentage}% complete)
              </span>
            </div>
            
            {validationResult.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-sm font-medium text-orange-800 mb-1">Issues to resolve:</p>
                <ul className="text-sm text-orange-700 list-disc list-inside">
                  {validationResult.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Project Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Project Details</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="projectAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Address *</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Complete project address"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="projectSize"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Size *</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="e.g., 25,000 sq ft"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="estimatedValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estimated Project Value *</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="e.g., $500,000 - $750,000"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="timelineRequirements"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timeline Requirements *</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="e.g., 12-week completion"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="specialRequirements"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Special Requirements</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Any special requirements, constraints, or considerations"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Current RFP Information Display */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Current RFP Information</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-700">Property</p>
                  <p className="text-sm text-gray-600">{rfp.property}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Tenant Name</p>
                  <p className="text-sm text-gray-600">{rfp.tenantName}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Project Name</p>
                  <p className="text-sm text-gray-600">{rfp.projectName}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Sent By</p>
                  <p className="text-sm text-gray-600">{rfp.sentBy}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Request Types</p>
                  <p className="text-sm text-gray-600">{rfp.requestTypes.join(", ")}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Due Date</p>
                  <p className="text-sm text-gray-600">
                    {rfp.dueDate ? new Date(rfp.dueDate).toLocaleDateString() : "Not specified"}
                  </p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row justify-between gap-4 pt-6 border-t">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => generatePdfMutation.mutate({ recipientType: "architect" })}
                  disabled={isGeneratingPdf}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Generate PDF for Architect
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => generatePdfMutation.mutate({ recipientType: "contractor" })}
                  disabled={isGeneratingPdf}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Generate PDF for Contractor
                </Button>
              </div>

              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={handleClose}>
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={updateRfpMutation.isPending}
                >
                  Save Information
                </Button>
                {validationResult?.isValid && (
                  <Button 
                    type="button"
                    onClick={handleAdvanceWorkflow}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <ArrowRight className="h-4 w-4 mr-2" />
                    Advance to Invitation Phase
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}