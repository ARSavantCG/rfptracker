import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertInvitationToBidSchema } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Users, Save, X } from "lucide-react";
import type { RfpRequest } from "@shared/schema";

const invitationFormSchema = insertInvitationToBidSchema.omit({
  rfpId: true,
});

type InvitationFormData = z.infer<typeof invitationFormSchema>;

interface InvitationToBidModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfp: RfpRequest | null;
}

export function InvitationToBidModal({ isOpen, onClose, rfp }: InvitationToBidModalProps) {
  const { toast } = useToast();

  const form = useForm<InvitationFormData>({
    resolver: zodResolver(invitationFormSchema),
    defaultValues: {
      projectScope: "",
      projectLocation: "",
      estimatedBudget: "",
      projectTimeline: "",
      bidSubmissionDeadline: "",
      projectStartDate: "",
      projectEndDate: "",
      specialRequirements: [],
      technicalSpecifications: "",
      contractTerms: "",
      paymentTerms: "",
      insuranceRequirements: "",
      bondingRequirements: "",
      prequalificationCriteria: [],
      evaluationCriteria: [],
      contactForQuestions: "",
      siteVisitScheduled: "",
      additionalDocuments: [],
    },
  });

  // Reset form when rfp changes
  useEffect(() => {
    if (rfp && isOpen) {
      // Pre-populate with RFP data where applicable
      form.reset({
        projectScope: `${rfp.project} - ${rfp.requestTypes.join(", ")}`,
        projectLocation: "",
        estimatedBudget: "",
        projectTimeline: "",
        bidSubmissionDeadline: "",
        projectStartDate: "",
        projectEndDate: "",
        specialRequirements: [],
        technicalSpecifications: "",
        contractTerms: "",
        paymentTerms: "",
        insuranceRequirements: "",
        bondingRequirements: "",
        prequalificationCriteria: [],
        evaluationCriteria: [],
        contactForQuestions: rfp.contactPerson || "",
        siteVisitScheduled: "",
        additionalDocuments: [],
      });
    }
  }, [rfp, isOpen, form]);

  const createInvitationMutation = useMutation({
    mutationFn: async (data: InvitationFormData) => {
      if (!rfp) throw new Error("No RFP selected");
      
      // Create invitation to bid
      const invitationData = { ...data, rfpId: rfp.id };
      await apiRequest("/api/invitation-to-bid", "POST", invitationData);
      
      // Advance workflow phase
      await apiRequest(`/api/rfp-requests/${rfp.id}/workflow-phase`, "PATCH", { 
        phase: "invitation-to-bid" 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      toast({
        title: "Invitation to Bid created",
        description: "Project has been advanced to invitation-to-bid phase",
      });
      onClose();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create invitation to bid. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InvitationFormData) => {
    createInvitationMutation.mutate(data);
  };

  const handleClose = () => {
    form.reset();
    onClose();
  };

  if (!rfp) return null;

  const commonRequirements = [
    "Licensed contractor",
    "Bonding capacity",
    "Insurance coverage",
    "Previous experience",
    "Financial stability",
    "Local presence",
    "Safety record",
    "Environmental compliance"
  ];

  const evaluationFactors = [
    "Price competitiveness",
    "Technical capability",
    "Schedule feasibility",
    "Past performance",
    "Resource availability",
    "Quality standards",
    "Innovation approach",
    "Local workforce"
  ];

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Create Invitation to Bid - {rfp.rfpNumber}
          </DialogTitle>
          <DialogDescription>
            Set up the invitation to bid requirements and specifications for contractors and architects
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Project Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Project Information</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="projectScope"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Scope</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Detailed description of project scope and requirements"
                          rows={3}
                          {...field}
                        />
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
                        <Input placeholder="Full project address" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="estimatedBudget"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estimated Budget</FormLabel>
                      <FormControl>
                        <Input placeholder="$X,XXX,XXX" {...field} />
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
                        <Input placeholder="X months" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contactForQuestions"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact for Questions</FormLabel>
                      <FormControl>
                        <Input placeholder="Contact person name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Dates and Deadlines */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Schedule</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <FormField
                  control={form.control}
                  name="bidSubmissionDeadline"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bid Submission Deadline *</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="siteVisitScheduled"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Site Visit Date</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="projectStartDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Start Date</FormLabel>
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
                      <FormLabel>Project End Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Requirements and Criteria */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Requirements & Criteria</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="prequalificationCriteria"
                  render={() => (
                    <FormItem>
                      <FormLabel>Prequalification Requirements</FormLabel>
                      <div className="grid grid-cols-1 gap-2">
                        {commonRequirements.map((requirement) => (
                          <FormField
                            key={requirement}
                            control={form.control}
                            name="prequalificationCriteria"
                            render={({ field }) => {
                              return (
                                <FormItem
                                  key={requirement}
                                  className="flex flex-row items-start space-x-3 space-y-0"
                                >
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(requirement)}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...field.value, requirement])
                                          : field.onChange(
                                              field.value?.filter(
                                                (value) => value !== requirement
                                              )
                                            )
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal">
                                    {requirement}
                                  </FormLabel>
                                </FormItem>
                              )
                            }}
                          />
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="evaluationCriteria"
                  render={() => (
                    <FormItem>
                      <FormLabel>Evaluation Criteria</FormLabel>
                      <div className="grid grid-cols-1 gap-2">
                        {evaluationFactors.map((factor) => (
                          <FormField
                            key={factor}
                            control={form.control}
                            name="evaluationCriteria"
                            render={({ field }) => {
                              return (
                                <FormItem
                                  key={factor}
                                  className="flex flex-row items-start space-x-3 space-y-0"
                                >
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(factor)}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...field.value, factor])
                                          : field.onChange(
                                              field.value?.filter(
                                                (value) => value !== factor
                                              )
                                            )
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal">
                                    {factor}
                                  </FormLabel>
                                </FormItem>
                              )
                            }}
                          />
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Specifications and Terms */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Specifications & Terms</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="technicalSpecifications"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Technical Specifications</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Detailed technical requirements and specifications"
                          rows={4}
                          {...field}
                        />
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
                        <Textarea 
                          placeholder="Contract terms and conditions"
                          rows={4}
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
                          rows={3}
                          {...field}
                        />
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
                        <Textarea 
                          placeholder="Required insurance coverage and limits"
                          rows={3}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="bondingRequirements"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bonding Requirements</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Performance bond and payment bond requirements"
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-3 pt-6 border-t">
              <Button type="button" variant="outline" onClick={handleClose}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={createInvitationMutation.isPending}
              >
                <Save className="h-4 w-4 mr-2" />
                {createInvitationMutation.isPending ? "Creating..." : "Create Invitation to Bid"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}