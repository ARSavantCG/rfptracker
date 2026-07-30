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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import { Calendar, Trash2, Edit, Plus, Building, Users, Printer } from "lucide-react";
import type { Property, ExecutedLease, BayConfiguration } from "@shared/schema";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";
import { BaySelectionGrid } from "@/components/bay-selection-grid";

const leaseFormSchema = z.object({
  tenantName: z.string().min(1, "Tenant name is required"),
  assignedBays: z.array(z.string()).min(1, "At least one bay must be assigned"),
  rentableAreaOverride: z.number().min(0).optional(),
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
      assignedBays: [],
      rentableAreaOverride: undefined,
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
      return apiRequest(`/api/properties/${property.id}/executed-leases`, "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/executed-leases`] });
      setShowForm(false);
      form.reset();
      toast({ title: "Success", description: "Lease created successfully", duration: 4000 });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create lease", variant: "destructive", duration: 6000 });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: LeaseFormData) => {
      return apiRequest(`/api/executed-leases/${editingLease!.id}`, "PATCH", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/executed-leases`] });
      setEditingLease(null);
      setShowForm(false);
      form.reset();
      toast({ title: "Success", description: "Lease updated successfully", duration: 4000 });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update lease", variant: "destructive", duration: 6000 });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (leaseId: number) => {
      return apiRequest(`/api/executed-leases/${leaseId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/executed-leases`] });
      toast({ title: "Success", description: "Lease deleted successfully", duration: 4000 });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete lease", variant: "destructive", duration: 6000 });
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
      assignedBays: lease.assignedBays || [],
      rentableAreaOverride: lease.rentableAreaOverride || undefined,
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

  const handlePrint = async () => {
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const response = await fetch(`/api/properties/${property.id}/executed-leases/print`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Print failed');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      console.error('Leases print error:', error);
      toast({
        title: "Print Error",
        description: "Failed to generate leases report",
        variant: "destructive",
        duration: 6000,
      });
    }
  };

  // Get leased bays to filter from available bays
  const leasedBays = leases.flatMap(lease => lease.assignedBays || []);
  const unassignedBays = availableBays.filter(bay => !leasedBays.includes(bay.id));

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex items-center gap-1 text-xs px-2 py-1 h-6">
          <Building className="h-3 w-3" />
          Manage Leases
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Building className="h-5 w-5" />
            Executed Leases - {property.propertyName}
          </DialogTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="flex items-center gap-1 mr-2 mt-1"
          >
            <Printer className="h-4 w-4" />
            Print
          </Button>
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

                    {/* Bay Assignment */}
                    <FormField
                      control={form.control}
                      name="assignedBays"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Assigned Bays</FormLabel>
                          <FormControl>
                            <div className="border rounded-md">
                              <BaySelectionGrid
                                property={property}
                                excludeLeaseId={editingLease?.id}
                                initialSelectedBays={(property?.bayConfigurations || []).filter(
                                  (bay: BayConfiguration) => field.value?.includes(bay.id)
                                )}
                                onSelectionChange={(selectedBays) => {
                                  field.onChange(selectedBays.map((bay) => bay.id));
                                }}
                              />
                            </div>
                          </FormControl>
                          
                          {/* Rentable Area Calculator */}
                          {field.value.length > 0 && (
                            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
                              <div className="text-sm font-medium text-blue-800 mb-2">Selected Bays Summary</div>
                              <div className="space-y-1 text-sm text-blue-700">
                                {field.value.map((bayId: string) => {
                                  const bay = availableBays.find(b => b.id === bayId);
                                  return bay ? (
                                    <div key={bayId} className="flex justify-between">
                                      <span>{bay.bayName}</span>
                                      <span>{(bay.rentableSquareFootage || bay.squareFootage).toLocaleString()} SF</span>
                                    </div>
                                  ) : null;
                                })}
                                <div className="border-t border-blue-300 pt-2 mt-2 font-semibold flex justify-between">
                                  <span>Total Rentable Area:</span>
                                  <span>{field.value.reduce((total: number, bayId: string) => {
                                    const bay = availableBays.find(b => b.id === bayId);
                                    return total + (bay ? (bay.rentableSquareFootage || bay.squareFootage) : 0);
                                  }, 0).toLocaleString()} SF</span>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Executed Lease Area Override */}
                    <FormField
                      control={form.control}
                      name="rentableAreaOverride"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-orange-700 font-semibold">Executed Lease Area (Override Bay Calculation)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="0"
                              className="border-orange-300 focus:border-orange-500"
                              {...field}
                              value={field.value || ""}
                              onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                              placeholder="Enter actual lease square footage if different from bay calculation"
                            />
                          </FormControl>
                          <div className="text-xs text-orange-600 mt-1 font-medium">
                            <strong>Optional:</strong> Enter the actual lease area if it differs from the calculated bay area above. 
                            This will override the bay calculation for all lease displays and reports.
                          </div>
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
                                value={field.value || ""}
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                                placeholder=""
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
                                value={field.value || ""}
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                                placeholder=""
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
                                value={field.value || ""}
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                                placeholder=""
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
                                value={field.value || ""}
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                                placeholder=""
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
                          <div className="grid grid-cols-2 gap-4">
                            <div className="text-sm">
                              <span className="text-gray-500">Rentable Area:</span>
                              <span className="ml-2 font-semibold text-blue-700">
                                {(() => {
                                  // Use override if available, otherwise calculate from bay configurations
                                  if (lease.rentableAreaOverride) {
                                    return lease.rentableAreaOverride.toLocaleString();
                                  }
                                  const assignedBayConfigs = property.bayConfigurations?.filter(
                                    (bay: any) => lease.assignedBays?.includes(bay.id)
                                  ) || [];
                                  const totalRentableArea = assignedBayConfigs.reduce(
                                    (total: number, bay: any) => total + (bay.rentableSquareFootage || bay.squareFootage || 0),
                                    0
                                  );
                                  return totalRentableArea.toLocaleString();
                                })()} SF
                                {lease.rentableAreaOverride && (
                                  <span className="text-xs text-orange-600 ml-1">(Override)</span>
                                )}
                              </span>
                            </div>
                            <div className="text-sm">
                              <span className="text-gray-500">Parking:</span>
                              <span className="ml-2 font-medium">
                                {`${lease.standardParking || 0} Std, ${lease.accessibleParking || 0} ADA, ${lease.evParking || 0} EV, ${lease.trailerParking || 0} Trailer`}
                              </span>
                            </div>
                          </div>
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