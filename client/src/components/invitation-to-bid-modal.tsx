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
import { FileText, Download, Users, Save, X } from "lucide-react";
import type { RfpRequest } from "@shared/schema";

const invitationFormSchema = z.object({
  generateArchitectRfp: z.boolean().default(false),
  generateContractorRfp: z.boolean().default(false),
  projectScope: z.string().min(1, "Project scope is required"),
  projectLocation: z.string().min(1, "Project location is required"),
  estimatedBudget: z.string().optional(),
  projectTimeline: z.string().min(1, "Project timeline is required"),
  bidSubmissionDeadline: z.string().min(1, "Bid submission deadline is required"),
  projectStartDate: z.string().optional(),
  projectEndDate: z.string().optional(),
  specialRequirements: z.string().optional(),
  technicalSpecifications: z.string().optional(),
  contractTerms: z.string().optional(),
  paymentTerms: z.string().optional(),
  insuranceRequirements: z.string().optional(),
  bondingRequirements: z.string().optional(),
  prequalificationCriteria: z.string().optional(),
  evaluationCriteria: z.string().optional(),
  contactPerson: z.string().min(1, "Contact person is required"),
  contactEmail: z.string().email("Valid email is required"),
  contactPhone: z.string().optional(),
}).refine(
  (data) => data.generateArchitectRfp || data.generateContractorRfp,
  {
    message: "Select at least one RFP type to generate (Architect or Contractor)",
    path: ["generateArchitectRfp"],
  }
);

type InvitationFormData = z.infer<typeof invitationFormSchema>;

interface InvitationToBidModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfp: RfpRequest | null;
}

