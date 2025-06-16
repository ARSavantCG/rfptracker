import { useState, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { FileText, Download, Users, Save, X, CheckCircle, Plus, Trash2 } from "lucide-react";
import type { RfpRequest, Property, Contact } from "@shared/schema";

const invitationFormSchema = z.object({
  generateArchitectRfp: z.boolean().default(false),
  generateContractorRfp: z.boolean().default(false),
  generateBrokerArchitectRfp: z.boolean().default(false),
  generateBrokerContractorRfp: z.boolean().default(false),
  projectScope: z.string().min(1, "Project scope is required"),
  projectLocation: z.string().min(1, "Project location is required"),
  bidSubmissionDeadline: z.string().min(1, "Bid submission deadline is required"),
  contactPerson: z.string().min(1, "Contact person is required"),
  contactEmail: z.string().email("Valid email is required"),
  contactPhone: z.string().optional(),
  projectDescription: z.string().optional(),
  documentsLink: z.string().optional(),
  keyDates: z.array(z.object({
    label: z.string(),
    date: z.string(),
  })).default([]),
  scopeOfWork: z.array(z.object({
    description: z.string(),
    quantity: z.number(),
    unit: z.string(),
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
      bidSubmissionDeadline: "",
      contactPerson: "",
      contactEmail: "",
      contactPhone: "",
      projectDescription: "",
      documentsLink: "",
      keyDates: [],
      scopeOfWork: [],
    },
  });

  const { fields: scopeFields, append: appendScope, remove: removeScope } = useFieldArray({
    control: form.control,
    name: "scopeOfWork",
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
        projectScope: rfp.projectName,
        projectLocation: getPropertyAddress(rfp.property) || "",
        bidSubmissionDeadline: "",
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
        scopeOfWork: [],
      };

      // Merge with existing invitation data if available
      const formValues = existingInvitation ? {
        ...defaultValues,
        bidSubmissionDeadline: existingInvitation.bidSubmissionDeadline ? 
          new Date(existingInvitation.bidSubmissionDeadline).toISOString().split('T')[0] : "",
        // Parse contact information from combined field or use development contact
        ...(() => {
          if (existingInvitation.contactForQuestions) {
            const parts = existingInvitation.contactForQuestions.split(' - ');
            if (parts.length >= 3) {
              return {
                contactPerson: parts[0] || "",
                contactEmail: parts[1] || "",
                contactPhone: parts[2] || "",
              };
            }
          }
          const contactDetails = getDevelopmentContactDetails(rfp.developmentContact || "");
          return {
            contactPerson: contactDetails.name,
            contactEmail: contactDetails.email,
            contactPhone: contactDetails.phone,
          };
        })(),
        projectDescription: existingInvitation.projectDescription || "",
        documentsLink: existingInvitation.documentsLink || "",
        keyDates: Array.isArray(existingInvitation.keyDates) ? existingInvitation.keyDates : [],
        scopeOfWork: Array.isArray(existingInvitation.scopeOfWork) ? existingInvitation.scopeOfWork : [],
      } : defaultValues;

      form.reset(formValues);
      setKeyDates(formValues.keyDates);
      
      // Force update scope of work fields after form reset
      if (formValues.scopeOfWork && formValues.scopeOfWork.length > 0) {
        setTimeout(() => {
          form.setValue('scopeOfWork', formValues.scopeOfWork);
        }, 50);
      }
    }
  }, [rfp, isOpen, existingInvitation, form, properties, contacts]);

  const saveInvitationMutation = useMutation({
    mutationFn: async (data: InvitationFormData) => {
      if (!rfp) throw new Error("No RFP selected");
      
      // Transform form data to match database schema
      const transformedData = {
        projectScope: data.projectScope,
        projectLocation: data.projectLocation,
        bidSubmissionDeadline: data.bidSubmissionDeadline,
        contactForQuestions: `${data.contactPerson} - ${data.contactEmail || ''} - ${data.contactPhone || ''}`,
        projectDescription: data.projectDescription,
        documentsLink: data.documentsLink,
        keyDates: data.keyDates,
        scopeOfWork: data.scopeOfWork,
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
    onSuccess: (updatedInvitation) => {
      toast({
        title: "Invitation Saved",
        description: "Your invitation details have been saved successfully.",
      });
      
      // Preserve current form state including scope of work
      const currentFormValues = form.getValues();
      
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests", rfp?.id, "invitation-to-bid"] });
      
      // Restore form state after a brief delay to allow data to refresh
      setTimeout(() => {
        if (updatedInvitation?.scopeOfWork) {
          form.setValue('scopeOfWork', updatedInvitation.scopeOfWork);
        } else if (currentFormValues.scopeOfWork) {
          form.setValue('scopeOfWork', currentFormValues.scopeOfWork);
        }
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
      
      setIsGeneratingPdfs(true);
      
      const documentsToOpen = [];
      
      if (data.generateArchitectRfp) {
        documentsToOpen.push({ type: "architect", title: "Architect RFP" });
      }
      if (data.generateContractorRfp) {
        documentsToOpen.push({ type: "contractor", title: "Contractor RFP" });
      }
      if (data.generateBrokerArchitectRfp) {
        documentsToOpen.push({ type: "broker-architect", title: "Broker Architect RFP" });
      }
      if (data.generateBrokerContractorRfp) {
        documentsToOpen.push({ type: "broker-contractor", title: "Broker Contractor RFP" });
      }
      
      // Save invitation data first
      await saveInvitationMutation.mutateAsync(data);
      
      // Generate and open documents
      for (let i = 0; i < documentsToOpen.length; i++) {
        const doc = documentsToOpen[i];
        try {
          console.log(`Opening ${doc.title} document...`);
          const response = await fetch(`/api/rfp-requests/${rfp.id}/generate-pdf-html`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipientType: doc.type,
              recipientName: "",
              recipientCompany: ""
            })
          });
          
          if (response.ok) {
            const htmlContent = await response.text();
            const newWindow = window.open('', '_blank');
            if (newWindow) {
              newWindow.document.write(htmlContent);
              newWindow.document.close();
            }
          }
          
          // Add a small delay between documents to avoid overwhelming the browser
          if (i < documentsToOpen.length - 1) {
            console.log("Waiting 500ms before opening next document...");
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error(`Failed to open ${doc.title}:`, error);
          toast({
            title: "Document Error",
            description: `Failed to open ${doc.title}. ${error instanceof Error ? error.message : 'Unknown error'}`,
            variant: "destructive",
          });
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
                        <Input {...field} placeholder="Project scope" />
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
                        <Input {...field} placeholder="Project location" />
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
                      <FormLabel>Due Date (Consultant)</FormLabel>
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

            {/* Scope of Work */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Scope of Work</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => appendScope({ description: "", quantity: 1, unit: "" })}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Line Item
                </Button>
              </div>
              
              {scopeFields.length === 0 && (
                <div className="text-center text-gray-500 py-4">
                  No scope items added yet. Click "Add Line Item" to get started.
                </div>
              )}

              {scopeFields.length > 0 && (
                <div className="space-y-2">
                  {/* Column Headers */}
                  <div className="grid grid-cols-12 gap-4 pb-2 border-b text-sm font-medium text-gray-600">
                    <div className="col-span-6">Description</div>
                    <div className="col-span-2">Quantity</div>
                    <div className="col-span-3">Unit</div>
                    <div className="col-span-1"></div>
                  </div>

                  {/* Scope Items */}
                  {scopeFields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-12 gap-4 items-center">
                      <div className="col-span-6">
                        <FormField
                          control={form.control}
                          name={`scopeOfWork.${index}.description`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input {...field} placeholder="Work description" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      
                      <div className="col-span-2">
                        <FormField
                          control={form.control}
                          name={`scopeOfWork.${index}.quantity`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input 
                                  type="number" 
                                  {...field} 
                                  onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                                  placeholder="1" 
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="col-span-3">
                        <FormField
                          control={form.control}
                          name={`scopeOfWork.${index}.unit`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input {...field} placeholder="sq ft, each, etc." />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="col-span-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeScope(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Additional Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Additional Information</h3>
              <div className="grid grid-cols-1 gap-4">
                <FormField
                  control={form.control}
                  name="projectDescription"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Description</FormLabel>
                      <FormControl>
                        <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="documentsLink"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Documents Link</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Link to project documents" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-between items-center pt-6 border-t">
              <Button 
                type="button"
                variant="outline"
                onClick={async () => {
                  if (!rfp) return;
                  
                  const formData = form.getValues();
                  await saveInvitationMutation.mutateAsync(formData);
                }}
                disabled={saveInvitationMutation.isPending}
              >
                <Save className="h-4 w-4 mr-2" />
                Save Progress
              </Button>
              
              <div className="flex gap-2">
                <Button 
                  type="button"
                  variant="outline"
                  onClick={onClose}
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                
                <Button 
                  type="submit"
                  disabled={createInvitationMutation.isPending || isGeneratingPdfs || saveInvitationMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Generate RFPs
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}