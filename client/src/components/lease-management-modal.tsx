/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import { Calendar, Trash2, Edit, Plus, Building, Users } from "lucide-react";
import type { Property, ExecutedLease, BayConfiguration } from "@shared/schema";

const leaseFormSchema = z.object({
  tenantName: z.string().min(1, "Tenant name is required"),
  leaseStartDate: z.string().min(1, "Lease start date is required"),
  leaseEndDate: z.string().optional(),
  assignedBays: z.array(z.string()).min(1, "At least one bay must be assigned"),
  standardParking: z.number().min(0).default(0),
  accessibleParking: z.number().min(0).default(0),
  evParking: z.number().min(0).default(0),
  trailerParking: z.number().min(0).default(0),
  notes: z.string().optional(),
});

type LeaseFormData = z.infer<typeof leaseFormSchema>;

interface LeaseManagementModalProps {
  property: Property;
  availableBays: BayConfiguration[];
}

export default function LeaseManagementModal({ property, availableBays }: LeaseManagementModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingLease, setEditingLease] = useState<ExecutedLease | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<LeaseFormData>({
    resolver: zodResolver(leaseFormSchema),
    defaultValues: {
      tenantName: "",
      leaseStartDate: "",
      leaseEndDate: "",
      assignedBays: [],
      standardParking: 0,
      accessibleParking: 0,
      evParking: 0,
      trailerParking: 0,
      notes: "",
    },
  });

  const { data: leases = [], isLoading } = useQuery<ExecutedLease[]>({
    queryKey: [`/api/properties/${property.id}/executed-leases`],
    enabled: isOpen,
  });

  const createMutation = useMutation({
    mutationFn: async (data: LeaseFormData) => {
      const formattedData = {
        ...data,
        leaseStartDate: new Date(data.leaseStartDate),
        leaseEndDate: data.leaseEndDate ? new Date(data.leaseEndDate) : null,
      };
      return apiRequest(`/api/properties/${property.id}/executed-leases`, "POST", formattedData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/executed-leases`] });
      setShowForm(false);
      form.reset();
      toast({ title: "Success", description: "Lease created successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create lease", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: LeaseFormData) => {
      const formattedData = {
        ...data,
        leaseStartDate: new Date(data.leaseStartDate),
        leaseEndDate: data.leaseEndDate ? new Date(data.leaseEndDate) : null,
      };
      return apiRequest(`/api/executed-leases/${editingLease!.id}`, "PATCH", formattedData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/executed-leases`] });
      setEditingLease(null);
      setShowForm(false);
      form.reset();
      toast({ title: "Success", description: "Lease updated successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update lease", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (leaseId: number) => {
      return apiRequest(`/api/executed-leases/${leaseId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/executed-leases`] });
      toast({ title: "Success", description: "Lease deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete lease", variant: "destructive" });
    },
  });

  const onSubmit = (data: LeaseFormData) => {
    if (editingLease) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (lease: ExecutedLease) => {
    setEditingLease(lease);
    form.reset({
      tenantName: lease.tenantName,
      leaseStartDate: lease.leaseStartDate.toISOString().split('T')[0],
      leaseEndDate: lease.leaseEndDate ? lease.leaseEndDate.toISOString().split('T')[0] : "",
      assignedBays: lease.assignedBays || [],
      standardParking: lease.standardParking || 0,
      accessibleParking: lease.accessibleParking || 0,
      evParking: lease.evParking || 0,
      trailerParking: lease.trailerParking || 0,
      notes: lease.notes || "",
    });
    setShowForm(true);
  };

  const handleCancel = () => {
    setEditingLease(null);
    setShowForm(false);
    form.reset();
  };

  // Get leased bays to filter from available bays
  const leasedBays = leases.flatMap(lease => lease.assignedBays || []);
  const unassignedBays = availableBays.filter(bay => !leasedBays.includes(bay.id));

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="flex items-center gap-2">
          <Building className="h-4 w-4" />
          Manage Leases
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building className="h-5 w-5" />
            Executed Leases - {property.propertyName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Add New Lease Button */}
          {!showForm && (
            <Button onClick={() => setShowForm(true)} className="mb-4">
              <Plus className="h-4 w-4 mr-2" />
              Add New Lease
            </Button>
          )}

          {/* Lease Form */}
          {showForm && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {editingLease ? "Edit Lease" : "Add New Lease"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="tenantName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tenant Name</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="Enter tenant name" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <FormField
                          control={form.control}
                          name="leaseStartDate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Start Date</FormLabel>
                              <FormControl>
                                <Input type="date" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="leaseEndDate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>End Date (Optional)</FormLabel>
                              <FormControl>
                                <Input type="date" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    {/* Bay Assignment */}
                    <FormField
                      control={form.control}
                      name="assignedBays"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Assigned Bays</FormLabel>
                          <FormControl>
                            <div className="grid grid-cols-6 gap-2 max-h-32 overflow-y-auto border rounded-md p-3">
                              {availableBays.map((bay) => (
                                <div
                                  key={bay.id}
                                  className={`flex items-center space-x-2 ${
                                    leasedBays.includes(bay.id) && !editingLease?.assignedBays?.includes(bay.id)
                                      ? "opacity-50"
                                      : ""
                                  }`}
                                >
                                  <Checkbox
                                    id={bay.id}
                                    checked={field.value.includes(bay.id)}
                                    disabled={
                                      leasedBays.includes(bay.id) && !editingLease?.assignedBays?.includes(bay.id)
                                    }
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        field.onChange([...field.value, bay.id]);
                                      } else {
                                        field.onChange(field.value.filter((id: string) => id !== bay.id));
                                      }
                                    }}
                                  />
                                  <label
                                    htmlFor={bay.id}
                                    className={`text-sm font-medium cursor-pointer ${
                                      leasedBays.includes(bay.id) && !editingLease?.assignedBays?.includes(bay.id)
                                        ? "text-gray-400"
                                        : ""
                                    }`}
                                  >
                                    {bay.bayName}
                                  </label>
                                </div>
                              ))}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Parking Information */}
                    <div className="grid grid-cols-4 gap-4">
                      <FormField
                        control={form.control}
                        name="standardParking"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Standard Parking</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="0"
                                {...field}
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="accessibleParking"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Accessible Parking</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="0"
                                {...field}
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="evParking"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>EV Parking</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="0"
                                {...field}
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="trailerParking"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Trailer Parking</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="0"
                                {...field}
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes</FormLabel>
                          <FormControl>
                            <Textarea {...field} placeholder="Additional notes about this lease" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex gap-2">
                      <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                        {editingLease ? "Update Lease" : "Create Lease"}
                      </Button>
                      <Button type="button" variant="outline" onClick={handleCancel}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}

          {/* Existing Leases */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Users className="h-5 w-5" />
              Current Leases ({leases.length})
            </h3>
            
            {isLoading ? (
              <div className="text-center py-8">Loading leases...</div>
            ) : leases.length === 0 ? (
              <Card>
                <CardContent className="text-center py-8">
                  <p className="text-gray-500">No executed leases found for this property.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {leases.map((lease: ExecutedLease) => (
                  <Card key={lease.id}>
                    <CardContent className="pt-6">
                      <div className="flex justify-between items-start">
                        <div className="space-y-2">
                          <h4 className="font-semibold text-lg">{lease.tenantName}</h4>
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              {formatDate(lease.leaseStartDate)} - {lease.leaseEndDate ? formatDate(lease.leaseEndDate) : "Open"}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {lease.assignedBays?.map((bayId) => (
                              <Badge key={bayId} variant="secondary">
                                Bay {bayId}
                              </Badge>
                            ))}
                          </div>
                          {(lease.standardParking || lease.accessibleParking || lease.evParking || lease.trailerParking) && (
                            <div className="text-sm text-gray-600">
                              Parking: {lease.standardParking || 0} Standard, {lease.accessibleParking || 0} Accessible, 
                              {lease.evParking || 0} EV, {lease.trailerParking || 0} Trailer
                            </div>
                          )}
                          {lease.notes && (
                            <p className="text-sm text-gray-600">{lease.notes}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(lease)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deleteMutation.mutate(lease.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}