import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { updateRfpRequestSchema } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Edit, Save, X } from "lucide-react";
import type { RfpRequest } from "@shared/schema";

const editRfpSchema = z.object({
  rfpNumber: z.string().min(1, "RFP number is required"),
  property: z.string().min(1, "Property is required"),
  tenantName: z.string().min(1, "Tenant name is required"),
  projectName: z.string().min(1, "Project name is required"),
  confidential: z.boolean().optional(),
  sentBy: z.string().min(1, "Sent by is required"),
  sentOn: z.string().min(1, "Sent on date is required"),
  developmentContact: z.string().optional(),
  projectArea: z.string().optional(),
  requestTypes: z.array(z.string()).min(1, "At least one request type is required"),
  notes: z.string().optional(),
  status: z.enum(["received", "in-progress", "completed", "on-hold"]),
  workflowPhase: z.enum(["rfp-entry", "invitation-to-bid", "bid-collection", "evaluation", "award"]).optional(),
});

type EditRfpFormData = z.infer<typeof editRfpSchema>;

interface EditRfpModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfp: RfpRequest | null;
}

export function EditRfpModal({ isOpen, onClose, rfp }: EditRfpModalProps) {
  const { toast } = useToast();

  const form = useForm<EditRfpFormData>({
    resolver: zodResolver(editRfpSchema),
    defaultValues: {
      rfpNumber: "",
      property: "",
      tenantName: "",
      projectName: "",
      confidential: false,
      sentBy: "",
      sentOn: "",
      developmentContact: "",
      projectArea: "",
      requestTypes: [],
      notes: "",
      status: "received",
      workflowPhase: "rfp-entry",
    },
  });

  // Update form values when rfp changes
  useEffect(() => {
    if (rfp && isOpen) {
      form.reset({
        rfpNumber: rfp.rfpNumber || "",
        property: rfp.property || "",
        tenantName: rfp.tenantName || "",
        projectName: rfp.projectName || "",
        confidential: Boolean(rfp.confidential),
        sentBy: rfp.sentBy || "",
        sentOn: rfp.sentOn ? new Date(rfp.sentOn).toISOString().split('T')[0] : "",
        developmentContact: rfp.developmentContact || "",
        projectArea: rfp.projectArea || "",
        requestTypes: rfp.requestTypes || [],
        notes: rfp.notes || "",
        status: rfp.status as "received" | "in-progress" | "completed" | "on-hold",
        workflowPhase: (rfp.workflowPhase || "rfp-entry") as "rfp-entry" | "invitation-to-bid" | "bid-collection" | "evaluation" | "award",
      });
    }
  }, [rfp, isOpen, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: EditRfpFormData) => {
      if (!rfp) throw new Error("No RFP selected");
      return apiRequest(`/api/rfp-requests/${rfp.id}`, "PATCH", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Success",
        description: "RFP updated successfully",
      });
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update RFP",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: EditRfpFormData) => {
    updateMutation.mutate(data);
  };

  if (!rfp) return null;

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5" />
            Edit RFP Request
          </DialogTitle>
          <DialogDescription>
            Update the details for this RFP request. All fields are editable.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* RFP Number */}
            <FormField
              control={form.control}
              name="rfpNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>RFP Number</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., RFP-2025-001" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Property */}
            <FormField
              control={form.control}
              name="property"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Property</FormLabel>
                  <FormControl>
                    <Input placeholder="Property name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Tenant Name */}
            <FormField
              control={form.control}
              name="tenantName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tenant Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Tenant name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Project Name */}
            <FormField
              control={form.control}
              name="projectName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Project name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Confidential */}
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
                    <FormLabel>Confidential</FormLabel>
                  </div>
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              {/* Sent By */}
              <FormField
                control={form.control}
                name="sentBy"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sent By</FormLabel>
                    <FormControl>
                      <Input placeholder="Person who sent" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Sent On */}
              <FormField
                control={form.control}
                name="sentOn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sent On</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Development Contact */}
              <FormField
                control={form.control}
                name="developmentContact"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Development Contact</FormLabel>
                    <FormControl>
                      <Input placeholder="Development contact" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Project Area */}
              <FormField
                control={form.control}
                name="projectArea"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Area (sq ft)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., 95000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Request Types */}
            <FormField
              control={form.control}
              name="requestTypes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Request Types</FormLabel>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {["pricing", "schedule", "space-plan"].map((type) => (
                      <div key={type} className="flex items-center space-x-2">
                        <Checkbox
                          id={type}
                          checked={field.value?.includes(type)}
                          onCheckedChange={(checked) => {
                            const currentTypes = field.value || [];
                            if (checked) {
                              field.onChange([...currentTypes, type]);
                            } else {
                              field.onChange(currentTypes.filter((t) => t !== type));
                            }
                          }}
                        />
                        <label
                          htmlFor={type}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 capitalize"
                        >
                          {type.replace("-", " ")}
                        </label>
                      </div>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              {/* Status */}
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="received">Received</SelectItem>
                        <SelectItem value="in-progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="on-hold">On Hold</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Workflow Phase */}
              <FormField
                control={form.control}
                name="workflowPhase"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Workflow Phase</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select phase" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="entry">Entry</SelectItem>
                        <SelectItem value="validation">Validation</SelectItem>
                        <SelectItem value="invitation">Invitation</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Additional notes..."
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={updateMutation.isPending}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                <Save className="h-4 w-4 mr-2" />
                {updateMutation.isPending ? "Updating..." : "Update RFP"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}