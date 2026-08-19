import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { FileUpload } from "./file-upload";
import { HierarchicalPropertySelector } from "./hierarchical-property-selector";
import { BayConfigurationModal } from "./bay-configuration-modal";
import { useToast } from "@/hooks/use-toast";
import { getCurrentDateString } from "@shared/date-utils";
import { type Property, type Contact, type BayConfiguration, type BuildingCosts } from "@shared/schema";
import { usePermissions } from "@/hooks/usePermissions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Grid3x3, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { X } from "lucide-react";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";
import { computeAreaSummary } from "@shared/area-utils";

const createRfpSchema = z.object({
  property: z.string().min(1, "Property is required"),
  tenantName: z.string().min(1, "Tenant name is required"),
  projectName: z.string().min(1, "Project name is required"),
  sentBy: z.string().min(1, "RFP request is required"),
  receivedOn: z.string().min(1, "Received on date is required"),
  internalDueDate: z.string().min(1, "Internal due date is required"),
  responseToBrokerDue: z.string().optional(),
  developmentContact: z.string().optional(),
  projectArea: z.string().optional(),
  confidential: z.boolean().default(false),
  requestTypes: z.array(z.string()),
  trackType: z.enum(["development", "allowance"]).default("development"),
  anticipatedLeaseExecutionDate: z.string().min(1, "Anticipated lease execution date is required"),
  anticipatedOccupancyDate: z.string().optional(),
  notes: z.string().optional(), // Development Team Notes
  dealMetricNotes: z.string().optional(), // Deal Metric Notes
  areaBreakdown: z.array(z.object({
    id: z.string(),
    description: z.string(),
    squareFootage: z.string(),
    notes: z.string().optional()
  })).optional().default([]),
}).superRefine((data, ctx) => {
  // Request types are required for DEVELOPMENT requests only. An allowance deal
  // asks for no pricing, schedule or space plan, so the field is hidden - and a
  // hidden required field is an unsubmittable form with no visible reason why.
  if (data.trackType !== "allowance" && (!data.requestTypes || data.requestTypes.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["requestTypes"],
      message: "At least one request type is required",
    });
  }
});

type CreateRfpFormData = z.infer<typeof createRfpSchema>;

