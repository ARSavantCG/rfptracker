/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Plus, X, Save, Zap } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { RfpRequest, Contact } from "@shared/schema";
import { nanoid } from "nanoid";

// Voltage options for electrical allocation
const VOLTAGE_OPTIONS = [
  { value: "480", label: "480V (3-Phase)" },
  { value: "208", label: "208/120V (3-Phase)" },
] as const;

// Helper function to convert kVA to AMPS based on voltage
const kvaToAmps = (kva: number, voltage: string = "480"): number => {
  const multiplier = voltage === "208" ? 208 * Math.sqrt(3) : 480 * Math.sqrt(3);
  return Math.round((kva * 1000) / multiplier);
};

// Helper function to convert AMPS to kVA based on voltage
const ampsToKva = (amps: number, voltage: string = "480"): number => {
  const multiplier = voltage === "208" ? 208 * Math.sqrt(3) : 480 * Math.sqrt(3);
  return (amps * multiplier) / 1000;
};

const validationSchema = z.object({
  generalContractor: z.string().optional(),
  architect: z.string().optional(),
  developmentContact: z.string().optional(),
  contactPerson: z.string().optional(),
  contactEmail: z.string().optional(),
  areaBreakdown: z.array(z.object({
    id: z.string(),
    areaType: z.string(),
    description: z.string(),
    squareFootage: z.string(),
    notes: z.string().optional()
  })).optional().default([]),
  // Electrical allocation fields
  tenantElectricalAllocation: z.preprocess(
    (val) => val === "" || val === null || val === undefined ? null : Number(val),
    z.number().nullable().optional()
  ),
  tenantElectricalAdditionalRequest: z.preprocess(
    (val) => val === "" || val === null || val === undefined ? null : Number(val),
    z.number().nullable().optional()
  ),
  tenantElectricalVoltage: z.string().nullable().optional(),
  tenantElectricalAdditionalVoltage: z.string().nullable().optional(),
  tenantElectricalUpgradeTiming: z.string().nullable().optional(),
  tenantElectricalNotes: z.string().nullable().optional(),
  // Enhanced RFP optional context fields
  buildingPosition: z.string().optional(),
  adjacentTenants: z.string().optional(),
  clearHeight: z.string().optional(),
  sprinklerSpec: z.string().optional(),
  existingPower: z.string().optional(),
  dockDoorCount: z.preprocess(
    (val) => val === "" || val === null || val === undefined ? null : Number(val),
    z.number().int().nullable().optional()
  ),
  driveInDoorCount: z.preprocess(
    (val) => val === "" || val === null || val === undefined ? null : Number(val),
    z.number().int().nullable().optional()
  ),
  parkingRatio: z.string().optional(),
  bayDimensions: z.string().optional(),
  tenantProgramSummary: z.string().optional(),
});

type ValidationFormData = z.infer<typeof validationSchema>;

interface RfpValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfp: RfpRequest | null;
  onValidationComplete?: () => void;
}

