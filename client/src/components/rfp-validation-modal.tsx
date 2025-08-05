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
import { Plus, X, Save } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { RfpRequest, Contact } from "@shared/schema";
import { nanoid } from "nanoid";

const validationSchema = z.object({
  generalContractor: z.string().optional(),
  architect: z.string().optional(),
  developmentContact: z.string().optional(),
  contactPerson: z.string().optional(),
  contactEmail: z.string().optional(),
  areaBreakdown: z.array(z.object({
    id: z.string(),
    description: z.string(),
    squareFootage: z.string(),
    notes: z.string().optional()
  })).optional().default([]),
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

  const form = useForm<ValidationFormData>({
    resolver: zodResolver(validationSchema),
    defaultValues: {
      generalContractor: "",
      architect: "",
      developmentContact: "",
      contactPerson: "",
      contactEmail: "",
      areaBreakdown: [],
    },
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const { data: properties = [] } = useQuery<any[]>({
    queryKey: ["/api/properties"],
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
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update RFP validation",
        variant: "destructive",
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
      });
      handleClose();
      onValidationComplete?.();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to advance workflow",
        variant: "destructive",
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
        description: "",
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
                            return parseInt(rfp.warehouseAreaOverride).toLocaleString();
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
                          return totalArea ? parseInt(totalArea.toString()).toLocaleString() : 0;
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
                            totalArea = parseInt(rfp.warehouseAreaOverride);
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
                            totalArea = calculatedArea > 0 ? calculatedArea : parseInt((warehouseArea || projectArea || 0).toString());
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
                    {/* Column Headers - Show only once */}
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-3">
                        <label className="text-sm font-medium text-gray-700">Space Type</label>
                      </div>
                      <div className="col-span-3">
                        <label className="text-sm font-medium text-gray-700">Area (sq ft)</label>
                      </div>
                      <div className="col-span-5">
                        <label className="text-sm font-medium text-gray-700">Notes</label>
                      </div>
                      <div className="col-span-1">
                        {/* Empty space for remove button column */}
                      </div>
                    </div>

                    {/* Area Items */}
                    {form.watch("areaBreakdown")?.map((area, index) => (
                      <div key={area.id} className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-3">
                          <Input
                            value={area.description}
                            onChange={(e) => updateAreaBreakdown(index, "description", e.target.value)}
                            placeholder="e.g., Office Space"
                          />
                        </div>
                        <div className="col-span-3">
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
                        <div className="col-span-5">
                          <Input
                            value={area.notes || ""}
                            onChange={(e) => updateAreaBreakdown(index, "notes", e.target.value)}
                            placeholder="Additional notes"
                          />
                        </div>
                        <div className="col-span-1">
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
                    ))}
                  </div>
                )}
              </div>
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