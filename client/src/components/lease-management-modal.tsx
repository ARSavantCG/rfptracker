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
import { Checkbox } from "@/components/ui/checkbox";
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
import { defaultElectricalAllocation } from "@shared/electrical-utils";
import { ProjectTeamSection } from "@/components/project-team-section";

const leaseFormSchema = z.object({
  tenantName: z.string().min(1, "Tenant name is required"),
  assignedBays: z.array(z.string()).min(1, "At least one bay must be assigned"),
  rentableAreaOverride: z.number().min(0).optional(),
  standardParking: z.number().min(0).default(0),
  accessibleParking: z.number().min(0).default(0),
  evParking: z.number().min(0).default(0),
  trailerParking: z.number().min(0).default(0),
  leaseType: z.enum(['executed', 'temporary']).default('executed'),
  constructionByTenant: z.boolean().default(false),
  electricalAllocation: z.number().min(0).optional(),
  notes: z.string().optional(),
});

type LeaseFormData = z.infer<typeof leaseFormSchema>;

interface LeaseManagementModalProps {
  property: Property;
  availableBays: BayConfiguration[];
}

/**
 * The blank lease form.
 *
 * Must be passed EXPLICITLY to every form.reset(). react-hook-form treats the
 * argument to reset() as the form's new defaultValues, so once handleEdit calls
 * reset({...thatLease}), a later bare reset() restores THAT LEASE rather than an
 * empty form. That is why "Add New Lease" came up pre-filled with the previous
 * tenant's details, and why cleared numbers reappeared.
 */
function blankLeaseForm(): LeaseFormData {
  return {
    tenantName: "",
    assignedBays: [],
    rentableAreaOverride: undefined,
    standardParking: 0,
    accessibleParking: 0,
    evParking: 0,
    trailerParking: 0,
    leaseType: 'executed' as const,
    electricalAllocation: undefined,
    notes: "",
  };
}