interface CreateRfpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateRfpModal({ isOpen, onClose }: CreateRfpModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin, user } = usePermissions();
  // Allowance Fork: which path the user chose at the bottom of Step 1.
  const pricingPathRef = useRef<"development" | "rom_pilot">("development");
  const [romForkPending, setRomForkPending] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [calculatedFloorArea, setCalculatedFloorArea] = useState<number>(0);
  const [selectedBayConfigurations, setSelectedBayConfigurations] = useState<BayConfiguration[]>([]);
  const [bayConfigModalOpen, setBayConfigModalOpen] = useState(false);
  
  // Multi-building state
  const [multiBuildingMode, setMultiBuildingMode] = useState(false);
  const [selectedBaysPerBuilding, setSelectedBaysPerBuilding] = useState<{[propertyName: string]: BayConfiguration[]}>({});
  const [costsPerBuilding, setCostsPerBuilding] = useState<{[propertyName: string]: BuildingCosts}>({});

  const form = useForm<CreateRfpFormData>({
    resolver: zodResolver(createRfpSchema),
    defaultValues: {
      property: "",
      tenantName: "",
      projectName: "",
      sentBy: "",
      receivedOn: getCurrentDateString(),
      internalDueDate: "",
      responseToBrokerDue: "",
      developmentContact: "",
      projectArea: "",
      confidential: false,
      requestTypes: [],
      trackType: "development" as const,
      anticipatedLeaseExecutionDate: "",
      anticipatedOccupancyDate: "",
      notes: "",
      dealMetricNotes: "",
      areaBreakdown: [],
    },
  });

  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  // Auto-populate sentBy for EVERYONE with the logged-in user. Non-admins are
  // locked to it (disabled input below); admins get it prefilled but can change
  // it to anyone via the dropdown. For admins the value must match the dropdown's
  // `Name - Company` option format, so we resolve against the owner contacts;
  // never clobbers a value the admin has already picked.
  useEffect(() => {
    if (!user) return;
    if (form.getValues("sentBy")) return; // don't overwrite an existing choice
    const userDisplayName = (user as any).firstName && (user as any).lastName
      ? `${(user as any).firstName} ${(user as any).lastName}`
      : (user as any).username;
    if (!isAdmin()) {
      form.setValue("sentBy", userDisplayName);
      return;
    }
    const owners = (contacts as Contact[]).filter((c: Contact) => c.type === "owner");
    const match = owners.find(
      (c: Contact) => c.name?.trim().toLowerCase() === String(userDisplayName || "").trim().toLowerCase()
    );
    if (match) form.setValue("sentBy", `${match.name} - ${match.company}`);
    else if (userDisplayName) form.setValue("sentBy", userDisplayName);
  }, [user, isAdmin, form, contacts]);

  // Default Anticipated Lease Execution Date: the Friday one month after the
  // Internal Due Date. This date is usually an assumption rather than a known
  // fact, so a consistent default beats an empty required field — the user can
  // always override, and manual edits are never clobbered (we only overwrite
  // the value we ourselves computed last).
  const autoLeaseDateRef = useRef<string>("");
  const watchedInternalDue = form.watch("internalDueDate");
  useEffect(() => {
    try {
      if (!watchedInternalDue) return;
      const current = form.getValues("anticipatedLeaseExecutionDate");
      if (current && current !== autoLeaseDateRef.current) return; // user-set — leave alone
      const [y, m, d] = watchedInternalDue.split("-").map((n: string) => parseInt(n, 10));
      if (!y || !m || !d) return;
      const dt = new Date(y, m - 1, d);
      dt.setMonth(dt.getMonth() + 1);
      const toFriday = (5 - dt.getDay() + 7) % 7; // advance to Friday (0 if already Friday)
      dt.setDate(dt.getDate() + toFriday);
      const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      autoLeaseDateRef.current = iso;
      form.setValue("anticipatedLeaseExecutionDate", iso);
    } catch { /* defaulting must never break the form */ }
  }, [watchedInternalDue, form]);

  const createMutation = useMutation({
    mutationFn: async (data: CreateRfpFormData) => {
      const formData = new FormData();
      
      // Append form fields
      Object.entries(data).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, value.toString());
        }
      });
      
      // Append multi-building data
      formData.append('isMultiBuilding', multiBuildingMode.toString());
      if (multiBuildingMode) {
        // Multi-building: Send ONLY references (property IDs + bay IDs), NOT snapshots
        // Convert all cost values from strings to numbers before sending
        const convertedCosts = Object.entries(costsPerBuilding).reduce((acc, [key, value]) => {
          acc[key] = {
            existing: Number(value.existing) || 0,
            improvements: Number(value.improvements) || 0,
            rom: Number(value.rom) || 0,
            notes: value.notes || ''
          };
          return acc;
        }, {} as typeof costsPerBuilding);
        
        formData.append('costsPerBuilding', JSON.stringify(convertedCosts));
        
        // Extract bay IDs and property IDs for multi-building
        const propertyIdsPerBuilding: {[propertyName: string]: number} = {};
        const bayIdsPerBuilding: {[propertyName: string]: string[]} = {};
        
        for (const [propertyName, bays] of Object.entries(selectedBaysPerBuilding)) {
          const property = properties.find(p => p.propertyName === propertyName || p.displayName === propertyName);
          if (property) {
            propertyIdsPerBuilding[propertyName] = property.id;
            bayIdsPerBuilding[propertyName] = bays.map(bay => bay.id);
          }
        }
        
        formData.append('propertyIdsPerBuilding', JSON.stringify(propertyIdsPerBuilding));
        formData.append('bayIdsPerBuilding', JSON.stringify(bayIdsPerBuilding));
      } else if (selectedProperty && selectedBayConfigurations.length > 0) {
        // Single building: Send ONLY references (property ID + bay IDs), NOT snapshots
        // Send propertyId as number, not string
        formData.append('propertyId', selectedProperty.id.toString());
        formData.append('selectedBayIds', JSON.stringify(selectedBayConfigurations.map(bay => bay.id)));
      }
      
      // Append files
      selectedFiles.forEach((file) => {
        formData.append('files', file);
      });
      
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const response = await fetch('/api/rfp-requests/with-files', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.text();
        console.error('RFP creation failed:', response.status, errorData);
        throw new Error(`Failed to create RFP request: ${response.status} - ${errorData}`);
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Success",
        description: "RFP request created successfully",
        duration: 4000,
      });
      handleClose();
    },
    onError: (error) => {
      const errorMessage = error instanceof Error ? error.message : "Failed to create RFP request";
      
      // Check if it's an authentication error
      if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        toast({
          title: "Session Expired",
          description: "Please log out and log back in to continue",
          variant: "destructive",
          duration: 8000,
        });
      } else {
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
          duration: 6000,
        });
      }
    },
  });

  const onSubmit = async (data: CreateRfpFormData) => {
    const path = pricingPathRef.current;
    pricingPathRef.current = "development"; // reset so a later plain submit is clean
    if (path !== "rom_pilot") {
      createMutation.mutate(data);
      return;
    }
    // ROM Pilot path (self-assembled ROM or allowance): create the RFP, then fork it into a linked ROM
    // (server snapshots property/bays/project, marks pricingPath, jumps the phase),
    // then land the requester in the ROM Pilot to price scope from the locked catalog.
    setRomForkPending(true);
    try {
      const rfp = await createMutation.mutateAsync(data);
      if (!rfp?.id) throw new Error("RFP created but no id returned");
      await apiRequest(`/api/rfp-requests/${rfp.id}/fork-to-rom`, "POST");
      // Re-fetch RFP data AFTER the fork: creation's own invalidation fires
      // before the fork mutates pricingPath/workflowPhase, so without this the
      // dashboard deterministically shows the pre-fork snapshot (stale
      // Validation workflow, no purple) until a manual refresh.
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      queryClient.invalidateQueries({ queryKey: [`/api/rfp-requests/${rfp.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/rom-pilots"] });
      // Stay on the dashboard (Adolfo 2026-07-19): a ROM-path RFP lives in the
      // pipeline like any other RFP — same landing page, same navigation; only
      // the workflow content differs. No jarring jump to a standalone page.
      toast({
        title: "ROM Pilot created",
        description: `${rfp.rfpNumber || "The RFP"} is in your pipeline at the Evaluation phase — open it to price scope from the catalog. Quantities are yours, rates are locked.`,
        duration: 8000,
      });
    } catch (e: any) {
      toast({ title: "Allowance path failed", description: e?.message || "Unknown error", variant: "destructive", duration: 8000 });
    } finally {
      setRomForkPending(false);
    }
  };

  const handleRequestTypeChange = (type: string, checked: boolean) => {
    const currentTypes = form.getValues('requestTypes');
    if (checked) {
      form.setValue('requestTypes', [...currentTypes, type]);
    } else {
      form.setValue('requestTypes', currentTypes.filter(t => t !== type));
    }
  };

  const handleClose = () => {
    form.reset();
    setSelectedFiles([]);
    setSelectedProperty(null);
    setCalculatedFloorArea(0);
    setSelectedBayConfigurations([]);
    setMultiBuildingMode(false);
    setSelectedBaysPerBuilding({});
    setCostsPerBuilding({});
    onClose();
  };

  // Handle property selection and set the selected property for bay configuration selector
  const handlePropertyChange = (propertyId: string) => {
    const property = properties.find(p => p.id.toString() === propertyId);
    setSelectedProperty(property || null);
    setCalculatedFloorArea(0);
    setSelectedBayConfigurations([]);
    
    // Reset project area when property changes
    form.setValue("projectArea", "");
  };

  // Handle bay configuration selection and use pre-calculated area from bay selector
  const handleFloorAreaChange = (
    area: number, 
    bayConfigs: BayConfiguration[], 
    overrideArea?: number, 
    selectedBaysPerBuilding?: {[propertyName: string]: BayConfiguration[]}, 
    costsPerBuilding?: {[propertyName: string]: BuildingCosts}
  ) => {
    // Rentable = warehouse (selected bays) + the tenant's prorated share of the
    // mechanical room. Recomputed here via shared/area-utils rather than trusting
    // the `area` argument.
    //
    // The comment previously here claimed the selector's figure "already includes
    // proportional mechanical allocation". BaySelectionGrid does NOT - it reports
    // bay square footage only. bay-configuration-selector DOES add it. The two
    // selectors disagreed, and this modal used the one that omits it, so Total
    // Rentable Area rendered identical to Warehouse Area while a non-zero
    // Mechanical Allocation sat beside them - visibly failing to add up. The
    // mechanical share was displayed and then dropped from the stored area.
    const areaSummary = computeAreaSummary(
      bayConfigs,
      selectedProperty?.bayConfigurations,
      selectedProperty?.mechanicalRoomSquareFootage,
    );
    const rentableTotal = areaSummary.totalRentableSf > 0 ? areaSummary.totalRentableSf : area;
    setCalculatedFloorArea(rentableTotal);
    setSelectedBayConfigurations(bayConfigs);
    
    // Handle multi-building data if provided
    if (selectedBaysPerBuilding) {
      setSelectedBaysPerBuilding(selectedBaysPerBuilding);
    }
    if (costsPerBuilding) {
      setCostsPerBuilding(costsPerBuilding);
    }
    
    // Auto-populate the project area field with pre-calculated value
    if (rentableTotal > 0) {
      const areaText = overrideArea 
        ? `${rentableTotal.toLocaleString()} SF (override area for existing lease)`
        : `${rentableTotal.toLocaleString()} SF (bays + prorated mechanical)`;
      form.setValue("projectArea", areaText);
    } else {
      form.setValue("projectArea", "");
    }
  };

  const handleMultiBuildingToggle = (checked: boolean) => {
    setMultiBuildingMode(checked);
    // Reset multi-building specific states when toggling
    if (!checked) {
      setSelectedBaysPerBuilding({});
      setCostsPerBuilding({});
    }
  };

  const handleFilesSelected = (files: File[]) => {
    setSelectedFiles(files);
  };

  // Auto-generate project name when property and tenant change
  useEffect(() => {
    const propertyId = form.watch('property');
    const tenantName = form.watch('tenantName');
    const confidential = form.watch('confidential');
    
    if (propertyId && tenantName && properties.length > 0) {
      // Find the selected property by ID
      const selectedProperty = properties.find(p => p.id.toString() === propertyId);
      let propertyName = propertyId;
      
      if (selectedProperty) {
        // For multi-building mode, show "Multiple Bldgs."
        if (multiBuildingMode) {
          propertyName = `${selectedProperty.propertyName} - Multiple Bldgs.`;
        } else {
          // Only add building name if it exists, is not empty, and is different from property name
          if (selectedProperty.building && 
              selectedProperty.building.trim() !== '') {
            propertyName = `${selectedProperty.propertyName} - Bldg. ${selectedProperty.building}`;
          } else {
            propertyName = selectedProperty.propertyName;
          }
        }
      }
      
      const projectName = confidential 
        ? `${propertyName} - Confidential Project`
        : `${tenantName} @ ${propertyName}`;
      form.setValue('projectName', projectName);
    }
  }, [form.watch('property'), form.watch('tenantName'), form.watch('confidential'), properties]);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Create New RFP Request</DialogTitle>
          <DialogDescription>
            Fill out the form to create a new request for proposal.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Basic Information</h3>
                
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="property"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Property *</FormLabel>
                      <HierarchicalPropertySelector
                        value={field.value}
                        onChange={(value) => {
                          field.onChange(value);
                          handlePropertyChange(value);
                        }}
                        isMultiBuilding={multiBuildingMode}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tenantName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tenant Name *</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Tenant or client name"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Project Details</h3>
              
              <FormField
                control={form.control}
                name="projectName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Name *</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Auto-generated from property and tenant"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sentBy"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>RFP Request *</FormLabel>
                    <FormControl>
                      {isAdmin() ? (
                        // Admin can select from dropdown
                        <div className="relative">
                          <select
                            {...field}
                            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                          >
                            <option value="">Select request source</option>
                            {field.value &&
                              !(contacts as Contact[]).some(
                                (c: Contact) => c.type === "owner" && `${c.name} - ${c.company}` === field.value
                              ) && <option value={field.value}>{field.value}</option>}
                            {(contacts as Contact[])
                              .filter((contact: Contact) => contact.type === "owner")
                              .map((contact: Contact) => (
                                <option key={contact.id} value={`${contact.name} - ${contact.company}`}>
                                  {contact.name} - {contact.company}
                                </option>
                              ))}
                          </select>
                          <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                        </div>
                      ) : (
                        // Non-admin users see their name greyed out
                        <Input 
                          {...field}
                          disabled
                          className="bg-muted text-muted-foreground cursor-not-allowed"
                          placeholder="Your name will be auto-populated"
                        />
                      )}
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="receivedOn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Received On *</FormLabel>
                      <FormControl>
                        <Input 
                          type="date"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-sm text-muted-foreground">
                        When we received this request
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="internalDueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Internal Due Date *</FormLabel>
                      <FormControl>
                        <Input 
                          type="date"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-sm text-muted-foreground">
                        Internal deadline to provide RFP response
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="responseToBrokerDue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Response to Broker Due</FormLabel>
                      <FormControl>
                        <Input 
                          type="date"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-sm text-muted-foreground">
                        Deadline to respond to broker
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>





              {/* Multi-Building Toggle */}
              {selectedProperty && (
                <div className="space-y-4 border rounded-lg p-4 bg-blue-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="multi-building-toggle" className="text-sm font-medium">
                        Multi-Building RFP
                      </Label>
                      <p className="text-xs text-gray-600 mt-1">
                        Enable for RFPs spanning multiple buildings in the same property
                      </p>
                    </div>
                    <Switch
                      id="multi-building-toggle"
                      checked={multiBuildingMode}
                      onCheckedChange={handleMultiBuildingToggle}
                    />
                  </div>
                </div>
              )}

              {/* Bay Configuration Button for Automatic Floor Area Calculation */}
              {selectedProperty ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50">
                    <div>
                      <Label className="text-sm font-medium text-gray-700">
                        Bay Configuration {multiBuildingMode && <span className="text-blue-600">(Multi-Building Mode)</span>}
                      </Label>
                      <div className="text-xs text-gray-500 mt-1">
                        {multiBuildingMode && Object.keys(selectedBaysPerBuilding).length > 0 ? (
                          <div className="space-y-1">
                            {Object.entries(selectedBaysPerBuilding).map(([propertyName, bays]) => (
                              <div key={propertyName}>
                                {propertyName}: {bays.length} bay{bays.length !== 1 ? 's' : ''} ({bays.reduce((total, bay) => total + (bay.rentableSquareFootage || bay.squareFootage), 0).toLocaleString()} SF)
                              </div>
                            ))}
                            <div className="font-medium">Total: {calculatedFloorArea.toLocaleString()} SF</div>
                          </div>
                        ) : multiBuildingMode ? (
                          Object.keys(selectedBaysPerBuilding).length > 0 ? (
                            (() => {
                              const totalBays = Object.values(selectedBaysPerBuilding).reduce((total, bays) => total + bays.length, 0);
                              return `${totalBays} bay${totalBays !== 1 ? 's' : ''} selected (${calculatedFloorArea.toLocaleString()} SF)`;
                            })()
                          ) : 'No bays selected for area calculation'
                        ) : selectedBayConfigurations.length > 0 
                          ? `${selectedBayConfigurations.length} bay${selectedBayConfigurations.length !== 1 ? 's' : ''} selected (${calculatedFloorArea.toLocaleString()} SF)`
                          : 'No bays selected for area calculation'
                        }
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setBayConfigModalOpen(true)}
                      className="flex items-center gap-2"
                    >
                      <Grid3x3 className="h-4 w-4" />
                      {selectedBayConfigurations.length > 0 ? 'Modify Selection' : 'Select Bays'}
                    </Button>
                  </div>
                  
                  <FormField
                    control={form.control}
                    name="projectArea"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Total Rentable Area</FormLabel>
                        <FormControl>
                          <Input 
                            {...field}
                            readOnly
                            className="bg-gray-50"
                          />
                        </FormControl>
                        <p className="text-sm text-muted-foreground">
                          Automatically calculated from selected bay configurations
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Area Summary Section */}
                  {calculatedFloorArea > 0 && (
                    <div className="space-y-3 p-4 bg-blue-50 rounded-lg border">
                      <h4 className="font-medium text-gray-900">Area Summary</h4>
                      
                      <div className="grid grid-cols-3 gap-4 p-3 bg-white rounded border">
                        <div>
                          <label className="text-sm font-medium text-gray-700">Total Rentable Area</label>
                          <div className="text-lg font-semibold text-blue-600">
                            {(() => {
                              const roundedTotal = Math.round(calculatedFloorArea);
                              return roundedTotal.toLocaleString();
                            })()} SF
                          </div>
                          {multiBuildingMode && Object.keys(selectedBaysPerBuilding).length > 0 ? (
                            <div className="text-xs text-gray-500 space-y-1">
                              {Object.entries(selectedBaysPerBuilding).map(([propertyName, bays]) => (
                                <div key={propertyName}>
                                  {propertyName}: {bays.reduce((total, bay) => total + (bay.rentableSquareFootage || bay.squareFootage), 0).toLocaleString()} SF
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs text-gray-500">From selected bay configurations</div>
                          )}
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-700">Warehouse Area</label>
                          <div className="text-lg font-semibold text-green-600">
                            {(() => {
                              return computeAreaSummary(selectedBayConfigurations, selectedProperty?.bayConfigurations, selectedProperty?.mechanicalRoomSquareFootage).warehouseSf.toLocaleString();
                            })()} SF
                          </div>
                          <p className="text-xs text-gray-500">Available for tenant use</p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-700">Mechanical Allocation</label>
                          <div className="text-lg font-semibold text-orange-600">
                            {(() => {
                              return computeAreaSummary(selectedBayConfigurations, selectedProperty?.bayConfigurations, selectedProperty?.mechanicalRoomSquareFootage).mechanicalSf.toLocaleString();
                            })()} SF
                          </div>
                          <p className="text-xs text-gray-500">Building Systems</p>
                        </div>
                      </div>

                      <div className="text-sm text-gray-600 p-2 bg-yellow-50 rounded">
                        <strong>Note:</strong> The warehouse area represents the actual usable space for the tenant. 
                        Mechanical Room allocation is proportionate to tenant's share of building.
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg text-center text-gray-500">
                  <p className="font-medium">Select a property above</p>
                  <p className="text-sm">Bay selection will appear here for floor area calculation</p>
                </div>
              )}

              <FormField
                control={form.control}
                name="confidential"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>
                        Confidential Project
                      </FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Mark this project as confidential
                      </p>
                    </div>
                  </FormItem>
                )}
              />
            </div>

            {/* Route.
                Determines the number sequence and how far the request travels.
                Allowance deals get ALW- numbers so they cannot inflate the RFP
                count, and they skip steps 2-5 entirely - nothing is priced. */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Route *</h3>
              <FormField
                control={form.control}
                name="trackType"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => field.onChange("development")}
                        className={`text-left rounded-lg border p-3 ${field.value === "development" ? "border-blue-600 bg-blue-50" : "hover:bg-gray-50"}`}
                      >
                        <div className="font-medium text-sm">Development request</div>
                        <div className="text-xs text-gray-600 mt-1">
                          Priced against the database, by the development team or self-served
                          through ROM Pilot. Numbered <strong>RFP-</strong>.
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => field.onChange("allowance")}
                        className={`text-left rounded-lg border p-3 ${field.value === "allowance" ? "border-blue-600 bg-blue-50" : "hover:bg-gray-50"}`}
                      >
                        <div className="font-medium text-sm">Allowance deal — tracking only</div>
                        <div className="text-xs text-gray-600 mt-1">
                          Nothing is priced. Recorded so the deal is visible, then closed.
                          Numbered <strong>ALW-</strong>.
                        </div>
                      </button>
                    </div>
                    {field.value === "allowance" && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                        This will be saved and closed immediately — no pricing steps, and no
                        notification to the development team.
                      </p>
                    )}
                  </FormItem>
                )}
              />
            </div>

            {/* Request Types.
                Hidden on the allowance route: pricing / schedule / space plan are
                all things the development team would produce, and an allowance
                deal asks for none of them. Leaving the question on screen implies
                a choice that does not exist. */}
            {form.watch("trackType") !== "allowance" && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Request Type *</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {['Pricing', 'Schedule', 'Space Plan'].map((type) => (
                  <div key={type} className="flex items-center space-x-2">
                    <Checkbox
                      id={type}
                      checked={form.watch('requestTypes').includes(type.toLowerCase().replace(' ', '-'))}
                      onCheckedChange={(checked) => 
                        handleRequestTypeChange(type.toLowerCase().replace(' ', '-'), checked as boolean)
                      }
                    />
                    <label 
                      htmlFor={type}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {type}
                    </label>
                  </div>
                ))}
              </div>
              {form.formState.errors.requestTypes && (
                <p className="text-sm font-medium text-destructive">
                  {form.formState.errors.requestTypes.message}
                </p>
              )}
            </div>
            )}

            {/* Additional Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Additional Information</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="anticipatedLeaseExecutionDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Anticipated Lease Execution Date *</FormLabel>
                      <FormControl>
                        <Input 
                          type="date"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-sm text-muted-foreground">
                        Expected date for lease signing
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="anticipatedOccupancyDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tenant Desired Occupancy Date</FormLabel>
                      <FormControl>
                        <Input 
                          type="date"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-sm text-muted-foreground">
                        Tenant's preferred move-in date (optional)
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              {/* Notes for a team that will not see this record. Hidden on the
                  allowance route. */}
              {form.watch("trackType") !== "allowance" && (
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Development Team Notes</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Internal notes for the development team..."
                        className="min-h-[100px]"
                        {...field}
                        data-testid="input-development-notes"
                      />
                    </FormControl>
                    <p className="text-sm text-muted-foreground">
                      Notes for internal use by the development team
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              )}

              <FormField
                control={form.control}
                name="dealMetricNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Deal Metric Notes</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Financial metrics, deal terms, and evaluation notes..."
                        className="min-h-[100px]"
                        {...field}
                        data-testid="input-deal-metric-notes"
                      />
                    </FormControl>
                    <p className="text-sm text-muted-foreground">
                      Notes for the finance/metrics team (included in Step 1 email)
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <label className="text-sm font-medium">Attachments</label>
                <FileUpload onFilesSelected={handleFilesSelected} />
              </div>
              
              {selectedFiles.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Selected Files:</p>
                  <ul className="text-sm text-gray-600 space-y-1">
                    {selectedFiles.map((file, index) => (
                      <li key={index} className="flex justify-between items-center">
                        <span>{file.name}</span>
                        <button
                          type="button"
                          onClick={() => setSelectedFiles(files => files.filter((_, i) => i !== index))}
                          className="text-red-500 hover:text-red-700"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 pt-6 border-t">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              {/* The buttons ARE the route decision.
                  ROM Pilot and Route to Dev Team are both development paths; an
                  allowance deal is neither, and offering all three implied the
                  route picker above had not already been answered. */}
              {form.watch("trackType") === "allowance" ? (
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {createMutation.isPending ? "Recording..." : "Record Allowance Deal"}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={createMutation.isPending || romForkPending}
                    className="border-purple-400 text-purple-700 hover:bg-purple-50"
                    onClick={() => {
                      pricingPathRef.current = "rom_pilot";
                      form.handleSubmit(onSubmit)();
                    }}
                  >
                    {romForkPending ? "Creating ROM..." : "ROM Pilot"}
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createMutation.isPending || romForkPending}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {createMutation.isPending && !romForkPending ? "Creating..." : "Route to Dev Team"}
                  </Button>
                </>
              )}
            </div>
          </form>
        </Form>
      </DialogContent>

      {/* Bay Configuration Modal */}
      {selectedProperty && (
        <BayConfigurationModal
          isOpen={bayConfigModalOpen}
          onClose={() => setBayConfigModalOpen(false)}
          property={!multiBuildingMode ? selectedProperty : undefined}
          properties={multiBuildingMode ? properties : undefined}
          onConfirm={handleFloorAreaChange}
          initialSelectedBays={selectedBayConfigurations}
          isMultiBuilding={multiBuildingMode}
          initialSelectedBaysPerBuilding={selectedBaysPerBuilding}
          onBaysPerBuildingChange={setSelectedBaysPerBuilding}
          costsPerBuilding={costsPerBuilding}
          onCostsPerBuildingChange={setCostsPerBuilding}
        />
      )}
    </Dialog>
  );
}