import { useState, useEffect, useCallback, memo, useRef } from "react";

// TEMP DIAG (scroll-jump hunt): counts modal mounts across the session.
let itbModalMountCounter = 0;
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
import MasterScopeItemPicker, { type MasterScopeSelection } from "@/components/master-scope-item-picker";
import { DragDropContext, Droppable, Draggable, DropResult } from "react-beautiful-dnd";
import type { RfpRequest, Property, Contact } from "@shared/schema";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";

// Helpers for per-role rfpVariant serialization
import { parseRfpVariant } from "@shared/rfp-variant";
const serializeRfpVariant = (gcEnhanced: boolean, archEnhanced: boolean): string => {
  if (!gcEnhanced && !archEnhanced) return 'standard';
  return JSON.stringify({ gc: gcEnhanced ? 'enhanced' : 'standard', architect: archEnhanced ? 'enhanced' : 'standard' });
};

const invitationFormSchema = z.object({
  generateArchitectRfp: z.boolean().default(false),
  generateContractorRfp: z.boolean().default(false),
  generateArchitectRfpEnhanced: z.boolean().default(false),
  generateContractorRfpEnhanced: z.boolean().default(false),
  generateBrokerArchitectRfp: z.boolean().default(false),
  generateBrokerContractorRfp: z.boolean().default(false),
  selectedContractor: z.string().optional(),
  selectedArchitect: z.string().optional(),
  additionalContractors: z.array(z.string()).default([]),
  additionalArchitects: z.array(z.string()).default([]),
  projectScope: z.string().optional().default(""),
  projectLocation: z.string().optional().default(""),
  contractorDueDate: z.string().optional().default(""),
  architectDueDate: z.string().optional().default(""),
  projectDescription: z.string().optional(),
  documentsLink: z.string().optional(),
  keyDates: z.array(z.object({
    label: z.string(),
    date: z.string(),
  })).default([]),
  scopeOfWork: z.array(z.object({
    description: z.string(),
    quantity: z.union([z.number(), z.string()]).transform((val) =>
      // parseFloat + strip formatting chars (house rule) — parseInt("1,000") === 1.
      typeof val === 'string' ? (val.trim() === '' ? 0 : (parseFloat(val.replace(/[^0-9.\-]/g, '')) || 0)) : val
    ),
    unit: z.string(),
    // Optional link to the ROM Pilot master scope catalog — set only when the row was
    // picked from the autocomplete. Free-typed rows simply omit these (unchanged behavior).
    masterItemId: z.number().nullable().optional(),
    // Carried through from Step-2 commits. zod strips undeclared keys, so these
    // MUST be declared here or saving the ITB silently destroys the retraction
    // stamp (proposalId) and the soft-cost exclusion marker (category).
    proposalId: z.number().nullable().optional(),
    category: z.string().nullable().optional(),
    masterItemSnapshot: z.object({
      description: z.string(),
      unit: z.string(),
      unitPrice: z.string(),
    }).nullable().optional(),
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
  onComplete?: () => void;
}

// Helper function to clean up project names by removing trailing dashes and spaces
const cleanProjectName = (projectName: string): string => {
  return projectName.replace(/\s*-\s*$/, '').trim();
};

// Pure DOM implementation - no React components to avoid re-rendering issues



export function InvitationToBidModal({ isOpen, onClose, rfp, onComplete }: InvitationToBidModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isGeneratingPdfs, setIsGeneratingPdfs] = useState(false);
  const [keyDates, setKeyDates] = useState<Array<{label: string, date: string}>>([]);
  const [additionalAreas, setAdditionalAreas] = useState<Array<{id: string, description: string, squareFootage: string, notes: string}>>([]);
  const [savedAreas, setSavedAreas] = useState<any[]>([]);
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [editingAreaData, setEditingAreaData] = useState<{description: string, squareFootage: string, notes: string}>({description: '', squareFootage: '', notes: ''});
  const modalRef = useRef<HTMLDivElement>(null);
  // TEMP DIAG: module-level mount counter — if the jump coincides with a NEW mount
  // number, the whole modal is being unmounted/remounted by its parent, which
  // resets every ref gate and explains everything. Lazy init = once per mount.
  const [mountId] = useState(() => ++itbModalMountCounter);

  // TEMP DIAG (scroll-jump hunt): records focus losses and large upward scroll
  // jumps inside the dialog. Rendered as tiny text under the header — a single
  // screenshot after the jump reproduces will name exactly what stole focus.
  const [focusDiag, setFocusDiag] = useState<string[]>([]);
  useEffect(() => {
    if (!isOpen) { setFocusDiag([]); return; }
    const el = modalRef.current;
    if (!el) return;
    const ident = (n: any) =>
      n?.getAttribute?.("data-testid") || n?.getAttribute?.("name") || (n?.tagName ? `${n.tagName}${n.id ? "#" + n.id : ""}` : "NULL(body)");
    const log = (msg: string) =>
      setFocusDiag((prev) => [...prev.slice(-3), `${new Date().toISOString().slice(14, 23)} ${msg}`]);
    log(`modal mount #${mountId}`);
    const onFocusOut = (e: FocusEvent) => log(`out: ${ident(e.target)} -> ${ident(e.relatedTarget)}`);
    const onFocusIn = (e: FocusEvent) => log(`in: ${ident(e.target)}`);
    let lastTop = el.scrollTop;
    const onScroll = () => {
      if (el.scrollTop < lastTop - 200) {
        log(`SCROLL JUMP ${Math.round(lastTop)} -> ${Math.round(el.scrollTop)} (active: ${ident(document.activeElement)})`);
        // Phone home: full trail into deployment logs (fire-and-forget).
        setFocusDiag((trail) => {
          apiRequest(`/api/client-diag`, "POST", { mountId, jump: `${Math.round(lastTop)}->${Math.round(el.scrollTop)}`, active: ident(document.activeElement), trail }).catch(() => {});
          return trail;
        });
      }
      lastTop = el.scrollTop;
    };
    el.addEventListener("focusout", onFocusOut);
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("focusout", onFocusOut);
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("scroll", onScroll);
    };
  }, [isOpen]);
  const [showEnhancedSection, setShowEnhancedSection] = useState(false);
  const [scheduleFields, setScheduleFields] = useState({
    targetLXE: '', targetNTP: '', targetMobilization: '',
    targetPermitDrawings: '', targetSubstantialCompletion: '', targetRCD: '',
  });
  const [localAlternates, setLocalAlternates] = useState<Array<{
    id: string; description: string; optionA: string; optionB: string; masterCategoryId: number | null; isNew?: boolean;
  }>>([]);
  
  // Custom refs for scope of work navigation
  const scopeRefs = useRef<{[key: string]: HTMLInputElement}>({});

  // Ref-based navigation system
  const navigateScope = (currentIndex: number, currentField: 'description' | 'quantity' | 'unit', direction: 'forward' | 'backward' = 'forward') => {
    if (direction === 'forward') {
      if (currentField === 'description') {
        const quantityRef = scopeRefs.current[`quantity-${currentIndex}`];
        if (quantityRef) {
          quantityRef.focus();
          quantityRef.select();
          return;
        }
      } else if (currentField === 'quantity') {
        const unitRef = scopeRefs.current[`unit-${currentIndex}`];
        if (unitRef) {
          unitRef.focus();
          unitRef.select();
          return;
        }
      } else if (currentField === 'unit') {
        const nextDescRef = scopeRefs.current[`description-${currentIndex + 1}`];
        if (nextDescRef) {
          nextDescRef.focus();
          nextDescRef.select();
          return;
        } else {
          // Add new row
          const addButton = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent?.includes('Add Line Item'));
          if (addButton) {
            (addButton as HTMLButtonElement).click();
            setTimeout(() => {
              const newDescRef = scopeRefs.current[`description-${currentIndex + 1}`];
              if (newDescRef) {
                newDescRef.focus();
                newDescRef.select();
              }
            }, 100);
          }
        }
      }
    } else {
      // Backward navigation
      if (currentField === 'unit') {
        const quantityRef = scopeRefs.current[`quantity-${currentIndex}`];
        if (quantityRef) {
          quantityRef.focus();
          quantityRef.select();
        }
      } else if (currentField === 'quantity') {
        const descRef = scopeRefs.current[`description-${currentIndex}`];
        if (descRef) {
          descRef.focus();
          descRef.select();
        }
      }
    }
  };

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

  // Display quantities with thousands separators (1,000). onChange stores raw digits
// and the zod transform strips formatting on submit, so storage stays numeric.
const formatQuantityDisplay = (val: any): string => {
  const s = (val ?? "").toString().replace(/,/g, "");
  if (s === "") return "";
  const [int, dec] = s.split(".");
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec !== undefined ? `${intFmt}.${dec}` : intFmt;
};

// Fetch the RFP fresh when the modal opens. The `rfp` prop can be stale (e.g. items
  // accepted from the AI parser in Step 2 were just written to rfp.scopeOfWork), so we
  // seed the scope of work from this instead of the possibly-stale prop.
  const { data: freshRfp, isFetched: freshRfpFetched } = useQuery<RfpRequest>({
    queryKey: [`/api/rfp-requests/${rfp?.id}`],
    enabled: isOpen && !!rfp?.id,
  });

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
      generateArchitectRfpEnhanced: false,
      generateContractorRfpEnhanced: false,
      generateBrokerArchitectRfp: false,
      generateBrokerContractorRfp: false,
      requestPricing: false,
      requestSchedule: false,
      requestSpacePlan: false,
      projectScope: rfp?.projectName || rfp?.tenantName || "",
      projectLocation: rfp?.projectAddress || rfp?.property || "",
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
      additionalContractors: [],
      additionalArchitects: [],
    },
  });

  const { fields: scopeFields, append: appendScope, remove: removeScope, replace: replaceScope } = useFieldArray({
    control: form.control,
    name: "scopeOfWork",
  });

  // TEMP DIAG: if the field-array ids regenerate, every row input remounts (focus dies).
  // Logging it directly confirms/refutes the remount theory at jump time.
  const scopeIdsRef = useRef<string>("");
  useEffect(() => {
    const ids = scopeFields.map((f) => f.id).join(",");
    if (scopeIdsRef.current && ids !== scopeIdsRef.current) {
      setFocusDiag((prev) => [...prev.slice(-3), `${new Date().toISOString().slice(14, 23)} ROWS REMOUNTED (${scopeFields.length})`]);
    }
    scopeIdsRef.current = ids;
  }, [scopeFields]);

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
    "generateArchitectRfpEnhanced",
    "generateContractorRfpEnhanced",
    "generateBrokerArchitectRfp",
    "generateBrokerContractorRfp"
  ]);
  
  const hasSelectedRfpType = watchedValues.some(value => value === true);

  // Fetch master categories for the alternates dropdown
  const { data: masterCategories = [] } = useQuery<any[]>({
    queryKey: ["/api/master-categories"],
    enabled: isOpen,
  });

  // Fetch project alternates for this RFP
  const { data: savedAlternates = [], refetch: refetchAlternates } = useQuery<any[]>({
    queryKey: ["/api/rfp-requests", rfp?.id, "project-alternates"],
    queryFn: async () => {
      if (!rfp?.id) return [];
      const response = await fetch(`/api/rfp-requests/${rfp.id}/project-alternates`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` },
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!rfp?.id && isOpen,
  });

  // Sync savedAlternates into localAlternates when modal opens
  useEffect(() => {
    if (isOpen && savedAlternates) {
      setLocalAlternates(savedAlternates.map((a: any) => ({
        id: a.id,
        description: a.description,
        optionA: a.optionA ?? '',
        optionB: a.optionB ?? '',
        masterCategoryId: a.masterCategoryId ?? null,
      })));
    }
  }, [isOpen, savedAlternates]);

  // Sync schedule fields from rfp prop
  useEffect(() => {
    if (isOpen && rfp) {
      const fmt = (v: any) => v ? new Date(v).toISOString().split('T')[0] : '';
      setScheduleFields({
        targetLXE: fmt((rfp as any).targetLXE),
        targetNTP: fmt((rfp as any).targetNTP),
        targetMobilization: fmt((rfp as any).targetMobilization),
        targetPermitDrawings: fmt((rfp as any).targetPermitDrawings),
        targetSubstantialCompletion: fmt((rfp as any).targetSubstantialCompletion),
        targetRCD: fmt((rfp as any).targetRCD),
      });
    }
  }, [isOpen, rfp]);

  // Fetch existing invitation data
  const { data: existingInvitation, isFetched: invitationFetched } = useQuery({
    queryKey: ["/api/rfp-requests", rfp?.id, "invitation-to-bid"],
    queryFn: async () => {
      if (!rfp?.id) return null;
      const response = await fetch(`/api/rfp-requests/${rfp.id}/invitation-to-bid`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` }
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!rfp?.id && isOpen,
  });

  // Sync savedAreas from rfp.areaBreakdown
  useEffect(() => {
    if (isOpen && rfp?.areaBreakdown) {
      setSavedAreas(rfp.areaBreakdown);
    }
  }, [isOpen, rfp?.areaBreakdown]);

  // Reset additional areas when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAdditionalAreas([]);
      setSavedAreas([]);
      setEditingAreaId(null);
    }
  }, [isOpen]);

  const updateAreaBreakdownMutation = useMutation({
    mutationFn: async (updatedAreas: any[]) => {
      if (!rfp) throw new Error("No RFP selected");
      return await apiRequest(`/api/rfp-requests/${rfp.id}`, "PATCH", { areaBreakdown: updatedAreas });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      setEditingAreaId(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update areas",
        variant: "destructive",
      });
    },
  });

  const handleDeleteArea = (areaId: string) => {
    const updatedAreas = savedAreas.filter(a => a.id !== areaId);
    setSavedAreas(updatedAreas);
    updateAreaBreakdownMutation.mutate(updatedAreas);
  };

  const handleEditArea = (area: any) => {
    setEditingAreaId(area.id);
    setEditingAreaData({
      description: area.description || '',
      squareFootage: area.squareFootage || '',
      notes: area.notes || '',
    });
  };

  const handleSaveEditArea = () => {
    if (!editingAreaId) return;
    const updatedAreas = savedAreas.map(a => 
      a.id === editingAreaId 
        ? { ...a, description: editingAreaData.description, squareFootage: editingAreaData.squareFootage, notes: editingAreaData.notes }
        : a
    );
    setSavedAreas(updatedAreas);
    updateAreaBreakdownMutation.mutate(updatedAreas);
  };

  // Pre-populate form with existing data — ONCE per modal open. This effect used to
  // re-run on every background refetch of its query deps (window focus, invalidation),
  // and its replaceScope() regenerated all field ids, remounting every row input and
  // killing focus after a single keystroke. The ref gates it to one seed per open.
  const seededForOpenRef = useRef(false);
  useEffect(() => {
    if (!isOpen) { seededForOpenRef.current = false; return; }
    if (seededForOpenRef.current) return;
    if (!freshRfpFetched || !invitationFetched) return;
    if (rfp && properties.length > 0 && contacts.length > 0) {
      seededForOpenRef.current = true;
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
        generateArchitectRfpEnhanced: false,
        generateContractorRfpEnhanced: false,
        generateBrokerArchitectRfp: false,
        generateBrokerContractorRfp: false,

        selectedContractor: rfp.generalContractor || "none",
        selectedArchitect: rfp.architect || "none",
        additionalContractors: (rfp as any).additionalContractors || [],
        additionalArchitects: (rfp as any).additionalArchitects || [],
        projectScope: cleanProjectName(rfp.projectName),
        projectLocation: getPropertyAddress(rfp.property) || "",
        contractorDueDate: rfp.contractorDueDate ? new Date(rfp.contractorDueDate).toISOString().split('T')[0] : "",
        architectDueDate: rfp.architectDueDate ? new Date(rfp.architectDueDate).toISOString().split('T')[0] : "",

        projectDescription: rfp.projectDescription || "",
        documentsLink: rfp.documentsLink || "",
        keyDates: [],
        // Seed from the RFP's scope of work (e.g. items accepted from the AI intake
        // parser in Step 2 land in rfp.scopeOfWork). Previously hardcoded [], so
        // anything on the RFP never reached Step 3. Shapes are identical.
        scopeOfWork: Array.isArray((freshRfp as any)?.scopeOfWork)
          ? (freshRfp as any).scopeOfWork
          : (Array.isArray((rfp as any).scopeOfWork) ? (rfp as any).scopeOfWork : []),
        architectMilestones: [],
        contractorMilestones: [],
      };

      // Parse rfpVariant to set per-role checkbox state
      const rfpVariantParsed = parseRfpVariant(existingInvitation?.rfpVariant);

      // Merge with existing invitation data if available
      const formValues = existingInvitation ? {
        ...defaultValues,
        generateContractorRfpEnhanced: rfpVariantParsed.gc === 'enhanced',
        generateArchitectRfpEnhanced: rfpVariantParsed.architect === 'enhanced',
        selectedContractor: existingInvitation.selectedContractor || defaultValues.selectedContractor,
        selectedArchitect: existingInvitation.selectedArchitect || defaultValues.selectedArchitect,
        additionalContractors: existingInvitation.additionalContractors || defaultValues.additionalContractors,
        additionalArchitects: existingInvitation.additionalArchitects || defaultValues.additionalArchitects,
        contractorDueDate: existingInvitation.contractorDueDate ? 
          new Date(existingInvitation.contractorDueDate).toISOString().split('T')[0] : defaultValues.contractorDueDate,
        architectDueDate: existingInvitation.architectDueDate ? 
          new Date(existingInvitation.architectDueDate).toISOString().split('T')[0] : defaultValues.architectDueDate,

        // Contact information will be automatically populated from RFP validation data in PDF generation
        projectDescription: existingInvitation.projectDescription || "",
        documentsLink: existingInvitation.documentsLink || "",
        keyDates: Array.isArray(existingInvitation.keyDates) ? existingInvitation.keyDates : [],
        // Merge ITB scope with the RFP's current scope (Step 2 is a living review loop):
        // - ITB rows stamped with a proposalId survive only if that proposal is still
        //   in the RFP's scope — retracted / re-parsed items drop out, and surviving
        //   rows KEEP their Step-3 quantity/unit edits.
        // - Unstamped ITB rows (manual or pre-stamping legacy) are always kept.
        // - RFP rows not yet in the ITB (new accepts) are appended; unstamped RFP
        //   rows match by description to avoid duplicates.
        scopeOfWork: (() => {
          const itbScope = Array.isArray(existingInvitation.scopeOfWork) ? existingInvitation.scopeOfWork : [];
          const rfpScope = (defaultValues.scopeOfWork as any[]) || [];
          if (itbScope.length === 0) return rfpScope;
          const norm = (d: any) => (d || "").toString().trim().toLowerCase();
          const rfpPids = new Set(rfpScope.map((r: any) => r?.proposalId).filter((x: any) => x != null));
          const kept = itbScope.filter((row: any) => row?.proposalId == null || rfpPids.has(row.proposalId));
          const keptPids = new Set(kept.map((r: any) => r?.proposalId).filter((x: any) => x != null));
          const keptDescs = new Set(kept.map((r: any) => norm(r?.description)));
          const added = rfpScope.filter((r: any) =>
            r?.proposalId != null ? !keptPids.has(r.proposalId) : !keptDescs.has(norm(r?.description))
          );
          return [...kept, ...added];
        })(),
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
  }, [rfp, freshRfp, freshRfpFetched, isOpen, existingInvitation, invitationFetched, form, properties, contacts]);

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
        // Transform scope of work to ensure quantity is a number.
        // masterItemId/masterItemSnapshot are forwarded as-is via the spread — undefined/null
        // on free-typed rows, populated only when picked from the catalog autocomplete.
        scopeOfWork: data.scopeOfWork.map(item => ({
          ...item,
          quantity: typeof item.quantity === 'string' ? parseFloat(item.quantity) || 0 : item.quantity
        })),
        architectMilestones: data.architectMilestones,
        contractorMilestones: data.contractorMilestones,
        // Include contractor and architect selections
        selectedContractor: data.selectedContractor !== 'none' ? data.selectedContractor : null,
        selectedArchitect: data.selectedArchitect !== 'none' ? data.selectedArchitect : null,
        additionalContractors: data.additionalContractors || [],
        additionalArchitects: data.additionalArchitects || [],
        // Include additional areas from step 3
        additionalAreas: additionalAreas.filter(area => 
          area.description.trim() && area.squareFootage.trim()
        ).map(area => ({
          description: area.description.trim(),
          squareFootage: area.squareFootage.trim(),
          notes: area.notes.trim() || null
        })),
      };
      
      // Derive and persist rfpVariant
      const gcEnhanced = (data as any).generateContractorRfpEnhanced === true;
      const archEnhanced = (data as any).generateArchitectRfpEnhanced === true;
      const rfpVariant = serializeRfpVariant(gcEnhanced, archEnhanced);

      // Persist RFP type selection flags. Standard OR enhanced OR broker variants all
      // count — any contractor selection means contractorRfpRequired=true, etc. These
      // flags are stored on invitation_to_bid and read by the workflow-phase validator
      // to condition due-date requirements (date only required when type was selected).
      const contractorRfpRequired =
        (data as any).generateContractorRfp         === true ||
        (data as any).generateContractorRfpEnhanced === true ||
        (data as any).generateBrokerContractorRfp   === true;
      const architectRfpRequired =
        (data as any).generateArchitectRfp         === true ||
        (data as any).generateArchitectRfpEnhanced === true ||
        (data as any).generateBrokerArchitectRfp   === true;

      const transformedWithVariant = {
        ...transformedData,
        rfpVariant,
        contractorRfpRequired,
        architectRfpRequired,
      };

      // Persist schedule fields to rfp_requests if any are set
      const anyScheduleSet = Object.values(scheduleFields).some(v => v !== '');
      if (anyScheduleSet) {
        const schedulePayload: Record<string, string | null> = {};
        if (scheduleFields.targetLXE) schedulePayload.targetLXE = new Date(scheduleFields.targetLXE).toISOString();
        if (scheduleFields.targetNTP) schedulePayload.targetNTP = new Date(scheduleFields.targetNTP).toISOString();
        if (scheduleFields.targetMobilization) schedulePayload.targetMobilization = new Date(scheduleFields.targetMobilization).toISOString();
        if (scheduleFields.targetPermitDrawings) schedulePayload.targetPermitDrawings = new Date(scheduleFields.targetPermitDrawings).toISOString();
        if (scheduleFields.targetSubstantialCompletion) schedulePayload.targetSubstantialCompletion = new Date(scheduleFields.targetSubstantialCompletion).toISOString();
        if (scheduleFields.targetRCD) schedulePayload.targetRCD = new Date(scheduleFields.targetRCD).toISOString();
        await apiRequest(`/api/rfp-requests/${rfp.id}`, "PATCH", schedulePayload);
      }

      // Persist new alternates
      for (const alt of localAlternates.filter(a => a.isNew)) {
        await apiRequest(`/api/rfp-requests/${rfp.id}/project-alternates`, "POST", {
          description: alt.description,
          optionA: alt.optionA || null,
          optionB: alt.optionB || null,
          masterCategoryId: alt.masterCategoryId || null,
        });
      }

      // Save or update invitation to bid record
      if (existingInvitation) {
        return await apiRequest(`/api/rfp-requests/${rfp.id}/invitation-to-bid`, "PATCH", transformedWithVariant);
      } else {
        return await apiRequest("/api/invitation-to-bid", "POST", {
          rfpId: rfp.id,
          ...transformedWithVariant,
        });
      }
    },
    onSuccess: (updatedInvitation) => {
      toast({
        title: "Invitation Saved",
        description: "Your invitation details have been saved successfully.",
        duration: 4000,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests", rfp?.id, "invitation-to-bid"] });

      // ROOT CAUSE of the scroll-jump/focus-loss bug (confirmed via the ROWS
      // REMOUNTED diag): this handler used to form.reset(...) + replaceScope(...)
      // 100ms after every save — regenerating all useFieldArray ids and
      // remounting every row input, killing focus and snapping the dialog scroll
      // while the user was already typing in the next field (row save button →
      // click into quantity → save response lands → remount). The reset was
      // redundant: the form already holds exactly the values that were saved.
      // The invalidate above refreshes background data; the once-per-open seed
      // guard ensures it can't clobber the live form.
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
      
      const documentsToOpen: Array<{type: string, title: string, recipientName: string}> = [];
      
      // Get all contractors (primary + additional)
      const allContractors = [
        data.selectedContractor && data.selectedContractor !== "none" ? data.selectedContractor : null,
        ...(data.additionalContractors || []).filter(c => c && c.trim())
      ].filter(Boolean) as string[];
      
      // Get all architects (primary + additional)
      const allArchitects = [
        data.selectedArchitect && data.selectedArchitect !== "none" ? data.selectedArchitect : null,
        ...(data.additionalArchitects || []).filter(a => a && a.trim())
      ].filter(Boolean) as string[];
      
      if (data.generateArchitectRfp) {
        allArchitects.forEach(architect => {
          documentsToOpen.push({ type: "architect", title: `Architect RFP - ${architect}`, recipientName: architect });
        });
        if (allArchitects.length === 0) {
          documentsToOpen.push({ type: "architect", title: "Architect RFP", recipientName: "" });
        }
      }
      if (data.generateArchitectRfpEnhanced) {
        allArchitects.forEach(architect => {
          documentsToOpen.push({ type: "architect-enhanced", title: `Architect RFP (Enhanced) - ${architect}`, recipientName: architect });
        });
        if (allArchitects.length === 0) {
          documentsToOpen.push({ type: "architect-enhanced", title: "Architect RFP — Enhanced", recipientName: "" });
        }
      }
      if (data.generateContractorRfp) {
        allContractors.forEach(contractor => {
          documentsToOpen.push({ type: "contractor", title: `Contractor RFP - ${contractor}`, recipientName: contractor });
        });
        if (allContractors.length === 0) {
          documentsToOpen.push({ type: "contractor", title: "Contractor RFP", recipientName: "" });
        }
      }
      if (data.generateContractorRfpEnhanced) {
        allContractors.forEach(contractor => {
          documentsToOpen.push({ type: "contractor-enhanced", title: `GC RFP (Enhanced) - ${contractor}`, recipientName: contractor });
        });
        if (allContractors.length === 0) {
          documentsToOpen.push({ type: "contractor-enhanced", title: "GC RFP — Enhanced", recipientName: "" });
        }
      }
      if (data.generateBrokerArchitectRfp) {
        allArchitects.forEach(architect => {
          documentsToOpen.push({ type: "broker-architect", title: `Broker Architect RFP - ${architect}`, recipientName: architect });
        });
        if (allArchitects.length === 0) {
          documentsToOpen.push({ type: "broker-architect", title: "Broker Architect RFP", recipientName: "" });
        }
      }
      if (data.generateBrokerContractorRfp) {
        allContractors.forEach(contractor => {
          documentsToOpen.push({ type: "broker-contractor", title: `Broker Contractor RFP - ${contractor}`, recipientName: contractor });
        });
        if (allContractors.length === 0) {
          documentsToOpen.push({ type: "broker-contractor", title: "Broker Contractor RFP", recipientName: "" });
        }
      }
      
      // Save invitation data first
      await saveInvitationMutation.mutateAsync(data);
      
      // Generate and open documents
      for (let i = 0; i < documentsToOpen.length; i++) {
        const doc = documentsToOpen[i];
        try {
          const token = localStorage.getItem(AUTH_TOKEN_KEY);
          const response = await fetch(`/api/rfp-requests/${rfp.id}/generate-pdf`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              recipientType: doc.type,
              recipientName: doc.recipientName || "",
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
        duration: 6000,
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
      
      const documentsToOpen: Array<{type: string, title: string, recipientName: string}> = [];
      
      // Get all contractors (primary + additional)
      const allContractors = [
        data.selectedContractor && data.selectedContractor !== "none" ? data.selectedContractor : null,
        ...(data.additionalContractors || []).filter(c => c && c.trim())
      ].filter(Boolean) as string[];
      
      // Get all architects (primary + additional)
      const allArchitects = [
        data.selectedArchitect && data.selectedArchitect !== "none" ? data.selectedArchitect : null,
        ...(data.additionalArchitects || []).filter(a => a && a.trim())
      ].filter(Boolean) as string[];
      
      if (data.generateArchitectRfp) {
        allArchitects.forEach(architect => {
          documentsToOpen.push({ type: "architect", title: `Architect RFP - ${architect}`, recipientName: architect });
        });
        if (allArchitects.length === 0) {
          documentsToOpen.push({ type: "architect", title: "Architect RFP", recipientName: "" });
        }
      }
      if (data.generateArchitectRfpEnhanced) {
        allArchitects.forEach(architect => {
          documentsToOpen.push({ type: "architect-enhanced", title: `Architect RFP (Enhanced) - ${architect}`, recipientName: architect });
        });
        if (allArchitects.length === 0) {
          documentsToOpen.push({ type: "architect-enhanced", title: "Architect RFP — Enhanced", recipientName: "" });
        }
      }
      if (data.generateContractorRfp) {
        allContractors.forEach(contractor => {
          documentsToOpen.push({ type: "contractor", title: `Contractor RFP - ${contractor}`, recipientName: contractor });
        });
        if (allContractors.length === 0) {
          documentsToOpen.push({ type: "contractor", title: "Contractor RFP", recipientName: "" });
        }
      }
      if (data.generateContractorRfpEnhanced) {
        allContractors.forEach(contractor => {
          documentsToOpen.push({ type: "contractor-enhanced", title: `GC RFP (Enhanced) - ${contractor}`, recipientName: contractor });
        });
        if (allContractors.length === 0) {
          documentsToOpen.push({ type: "contractor-enhanced", title: "GC RFP — Enhanced", recipientName: "" });
        }
      }
      if (data.generateBrokerArchitectRfp) {
        allArchitects.forEach(architect => {
          documentsToOpen.push({ type: "broker-architect", title: `Broker Architect RFP - ${architect}`, recipientName: architect });
        });
        if (allArchitects.length === 0) {
          documentsToOpen.push({ type: "broker-architect", title: "Broker Architect RFP", recipientName: "" });
        }
      }
      if (data.generateBrokerContractorRfp) {
        allContractors.forEach(contractor => {
          documentsToOpen.push({ type: "broker-contractor", title: `Broker Contractor RFP - ${contractor}`, recipientName: contractor });
        });
        if (allContractors.length === 0) {
          documentsToOpen.push({ type: "broker-contractor", title: "Broker Contractor RFP", recipientName: "" });
        }
      }
      
      // Save invitation data first
      await saveInvitationMutation.mutateAsync(data);
      
      // Generate and open documents
      for (let i = 0; i < documentsToOpen.length; i++) {
        const doc = documentsToOpen[i];
        try {
          const token = localStorage.getItem(AUTH_TOKEN_KEY);
          const response = await fetch(`/api/rfp-requests/${rfp.id}/generate-pdf`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              recipientType: doc.type,
              recipientName: doc.recipientName || "",
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
      // Auto-advance: Call onComplete to open Bid Collection
      onComplete?.();
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

  const skipToBudgetMutation = useMutation({
    mutationFn: async () => {
      if (!rfp) throw new Error("No RFP selected");
      
      // Save current form data first
      const formData = form.getValues();
      await saveInvitationMutation.mutateAsync(formData);
      
      // Advance workflow directly to evaluation phase (budget phase)
      const advanceResponse = await apiRequest(`/api/rfp-requests/${rfp.id}/workflow-phase`, "PATCH", { 
        phase: "evaluation" 
      });
      
      return advanceResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      toast({
        title: "Success",
        description: "Skipped to Budget phase - ready for in-house budget work",
      });
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to skip to budget phase",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InvitationFormData) => {
    // Check if at least one option is selected
    const hasSelection = data.generateArchitectRfp || data.generateContractorRfp || 
                        data.generateArchitectRfpEnhanced || data.generateContractorRfpEnhanced ||
                        data.generateBrokerArchitectRfp || data.generateBrokerContractorRfp;
    
    if (!hasSelection) {
      return;
    }
    
    createInvitationMutation.mutate(data);
  };

  if (!rfp) return null;

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent ref={modalRef} className="max-w-4xl max-h-[90vh] overflow-y-auto">
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
          <form onSubmit={form.handleSubmit(onSubmit, (errors) => {
            console.warn('[InvitationModal] Form validation failed:', errors);
            toast({ title: "Form validation failed", description: "One or more fields are invalid — check the browser console for details.", variant: "destructive" });
          })} className="space-y-6" key={`itb-form-${Date.now()}`}>
            {/* Project Information - MOVED TO TOP FOR BETTER TAB ORDER */}
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

            {/* RFP Type Selection */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Select RFP Types to Generate</h3>
              {/* Standard / Enhanced pairs */}
              <div className="grid grid-cols-2 gap-3">
                {/* GC standard */}
                <FormField
                  control={form.control}
                  name="generateContractorRfp"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-3 border rounded-lg hover:bg-gray-50">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            field.onChange(checked);
                            if (checked) form.setValue("generateContractorRfpEnhanced", false);
                          }}
                          tabIndex={-1}
                        />
                      </FormControl>
                      <div className="space-y-0.5 leading-none">
                        <FormLabel>GC RFP</FormLabel>
                        <p className="text-xs text-gray-500">Standard contractor RFP</p>
                      </div>
                    </FormItem>
                  )}
                />
                {/* GC enhanced */}
                <FormField
                  control={form.control}
                  name="generateContractorRfpEnhanced"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-3 border border-indigo-200 rounded-lg hover:bg-indigo-50">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            field.onChange(checked);
                            if (checked) form.setValue("generateContractorRfp", false);
                          }}
                          tabIndex={-1}
                        />
                      </FormControl>
                      <div className="space-y-0.5 leading-none">
                        <FormLabel className="text-indigo-700">GC RFP — Enhanced</FormLabel>
                        <p className="text-xs text-indigo-500">Includes schedule &amp; alternates</p>
                      </div>
                    </FormItem>
                  )}
                />
                {/* Architect standard */}
                <FormField
                  control={form.control}
                  name="generateArchitectRfp"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-3 border rounded-lg hover:bg-gray-50">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            field.onChange(checked);
                            if (checked) form.setValue("generateArchitectRfpEnhanced", false);
                          }}
                          tabIndex={-1}
                        />
                      </FormControl>
                      <div className="space-y-0.5 leading-none">
                        <FormLabel>Architect RFP</FormLabel>
                        <p className="text-xs text-gray-500">Standard architect RFP</p>
                      </div>
                    </FormItem>
                  )}
                />
                {/* Architect enhanced */}
                <FormField
                  control={form.control}
                  name="generateArchitectRfpEnhanced"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-3 border border-indigo-200 rounded-lg hover:bg-indigo-50">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            field.onChange(checked);
                            if (checked) form.setValue("generateArchitectRfp", false);
                          }}
                          tabIndex={-1}
                        />
                      </FormControl>
                      <div className="space-y-0.5 leading-none">
                        <FormLabel className="text-indigo-700">Architect RFP — Enhanced</FormLabel>
                        <p className="text-xs text-indigo-500">Includes schedule &amp; alternates</p>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
              {/* Broker response checkboxes (unchanged) */}
              <div className="grid grid-cols-2 gap-3 pt-1 border-t">
                <FormField
                  control={form.control}
                  name="generateBrokerArchitectRfp"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} tabIndex={-1} />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Architect RFP (Broker Response)</FormLabel>
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
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} tabIndex={-1} />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>GC RFP (Broker Response)</FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Contractor and Architect Selection */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Contractor and Architect Selection</h3>
              <div className="grid grid-cols-2 gap-6">
                {/* Contractors Column */}
                <div className="space-y-3">
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
                            tabIndex={-1}
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
                  
                  {/* Additional Contractors */}
                  {form.watch("additionalContractors")?.map((contractor, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <select
                          value={contractor}
                          onChange={(e) => {
                            const current = form.getValues("additionalContractors") || [];
                            const updated = [...current];
                            updated[index] = e.target.value;
                            form.setValue("additionalContractors", updated);
                          }}
                          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 appearance-none"
                        >
                          <option value="">Select contractor</option>
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const current = form.getValues("additionalContractors") || [];
                          form.setValue("additionalContractors", current.filter((_, i) => i !== index));
                        }}
                        className="h-10 w-10 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const current = form.getValues("additionalContractors") || [];
                      form.setValue("additionalContractors", [...current, ""]);
                    }}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Contractor
                  </Button>
                </div>

                {/* Architects Column */}
                <div className="space-y-3">
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
                            tabIndex={-1}
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
                  
                  {/* Additional Architects */}
                  {form.watch("additionalArchitects")?.map((architect, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <select
                          value={architect}
                          onChange={(e) => {
                            const current = form.getValues("additionalArchitects") || [];
                            const updated = [...current];
                            updated[index] = e.target.value;
                            form.setValue("additionalArchitects", updated);
                          }}
                          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 appearance-none"
                        >
                          <option value="">Select architect</option>
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const current = form.getValues("additionalArchitects") || [];
                          form.setValue("additionalArchitects", current.filter((_, i) => i !== index));
                        }}
                        className="h-10 w-10 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const current = form.getValues("additionalArchitects") || [];
                      form.setValue("additionalArchitects", [...current, ""]);
                    }}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Architect
                  </Button>
                </div>
              </div>
            </div>

            {/* Enhanced RFP — Schedule & Alternates */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowEnhancedSection(v => !v)}
                className="w-full flex items-center justify-between p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-left hover:bg-indigo-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-indigo-800">Enhanced RFP — Schedule &amp; Alternates</span>
                  <span className="text-xs text-indigo-600 font-normal">Only used when generating an Enhanced variant.</span>
                </div>
                <ChevronDown className={`h-4 w-4 text-indigo-600 transition-transform ${showEnhancedSection ? "rotate-180" : ""}`} />
              </button>

              {showEnhancedSection && (
                <div className="border border-indigo-200 rounded-lg p-4 space-y-6 bg-indigo-50/30">
                  {/* Schedule Milestones */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800 mb-3">Target Schedule Milestones</h4>
                    <div className="grid grid-cols-2 gap-4">
                      {([
                        { key: 'targetLXE', label: 'Target LXE (Lease Execution)' },
                        { key: 'targetNTP', label: 'Target NTP (Notice to Proceed)' },
                        { key: 'targetMobilization', label: 'Target Mobilization' },
                        { key: 'targetPermitDrawings', label: 'Target Permit Drawings' },
                        { key: 'targetSubstantialCompletion', label: 'Target Substantial Completion' },
                        { key: 'targetRCD', label: 'Target RCD (Rent Commencement)' },
                      ] as const).map(({ key, label }) => (
                        <div key={key} className="space-y-1">
                          <label className="text-xs font-medium text-gray-700">{label}</label>
                          <input
                            type="date"
                            value={scheduleFields[key]}
                            onChange={(e) => setScheduleFields(prev => ({ ...prev, [key]: e.target.value }))}
                            className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Project Alternates */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-800">Project Alternates</h4>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setLocalAlternates(prev => [...prev, {
                          id: `new-${Date.now()}`,
                          description: '',
                          optionA: '',
                          optionB: '',
                          masterCategoryId: null,
                          isNew: true,
                        }])}
                      >
                        <Plus className="h-3 w-3 mr-1" /> Add Alternate
                      </Button>
                    </div>

                    {localAlternates.length === 0 && (
                      <p className="text-xs text-gray-500 italic">No alternates added. Click "Add Alternate" to include bid alternates in the Enhanced RFP.</p>
                    )}

                    <div className="space-y-3">
                      {localAlternates.map((alt, idx) => (
                        <div key={alt.id} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-start p-3 bg-white border border-gray-200 rounded-lg">
                          <div className="col-span-4 grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-gray-600">Description *</label>
                              <input
                                type="text"
                                value={alt.description}
                                onChange={(e) => setLocalAlternates(prev => prev.map((a, i) => i === idx ? { ...a, description: e.target.value } : a))}
                                placeholder="Alternate description"
                                className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-400"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-gray-600">Option A</label>
                              <input
                                type="text"
                                value={alt.optionA}
                                onChange={(e) => setLocalAlternates(prev => prev.map((a, i) => i === idx ? { ...a, optionA: e.target.value } : a))}
                                placeholder="e.g., Include"
                                className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-400"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-gray-600">Option B</label>
                              <input
                                type="text"
                                value={alt.optionB}
                                onChange={(e) => setLocalAlternates(prev => prev.map((a, i) => i === idx ? { ...a, optionB: e.target.value } : a))}
                                placeholder="e.g., Exclude"
                                className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-400"
                              />
                            </div>
                            <div className="flex items-end pb-0.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                                onClick={async () => {
                                  if (!alt.isNew && rfp?.id) {
                                    try {
                                      await apiRequest(`/api/project-alternates/${alt.id}`, "DELETE");
                                      refetchAlternates();
                                    } catch (e) { console.error(e); }
                                  }
                                  setLocalAlternates(prev => prev.filter((_, i) => i !== idx));
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                          <div className="col-span-4">
                            <label className="text-xs font-medium text-gray-600">Category</label>
                            <select
                              value={alt.masterCategoryId ?? ''}
                              onChange={(e) => setLocalAlternates(prev => prev.map((a, i) => i === idx ? { ...a, masterCategoryId: e.target.value ? parseInt(e.target.value) : null } : a))}
                              className="w-full text-xs border border-gray-300 rounded px-2 py-1 mt-1"
                            >
                              <option value="">— No category —</option>
                              {masterCategories.map((mc: any) => (
                                <option key={mc.id} value={mc.id}>{mc.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Area Breakdown UI removed from ITB workflow per spec — data model, DB column, and
                downstream consumers (evaluation-budget.tsx, pdf-generator.ts, rfp-validation-modal.tsx,
                project-report-generator.tsx, historical-pricing-reports.ts) are untouched. */}

            {/* Scope of Work */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Scope of Work</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  tabIndex={-1}
                  onClick={() => appendScope({ description: "", quantity: "", unit: "", masterItemId: null, masterItemSnapshot: null })}
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
                                          tabIndex={-1}
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
                                          tabIndex={-1}
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
                                        tabIndex={-1}
                                      >
                                        <GripVertical className="h-4 w-4 text-gray-400" />
                                      </div>
                                    </div>
                                  </div>
                      <div className="col-span-5">
                        <FormField
                          control={form.control}
                          name={`scopeOfWork.${index}.description`}
                          render={({ field }) => {
                            const linkedMasterItemId = form.watch(`scopeOfWork.${index}.masterItemId`);
                            return (
                              <FormItem>
                                <FormControl>
                                  <MasterScopeItemPicker
                                    searchEndpoint="/api/master-scope-items/search"
                                    name={`scopeOfWork.${index}.description`}
                                    value={field.value}
                                    masterItemId={linkedMasterItemId}
                                    onSelect={(sel: MasterScopeSelection) => {
                                      field.onChange(sel.description);
                                      form.setValue(`scopeOfWork.${index}.unit`, sel.unit ?? "");
                                      form.setValue(`scopeOfWork.${index}.masterItemId`, sel.type === "master" ? (sel.masterItemId ?? null) : null);
                                      form.setValue(`scopeOfWork.${index}.masterItemSnapshot`, sel.type === "master" ? (sel.snapshot ?? null) : null);
                                    }}
                                    onBlur={(typed) => {
                                      // Only act when the user actually changed the text.
                                      // A plain focus-then-blur (no edits) fires onBlur with the
                                      // same value that's already in the field — leave everything intact.
                                      if (typed === field.value) return;
                                      field.onChange(typed);
                                      // User typed something new — clear any stale catalog link so
                                      // the row is treated as a plain free-typed entry.
                                      if (linkedMasterItemId) {
                                        form.setValue(`scopeOfWork.${index}.masterItemId`, null);
                                        form.setValue(`scopeOfWork.${index}.masterItemSnapshot`, null);
                                      }
                                    }}
                                    placeholder="Work description"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            );
                          }}
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
                                  type="text" 
                                  {...field} 
                                  value={formatQuantityDisplay(field.value)}
                                  data-testid={`quantity-${index}`}
                                  onChange={(e) => field.onChange(e.target.value.replace(/[^0-9.]/g, ""))}
                                  placeholder="Quantity"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Tab' && !e.shiftKey) {
                                      e.preventDefault();
                                      // Focus next input (unit) in same row
                                      const unitInput = document.querySelector(`input[data-testid="unit-${index}"]`) as HTMLInputElement;
                                      if (unitInput) {
                                        unitInput.focus();
                                        unitInput.select();
                                      }
                                    } else if (e.key === 'Tab' && e.shiftKey) {
                                      e.preventDefault();
                                      // Focus previous input (description) in same row
                                      const descInput = document.querySelector(`input[name="scopeOfWork.${index}.description"]`) as HTMLInputElement;
                                      if (descInput) {
                                        descInput.focus();
                                        descInput.select();
                                      }
                                    }
                                  }}
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
                                            <Input 
                                              {...field} 
                                              data-testid={`unit-${index}`} 
                                              placeholder="sq ft, each, etc."
                                              onKeyDown={(e) => {
                                                if (e.key === 'Tab' && !e.shiftKey) {
                                                  e.preventDefault();
                                                  // Check if this is the last row
                                                  if (index === scopeFields.length - 1) {
                                                    // Add new row and focus it
                                                    appendScope({ description: "", quantity: "", unit: "", masterItemId: null, masterItemSnapshot: null });
                                                    // Focus will be set to new row after creation
                                                    setTimeout(() => {
                                                      const newDescInput = document.querySelector(`input[name="scopeOfWork.${index + 1}.description"]`) as HTMLInputElement;
                                                      if (newDescInput) {
                                                        newDescInput.focus();
                                                        newDescInput.select();
                                                      }
                                                    }, 50);
                                                  } else {
                                                    // Focus next row's description
                                                    const nextDescInput = document.querySelector(`input[name="scopeOfWork.${index + 1}.description"]`) as HTMLInputElement;
                                                    if (nextDescInput) {
                                                      nextDescInput.focus();
                                                      nextDescInput.select();
                                                    }
                                                  }
                                                } else if (e.key === 'Tab' && e.shiftKey) {
                                                  e.preventDefault();
                                                  // Focus previous input (quantity) in same row
                                                  const quantityInput = document.querySelector(`input[data-testid="quantity-${index}"]`) as HTMLInputElement;
                                                  if (quantityInput) {
                                                    quantityInput.focus();
                                                    quantityInput.select();
                                                  }
                                                }
                                              }}
                                            />
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
                                        tabIndex={-1}
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
                                        tabIndex={-1}
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
            <div className="flex justify-end items-center pt-6 border-t">
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
                  onClick={async () => {
                    // Run the same Zod validation as the "Generate RFPs" submit button before
                    // proceeding, so this button can no longer bypass form validation.
                    const isValid = await form.trigger();
                    if (!isValid) {
                      console.warn('[InvitationModal] Advance button blocked by validation errors:', form.formState.errors);
                      toast({ title: "Form validation failed", description: "One or more fields are invalid — check the highlighted fields.", variant: "destructive" });
                      return;
                    }

                    const formData = form.getValues();
                    const hasSelection = formData.generateArchitectRfp || formData.generateContractorRfp || 
                                        formData.generateArchitectRfpEnhanced || formData.generateContractorRfpEnhanced ||
                                        formData.generateBrokerArchitectRfp || formData.generateBrokerContractorRfp;
                    if (!hasSelection) {
                      toast({ title: "Selection required", description: "Select at least one RFP type to generate.", variant: "destructive" });
                      return;
                    }
                    generateAndAdvanceMutation.mutate(formData);
                  }}
                  disabled={!hasSelectedRfpType || createInvitationMutation.isPending || isGeneratingPdfs || saveInvitationMutation.isPending || generateAndAdvanceMutation.isPending || skipToBudgetMutation.isPending}
                  className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  {generateAndAdvanceMutation.isPending || isGeneratingPdfs ? "Generating & Advancing..." : "Generate RFPs & Advance"}
                </Button>
                
                <Button 
                  type="button"
                  onClick={() => skipToBudgetMutation.mutate()}
                  disabled={createInvitationMutation.isPending || isGeneratingPdfs || saveInvitationMutation.isPending || generateAndAdvanceMutation.isPending || skipToBudgetMutation.isPending}
                  className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                >
                  {skipToBudgetMutation.isPending ? "Skipping..." : "Skip to Evaluation"}
                </Button>
              </div>
            </div>
          </form>
        </Form>
        {focusDiag.length > 0 && (
          <div
            data-testid="focus-diag"
            className="fixed bottom-2 left-2 z-[100] rounded bg-black/70 px-2 py-1 text-[10px] font-mono leading-tight text-green-300 pointer-events-none"
          >
            {focusDiag.map((l, i) => (<div key={i}>{l}</div>))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}