export function InvitationToBidModal({ isOpen, onClose, rfp }: InvitationToBidModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isGeneratingPdfs, setIsGeneratingPdfs] = useState(false);

  const form = useForm<InvitationFormData>({
    resolver: zodResolver(invitationFormSchema),
    defaultValues: {
      generateArchitectRfp: false,
      generateContractorRfp: false,
      projectScope: "",
      projectLocation: "",
      estimatedBudget: "",
      projectTimeline: "",
      bidSubmissionDeadline: "",
      projectStartDate: "",
      projectEndDate: "",
      specialRequirements: "",
      technicalSpecifications: "",
      contractTerms: "",
      paymentTerms: "",
      insuranceRequirements: "",
      bondingRequirements: "",
      prequalificationCriteria: "",
      evaluationCriteria: "",
      contactPerson: "",
      contactEmail: "",
      contactPhone: "",
    },
  });

  // Pre-populate form with existing RFP data
  useEffect(() => {
    if (rfp && isOpen) {
      form.reset({
        generateArchitectRfp: false,
        generateContractorRfp: false,
        projectScope: `${rfp.projectName} - ${rfp.tenantName}`,
        projectLocation: rfp.property || "",
        estimatedBudget: "",
        projectTimeline: "",
        bidSubmissionDeadline: "",
        projectStartDate: "",
        projectEndDate: "",
        specialRequirements: "",
        technicalSpecifications: "",
        contractTerms: "",
        paymentTerms: "",
        insuranceRequirements: "",
        bondingRequirements: "",
        prequalificationCriteria: "",
        evaluationCriteria: "",
        contactPerson: rfp.developmentContact || "",
        contactEmail: "",
        contactPhone: "",
      });
    }
  }, [rfp, isOpen, form]);

  const createInvitationMutation = useMutation({
    mutationFn: async (data: InvitationFormData) => {
      if (!rfp) throw new Error("No RFP selected");
      
      // Create invitation to bid record
      const response = await apiRequest("/api/invitation-to-bid", "POST", {
        rfpId: rfp.id,
        ...data,
      });
      
      return response.json();
    },
    onSuccess: async (invitationToBid) => {
      toast({
        title: "Invitation to Bid Created",
        description: "RFP details saved successfully. Ready to generate PDFs.",
      });
      
      // Generate PDFs based on selections
      const formData = form.getValues();
      
      if (formData.generateArchitectRfp) {
        await generatePdf("architect");
      }
      
      if (formData.generateContractorRfp) {
        await generatePdf("contractor");
      }
      
      // Update RFP status
      await apiRequest(`/api/rfp-requests/${rfp?.id}`, "PATCH", {
        status: "completed",
        workflowPhase: "completed"
      });
      
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create invitation to bid",
        variant: "destructive",
      });
    },
  });

  const generatePdf = async (recipientType: "architect" | "contractor") => {
    try {
      setIsGeneratingPdfs(true);
      
      const response = await apiRequest("/api/rfp-requests/generate-pdf", "POST", {
        rfpId: rfp?.id,
        recipientType,
        invitationData: form.getValues(),
      });
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${rfp?.rfpNumber}-${recipientType}-rfp.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "PDF Generated",
        description: `${recipientType.charAt(0).toUpperCase() + recipientType.slice(1)} RFP downloaded successfully`,
      });
    } catch (error) {
      toast({
        title: "PDF Generation Failed",
        description: error instanceof Error ? error.message : `Failed to generate ${recipientType} PDF`,
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPdfs(false);
    }
  };

  const onSubmit = (data: InvitationFormData) => {
    createInvitationMutation.mutate(data);
  };

  if (!rfp) return null;

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Invitation to Bid - Generate RFPs for Architect/Contractor
          </DialogTitle>
          <DialogDescription>
            Configure and generate RFPs for architects and/or general contractors for {rfp.rfpNumber}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            
            {/* RFP Type Selection */}
            <div className="border p-4 rounded-lg bg-gray-50">
              <h3 className="font-medium mb-3">Select RFP Types to Generate</h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="generateArchitectRfp"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Generate Architect RFP</FormLabel>
                        <p className="text-sm text-muted-foreground">
                          Create RFP for architectural services
                        </p>
                      </div>
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="generateContractorRfp"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Generate General Contractor RFP</FormLabel>
                        <p className="text-sm text-muted-foreground">
                          Create RFP for general contractor services
                        </p>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
              <FormMessage />
            </div>

            {/* Basic Project Information */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="projectScope"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Scope</FormLabel>
                    <FormControl>
                      <Input placeholder="Brief description of project scope" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="projectLocation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Location</FormLabel>
                    <FormControl>
                      <Input placeholder="Complete project address" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="estimatedBudget"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estimated Budget</FormLabel>
                    <FormControl>
                      <Input placeholder="$0.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="projectTimeline"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Timeline</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., 6 months" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="bidSubmissionDeadline"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bid Submission Deadline</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="projectStartDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Anticipated Start Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="projectEndDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Anticipated End Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Detailed Requirements */}
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="specialRequirements"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Special Requirements</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Any special requirements, certifications, or qualifications needed"
                        className="min-h-[100px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="technicalSpecifications"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Technical Specifications</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Detailed technical specifications and requirements"
                        className="min-h-[100px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Contract Terms */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="contractTerms"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contract Terms</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="General contract terms and conditions"
                        className="min-h-[80px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="paymentTerms"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Terms</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Payment schedule and terms"
                        className="min-h-[80px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="insuranceRequirements"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Insurance Requirements</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Required insurance coverage and limits"
                        className="min-h-[80px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="bondingRequirements"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bonding Requirements</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Performance and payment bond requirements"
                        className="min-h-[80px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Evaluation Criteria */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="prequalificationCriteria"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prequalification Criteria</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Minimum qualifications and experience requirements"
                        className="min-h-[80px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="evaluationCriteria"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Evaluation Criteria</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="How bids will be evaluated and scored"
                        className="min-h-[80px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Contact Information */}
            <div className="border-t pt-4">
              <h3 className="font-medium mb-3">Contact Information</h3>
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="contactPerson"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Person</FormLabel>
                      <FormControl>
                        <Input placeholder="Primary contact name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="contact@company.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="(555) 123-4567" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={createInvitationMutation.isPending || isGeneratingPdfs}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              
              <Button 
                type="submit" 
                disabled={createInvitationMutation.isPending || isGeneratingPdfs}
              >
                {isGeneratingPdfs ? (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Generating PDFs...
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4 mr-2" />
                    Generate Selected RFPs
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