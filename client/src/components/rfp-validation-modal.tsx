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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, X, Save } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { RfpRequest, Contact } from "@shared/schema";
import { nanoid } from "nanoid";

const validationSchema = z.object({
  generalContractor: z.string().optional(),
  architect: z.string().optional(),
  officeAreaExisting: z.string().optional(),
  officeAreaNew: z.string().optional(),
  warehouseArea: z.string().optional(),
  warehouseNotes: z.string().optional(),
  projectAddress: z.string().optional(),
  projectSize: z.string().optional(),
  estimatedValue: z.string().optional(),
  timelineRequirements: z.string().optional(),
  specialRequirements: z.string().optional(),
  contactPerson: z.string().optional(),
  contactEmail: z.string().optional(),
  dueDate: z.string().optional(),
  projectDescription: z.string().optional(),
  documentsLink: z.string().optional(),
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
      officeAreaExisting: "",
      officeAreaNew: "",
      warehouseArea: "",
      warehouseNotes: "",
      projectAddress: "",
      projectSize: "",
      estimatedValue: "",
      timelineRequirements: "",
      specialRequirements: "",
      contactPerson: "",
      contactEmail: "",
      dueDate: "",
      projectDescription: "",
      documentsLink: "",
      areaBreakdown: [],
    },
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  // Load existing validation data when RFP changes
  useEffect(() => {
    if (rfp && isOpen) {
      form.reset({
        generalContractor: rfp.generalContractor || "",
        architect: rfp.architect || "",
        officeAreaExisting: rfp.officeAreaExisting || "",
        officeAreaNew: rfp.officeAreaNew || "",
        warehouseArea: rfp.warehouseArea || "",
        warehouseNotes: rfp.warehouseNotes || "",
        projectAddress: rfp.projectAddress || "",
        projectSize: rfp.projectSize || "",
        estimatedValue: rfp.estimatedValue || "",
        timelineRequirements: rfp.timelineRequirements || "",
        specialRequirements: rfp.specialRequirements || "",
        contactPerson: rfp.contactPerson || rfp.developmentContact || "",
        contactEmail: rfp.contactEmail || "",
        dueDate: rfp.dueDate ? new Date(rfp.dueDate).toISOString().split('T')[0] : "",
        projectDescription: rfp.projectDescription || "",
        documentsLink: rfp.documentsLink || "",
        areaBreakdown: rfp.areaBreakdown || [],
      });
    }
  }, [rfp, isOpen, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: ValidationFormData) => {
      if (!rfp) throw new Error("No RFP selected");

      const response = await apiRequest(`/api/rfp-requests/${rfp.id}`, "PATCH", {
        ...data,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      toast({
        title: "Success",
        description: "RFP validation details updated successfully",
      });
      handleClose();
      onValidationComplete?.();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update RFP validation",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ValidationFormData) => {
    updateMutation.mutate(data);
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
            {/* Contact Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Project Contacts</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="generalContractor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>General Contractor</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select general contractor" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {contacts
                            .filter((contact) => contact.type === "contractor")
                            .map((contact) => (
                              <SelectItem key={contact.id} value={`${contact.name} - ${contact.company}`}>
                                {contact.name} - {contact.company}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="architect"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Architect</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select architect" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {contacts
                            .filter((contact) => contact.type === "architect")
                            .map((contact) => (
                              <SelectItem key={contact.id} value={`${contact.name} - ${contact.company}`}>
                                {contact.name} - {contact.company}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="contactPerson"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Person</FormLabel>
                      <FormControl>
                        <Input placeholder="Primary contact person" {...field} />
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
                        <Input type="email" placeholder="contact@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Project Details */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Project Details</h3>
              
              <FormField
                control={form.control}
                name="projectDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Description</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Detailed project description..."
                        className="min-h-[100px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="projectAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Address</FormLabel>
                      <FormControl>
                        <Input placeholder="Project address" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Due Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="projectSize"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Size</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., 50,000 SF" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="estimatedValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estimated Value</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., $2,500,000" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Area Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Area Information</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="warehouseArea"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Warehouse Area (SF)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., 45,000" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="officeAreaExisting"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Existing Office Area (SF)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., 2,500" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="officeAreaNew"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New Office Area (SF)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., 2,500" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="warehouseNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Warehouse Notes</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Additional warehouse area notes..."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                      <div className="col-span-4">
                        <label className="text-sm font-medium text-gray-700">Description</label>
                      </div>
                      <div className="col-span-3">
                        <label className="text-sm font-medium text-gray-700">Square Footage</label>
                      </div>
                      <div className="col-span-4">
                        <label className="text-sm font-medium text-gray-700">Notes</label>
                      </div>
                      <div className="col-span-1">
                        {/* Empty space for remove button column */}
                      </div>
                    </div>

                    {/* Area Items */}
                    {form.watch("areaBreakdown")?.map((area, index) => (
                      <div key={area.id} className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-4">
                          <Input
                            value={area.description}
                            onChange={(e) => updateAreaBreakdown(index, "description", e.target.value)}
                            placeholder="e.g., Office Space"
                          />
                        </div>
                        <div className="col-span-3">
                          <Input
                            value={area.squareFootage}
                            onChange={(e) => updateAreaBreakdown(index, "squareFootage", e.target.value)}
                            placeholder="e.g., 5000"
                          />
                        </div>
                        <div className="col-span-4">
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

            {/* Additional Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Additional Requirements</h3>
              
              <FormField
                control={form.control}
                name="timelineRequirements"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Timeline Requirements</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Project timeline and milestone requirements..."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="specialRequirements"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Special Requirements</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Special construction requirements, certifications, etc..."
                        {...field}
                      />
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
                      <Input 
                        placeholder="Link to additional project documents"
                        {...field}
                      />
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
                disabled={updateMutation.isPending}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                <Save className="h-4 w-4 mr-2" />
                {updateMutation.isPending ? "Saving..." : "Save Validation Details"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}