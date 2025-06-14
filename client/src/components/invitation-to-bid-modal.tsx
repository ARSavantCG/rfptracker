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
    date: z.string(),
  })).default([]),
});

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
    onSuccess: async (updatedInvitation, variables) => {
      const formData = variables;
      
      // Generate PDFs based on selected options
      const documentsToOpen = [];
      
      if (formData.generateArchitectRfp) {
        documentsToOpen.push({ type: "architect", label: "Architect RFP" });
      }
      if (formData.generateContractorRfp) {
        documentsToOpen.push({ type: "contractor", label: "Contractor RFP" });
      }
      if (formData.generateBrokerArchitectRfp) {
        documentsToOpen.push({ type: "broker-architect", label: "Broker Architect RFP" });
      }
      if (formData.generateBrokerContractorRfp) {
        documentsToOpen.push({ type: "broker-contractor", label: "Broker Contractor RFP" });
      }
      
      if (documentsToOpen.length > 0) {
        setIsGeneratingPdfs(true);
        
        // Generate and open each document
        console.log(`Total documents to open: ${documentsToOpen.length}`, documentsToOpen);
        
        for (let i = 0; i < documentsToOpen.length; i++) {
          const doc = documentsToOpen[i];
          console.log(`[${i + 1}/${documentsToOpen.length}] Opening ${doc.type} document (${doc.label})...`);
          
          try {
            const response = await fetch(`/api/rfp-requests/${rfp.id}/generate-pdf`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ recipientType: doc.type })
            });
            
            console.log(`Response status for ${doc.type}:`, response.status);
            
            if (response.ok) {
              const htmlContent = await response.text();
              console.log(`HTML content length for ${doc.type}:`, htmlContent.length);
              
              // Open in new window for manual saving
              console.log(`Opening window for ${doc.type}...`);
              const newWindow = window.open('', '_blank');
              if (newWindow) {
                newWindow.document.write(htmlContent);
                newWindow.document.close();
              } else {
                console.error(`Failed to open window for ${doc.type}`);
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
          
          // Add a small delay between documents to avoid overwhelming the browser
          if (i < documentsToOpen.length - 1) {
            console.log("Waiting 500ms before opening next document...");
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        toast({
          title: "Documents Opened",
          description: `${documentsToOpen.length} document(s) opened in new tabs. Use Ctrl+P to save as PDF.`,
          action: (
            <ToastAction
              altText="Complete Phase"
              onClick={async () => {
                try {
                  const response = await fetch(`/api/rfp-requests/${rfp.id}/advance-phase`, {
                    method: 'PATCH',
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
            >
              Complete Phase
            </ToastAction>
          ),
        });
        
        setIsGeneratingPdfs(false);
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests", rfp?.id, "invitation-to-bid"] });
    },
    onError: (error) => {
      setIsGeneratingPdfs(false);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create invitation",
        variant: "destructive",
      });
    },
  });

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
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Select RFP Types to Generate</h3>
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
                        <FormLabel>Architect RFP</FormLabel>
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
                        <FormLabel>Contractor RFP</FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
                
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
                        <FormLabel>Broker Architect RFP</FormLabel>
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
                        <FormLabel>Broker Contractor RFP</FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Project Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Project Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="projectScope"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
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
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="estimatedBudget"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estimated Budget</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="$" />
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
                        <Input {...field} placeholder="e.g., 6 months" />
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
            </div>

            {/* Contact Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Contact Information</h3>
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="contactPerson"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Person</FormLabel>
                      <FormControl>
                        <Input {...field} />
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
                        <Input type="email" {...field} />
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
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Additional Requirements */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Additional Requirements</h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="specialRequirements"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Special Requirements</FormLabel>
                      <FormControl>
                        <Textarea {...field} />
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
                        <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contractTerms"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contract Terms</FormLabel>
                      <FormControl>
                        <Textarea {...field} />
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
                        <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="insuranceRequirements"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Insurance Requirements</FormLabel>
                      <FormControl>
                        <Textarea {...field} />
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
                        <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="prequalificationCriteria"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prequalification Criteria</FormLabel>
                      <FormControl>
                        <Textarea {...field} />
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
                        <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button 
                type="button"
                variant="outline"
                onClick={() => saveInvitationMutation.mutate(form.getValues())}
                disabled={saveInvitationMutation.isPending}
              >
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
              
              <Button 
                type="submit"
                disabled={createInvitationMutation.isPending || isGeneratingPdfs || saveInvitationMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <FileText className="h-4 w-4 mr-2" />
                {isGeneratingPdfs ? "Generating..." : "Generate & Open RFPs"}
              </Button>
              
              <Button 
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={createInvitationMutation.isPending || isGeneratingPdfs || saveInvitationMutation.isPending}
              >
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