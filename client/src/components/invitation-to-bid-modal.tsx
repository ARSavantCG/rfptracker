import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { FileText, Download, Users, Save, X, CheckCircle } from "lucide-react";
import type { RfpRequest, Property, Contact } from "@shared/schema";

const invitationFormSchema = z.object({
  generateArchitectRfp: z.boolean().default(false),
  generateContractorRfp: z.boolean().default(false),
  generateBrokerArchitectRfp: z.boolean().default(false),
  generateBrokerContractorRfp: z.boolean().default(false),
  projectScope: z.string().min(1, "Project scope is required"),
  projectLocation: z.string().min(1, "Project location is required"),
  estimatedBudget: z.string().optional(),
  projectTimeline: z.string().min(1, "Project timeline is required"),
  bidSubmissionDeadline: z.string().min(1, "Bid submission deadline is required"),

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
  projectDescription: z.string().optional(),
  documentsLink: z.string().optional(),
  keyDates: z.array(z.object({
    label: z.string(),
    date: z.string()
  })).default([]),
}).refine(
  (data) => data.generateArchitectRfp || data.generateContractorRfp || data.generateBrokerArchitectRfp || data.generateBrokerContractorRfp,
  {
    message: "Select at least one RFP type to generate",
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
  const [keyDates, setKeyDates] = useState<Array<{label: string, date: string}>>([]);

  // Fetch properties for project location
  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  // Fetch contacts to get full contact details
  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  // Helper function to get property address
  const getPropertyAddress = (propertyId: string) => {
    const property = properties.find(p => p.id.toString() === propertyId);
    return property ? `${property.streetAddress}, ${property.city}, ${property.state} ${property.zip}` : "";
  };

  // Helper function to get development contact details
  const getDevelopmentContactDetails = (developmentContact: string) => {
    if (!developmentContact) return { name: "", email: "", phone: "" };
    
    // Extract just the name part (before " - " if it exists)
    const contactName = developmentContact.split(' - ')[0].trim();
    
    // Find matching contact in the database
    const contact = contacts.find(c => c.name.toLowerCase() === contactName.toLowerCase());
    
    return {
      name: contact?.name || contactName,
      email: contact?.email || "",
      phone: contact?.phone || ""
    };
  };

  const form = useForm<InvitationFormData>({
    resolver: zodResolver(invitationFormSchema),
    defaultValues: {
      generateArchitectRfp: false,
      generateContractorRfp: false,
      generateBrokerArchitectRfp: false,
      generateBrokerContractorRfp: false,
      projectScope: "",
      projectLocation: "",
      estimatedBudget: "",
      projectTimeline: "",
      bidSubmissionDeadline: "",
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

  // Fetch existing invitation data
  const { data: existingInvitation } = useQuery({
    queryKey: ["/api/rfp-requests", rfp?.id, "invitation-to-bid"],
    queryFn: async () => {
      if (!rfp?.id) return null;
      const response = await fetch(`/api/rfp-requests/${rfp.id}/invitation-to-bid`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!rfp?.id && isOpen,
  });

  // Pre-populate form with existing data
  useEffect(() => {
    if (rfp && isOpen && properties.length > 0 && contacts.length > 0) {
      const defaultValues = {
        generateArchitectRfp: false,
        generateContractorRfp: false,
        generateBrokerArchitectRfp: false,
        generateBrokerContractorRfp: false,
        projectScope: `${rfp.projectName} - ${rfp.tenantName}`,
        projectLocation: getPropertyAddress(rfp.property) || "",
        estimatedBudget: "",
        projectTimeline: "",
        bidSubmissionDeadline: "",
        specialRequirements: "",
        technicalSpecifications: "",
        contractTerms: "",
        paymentTerms: "",
        insuranceRequirements: "",
        bondingRequirements: "",
        prequalificationCriteria: "",
        evaluationCriteria: "",
        ...(() => {
          const contactDetails = getDevelopmentContactDetails(rfp.developmentContact || "");
          return {
            contactPerson: contactDetails.name,
            contactEmail: contactDetails.email,
            contactPhone: contactDetails.phone,
          };
        })(),
        projectDescription: rfp.projectDescription || "",
        documentsLink: rfp.documentsLink || "",
        keyDates: [],
      };

      // Merge with existing invitation data if available
      const formValues = existingInvitation ? {
        ...defaultValues,
        estimatedBudget: existingInvitation.estimatedBudget || "",
        projectTimeline: existingInvitation.projectTimeline || "",
        bidSubmissionDeadline: existingInvitation.bidSubmissionDeadline ? 
          new Date(existingInvitation.bidSubmissionDeadline).toISOString().split('T')[0] : "",
        projectStartDate: existingInvitation.projectStartDate ? 
          new Date(existingInvitation.projectStartDate).toISOString().split('T')[0] : "",
        projectEndDate: existingInvitation.projectEndDate ? 
          new Date(existingInvitation.projectEndDate).toISOString().split('T')[0] : "",
        specialRequirements: Array.isArray(existingInvitation.specialRequirements) ? 
          existingInvitation.specialRequirements.join(", ") : (existingInvitation.specialRequirements || ""),
        technicalSpecifications: existingInvitation.technicalSpecifications || "",
        contractTerms: existingInvitation.contractTerms || "",
        paymentTerms: existingInvitation.paymentTerms || "",
        insuranceRequirements: existingInvitation.insuranceRequirements || "",
        bondingRequirements: existingInvitation.bondingRequirements || "",
        prequalificationCriteria: Array.isArray(existingInvitation.prequalificationCriteria) ? 
          existingInvitation.prequalificationCriteria.join(", ") : (existingInvitation.prequalificationCriteria || ""),
        evaluationCriteria: Array.isArray(existingInvitation.evaluationCriteria) ? 
          existingInvitation.evaluationCriteria.join(", ") : (existingInvitation.evaluationCriteria || ""),
        // Parse contact information from combined field or use development contact
        ...(() => {
          if (existingInvitation.contactForQuestions) {
            const parts = existingInvitation.contactForQuestions.split(' - ');
            // Handle both old format "Name - Company - Email - Phone" and new format "Name - Email - Phone"
            if (parts.length >= 4) {
              // Old format: "Name - Company - Email - Phone"
              return {
                contactPerson: parts[0] || "",
                contactEmail: parts[2] || "",
                contactPhone: parts[3] || "",
              };
            } else if (parts.length >= 3) {
              // New format: "Name - Email - Phone"
              return {
                contactPerson: parts[0] || "",
                contactEmail: parts[1] || "",
                contactPhone: parts[2] || "",
              };
            } else {
              // Fallback to development contact
              const contactDetails = getDevelopmentContactDetails(rfp.developmentContact || "");
              return {
                contactPerson: contactDetails.name,
                contactEmail: contactDetails.email,
                contactPhone: contactDetails.phone,
              };
            }
          } else {
            const contactDetails = getDevelopmentContactDetails(rfp.developmentContact || "");
            return {
              contactPerson: contactDetails.name,
              contactEmail: contactDetails.email,
              contactPhone: contactDetails.phone,
            };
          }
        })(),
        projectDescription: existingInvitation.projectDescription || "",
        documentsLink: existingInvitation.documentsLink || "",
        keyDates: Array.isArray(existingInvitation.keyDates) ? existingInvitation.keyDates : [],
      } : defaultValues;

      form.reset(formValues);
      setKeyDates(formValues.keyDates);
    }
  }, [rfp, isOpen, existingInvitation, form, properties, contacts]);

  const saveInvitationMutation = useMutation({
    mutationFn: async (data: InvitationFormData) => {
      if (!rfp) throw new Error("No RFP selected");
      
      // Transform form data to match database schema
      const transformedData = {
        projectScope: data.projectScope,
        projectLocation: data.projectLocation,
        estimatedBudget: data.estimatedBudget,
        projectTimeline: data.projectTimeline,
        bidSubmissionDeadline: data.bidSubmissionDeadline,
        projectStartDate: data.projectStartDate,
        projectEndDate: data.projectEndDate,
        specialRequirements: data.specialRequirements ? [data.specialRequirements] : [],
        technicalSpecifications: data.technicalSpecifications,
        contractTerms: data.contractTerms,
        paymentTerms: data.paymentTerms,
        insuranceRequirements: data.insuranceRequirements,
        bondingRequirements: data.bondingRequirements,
        prequalificationCriteria: data.prequalificationCriteria ? [data.prequalificationCriteria] : [],
        evaluationCriteria: data.evaluationCriteria ? [data.evaluationCriteria] : [],
        contactForQuestions: `${data.contactPerson} - ${data.contactEmail || ''} - ${data.contactPhone || ''}`,
        projectDescription: data.projectDescription,
        documentsLink: data.documentsLink,
        keyDates: data.keyDates,
      };
      
      // Save or update invitation to bid record
      if (existingInvitation) {
        const response = await apiRequest(`/api/rfp-requests/${rfp.id}/invitation-to-bid`, "PATCH", transformedData);
        return response.json();
      } else {
        const response = await apiRequest("/api/invitation-to-bid", "POST", {
          rfpId: rfp.id,
          ...transformedData,
        });
        return response.json();
      }
    },
    onSuccess: (updatedInvitation, variables) => {
      toast({
        title: "Invitation Saved",
        description: "Your invitation details have been saved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests", rfp?.id, "invitation-to-bid"] });
      
      // Preserve checkbox state after save
      const currentFormValues = form.getValues();
      const preservedCheckboxes = {
        generateArchitectRfp: currentFormValues.generateArchitectRfp,
        generateContractorRfp: currentFormValues.generateContractorRfp,
        generateBrokerArchitectRfp: currentFormValues.generateBrokerArchitectRfp,
        generateBrokerContractorRfp: currentFormValues.generateBrokerContractorRfp,
      };
      
      // Update form with preserved checkbox state after a brief delay to allow data to refresh
      setTimeout(() => {
        form.setValue('generateArchitectRfp', preservedCheckboxes.generateArchitectRfp);
        form.setValue('generateContractorRfp', preservedCheckboxes.generateContractorRfp);
        form.setValue('generateBrokerArchitectRfp', preservedCheckboxes.generateBrokerArchitectRfp);
        form.setValue('generateBrokerContractorRfp', preservedCheckboxes.generateBrokerContractorRfp);
      }, 100);
    },
    onError: (error) => {
      toast({
        title: "Save Failed",
        description: error instanceof Error ? error.message : "Failed to save invitation",
        variant: "destructive",
      });
    },
  });

  const createInvitationMutation = useMutation({
    mutationFn: async (data: InvitationFormData) => {
      if (!rfp) throw new Error("No RFP selected");
      
      // Transform form data to match database schema
      const transformedData = {
        projectScope: data.projectScope,
        projectLocation: data.projectLocation,
        estimatedBudget: data.estimatedBudget,
        projectTimeline: data.projectTimeline,
        bidSubmissionDeadline: data.bidSubmissionDeadline,
        projectStartDate: data.projectStartDate,
        projectEndDate: data.projectEndDate,
        specialRequirements: data.specialRequirements ? [data.specialRequirements] : [],
        technicalSpecifications: data.technicalSpecifications,
        contractTerms: data.contractTerms,
        paymentTerms: data.paymentTerms,
        insuranceRequirements: data.insuranceRequirements,
        bondingRequirements: data.bondingRequirements,
        prequalificationCriteria: data.prequalificationCriteria ? [data.prequalificationCriteria] : [],
        evaluationCriteria: data.evaluationCriteria ? [data.evaluationCriteria] : [],
        contactForQuestions: `${data.contactPerson} - ${data.contactEmail || ''} - ${data.contactPhone || ''}`,
      };
      
      // First save the invitation data
      if (existingInvitation) {
        const response = await apiRequest(`/api/rfp-requests/${rfp.id}/invitation-to-bid`, "PATCH", transformedData);
        return response.json();
      } else {
        const response = await apiRequest("/api/invitation-to-bid", "POST", {
          rfpId: rfp.id,
          ...transformedData,
        });
        return response.json();
      }
    },
    onSuccess: async (invitationToBid) => {
      toast({
        title: "Invitation to Bid Created", 
        description: "RFP details saved successfully. Ready to generate PDFs.",
      });
      
      try {
        // Generate PDFs based on selections
        const formData = form.getValues();
        setIsGeneratingPdfs(true);
        
        // Generate documents sequentially in the same user action context to avoid popup blocking
        let delay = 0;
        
        if (formData.generateArchitectRfp) {
          if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
          await generatePdf("architect");
          delay += 500;
        }
        
        if (formData.generateContractorRfp) {
          if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
          await generatePdf("contractor");
          delay += 500;
        }
        
        if (formData.generateBrokerArchitectRfp) {
          if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
          await generatePdf("broker-architect");
          delay += 500;
        }
        
        if (formData.generateBrokerContractorRfp) {
          if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
          
          // Generate PDF for direct download to avoid conversion step
          const response = await fetch(`/api/rfp-requests/${rfp?.id}/generate-pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              recipientType: "broker-contractor",
              invitationData: form.getValues(),
              returnType: "pdf"
            }),
          });
          
          if (response.ok) {
            const pdfBlob = await response.blob();
            const url = window.URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${rfp?.rfpNumber}-broker-contractor-rfp.pdf`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => window.URL.revokeObjectURL(url), 1000);
            
            toast({
              title: "Documents Generated",
              description: "Architect RFP opened in new tab. Contractor PDF downloaded and ready for distribution.",
            });
          }
        }
      
        // Update RFP status
        await apiRequest(`/api/rfp-requests/${rfp?.id}`, "PATCH", {
          status: "in-progress",
          workflowPhase: "bid-collection"
        });
        
        queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
        queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
        
        onClose();
      } catch (error) {
        console.error("PDF generation error:", error);
        toast({
          title: "PDF Generation Error",
          description: error instanceof Error ? error.message : "Failed to generate PDFs",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      console.log("===== MUTATION ERROR CALLBACK =====");
      console.error("Mutation error:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create invitation to bid",
        variant: "destructive",
      });
    },
  });

  const generatePdf = async (recipientType: "architect" | "contractor" | "broker-architect" | "broker-contractor") => {
    try {
      setIsGeneratingPdfs(true);
      console.log(`Starting PDF generation for ${recipientType}`);
      console.log(`Making request to: /api/rfp-requests/${rfp?.id}/generate-pdf`);
      
      // Get HTML content from backend
      const response = await fetch(`/api/rfp-requests/${rfp?.id}/generate-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipientType,
          invitationData: form.getValues(),
        }),
      });
      
      console.log(`Response status for ${recipientType}:`, response.status);
      
      if (!response.ok) {
        throw new Error(`Failed to generate PDF: ${response.status} ${response.statusText}`);
      }
      
      const htmlContent = await response.text();
      console.log(`HTML content length for ${recipientType}:`, htmlContent.length);
      
      // Create a new window/tab with the content
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        console.log(`Opening print window for ${recipientType}`);
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        
        // Let user manually print if they want to
        printWindow.addEventListener('load', () => {
          // Focus the window to ensure it's visible
          printWindow.focus();
        });
      } else {
        console.log(`Print window blocked for ${recipientType}. User needs to allow popups.`);
        
        // Create a manual link for the blocked popup
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.download = `${rfp?.rfpNumber}-${recipientType}-invitation.html`;
        a.textContent = `Open ${recipientType.charAt(0).toUpperCase() + recipientType.slice(1)} RFP`;
        a.style.color = '#007bff';
        a.style.textDecoration = 'underline';
        
        toast({
          title: "Popup Blocked",
          description: `The ${recipientType.charAt(0).toUpperCase() + recipientType.slice(1)} RFP was blocked. Please allow popups or try again.`,
          variant: "destructive",
        });
        
        // Cleanup the blob URL after a delay
        setTimeout(() => {
          window.URL.revokeObjectURL(url);
        }, 60000);
        
        return;
      }
      
      toast({
        title: "Document Generated",
        description: `${recipientType.charAt(0).toUpperCase() + recipientType.slice(1)} invitation opened for printing`,
      });
    } catch (error) {
      console.error(`Error generating ${recipientType} PDF:`, error);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : `Failed to generate ${recipientType} document`,
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPdfs(false);
    }
  };

  const onSubmit = (data: InvitationFormData) => {
    // Check if at least one option is selected
    const hasSelection = data.generateArchitectRfp || data.generateContractorRfp || 
                        data.generateBrokerArchitectRfp || data.generateBrokerContractorRfp;
    
    if (!hasSelection) {
      return;
    }
    
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
              <h3 className="font-medium mb-4">Select RFP Types to Generate</h3>
              
              {/* Broker Response Section */}
              <div className="mb-6">
                <h4 className="font-medium text-sm text-green-700 mb-3">Broker Response RFPs (Prospective Tenants)</h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="generateBrokerArchitectRfp"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Architect RFP (Preliminary)</FormLabel>
                          <p className="text-sm text-muted-foreground">
                            Space planning & preliminary pricing for prospects
                          </p>
                        </div>
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="generateBrokerContractorRfp"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Contractor RFP (Preliminary)</FormLabel>
                          <p className="text-sm text-muted-foreground">
                            Preliminary pricing & scheduling for prospects
                          </p>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Formal Bids Section */}
              <div className="border-t pt-4">
                <h4 className="font-medium text-sm text-blue-700 mb-3">Formal Project Bids (Existing Tenants)</h4>
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
                          <FormLabel>Architect RFP (Formal)</FormLabel>
                          <p className="text-sm text-muted-foreground">
                            Complete RFP for confirmed tenant project
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
                          <FormLabel>Contractor ITB (Formal)</FormLabel>
                          <p className="text-sm text-muted-foreground">
                            Formal invitation to bid for confirmed project
                          </p>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
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

            {/* Project Description */}
            <FormField
              control={form.control}
              name="projectDescription"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Description</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Detailed description of the project scope and requirements" 
                      className="min-h-[100px]" 
                      {...field} 
                    />
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
                  <FormLabel>Documents Link</FormLabel>
                  <FormControl>
                    <Input placeholder="https://example.com/project-documents" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Key Dates */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <FormLabel>Key Dates</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const currentKeyDates = form.getValues("keyDates");
                    form.setValue("keyDates", [...currentKeyDates, { label: "", date: "" }]);
                  }}
                >
                  Add Key Date
                </Button>
              </div>
              
              {keyDates.map((_, index) => (
                <div key={index} className="flex gap-4 items-end">
                  <div className="flex-1">
                    <FormField
                      control={form.control}
                      name={`keyDates.${index}.label`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date Label</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., Bid Due Date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <div className="flex-1">
                    <FormField
                      control={form.control}
                      name={`keyDates.${index}.date`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const updatedKeyDates = keyDates.filter((_, i) => i !== index);
                      setKeyDates(updatedKeyDates);
                      form.setValue("keyDates", updatedKeyDates);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
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

            {/* Key Dates Management */}
            <div className="border-t pt-4">
              <h3 className="font-medium mb-3">Key Project Dates</h3>
              <div className="space-y-3">
                {keyDates.map((keyDate, index) => (
                  <div key={index} className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Input
                        placeholder="Date description (e.g., Design completion)"
                        value={keyDate.label}
                        onChange={(e) => {
                          const updatedKeyDates = [...keyDates];
                          updatedKeyDates[index].label = e.target.value;
                          setKeyDates(updatedKeyDates);
                          form.setValue("keyDates", updatedKeyDates);
                        }}
                      />
                    </div>
                    <div className="flex-1">
                      <Input
                        type="date"
                        value={keyDate.date}
                        onChange={(e) => {
                          const updatedKeyDates = [...keyDates];
                          updatedKeyDates[index].date = e.target.value;
                          setKeyDates(updatedKeyDates);
                          form.setValue("keyDates", updatedKeyDates);
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const updatedKeyDates = [...keyDates];
                        updatedKeyDates.splice(index, 1);
                        setKeyDates(updatedKeyDates);
                        form.setValue("keyDates", updatedKeyDates);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const updatedKeyDates = [...keyDates, { label: "", date: "" }];
                    setKeyDates(updatedKeyDates);
                    form.setValue("keyDates", updatedKeyDates);
                  }}
                >
                  Add Key Date
                </Button>
              </div>
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
                disabled={createInvitationMutation.isPending || isGeneratingPdfs || saveInvitationMutation.isPending}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              
              <div className="flex space-x-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    // Save without validation - allow saving partial data as draft
                    const formData = form.getValues();
                    saveInvitationMutation.mutate(formData);
                  }}
                  disabled={createInvitationMutation.isPending || isGeneratingPdfs || saveInvitationMutation.isPending}
                >
                  {saveInvitationMutation.isPending ? (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </>
                  )}
                </Button>

                <Button
                  type="button"
                  onClick={async () => {
                    if (!rfp) return;
                    
                    // Validate at least one checkbox is selected
                    const formData = form.getValues();
                    const hasSelectedDocuments = formData.generateArchitectRfp || 
                                               formData.generateContractorRfp || 
                                               formData.generateBrokerArchitectRfp || 
                                               formData.generateBrokerContractorRfp;
                    
                    if (!hasSelectedDocuments) {
                      toast({
                        title: "Validation Error",
                        description: "Please select at least one document type before completing the invitation.",
                        variant: "destructive",
                      });
                      return;
                    }
                    
                    try {
                      // First save the current form data
                      await saveInvitationMutation.mutateAsync(formData);
                      
                      // Then advance the workflow to bid-collection phase
                      const response = await fetch(`/api/rfp-requests/${rfp.id}/advance-workflow`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ newPhase: 'bid-collection' })
                      });
                      
                      if (response.ok) {
                        toast({
                          title: "Phase Complete",
                          description: "Invitation to Bid completed. Moving to Bid Collection phase.",
                        });
                        queryClient.invalidateQueries({ queryKey: ['/api/rfp-requests'] });
                        onClose();
                      } else {
                        throw new Error('Failed to advance workflow');
                      }
                    } catch (error) {
                      toast({
                        title: "Error",
                        description: "Failed to complete invitation phase.",
                        variant: "destructive",
                      });
                    }
                  }}
                  disabled={createInvitationMutation.isPending || isGeneratingPdfs || saveInvitationMutation.isPending}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Complete Invitation to Bid
                </Button>
                
                <Button 
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    if (!rfp) return;
                    
                    const formData = form.getValues();
                    const documentsToOpen = [];
                    
                    if (formData.generateArchitectRfp) documentsToOpen.push({ type: "architect", label: "Formal Architect RFP" });
                    if (formData.generateContractorRfp) documentsToOpen.push({ type: "contractor", label: "Formal Contractor ITB" });
                    if (formData.generateBrokerArchitectRfp) documentsToOpen.push({ type: "broker-architect", label: "Broker Architect RFP" });
                    if (formData.generateBrokerContractorRfp) documentsToOpen.push({ type: "broker-contractor", label: "Broker Contractor RFP" });
                    
                    if (documentsToOpen.length === 0) {
                      toast({
                        title: "No Documents Selected",
                        description: "Please select at least one document type to open.",
                        variant: "destructive",
                      });
                      return;
                    }
                    
                    // Open all selected documents in new tabs
                    console.log(`Total documents to open: ${documentsToOpen.length}`, documentsToOpen);
                    
                    for (let i = 0; i < documentsToOpen.length; i++) {
                      const doc = documentsToOpen[i];
                      try {
                        console.log(`[${i + 1}/${documentsToOpen.length}] Opening ${doc.type} document (${doc.label})...`);
                        
                        const response = await fetch(`/api/rfp-requests/${rfp.id}/generate-pdf`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ 
                            recipientType: doc.type,
                            invitationData: formData,
                            returnType: "html"
                          }),
                        });
                        
                        console.log(`Response status for ${doc.type}:`, response.status);
                        
                        if (response.ok) {
                          const htmlText = await response.text();
                          console.log(`HTML content length for ${doc.type}:`, htmlText.length);
                          
                          const blob = new Blob([htmlText], { type: 'text/html' });
                          const url = URL.createObjectURL(blob);
                          
                          console.log(`Opening window for ${doc.type}...`);
                          const newWindow = window.open(url, '_blank');
                          
                          if (!newWindow || newWindow.closed || typeof newWindow.closed == 'undefined') {
                            console.error(`Failed to open window for ${doc.type}`);
                            toast({
                              title: "Window Blocked",
                              description: `${doc.type} document window was blocked. Check popup settings.`,
                              variant: "destructive",
                            });
                          } else {
                            console.log(`✓ Successfully opened ${doc.type} document in new tab`);
                          }
                          
                          setTimeout(() => URL.revokeObjectURL(url), 5000);
                          
                          // Increased delay between opening tabs
                          if (i < documentsToOpen.length - 1) {
                            console.log(`Waiting 500ms before opening next document...`);
                            await new Promise(resolve => setTimeout(resolve, 500));
                          }
                        } else {
                          console.error(`Failed to generate ${doc.type} document: ${response.status} ${response.statusText}`);
                          toast({
                            title: "Generation Failed",
                            description: `Failed to generate ${doc.type} document.`,
                            variant: "destructive",
                          });
                        }
                      } catch (error) {
                        console.error(`Error opening ${doc.type} document:`, error);
                        toast({
                          title: "Error",
                          description: `Error opening ${doc.type} document: ${(error as Error)?.message || 'Unknown error'}`,
                          variant: "destructive",
                        });
                      }
                    }
                    
                    toast({
                      title: "Documents Opened",
                      description: `${documentsToOpen.length} document(s) opened in new tabs. Use Ctrl+P to save as PDF.`,
                    });
                  }}
                  disabled={createInvitationMutation.isPending || isGeneratingPdfs || saveInvitationMutation.isPending}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Open for PDF Saving
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}