export default function LeaseManagementModal({ property, availableBays }: LeaseManagementModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingLease, setEditingLease] = useState<ExecutedLease | null>(null);
  const [showForm, setShowForm] = useState(false);
  // Bumped every time the form is opened. Used as a React key on the bay grid so
  // it remounts with a clean internal selection each session - resetting the form
  // field alone does not clear the grid's own state.
  const [formInstance, setFormInstance] = useState(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<LeaseFormData>({
    resolver: zodResolver(leaseFormSchema),
    defaultValues: blankLeaseForm(),
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
      setEditingLease(null);
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}/executed-leases`] });
      setShowForm(false);
      form.reset(blankLeaseForm());
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
      form.reset(blankLeaseForm());
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

  // The Add button previously did only setShowForm(true) - it neither cleared
  // editingLease nor reset the form, so re-opening the form showed whatever was
  // last in it. Worse, a stale editingLease routes onSubmit to updateMutation, so
  // "adding" a lease would have PATCHed the one previously edited.
  const startNewLease = () => {
    setEditingLease(null);
    form.reset(blankLeaseForm());
    setFormInstance((n) => n + 1);
    setShowForm(true);
  };

  // Closing the dialog (X, overlay click, Esc) bypassed handleCancel entirely, so
  // form state, showForm, and editingLease all survived until the next open.
  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      setEditingLease(null);
      setShowForm(false);
      form.reset(blankLeaseForm());
    }
    setIsOpen(open);
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
      leaseType: (lease.leaseType === 'temporary' ? 'temporary' : 'executed') as 'executed' | 'temporary',
      constructionByTenant: !!lease.constructionByTenant,
      electricalAllocation: lease.electricalAllocation ?? undefined,
      notes: lease.notes || "",
    });
    setFormInstance((n) => n + 1);
    setShowForm(true);
  };

  const handleCancel = () => {
    setEditingLease(null);
    setShowForm(false);
    form.reset(blankLeaseForm());
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
    <Dialog open={isOpen} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex items-center gap-1 text-xs px-2 py-1 h-6">
          <Building className="h-3 w-3" />
          Manage Leases
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[1100px] max-w-[95vw] max-h-[90vh] overflow-y-auto">
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
            <Button onClick={startNewLease} className="mb-4">
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
                            <div className="border rounded-md min-w-0 overflow-x-auto max-h-[300px] overflow-y-auto">
                              <BaySelectionGrid
                                key={formInstance}
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
                              onWheel={(e) => e.currentTarget.blur()}
                              min="0"
                              className="border-orange-300 focus:border-orange-500"
                              {...field}
                              value={field.value ?? ""}
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

                    {/* Lease Type */}
                    <FormField
                      control={form.control}
                      name="leaseType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Agreement Type</FormLabel>
                          <FormControl>
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              value={field.value}
                              onChange={(e) => field.onChange(e.target.value)}
                            >
                              <option value="executed">Executed Lease</option>
                              <option value="temporary">Temporary / Access Agreement</option>
                            </select>
                          </FormControl>
                          <div className="text-xs text-muted-foreground mt-1">
                            {field.value === 'temporary'
                              ? 'Shown in the bay grid with a dashed amber border and a TEMP marker, but the bays stay selectable for RFPs and other leases.'
                              : 'Blocks its bays from selection in the bay grid.'}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Construction responsibility */}
                    <FormField
                      control={form.control}
                      name="constructionByTenant"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start gap-2 space-y-0 rounded-md border p-3">
                          <FormControl>
                            <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(!!v)} />
                          </FormControl>
                          <div className="leading-tight">
                            <FormLabel className="cursor-pointer">Construction by tenant</FormLabel>
                            <p className="text-xs text-muted-foreground mt-1">
                              Tenant performs its own build-out, so no landlord design team is required.
                              The Project Team Directory will show this lease as N/A rather than flagging
                              it as missing a team.
                            </p>
                          </div>
                        </FormItem>
                      )}
                    />

                    {/* Electrical Allocation */}
                    <FormField
                      control={form.control}
                      name="electricalAllocation"
                      render={({ field }) => {
                        // Same rule the RFP validation screen uses: the tenant's
                        // proportionate share of the building's total amps, floored
                        // to the property's increment. Computed from the bays selected
                        // above, so it moves as the selection changes.
                        const selectedBayIds: string[] = form.watch("assignedBays") || [];
                        const selectedSf = availableBays
                          .filter((b) => selectedBayIds.includes(b.id))
                          .reduce((sum, b) => sum + (b.rentableSquareFootage || b.squareFootage || 0), 0);
                        const buildingSf = (property?.bayConfigurations || []).reduce(
                          (sum: number, b: BayConfiguration) => sum + (b.rentableSquareFootage || b.squareFootage || 0), 0
                        );
                        const sharePct = buildingSf > 0 ? (selectedSf / buildingSf) * 100 : 0;
                        const buildingAmps = property?.electricalAllocation || 0;
                        const increment = property?.electricalAllocationIncrement || 200;
                        const suggested = defaultElectricalAllocation({
                          buildingTotalAmps: buildingAmps,
                          tenantSharePercent: sharePct,
                          increment,
                          minimum: property?.electricalAllocationMinimum ?? 200,
                        });

                        return (
                          <FormItem>
                            <FormLabel>Electrical Allocation (AMPS)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                onWheel={(e) => e.currentTarget.blur()}
                                min="0"
                                {...field}
                                value={field.value ?? ""}
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                                placeholder={suggested > 0 ? `${suggested}` : ""}
                              />
                            </FormControl>
                            {buildingAmps > 0 && sharePct > 0 ? (
                              <div className="text-xs text-muted-foreground mt-1">
                                Suggested <strong>{suggested.toLocaleString()} A</strong> &mdash;{" "}
                                {sharePct.toFixed(1)}% of {buildingAmps.toLocaleString()} A building total,
                                rounded down to the {increment} A increment.
                                {field.value == null && (
                                  <button
                                    type="button"
                                    className="ml-2 underline text-blue-700"
                                    onClick={() => field.onChange(suggested)}
                                  >
                                    Use suggested
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground mt-1">
                                {buildingAmps > 0
                                  ? "Select bays above to derive a suggested allocation."
                                  : "No building electrical allocation recorded on this property."}
                              </div>
                            )}
                            <FormMessage />
                          </FormItem>
                        );
                      }}
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
                                onWheel={(e) => e.currentTarget.blur()}
                                min="0"
                                {...field}
                                value={field.value ?? ""}
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
                                onWheel={(e) => e.currentTarget.blur()}
                                min="0"
                                {...field}
                                value={field.value ?? ""}
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
                                onWheel={(e) => e.currentTarget.blur()}
                                min="0"
                                {...field}
                                value={field.value ?? ""}
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
                                onWheel={(e) => e.currentTarget.blur()}
                                min="0"
                                {...field}
                                value={field.value ?? ""}
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
                                {lease.leaseType === 'temporary' && (
                                  <span className="inline-block mr-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-semibold align-middle">
                                    TEMPORARY
                                  </span>
                                )}{`${lease.standardParking || 0} Std, ${lease.accessibleParking || 0} ADA, ${lease.evParking || 0} EV, ${lease.trailerParking || 0} Trailer`}{lease.electricalAllocation ? ` · ${lease.electricalAllocation.toLocaleString()} A` : ''}
                              </span>
                            </div>
                          </div>

                          {/* Design team for this lease. Lives here rather than on
                              the RFP because the lease is the deal that actually
                              gets built, and it is what the directory report reads. */}
                          {lease.constructionByTenant ? (
                            <div className="mt-3 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
                              Construction by tenant — no landlord design team required. Shown as N/A on the
                              Project Team Directory.
                            </div>
                          ) : (
                            <ProjectTeamSection leaseId={lease.id} />
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