export function RfpValidationModal({ isOpen, onClose, rfp, onValidationComplete }: RfpValidationModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [openAreaTypeIndex, setOpenAreaTypeIndex] = useState<number | null>(null);
  const [showEnhancedContext, setShowEnhancedContext] = useState(false);

  const form = useForm<ValidationFormData>({
    resolver: zodResolver(validationSchema),
    defaultValues: {
      generalContractor: "",
      architect: "",
      developmentContact: "",
      contactPerson: "",
      contactEmail: "",
      areaBreakdown: [],
      tenantElectricalAllocation: null,
      tenantElectricalAdditionalRequest: null,
      tenantElectricalVoltage: null,
      tenantElectricalAdditionalVoltage: null,
      tenantElectricalUpgradeTiming: null,
      tenantElectricalNotes: null,
      buildingPosition: "",
      adjacentTenants: "",
      clearHeight: "",
      sprinklerSpec: "",
      existingPower: "",
      dockDoorCount: null,
      driveInDoorCount: null,
      parkingRatio: "",
      bayDimensions: "",
      tenantProgramSummary: "",
    },
  });

  // Close area type dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest('.area-type-dropdown')) {
        setOpenAreaTypeIndex(null);
      }
    }

    if (openAreaTypeIndex !== null) {
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
      
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openAreaTypeIndex]);

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const { data: properties = [] } = useQuery<any[]>({
    queryKey: ["/api/properties"],
  });

  // Get the current property for transformer data
  const currentProperty = properties?.find((p: any) => 
    p.name === rfp?.property || p.id.toString() === rfp?.property
  );

  // Fetch transformers for the property
  const { data: transformers = [] } = useQuery<any[]>({
    queryKey: [`/api/properties/${currentProperty?.id}/transformers`],
    enabled: !!currentProperty?.id,
  });

  // Helper function to extract contact details from development contact
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

  // Load existing validation data when RFP changes
  useEffect(() => {
    if (rfp && isOpen) {
      const contactDetails = getDevelopmentContactDetails(rfp.developmentContact || "");
      
      form.reset({
        generalContractor: rfp.generalContractor || "",
        architect: rfp.architect || "",
        developmentContact: rfp.developmentContact || "",
        contactPerson: rfp.contactPerson || contactDetails.name || "",
        contactEmail: rfp.contactEmail || contactDetails.email || "",
        areaBreakdown: rfp.areaBreakdown || [],
        tenantElectricalAllocation: rfp.tenantElectricalAllocation ?? null,
        tenantElectricalAdditionalRequest: rfp.tenantElectricalAdditionalRequest ?? null,
        tenantElectricalVoltage: rfp.tenantElectricalVoltage ?? null,
        tenantElectricalAdditionalVoltage: (rfp as any).tenantElectricalAdditionalVoltage ?? null,
        tenantElectricalUpgradeTiming: (rfp as any).tenantElectricalUpgradeTiming ?? null,
        tenantElectricalNotes: rfp.tenantElectricalNotes ?? null,
        buildingPosition: (rfp as any).buildingPosition ?? "",
        adjacentTenants: (rfp as any).adjacentTenants ?? "",
        clearHeight: (rfp as any).clearHeight ?? "",
        sprinklerSpec: (rfp as any).sprinklerSpec ?? "",
        existingPower: (rfp as any).existingPower ?? "",
        dockDoorCount: (rfp as any).dockDoorCount ?? null,
        driveInDoorCount: (rfp as any).driveInDoorCount ?? null,
        parkingRatio: (rfp as any).parkingRatio ?? "",
        bayDimensions: (rfp as any).bayDimensions ?? "",
        tenantProgramSummary: (rfp as any).tenantProgramSummary ?? "",
      });
    }
  }, [rfp, isOpen, form, contacts]);

  const updateMutation = useMutation({
    mutationFn: async (data: ValidationFormData) => {
      if (!rfp) throw new Error("No RFP selected");

      // Only update the RFP validation data, don't advance workflow
      const response = await apiRequest(`/api/rfp-requests/${rfp.id}`, "PATCH", data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      toast({
        title: "Success",
        description: "RFP validation details saved successfully",
        duration: 4000,
      });
      handleClose();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update RFP validation",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const advanceMutation = useMutation({
    mutationFn: async () => {
      if (!rfp) throw new Error("No RFP selected");
      
      // Save current validation data first, then advance workflow
      const currentData = form.getValues();
      await apiRequest(`/api/rfp-requests/${rfp.id}`, "PATCH", currentData);
      
      // Then advance to invitation-to-bid phase
      return apiRequest(`/api/rfp-requests/${rfp.id}/workflow-phase`, "PATCH", { 
        phase: "invitation-to-bid" 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      toast({
        title: "Success",
        description: "RFP validation completed and advanced to Invitation to Bid",
        duration: 4000,
      });
      handleClose();
      onValidationComplete?.();
    },
    onError: (error) => {
      const raw = error instanceof Error ? error.message : "Failed to advance workflow";
      // Strip leading HTTP status code prefix ("400: ") for cleaner display
      const description = raw.replace(/^\d{3}:\s*/, "");
      toast({
        title: "Cannot advance to next phase",
        description,
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const onSubmit = (data: ValidationFormData) => {
    updateMutation.mutate(data);
  };

  const handleAdvanceWorkflow = () => {
    advanceMutation.mutate();
  };

  const handleClose = () => {
    form.reset();
    onClose();
  };

  const addAreaBreakdown = () => {
    const currentBreakdown = form.getValues("areaBreakdown") || [];
    form.setValue("areaBreakdown", [
      ...currentBreakdown,
      {
        id: nanoid(),
        areaType: "Office",
        description: "Office",
        squareFootage: "",
        notes: ""
      }
    ]);
  };

  const removeAreaBreakdown = (index: number) => {
    const currentBreakdown = form.getValues("areaBreakdown") || [];
    form.setValue("areaBreakdown", currentBreakdown.filter((_, i) => i !== index));
  };

  const updateAreaBreakdown = (index: number, field: keyof ValidationFormData["areaBreakdown"][0], value: string) => {
    const currentBreakdown = form.getValues("areaBreakdown") || [];
    const updatedBreakdown = [...currentBreakdown];
    if (updatedBreakdown[index]) {
      updatedBreakdown[index] = { ...updatedBreakdown[index], [field]: value };
      form.setValue("areaBreakdown", updatedBreakdown);
    }
  };

  if (!rfp) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">RFP Validation - {rfp.projectName}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Area Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Area Information</h3>
              
              {/* Rentable Area Calculation */}
              {rfp && (
                <div className="bg-blue-50 p-4 rounded-lg border">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Rentable Area Calculation</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Total Rentable Area:</span>
                      <span className="font-medium">
                        {(() => {
                          // Check for override area first (highest priority)
                          if (rfp.warehouseAreaOverride) {
                            return parseFloat(rfp.warehouseAreaOverride.toString().replace(/[^0-9.]/g, '')).toLocaleString();
                          }
                          
                          // Check multiple possible area fields
                          const warehouseArea = rfp.warehouseArea;
                          const projectArea = rfp.projectArea;
                          
                          // Check if bay configurations contain calculated area using correct proportional method
                          let calculatedArea = 0;
                          if (rfp.selectedBayConfigurations && rfp.selectedBayConfigurations.length > 0) {
                            // Calculate warehouse area only from bay configurations
                            const selectedBaySquareFootage = rfp.selectedBayConfigurations.reduce((sum: number, bay: any) => sum + (bay.squareFootage || 0), 0);
                            
                            // Get property data for mechanical room calculation
                            const property = properties?.find((p: any) => p.id.toString() === rfp.property);
                            const mechanicalRoomSF = property?.mechanicalRoomSquareFootage || 0;
                            
                            // Calculate proportional mechanical allocation
                            let proportionalMechanical = 0;
                            if (property?.bayConfigurations) {
                              const totalPropertyBaysSF = property.bayConfigurations.reduce((sum: number, bay: any) => sum + (bay.squareFootage || 0), 0);
                              if (rfp.selectedBayConfigurations.length === property.bayConfigurations.length) {
                                // All bays selected = 100% of mechanical room
                                proportionalMechanical = mechanicalRoomSF;
                              } else {
                                // Partial selection = proportional allocation
                                proportionalMechanical = totalPropertyBaysSF > 0 ? (selectedBaySquareFootage / totalPropertyBaysSF) * mechanicalRoomSF : 0;
                              }
                            }
                            
                            calculatedArea = selectedBaySquareFootage + proportionalMechanical;
                          }
                          
                          // Priority: warehouseAreaOverride > calculated area from bays > warehouseArea > projectArea
                          const totalArea = calculatedArea > 0 ? calculatedArea : (warehouseArea || projectArea);
                          return totalArea ? parseFloat(totalArea.toString().replace(/[^0-9.]/g, '')).toLocaleString() : 0;
                        })()} SF
                      </span>
                    </div>
                    {form.watch("areaBreakdown").length > 0 && (
                      <>
                        <div className="border-t pt-2">
                          <span className="text-gray-600">Additional Areas:</span>
                          {form.watch("areaBreakdown").map((area, index) => (
                            <div key={area.id} className="flex justify-between ml-4">
                              <span>• {area.description || `Area ${index + 1}`}:</span>
                              <span className="font-medium">{area.squareFootage ? parseInt(area.squareFootage).toLocaleString() : 0} SF</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    <div className="border-t pt-2 flex justify-between font-semibold text-gray-900">
                      <span>Remaining Rentable Area:</span>
                      <span>
                        {(() => {
                          // Check for override area first (highest priority)
                          let totalArea = 0;
                          if (rfp.warehouseAreaOverride) {
                            totalArea = parseFloat(rfp.warehouseAreaOverride.toString().replace(/[^0-9.]/g, ''));
                          } else {
                            // Use same logic as above for consistency
                            const warehouseArea = rfp.warehouseArea;
                            const projectArea = rfp.projectArea;
                            
                            // Check if bay configurations contain calculated area using correct proportional method
                            let calculatedArea = 0;
                            if (rfp.selectedBayConfigurations && rfp.selectedBayConfigurations.length > 0) {
                              // Calculate warehouse area only from bay configurations
                              const selectedBaySquareFootage = rfp.selectedBayConfigurations.reduce((sum: number, bay: any) => sum + (bay.squareFootage || 0), 0);
                              
                              // Get property data for mechanical room calculation
                              const property = properties?.find((p: any) => p.id.toString() === rfp.property);
                              const mechanicalRoomSF = property?.mechanicalRoomSquareFootage || 0;
                              
                              // Calculate proportional mechanical allocation
                              let proportionalMechanical = 0;
                              if (property?.bayConfigurations) {
                                const totalPropertyBaysSF = property.bayConfigurations.reduce((sum: number, bay: any) => sum + (bay.squareFootage || 0), 0);
                                if (rfp.selectedBayConfigurations.length === property.bayConfigurations.length) {
                                  // All bays selected = 100% of mechanical room
                                  proportionalMechanical = mechanicalRoomSF;
                                } else {
                                  // Partial selection = proportional allocation
                                  proportionalMechanical = totalPropertyBaysSF > 0 ? (selectedBaySquareFootage / totalPropertyBaysSF) * mechanicalRoomSF : 0;
                                }
                              }
                              
                              calculatedArea = selectedBaySquareFootage + proportionalMechanical;
                            }
                            
                            // Priority: calculated area from bays > warehouseArea > projectArea
                            totalArea = calculatedArea > 0 ? calculatedArea : parseFloat((warehouseArea || projectArea || 0).toString().replace(/[^0-9.]/g, ''));
                          }
                          
                          const additionalAreas = form.watch("areaBreakdown").reduce((sum, area) => 
                            sum + parseInt(area.squareFootage || "0"), 0);
                          const remaining = totalArea - additionalAreas;
                          return remaining.toLocaleString();
                        })()} SF
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Area Breakdown */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">Area Breakdown</h4>
                  <Button
                    type="button"
                    onClick={addAreaBreakdown}
                    variant="outline"
                    size="sm"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Area
                  </Button>
                </div>

                {form.watch("areaBreakdown")?.length > 0 && (
                  <div className="space-y-2">
                    {/* Area Items */}
                    {form.watch("areaBreakdown")?.map((area, index) => (
                      <div key={area.id} className="space-y-2 p-3 border rounded-md bg-gray-50">
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-3 relative">
                            <label className="text-xs font-medium text-gray-600">Description</label>
                            <div className="relative area-type-dropdown">
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenAreaTypeIndex(openAreaTypeIndex === index ? null : index);
                                }}
                                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                              >
                                <span className={area.description ? "text-foreground" : "text-muted-foreground"}>
                                  {area.description || "Select description"}
                                </span>
                                <ChevronDown className={`h-4 w-4 opacity-70 transition-transform ${openAreaTypeIndex === index ? "rotate-180" : ""}`} />
                              </button>
                              {openAreaTypeIndex === index && (
                                <div className="absolute z-[9999] mt-1 w-full rounded-md border bg-popover shadow-lg">
                                  <div className="p-1">
                                    {["Office", "Warehouse Office", "Other"].map((option) => (
                                      <div
                                        key={option}
                                        className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-sm"
                                        onClick={() => {
                                          updateAreaBreakdown(index, "description", option);
                                          updateAreaBreakdown(index, "areaType", option);
                                          setOpenAreaTypeIndex(null);
                                        }}
                                      >
                                        {option}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                          {area.description === "Other" && (
                            <div className="col-span-3">
                              <label className="text-xs font-medium text-gray-600">Custom Name</label>
                              <Input
                                value={area.notes || ""}
                                onChange={(e) => updateAreaBreakdown(index, "notes", e.target.value)}
                                placeholder="Enter custom name"
                              />
                            </div>
                          )}
                          <div className={area.description === "Other" ? "col-span-2" : "col-span-3"}>
                            <label className="text-xs font-medium text-gray-600">Area (sq ft)</label>
                            <Input
                              value={area.squareFootage ? parseInt(area.squareFootage.replace(/,/g, "")).toLocaleString() : ""}
                              onChange={(e) => {
                                const value = e.target.value.replace(/,/g, "");
                                if (value === "" || /^\d+$/.test(value)) {
                                  updateAreaBreakdown(index, "squareFootage", value);
                                }
                              }}
                              placeholder="e.g., 5,000"
                            />
                          </div>
                          <div className={area.description === "Other" ? "col-span-3" : "col-span-5"}>
                            <label className="text-xs font-medium text-gray-600">Notes</label>
                            <Input
                              value={area.notes || ""}
                              onChange={(e) => updateAreaBreakdown(index, "notes", e.target.value)}
                              placeholder="Additional notes"
                            />
                          </div>
                          <div className="col-span-1 flex items-end pb-1">
                            <Button
                              type="button"
                              onClick={() => removeAreaBreakdown(index)}
                              variant="outline"
                              size="sm"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Electrical Allocation */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2 flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-500" />
                Electrical Allocation
              </h3>
              
              {/* Property Electrical Info */}
              {(() => {
                const totalTransformerCapacity = transformers.reduce((sum: number, t: any) => sum + (t.totalCapacityKva || 0), 0);
                const propertyAllocation = currentProperty?.electricalAllocation || 0;
                const propertyIncrement = currentProperty?.electricalAllocationIncrement || 50;
                
                // Calculate tenant's share of building
                const tenantSF = rfp?.selectedBayConfigurations?.reduce((sum: number, bay: any) => sum + (bay.squareFootage || 0), 0) || 0;
                const propertySF = currentProperty?.bayConfigurations?.reduce((sum: number, bay: any) => sum + (bay.squareFootage || 0), 0) || 0;
                const tenantSharePercent = propertySF > 0 ? (tenantSF / propertySF) * 100 : 0;
                
                // Calculate suggested allocation
                const selectedVoltage = form.watch("tenantElectricalVoltage") || "480";
                const tenantKvaShare = totalTransformerCapacity * (tenantSharePercent / 100);
                const suggestedAmps = kvaToAmps(tenantKvaShare, selectedVoltage);
                // Round DOWN to nearest 50 AMPS
                const suggestedAmpsRounded = Math.floor(suggestedAmps / 50) * 50;
                
                return (
                  <div className="space-y-4">
                    {/* Property electrical summary */}
                    <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                      <h4 className="text-sm font-medium text-gray-900 mb-2">Property Electrical Summary</h4>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-gray-600">Building Transformer Capacity:</span>
                          <span className="font-medium ml-2">{totalTransformerCapacity.toLocaleString()} kVA</span>
                        </div>
                        <div>
                          <span className="text-gray-600">Standard Tenant Allocation:</span>
                          <span className="font-medium ml-2">{propertyAllocation.toLocaleString()} AMPS</span>
                        </div>
                        <div>
                          <span className="text-gray-600">Increment:</span>
                          <span className="font-medium ml-2">{propertyIncrement.toLocaleString()} AMPS</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Calculated Suggestion */}
                    {totalTransformerCapacity > 0 && propertySF > 0 && (
                      <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                        <h4 className="text-sm font-medium text-gray-900 mb-2">Calculated Allocation (Based on Tenant's Share)</h4>
                        <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                          <div>
                            <span className="text-gray-600">Tenant Area:</span>
                            <span className="font-medium ml-2">{tenantSF.toLocaleString()} SF ({tenantSharePercent.toFixed(1)}%)</span>
                          </div>
                          <div>
                            <span className="text-gray-600">kVA Share:</span>
                            <span className="font-medium ml-2">{tenantKvaShare.toFixed(1)} kVA</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-gray-600">Suggested Allocation:</span>
                            <span className="text-lg font-semibold text-green-700 ml-2">{suggestedAmpsRounded.toLocaleString()} AMPS</span>
                            <span className="text-xs text-gray-500 ml-2">(rounded down to 50A)</span>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => form.setValue("tenantElectricalAllocation", suggestedAmpsRounded)}
                            className="bg-green-100 hover:bg-green-200 border-green-300"
                            data-testid="button-apply-suggested-allocation"
                          >
                            Apply Suggestion
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Tenant allocation inputs */}
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="tenantElectricalVoltage"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Service Voltage</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <select
                                  value={field.value || "480"}
                                  onChange={(e) => field.onChange(e.target.value)}
                                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                                  data-testid="select-electrical-voltage"
                                >
                                  {VOLTAGE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="tenantElectricalAllocation"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Base Allocation (AMPS)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder={`e.g., ${propertyAllocation || 200}`}
                                value={field.value ?? ""}
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                                data-testid="input-electrical-allocation"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="tenantElectricalAdditionalRequest"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Additional Request (AMPS)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="e.g., 400"
                                value={field.value ?? ""}
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                                data-testid="input-electrical-additional"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="tenantElectricalAdditionalVoltage"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Additional Request Voltage</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <select
                                  value={field.value || "480"}
                                  onChange={(e) => field.onChange(e.target.value)}
                                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                                  data-testid="select-electrical-additional-voltage"
                                >
                                  {VOLTAGE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="flex items-end">
                        <div className="bg-gray-100 p-3 rounded-lg w-full">
                          <span className="text-sm text-gray-600">Total Electrical:</span>
                          <span className="text-lg font-semibold ml-2" data-testid="text-electrical-total">
                            {((form.watch("tenantElectricalAllocation") || 0) + 
                              (form.watch("tenantElectricalAdditionalRequest") || 0)).toLocaleString()} AMPS
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Transformer Upgrade Timing Indicator */}
                    {(() => {
                      const additionalRequest = form.watch("tenantElectricalAdditionalRequest") || 0;
                      const additionalVoltage = form.watch("tenantElectricalAdditionalVoltage") || "480";
                      const baseAllocation = form.watch("tenantElectricalAllocation") || 0;
                      const baseVoltage = form.watch("tenantElectricalVoltage") || "480";
                      
                      if (additionalRequest <= 0) {
                        // Clear timing if no additional request
                        const currentTiming = form.getValues("tenantElectricalUpgradeTiming");
                        if (currentTiming) {
                          form.setValue("tenantElectricalUpgradeTiming", null);
                        }
                        return null;
                      }
                      
                      // Convert allocations to kVA
                      const baseKva = ampsToKva(baseAllocation, baseVoltage);
                      const additionalKva = ampsToKva(additionalRequest, additionalVoltage);
                      const totalRequestedKva = baseKva + additionalKva;
                      
                      // Tenant's proportional share of transformer capacity
                      const remainingKvaForTenant = tenantKvaShare;
                      
                      // Determine if upgrade is needed NOW or can be LATER
                      const needsUpgradeNow = totalRequestedKva > remainingKvaForTenant;
                      const excessKva = totalRequestedKva - remainingKvaForTenant;
                      
                      // Auto-set the timing field for PDF generation
                      const newTiming = needsUpgradeNow ? "immediate" : "future";
                      const currentTiming = form.getValues("tenantElectricalUpgradeTiming");
                      if (currentTiming !== newTiming) {
                        form.setValue("tenantElectricalUpgradeTiming", newTiming);
                      }
                      
                      return (
                        <div 
                          className={`p-4 rounded-lg border ${needsUpgradeNow ? 'bg-red-50 border-red-300' : 'bg-blue-50 border-blue-300'}`}
                          data-testid="indicator-transformer-timing"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`px-3 py-1.5 rounded-full font-bold text-sm ${needsUpgradeNow ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>
                              {needsUpgradeNow ? 'UPGRADE NOW' : 'UPGRADE LATER'}
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-medium">
                                {needsUpgradeNow 
                                  ? `Additional request exceeds tenant's proportional capacity by ${excessKva.toFixed(1)} kVA`
                                  : `Additional request is within tenant's proportional capacity (${remainingKvaForTenant.toFixed(1)} kVA available)`
                                }
                              </div>
                              <div className="text-xs text-gray-600 mt-1">
                                Requested: {totalRequestedKva.toFixed(1)} kVA total ({additionalKva.toFixed(1)} kVA additional @ {additionalVoltage}V)
                              </div>
                            </div>
                          </div>
                          {needsUpgradeNow && (
                            <div className="mt-3 text-xs text-red-700">
                              <strong>Recommendation:</strong> Include transformer upgrade scope in pricing request. Upgrade should be completed before tenant move-in.
                            </div>
                          )}
                          {!needsUpgradeNow && (
                            <div className="mt-3 text-xs text-blue-700">
                              <strong>Note:</strong> Tenant's additional request can be accommodated with existing transformer capacity. Upgrade can be deferred if needed.
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    <FormField
                      control={form.control}
                      name="tenantElectricalNotes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Electrical Notes</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Notes about tenant electrical requirements..."
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value)}
                              className="min-h-[60px]"
                              data-testid="textarea-electrical-notes"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                );
              })()}
            </div>

            {/* Enhanced RFP — Optional Context */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowEnhancedContext(v => !v)}
                className="w-full flex items-center justify-between p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-left hover:bg-indigo-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-indigo-800">Enhanced RFP — Optional Context</span>
                  <span className="text-xs text-indigo-600 font-normal">
                    These fields populate the Enhanced RFP variants. Standard RFPs do not use them.
                  </span>
                </div>
                <ChevronDown className={`h-4 w-4 text-indigo-600 transition-transform ${showEnhancedContext ? "rotate-180" : ""}`} />
              </button>

              {showEnhancedContext && (
                <div className="border border-indigo-200 rounded-lg p-4 space-y-4 bg-indigo-50/30">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="buildingPosition"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Building Position</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} placeholder="e.g., Corner, End-cap, Mid-row" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="adjacentTenants"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Adjacent Tenants</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} placeholder="Names of neighboring tenants" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="clearHeight"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Clear Height</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} placeholder="e.g., 32' clear" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="sprinklerSpec"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Sprinkler Specification</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} placeholder="e.g., ESFR K-25" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="existingPower"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Existing Power</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} placeholder="e.g., 1,600A 480V 3-Phase" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="parkingRatio"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Parking Ratio</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} placeholder="e.g., 1/1,000 SF" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="dockDoorCount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Dock Door Count</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="e.g., 12"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="driveInDoorCount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Drive-In Door Count</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="e.g., 2"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="bayDimensions"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bay Dimensions</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} placeholder="e.g., 54' × 50'" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="tenantProgramSummary"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tenant Program Summary</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            value={field.value ?? ""}
                            placeholder="Brief description of the tenant's operational program and requirements..."
                            className="min-h-[80px]"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </div>

            {/* Contact Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Contact Information</h3>
              
              <FormField
                control={form.control}
                name="developmentContact"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Development Contact</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <select
                          {...field}
                          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                        >
                          <option value="">Select development contact</option>
                          {contacts
                            .filter((contact) => contact.tags && contact.tags.includes("Development"))
                            .map((contact) => (
                              <option key={contact.id} value={`${contact.name} - ${contact.company}`}>
                                {contact.name} - {contact.company}
                              </option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={updateMutation.isPending || advanceMutation.isPending}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending || advanceMutation.isPending}>
                <Save className="h-4 w-4 mr-2" />
                {updateMutation.isPending ? "Saving..." : "Save Validation Details"}
              </Button>
              <Button 
                type="button"
                onClick={handleAdvanceWorkflow}
                disabled={updateMutation.isPending || advanceMutation.isPending}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {advanceMutation.isPending ? "Saving & Advancing..." : "Save & Advance to ITB"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}