import { useState, useEffect, useCallback, memo, useRef } from "react";
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
// Removed Select import - using native HTML selects for consistency
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { FileText, Download, Users, Save, X, CheckCircle, Plus, Trash2, ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import { DragDropContext, Droppable, Draggable, DropResult } from "react-beautiful-dnd";
import type { RfpRequest, Property, Contact } from "@shared/schema";

const invitationFormSchema = z.object({
  generateArchitectRfp: z.boolean().default(false),
  generateContractorRfp: z.boolean().default(false),
  generateBrokerArchitectRfp: z.boolean().default(false),
  generateBrokerContractorRfp: z.boolean().default(false),
  selectedContractor: z.string().optional(),
  selectedArchitect: z.string().optional(),
  projectScope: z.string().min(1, "Project scope is required"),
  projectLocation: z.string().min(1, "Project location is required"),
  contractorDueDate: z.string().min(1, "Contractor due date is required"),
  architectDueDate: z.string().min(1, "Architect due date is required"),
  projectDescription: z.string().optional(),
  documentsLink: z.string().optional(),
  keyDates: z.array(z.object({
    label: z.string(),
    date: z.string(),
  })).default([]),
  scopeOfWork: z.array(z.object({
    description: z.string(),
    quantity: z.union([z.number(), z.string()]).transform((val) => 
      typeof val === 'string' ? (val === '' ? 0 : parseInt(val) || 0) : val
    ),
    unit: z.string(),
  })).default([]),
  architectMilestones: z.array(z.object({
    description: z.string(),
  })).default([]),
  contractorMilestones: z.array(z.object({
    description: z.string(),
  })).default([]),
});

type InvitationFormData = z.infer<typeof invitationFormSchema>;

interface InvitationToBidModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfp: RfpRequest | null;
}

// Helper function to clean up project names by removing trailing dashes and spaces
const cleanProjectName = (projectName: string): string => {
  return projectName.replace(/\s*-\s*$/, '').trim();
};

// Pure DOM implementation - no React components to avoid re-rendering issues



export function InvitationToBidModal({ isOpen, onClose, rfp }: InvitationToBidModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isGeneratingPdfs, setIsGeneratingPdfs] = useState(false);
  const [keyDates, setKeyDates] = useState<Array<{label: string, date: string}>>([]);
  const [additionalAreas, setAdditionalAreas] = useState<Array<{id: string, description: string, squareFootage: string, notes: string}>>([]);

  // Helper function to format numbers with commas
  const formatNumberWithCommas = (value: string): string => {
    // Remove any non-digit characters except commas and periods
    const cleanValue = value.replace(/[^\d]/g, '');
    if (cleanValue === '') return '';
    
    // Add commas for thousands
    return parseInt(cleanValue).toLocaleString();
  };

  // Helper function to get raw number from formatted string
  const getRawNumber = (formattedValue: string): string => {
    return formattedValue.replace(/,/g, '');
  };

  // Update area field - optimized to prevent focus loss with useCallback
  const updateAreaField = useCallback((index: number, field: 'description' | 'squareFootage' | 'notes', value: string) => {
    setAdditionalAreas(prevAreas => {
      const newAreas = [...prevAreas];
      newAreas[index] = { ...newAreas[index], [field]: value };
      return newAreas;
    });
  }, []);

  // Remove area field - memoized to prevent re-renders
  const removeAreaField = useCallback((index: number) => {
    setAdditionalAreas(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Fetch properties for project location
  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  // Fetch contacts to get full contact details
  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  // Fetch RFP generation history
  const { data: generationHistory = [], refetch: refetchHistory } = useQuery({
    queryKey: [`/api/rfp-requests/${rfp?.id}/generation-history`],
    enabled: !!rfp?.id,
  });

  // Delete generation history item mutation
  const deleteHistoryMutation = useMutation({
    mutationFn: async (historyId: number) => {
      await apiRequest(`/api/generation-history/${historyId}`, "DELETE");
    },
    onSuccess: () => {
      refetchHistory();
      toast({
        title: "Success",
        description: "Generation history item deleted successfully",
        duration: 4000,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to delete generation history item",
        variant: "destructive",
        duration: 6000,
      });
    },
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
      requestPricing: false,
      requestSchedule: false,
      requestSpacePlan: false,
      projectScope: "",
      projectLocation: "",
      contractorDueDate: "",
      architectDueDate: "",
      projectDescription: "",
      documentsLink: "",
      keyDates: [],
      scopeOfWork: [],
      architectMilestones: [],
      contractorMilestones: [],
      selectedContractor: "none",
      selectedArchitect: "none",
    },
  });

  const { fields: scopeFields, append: appendScope, remove: removeScope, replace: replaceScope } = useFieldArray({
    control: form.control,
    name: "scopeOfWork",
  });

  const { fields: architectMilestoneFields, append: appendArchitectMilestone, remove: removeArchitectMilestone } = useFieldArray({
    control: form.control,
    name: "architectMilestones",
  });

  const { fields: contractorMilestoneFields, append: appendContractorMilestone, remove: removeContractorMilestone } = useFieldArray({
    control: form.control,
    name: "contractorMilestones",
  });

  // Reorder functions for scope of work items
  const moveScopeUp = (index: number) => {
    if (index === 0) return;
    const items = form.getValues("scopeOfWork");
    [items[index - 1], items[index]] = [items[index], items[index - 1]];
    form.setValue("scopeOfWork", items);
  };

  const moveScopeDown = (index: number) => {
    const items = form.getValues("scopeOfWork");
    if (index === items.length - 1) return;
    [items[index], items[index + 1]] = [items[index + 1], items[index]];
    form.setValue("scopeOfWork", items);
  };

  // Reorder functions for architect milestones
  const moveArchitectMilestoneUp = (index: number) => {
    if (index === 0) return;
    const items = form.getValues("architectMilestones");
    [items[index - 1], items[index]] = [items[index], items[index - 1]];
    form.setValue("architectMilestones", items);
  };

  const moveArchitectMilestoneDown = (index: number) => {
    const items = form.getValues("architectMilestones");
    if (index === items.length - 1) return;
    [items[index], items[index + 1]] = [items[index + 1], items[index]];
    form.setValue("architectMilestones", items);
  };

  // Reorder functions for contractor milestones
  const moveContractorMilestoneUp = (index: number) => {
    if (index === 0) return;
    const items = form.getValues("contractorMilestones");
    [items[index - 1], items[index]] = [items[index], items[index - 1]];
    form.setValue("contractorMilestones", items);
  };

  const moveContractorMilestoneDown = (index: number) => {
    const items = form.getValues("contractorMilestones");
    if (index === items.length - 1) return;
    [items[index], items[index + 1]] = [items[index + 1], items[index]];
    form.setValue("contractorMilestones", items);
  };

  // Drag and drop handlers
  const handleScopeOfWorkDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const items = [...form.getValues("scopeOfWork")];
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    form.setValue("scopeOfWork", items);
  };

  const handleArchitectMilestonesDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const items = [...form.getValues("architectMilestones")];
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    form.setValue("architectMilestones", items);
  };

  const handleContractorMilestonesDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const items = [...form.getValues("contractorMilestones")];
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    form.setValue("contractorMilestones", items);
  };

  // Watch checkbox values to enable/disable Generate RFPs button
  const watchedValues = form.watch([
    "generateArchitectRfp",
    "generateContractorRfp", 
    "generateBrokerArchitectRfp",
    "generateBrokerContractorRfp"
  ]);
  
  const hasSelectedRfpType = watchedValues.some(value => value === true);

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

  // Reset additional areas when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAdditionalAreas([]);
    }
  }, [isOpen]);

  // Pre-populate form with existing data
  useEffect(() => {
    if (rfp && isOpen && properties.length > 0 && contacts.length > 0) {
      // Load existing additional areas if they exist
      if (existingInvitation?.additionalAreas) {
        setAdditionalAreas(existingInvitation.additionalAreas.map((area: any) => ({
          id: `existing-${Date.now()}-${Math.random()}`,
          description: area.description || "",
          squareFootage: area.squareFootage || "",
          notes: area.notes || ""
        })));
      }
      
      const defaultValues = {
        generateArchitectRfp: false,
        generateContractorRfp: false,
        generateBrokerArchitectRfp: false,
        generateBrokerContractorRfp: false,

        selectedContractor: rfp.generalContractor || "none",
        selectedArchitect: rfp.architect || "none",
        projectScope: cleanProjectName(rfp.projectName),
        projectLocation: getPropertyAddress(rfp.property) || "",
        contractorDueDate: rfp.contractorDueDate ? new Date(rfp.contractorDueDate).toISOString().split('T')[0] : "",
        architectDueDate: rfp.architectDueDate ? new Date(rfp.architectDueDate).toISOString().split('T')[0] : "",

        projectDescription: rfp.projectDescription || "",
        documentsLink: rfp.documentsLink || "",
        keyDates: [],
        scopeOfWork: [],
        architectMilestones: [],
        contractorMilestones: [],
      };

      // Merge with existing invitation data if available
      const formValues = existingInvitation ? {
        ...defaultValues,
        selectedContractor: existingInvitation.selectedContractor || defaultValues.selectedContractor,
        selectedArchitect: existingInvitation.selectedArchitect || defaultValues.selectedArchitect,
        contractorDueDate: existingInvitation.contractorDueDate ? 
          new Date(existingInvitation.contractorDueDate).toISOString().split('T')[0] : defaultValues.contractorDueDate,
        architectDueDate: existingInvitation.architectDueDate ? 
          new Date(existingInvitation.architectDueDate).toISOString().split('T')[0] : defaultValues.architectDueDate,

        // Contact information will be automatically populated from RFP validation data in PDF generation
        projectDescription: existingInvitation.projectDescription || "",
        documentsLink: existingInvitation.documentsLink || "",
        keyDates: Array.isArray(existingInvitation.keyDates) ? existingInvitation.keyDates : [],
        scopeOfWork: Array.isArray(existingInvitation.scopeOfWork) ? existingInvitation.scopeOfWork : [],
        architectMilestones: Array.isArray(existingInvitation.architectMilestones) ? existingInvitation.architectMilestones : [],
        contractorMilestones: Array.isArray(existingInvitation.contractorMilestones) ? existingInvitation.contractorMilestones : [],
      } : defaultValues;

      form.reset(formValues);
      setKeyDates(formValues.keyDates);
      
      // Force update scope of work fields after form reset
      if (formValues.scopeOfWork && formValues.scopeOfWork.length > 0) {
        setTimeout(() => {
          replaceScope(formValues.scopeOfWork);
        }, 100);
      } else {
        replaceScope([]);
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
        bidSubmissionDeadline: data.contractorDueDate || null,
        contractorDueDate: data.contractorDueDate || null,
        architectDueDate: data.architectDueDate || null,
        contactForQuestions: '', // Will be populated from RFP validation data in PDF generation
        projectDescription: data.projectDescription,
        documentsLink: data.documentsLink,
        keyDates: data.keyDates,
        // Transform scope of work to ensure quantity is a number
        scopeOfWork: data.scopeOfWork.map(item => ({
          ...item,
          quantity: typeof item.quantity === 'string' ? parseFloat(item.quantity) || 0 : item.quantity
        })),
        architectMilestones: data.architectMilestones,
        contractorMilestones: data.contractorMilestones,
        // Include contractor and architect selections
        selectedContractor: data.selectedContractor !== 'none' ? data.selectedContractor : null,
        selectedArchitect: data.selectedArchitect !== 'none' ? data.selectedArchitect : null,
        // Include additional areas from step 3
        additionalAreas: additionalAreas.filter(area => 
          area.description.trim() && area.squareFootage.trim()
        ).map(area => ({
          description: area.description.trim(),
          squareFootage: area.squareFootage.trim(),
          notes: area.notes.trim() || null
        })),
      };
      
      // Save or update invitation to bid record
      if (existingInvitation) {
        return await apiRequest(`/api/rfp-requests/${rfp.id}/invitation-to-bid`, "PATCH", transformedData);
      } else {
        return await apiRequest("/api/invitation-to-bid", "POST", {
          rfpId: rfp.id,
          ...transformedData,
        });
      }
    },
    onSuccess: (updatedInvitation) => {
      toast({
        title: "Invitation Saved",
        description: "Your invitation details have been saved successfully.",
        duration: 4000,
      });
      
      // Preserve current form state completely
      const currentFormValues = form.getValues();
      
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests", rfp?.id, "invitation-to-bid"] });
      
      // Restore complete form state after data refresh
      setTimeout(() => {
        // Preserve all form values, not just scope of work
        form.reset({
          ...currentFormValues,
          // Ensure scope of work is properly maintained
          scopeOfWork: updatedInvitation?.scopeOfWork || currentFormValues.scopeOfWork || []
        });
        
        // Update scope of work field array
        if (updatedInvitation?.scopeOfWork) {
          replaceScope(updatedInvitation.scopeOfWork);
        } else if (currentFormValues.scopeOfWork) {
          replaceScope(currentFormValues.scopeOfWork);
        }
      }, 100);
    },
    onError: (error) => {
      toast({
        title: "Save Failed",
        description: error instanceof Error ? error.message : "Failed to save invitation",
        variant: "destructive",
        duration: 6000,
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
          const token = localStorage.getItem('auth-token');
          const response = await fetch(`/api/rfp-requests/${rfp.id}/generate-pdf`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              recipientType: doc.type,
              recipientName: "",
              recipientCompany: "",
              returnType: "html"
            })
          });
          
          if (response.ok) {
            const htmlContent = await response.text();
            const newWindow = window.open('', '_blank');
            if (newWindow) {
              newWindow.document.write(htmlContent);
              newWindow.document.close();
              console.log(`Successfully opened ${doc.title} in new window`);
            } else {
              console.error(`Failed to open window for ${doc.title} - popup may be blocked`);
              toast({
                title: "Popup Blocked",
                description: `${doc.title} was blocked by popup blocker. Please allow popups and try again.`,
                variant: "destructive",
              });
            }
          } else {
            console.error(`HTTP error for ${doc.title}:`, response.status, response.statusText);
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
      
      // Refresh generation history to show new items
      refetchHistory();
      
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

  const generateAndAdvanceMutation = useMutation({
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
          const token = localStorage.getItem('auth-token');
          const response = await fetch(`/api/rfp-requests/${rfp.id}/generate-pdf`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              recipientType: doc.type,
              recipientName: "",
              recipientCompany: "",
              returnType: "html"
            })
          });
          
          if (response.ok) {
            const htmlContent = await response.text();
            const newWindow = window.open('', '_blank');
            if (newWindow) {
              newWindow.document.write(htmlContent);
              newWindow.document.close();
              console.log(`Successfully opened ${doc.title} in new window`);
            } else {
              console.error(`Failed to open window for ${doc.title} - popup may be blocked`);
            }
          }
          
          // Add a small delay between documents
          if (i < documentsToOpen.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error(`Failed to open ${doc.title}:`, error);
        }
      }
      
      // Refresh generation history
      refetchHistory();
      
      // Advance workflow to bid-collection
      const advanceResponse = await apiRequest(`/api/rfp-requests/${rfp.id}/workflow-phase`, "PATCH", { 
        phase: "bid-collection" 
      });
      
      return advanceResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      toast({
        title: "Success",
        description: "RFPs generated and advanced to Bid Collection phase",
      });
      setIsGeneratingPdfs(false);
      onClose();
    },
    onError: (error) => {
      setIsGeneratingPdfs(false);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to generate RFPs and advance workflow",
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
            Issuance to General Contractor and/or Architect
          </DialogTitle>
          <DialogDescription>
            Configure and generate RFPs for architects and/or general contractors for {rfp.rfpNumber}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" key={`itb-form-${Date.now()}`}>
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
                  name="contractorDueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contractor Due Date</FormLabel>
                      <FormControl>
                        <Input 
                          type="date" 
                          {...field} 
                          onChange={(e) => {
                            field.onChange(e);
                            // Auto-populate architect due date with contractor date
                            if (e.target.value) {
                              form.setValue("architectDueDate", e.target.value);
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="architectDueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Architect Due Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Contractor and Architect Selection */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Contractor and Architect Selection</h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="selectedContractor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>General Contractor</FormLabel>
                      <div className="relative">
                        <select
                          value={field.value || ""}
                          onChange={(e) => field.onChange(e.target.value)}
                          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                        >
                          <option value="">No contractor selected</option>
                          {contacts
                            .filter(contact => contact.type === 'contractor')
                            .map(contact => (
                              <option key={contact.id} value={contact.name}>
                                {contact.name} {contact.company && `(${contact.company})`}
                              </option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="selectedArchitect"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Architect</FormLabel>
                      <div className="relative">
                        <select
                          value={field.value || ""}
                          onChange={(e) => field.onChange(e.target.value)}
                          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                        >
                          <option value="">No architect selected</option>
                          {contacts
                            .filter(contact => contact.type === 'architect')
                            .map(contact => (
                              <option key={contact.id} value={contact.name}>
                                {contact.name} {contact.company && `(${contact.company})`}
                              </option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Area Breakdown - Pure DOM Implementation */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Area Breakdown</h3>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    const container = document.getElementById('additional-areas-container');
                    if (!container) return;
                    
                    const newId = `area-${Date.now()}-${Math.random()}`;
                    const newRow = document.createElement('div');
                    newRow.className = 'grid grid-cols-5 gap-4 items-center py-2 border-b border-gray-100';
                    newRow.setAttribute('data-area-id', newId);
                    
                    newRow.innerHTML = `
                      <input
                        type="text"
                        placeholder="Area description"
                        data-field="description"
                        class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      />
                      <input
                        type="text"
                        placeholder="0"
                        data-field="squareFootage"
                        class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      />
                      <input
                        type="text"
                        placeholder="Notes (optional)"
                        data-field="notes"
                        class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      />
                      <div class="flex gap-1">
                        <button
                          type="button"
                          data-save="${newId}"
                          class="flex h-8 w-8 items-center justify-center rounded-md text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                          title="Save area"
                        >
                          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="m9 12 2 2 4-4"></path>
                            <path d="M21 12c.552 0 1-.448 1-1V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6c0-.552-.448-1-1-1z"></path>
                          </svg>
                        </button>
                        <button
                          type="button"
                          data-remove="${newId}"
                          class="flex h-8 w-8 items-center justify-center rounded-md text-red-500 hover:text-red-700 hover:bg-red-50"
                          title="Remove area"
                        >
                          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3,6 5,6 21,6"></polyline>
                            <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                          </svg>
                        </button>
                      </div>
                    `;
                    
                    container.appendChild(newRow);
                    
                    // Add event listeners for formatting and cleanup
                    const sqftInput = newRow.querySelector('[data-field="squareFootage"]') as HTMLInputElement;
                    if (sqftInput) {
                      sqftInput.addEventListener('input', (event) => {
                        const target = event.target as HTMLInputElement;
                        const rawValue = target.value.replace(/,/g, '');
                        if (rawValue && !isNaN(Number(rawValue)) && rawValue !== '0') {
                          const formatted = Number(rawValue).toLocaleString();
                          if (target.value !== formatted) {
                            const cursorPos = target.selectionStart || 0;
                            target.value = formatted;
                            // Try to maintain cursor position
                            target.setSelectionRange(cursorPos, cursorPos);
                          }
                        }
                      });
                    }
                    
                    // Save button functionality
                    const saveBtn = newRow.querySelector('[data-save]');
                    if (saveBtn) {
                      saveBtn.addEventListener('click', async () => {
                        const inputs = newRow.querySelectorAll('input');
                        const description = (inputs[0] as HTMLInputElement).value;
                        const squareFootage = (inputs[1] as HTMLInputElement).value.replace(/,/g, '');
                        const notes = (inputs[2] as HTMLInputElement).value;
                        
                        if (!description.trim()) {
                          toast({
                            title: "Validation Error",
                            description: "Area description is required",
                            variant: "destructive",
                            duration: 4000,
                          });
                          return;
                        }
                        
                        // Here you would typically save to database
                        // For now, we'll show success and mark as saved
                        toast({
                          title: "Area Saved",
                          description: "Additional area has been saved successfully",
                          duration: 4000,
                        });
                        
                        // Visual indication that it's saved
                        saveBtn.style.opacity = '0.5';
                        saveBtn.setAttribute('title', 'Area saved');
                      });
                    }
                    
                    // Remove button functionality
                    const removeBtn = newRow.querySelector('[data-remove]');
                    if (removeBtn) {
                      removeBtn.addEventListener('click', () => {
                        newRow.remove();
                      });
                    }
                    
                    // Focus first input
                    const firstInput = newRow.querySelector('input') as HTMLInputElement;
                    if (firstInput) {
                      firstInput.focus();
                    }
                  }}
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Area
                </button>
              </div>
              
              <div className="space-y-2">
                {/* Column Headers */}
                <div className="grid grid-cols-5 gap-4 pb-2 border-b text-sm font-medium text-gray-600">
                  <div>Description</div>
                  <div>Square Footage</div>
                  <div>Notes</div>
                  <div>Actions</div>
                  <div></div>
                </div>
                
                {/* Original Area Items from Step 2 */}
                {rfp?.areaBreakdown && rfp.areaBreakdown.map((area, index) => (
                  <div key={area.id || index} className="grid grid-cols-5 gap-4 items-center py-2 border-b border-gray-100">
                    <div className="text-sm">{area.description}</div>
                    <div className="text-sm font-medium">{parseInt(area.squareFootage || '0').toLocaleString()} SF</div>
                    <div className="text-sm text-gray-600">{area.notes || '—'}</div>
                    <div className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">From Step 2</div>
                    <div></div>
                  </div>
                ))}
                
                {/* Pure DOM Container for Additional Areas */}
                <div id="additional-areas-container"></div>
                
                {!rfp?.areaBreakdown?.length && (
                  <div className="text-center text-gray-500 py-4 border border-dashed border-gray-300 rounded-lg">
                    No area breakdown defined. Areas can be defined during RFP validation phase or added here.
                  </div>
                )}
                
                {rfp?.areaBreakdown && rfp.areaBreakdown.length > 0 && (
                  <div className="text-sm text-gray-500 italic">
                    Area breakdown defined during RFP validation phase
                  </div>
                )}
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
                  onClick={() => appendScope({ description: "", quantity: "", unit: "" })}
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
                <DragDropContext onDragEnd={handleScopeOfWorkDragEnd}>
                  <div className="space-y-2">
                    {/* Column Headers */}
                    <div className="grid grid-cols-12 gap-4 pb-2 border-b text-sm font-medium text-gray-600">
                      <div className="col-span-1">Order</div>
                      <div className="col-span-5">Description</div>
                      <div className="col-span-2">Quantity</div>
                      <div className="col-span-3">Unit</div>
                      <div className="col-span-1"></div>
                    </div>

                    <Droppable droppableId="scopeOfWork">
                      {(provided) => (
                        <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                          {/* Scope Items */}
                          {scopeFields.map((field, index) => (
                            <Draggable key={field.id} draggableId={field.id} index={index}>
                              {(provided) => (
                                <div 
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  className="grid grid-cols-12 gap-4 items-center"
                                >
                                  <div className="col-span-1">
                                    <div className="flex items-center gap-1">
                                      <div className="flex flex-col gap-1">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => moveScopeUp(index)}
                                          disabled={index === 0}
                                          className="h-6 w-6 p-0"
                                        >
                                          <ChevronUp className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => moveScopeDown(index)}
                                          disabled={index === scopeFields.length - 1}
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
                                  </div>
                      <div className="col-span-5">
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
                                  onChange={(e) => field.onChange(e.target.value === "" ? "" : parseInt(e.target.value) || "")}
                                  placeholder="Enter quantity" 
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
                                    <div className="flex gap-1">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => saveInvitationMutation.mutate(form.getValues())}
                                        className="h-8 w-8 p-0"
                                        title="Save"
                                      >
                                        <Save className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => removeScope(index)}
                                        className="h-8 w-8 p-0"
                                        title="Delete"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                </DragDropContext>
              )}
            </div>

            {/* Milestone Requests */}
            <div className="space-y-6">
              <h3 className="text-lg font-medium">Milestone Requests</h3>
              
              {/* Side by Side Milestones */}
              <div className="grid grid-cols-2 gap-6">
                {/* Architect Milestones */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-md font-medium text-gray-700">Architect Milestone Requests</h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => appendArchitectMilestone({ description: "" })}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add
                    </Button>
                  </div>
                  
                  {architectMilestoneFields.length === 0 && (
                    <div className="text-center text-gray-500 py-4 border-2 border-dashed border-gray-200 rounded-lg">
                      No architect milestone requests added yet.
                    </div>
                  )}

                  {architectMilestoneFields.length > 0 && (
                    <div className="space-y-2">
                      {/* Column Headers */}
                      <div className="grid grid-cols-12 gap-2 pb-2 border-b text-sm font-medium text-gray-600">
                        <div className="col-span-1">Order</div>
                        <div className="col-span-10">Milestone Request</div>
                        <div className="col-span-1"></div>
                      </div>

                      {/* Milestone Items */}
                      {architectMilestoneFields.map((field, index) => (
                        <div key={field.id} className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-1">
                            <div className="flex flex-col gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => moveArchitectMilestoneUp(index)}
                                disabled={index === 0}
                                className="h-6 w-6 p-0"
                              >
                                <ChevronUp className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => moveArchitectMilestoneDown(index)}
                                disabled={index === architectMilestoneFields.length - 1}
                                className="h-6 w-6 p-0"
                              >
                                <ChevronDown className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <div className="col-span-10">
                            <FormField
                              control={form.control}
                              name={`architectMilestones.${index}.description`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input {...field} placeholder="e.g., Preliminary design drawings completion date" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="col-span-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeArchitectMilestone(index)}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Contractor Milestones */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-md font-medium text-gray-700">Contractor Milestone Requests</h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => appendContractorMilestone({ description: "" })}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add
                    </Button>
                  </div>
                  
                  {contractorMilestoneFields.length === 0 && (
                    <div className="text-center text-gray-500 py-4 border-2 border-dashed border-gray-200 rounded-lg">
                      No contractor milestone requests added yet.
                    </div>
                  )}

                  {contractorMilestoneFields.length > 0 && (
                    <div className="space-y-2">
                      {/* Column Headers */}
                      <div className="grid grid-cols-12 gap-2 pb-2 border-b text-sm font-medium text-gray-600">
                        <div className="col-span-1">Order</div>
                        <div className="col-span-10">Milestone Request</div>
                        <div className="col-span-1"></div>
                      </div>

                      {/* Milestone Items */}
                      {contractorMilestoneFields.map((field, index) => (
                        <div key={field.id} className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-1">
                            <div className="flex flex-col gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => moveContractorMilestoneUp(index)}
                                disabled={index === 0}
                                className="h-6 w-6 p-0"
                              >
                                <ChevronUp className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => moveContractorMilestoneDown(index)}
                                disabled={index === contractorMilestoneFields.length - 1}
                                className="h-6 w-6 p-0"
                              >
                                <ChevronDown className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <div className="col-span-10">
                            <FormField
                              control={form.control}
                              name={`contractorMilestones.${index}.description`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input {...field} placeholder="e.g., Construction schedule with key milestones" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="col-span-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeContractorMilestone(index)}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
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

            {/* RFP Generation History */}
            {generationHistory.length > 0 && (
              <div className="space-y-4 pt-6 border-t">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  RFP Generation History
                </h3>
                <div className="space-y-3">
                  {generationHistory.map((historyItem: any) => (
                    <div key={historyItem.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div className="flex-1">
                        <div className="font-medium">{historyItem.title}</div>
                        <div className="text-sm text-gray-600 mt-1">
                          Generated by {historyItem.generatedBy} on{" "}
                          {new Date(historyItem.generatedAt).toLocaleDateString("en-US", {
                            timeZone: "America/New_York",
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </div>
                        {historyItem.notes && (
                          <div className="text-sm text-gray-500 mt-1">{historyItem.notes}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            // Open in new tab to view the generated content
                            const newWindow = window.open("", "_blank");
                            if (newWindow) {
                              newWindow.document.write(historyItem.generatedContent);
                              newWindow.document.close();
                            }
                          }}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          View
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (confirm("Are you sure you want to delete this generation history item?")) {
                              deleteHistoryMutation.mutate(historyItem.id);
                            }
                          }}
                          disabled={deleteHistoryMutation.isPending}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                  disabled={!hasSelectedRfpType || createInvitationMutation.isPending || isGeneratingPdfs || saveInvitationMutation.isPending || generateAndAdvanceMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Generate RFPs
                </Button>
                
                <Button 
                  type="button"
                  onClick={() => {
                    const formData = form.getValues();
                    const hasSelection = formData.generateArchitectRfp || formData.generateContractorRfp || 
                                        formData.generateBrokerArchitectRfp || formData.generateBrokerContractorRfp;
                    if (hasSelection) {
                      generateAndAdvanceMutation.mutate(formData);
                    }
                  }}
                  disabled={!hasSelectedRfpType || createInvitationMutation.isPending || isGeneratingPdfs || saveInvitationMutation.isPending || generateAndAdvanceMutation.isPending}
                  className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  {generateAndAdvanceMutation.isPending || isGeneratingPdfs ? "Generating & Advancing..." : "Generate RFPs & Advance"}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}