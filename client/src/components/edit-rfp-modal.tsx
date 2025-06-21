import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { PropertySelector } from "./property-selector";
import { FileUpload } from "./file-upload";
import { BayConfigurationModal } from "./bay-configuration-modal";
import { Edit, Save, X, Download, Trash2, Grid3x3 } from "lucide-react";
import type { RfpRequest, RfpFile, Property, BayConfiguration } from "@shared/schema";

const editRfpSchema = z.object({
  rfpNumber: z.string().min(1, "RFP number is required"),
  property: z.string().min(1, "Property is required"),
  tenantName: z.string().min(1, "Tenant name is required"),
  projectName: z.string().min(1, "Project name is required"),
  confidential: z.boolean(),
  sentBy: z.string().min(1, "Sent by is required"),
  receivedOn: z.string().min(1, "Received on date is required"),
  internalDueDate: z.string().min(1, "Internal due date is required"),
  developmentContact: z.string(),
  projectArea: z.string(),
  requestTypes: z.array(z.string()).min(1, "At least one request type is required"),
  notes: z.string(),
  status: z.enum(["received", "in-progress", "completed", "on-hold"]),
  workflowPhase: z.enum(["rfp-entry", "invitation-to-bid", "bid-collection", "evaluation", "award", "publish"]),
});

type EditRfpFormData = z.infer<typeof editRfpSchema>;

interface EditRfpModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfp: RfpRequest | null;
}

export function EditRfpModal({ isOpen, onClose, rfp }: EditRfpModalProps) {
  const { toast } = useToast();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [calculatedFloorArea, setCalculatedFloorArea] = useState<number>(0);
  const [selectedBayConfigurations, setSelectedBayConfigurations] = useState<BayConfiguration[]>([]);
  const [bayConfigModalOpen, setBayConfigModalOpen] = useState(false);

  // Fetch properties for bay configuration
  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    enabled: isOpen,
  });

  // Handle bay configuration selection and calculate floor area
  const handleFloorAreaChange = (area: number, bayConfigs: BayConfiguration[]) => {
    const roundedArea = Math.round(area);
    setCalculatedFloorArea(roundedArea);
    setSelectedBayConfigurations(bayConfigs);
    
    // Auto-populate the project area field with calculated value
    if (roundedArea > 0) {
      form.setValue("projectArea", `${roundedArea.toLocaleString()} SF (calculated from selected bay configurations)`);
    } else {
      form.setValue("projectArea", "");
    }
  };

  // File management functions
  const deleteFileMutation = useMutation({
    mutationFn: async (fileId: string) => {
      if (!rfp) return;
      const response = await apiRequest(`/api/rfp-requests/${rfp.id}/files/${fileId}`, "DELETE");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Success",
        description: "File deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete file",
        variant: "destructive",
      });
    },
  });

  const handleDownloadFile = (fileId: string, fileName: string) => {
    if (!rfp) return;
    const link = document.createElement('a');
    link.href = `/api/rfp-requests/${rfp.id}/files/${fileId}`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDeleteFile = (fileId: string, fileName: string) => {
    if (confirm(`Are you sure you want to delete "${fileName}"?`)) {
      deleteFileMutation.mutate(fileId);
    }
  };

  const handleClose = () => {
    setSelectedFiles([]);
    onClose();
  };

  const form = useForm<EditRfpFormData>({
    resolver: zodResolver(editRfpSchema),
    defaultValues: {
      rfpNumber: "",
      property: "",
      tenantName: "",
      projectName: "",
      confidential: false,
      sentBy: "",
      receivedOn: "",
      internalDueDate: "",
      developmentContact: "",
      projectArea: "",
      requestTypes: [],
      notes: "",
      status: "received",
      workflowPhase: "rfp-entry",
    },
  });

  useEffect(() => {
    if (rfp && isOpen) {
      form.reset({
        rfpNumber: rfp.rfpNumber || "",
        property: rfp.property || "",
        tenantName: rfp.tenantName || "",
        projectName: rfp.projectName || "",
        confidential: Boolean(rfp.confidential),
        sentBy: rfp.sentBy || "",
        receivedOn: rfp.receivedOn ? new Date(rfp.receivedOn).toISOString().split('T')[0] : "",
        internalDueDate: rfp.internalDueDate ? new Date(rfp.internalDueDate).toISOString().split('T')[0] : "",
        developmentContact: rfp.developmentContact || "",
        projectArea: rfp.projectArea || "",
        requestTypes: rfp.requestTypes || [],
        notes: rfp.notes || "",
        status: rfp.status as "received" | "in-progress" | "completed" | "on-hold",
        workflowPhase: (rfp.workflowPhase || "rfp-entry") as "rfp-entry" | "invitation-to-bid" | "bid-collection" | "evaluation" | "award",
      });

      // Set selected property for bay configuration
      if (rfp.property && properties.length > 0) {
        const property = properties.find(p => p.id.toString() === rfp.property);
        if (property) {
          setSelectedProperty(property);
        }
      }

      // Initialize bay configurations if they exist
      if (rfp.selectedBayConfigurations && rfp.selectedBayConfigurations.length > 0) {
        setSelectedBayConfigurations(rfp.selectedBayConfigurations);
        const totalArea = rfp.selectedBayConfigurations.reduce((sum: number, bay: any) => sum + (bay.rentableSquareFootage || bay.squareFootage), 0);
        setCalculatedFloorArea(totalArea);
      } else {
        // Try to extract from project area if it contains calculated text
        const projectArea = rfp.projectArea || "";
        if (projectArea.includes("calculated from selected bay configurations")) {
          const match = projectArea.match(/(\d{1,3}(?:,\d{3})*)/);
          if (match) {
            const area = parseInt(match[1].replace(/,/g, ''));
            setCalculatedFloorArea(area);
          }
        }
      }
    }
  }, [rfp, isOpen, form, properties]);

  // Auto-format project name when tenant name, property, or confidential status changes
  useEffect(() => {
    const subscription = form.watch((value, { name, type }) => {
      if (name === 'tenantName' || name === 'property' || name === 'confidential') {
        const tenantName = value.tenantName || '';
        const property = value.property || '';
        const confidential = value.confidential || false;

        // Update selected property when property field changes
        if (name === 'property' && property && properties.length > 0) {
          const selectedProp = properties.find(p => p.id.toString() === property);
          if (selectedProp) {
            setSelectedProperty(selectedProp);
            // Reset bay configurations when property changes
            setSelectedBayConfigurations([]);
            setCalculatedFloorArea(0);
            form.setValue("projectArea", "");
          }
        }
        
        if (property) {
          let projectName = '';
          if (confidential) {
            projectName = `Confidential @ ${property}`;
          } else if (tenantName) {
            projectName = `${tenantName} @ ${property}`;
          } else {
            projectName = `@ ${property}`;
          }
          
          form.setValue('projectName', projectName, { shouldValidate: false });
        }
      }
    });
    
    return () => subscription.unsubscribe();
  }, [form, properties]);

  const updateMutation = useMutation({
    mutationFn: async (data: EditRfpFormData) => {
      if (!rfp) throw new Error("No RFP selected");
      
      const formData = new FormData();
      
      // Append form fields
      Object.entries(data).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, value.toString());
        }
      });
      
      // Add selected bay configurations
      if (selectedBayConfigurations.length > 0) {
        formData.append('selectedBayConfigurations', JSON.stringify(selectedBayConfigurations));
      }
      
      // Append new files
      selectedFiles.forEach((file) => {
        formData.append('files', file);
      });
      
      const response = await fetch(`/api/rfp-requests/${rfp.id}/update-with-files`, {
        method: 'PATCH',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Failed to update RFP request');
      }
      
      return response.json();
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
            Update the details for this RFP request. All fields are editable including the RFP number.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((data) => updateMutation.mutate(data))} className="space-y-4">
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

            <FormField
              control={form.control}
              name="property"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Property</FormLabel>
                  <FormControl>
                    <PropertySelector
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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

              <FormField
                control={form.control}
                name="receivedOn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Received On</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="internalDueDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Internal Due Date *</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
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

              <FormField
                control={form.control}
                name="projectArea"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Area (sq ft)</FormLabel>
                    {selectedProperty ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50">
                          <div>
                            <div className="text-sm font-medium text-gray-700">Bay Configuration</div>
                            <p className="text-xs text-gray-500 mt-1">
                              {selectedBayConfigurations.length > 0 
                                ? `${selectedBayConfigurations.length} bay${selectedBayConfigurations.length !== 1 ? 's' : ''} selected (${calculatedFloorArea.toLocaleString()} SF)`
                                : 'No bays selected for area calculation'
                              }
                            </p>
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
                      </div>
                    ) : (
                      <FormControl>
                        <Input placeholder="e.g., 95000" {...field} />
                      </FormControl>
                    )}
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
                        {calculatedFloorArea.toLocaleString()} SF
                      </div>
                      <p className="text-xs text-gray-500">From selected bay configurations</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700">Warehouse Area</label>
                      <div className="text-lg font-semibold text-green-600">
                        {(calculatedFloorArea - selectedBayConfigurations.reduce((sum, bay) => sum + (bay.mechanicalRoomAllocation || 0), 0)).toLocaleString()} SF
                      </div>
                      <p className="text-xs text-gray-500">Available for tenant use</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700">Mechanical Allocation</label>
                      <div className="text-lg font-semibold text-orange-600">
                        {selectedBayConfigurations.reduce((sum, bay) => sum + (bay.mechanicalRoomAllocation || 0), 0).toLocaleString()} SF
                      </div>
                      <p className="text-xs text-gray-500">HVAC & building systems</p>
                    </div>
                  </div>

                  <div className="text-sm text-gray-600 p-2 bg-yellow-50 rounded">
                    <strong>Note:</strong> The warehouse area represents the actual usable space for the tenant. 
                    Mechanical allocation is separate space for HVAC, electrical, and building systems.
                  </div>
                </div>
              )}
            </div>

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
                        <SelectItem value="rfp-entry">RFP Entry</SelectItem>
                        <SelectItem value="invitation-to-bid">Invitation to Bid</SelectItem>
                        <SelectItem value="bid-collection">Bid Collection</SelectItem>
                        <SelectItem value="evaluation">Evaluation</SelectItem>
                        <SelectItem value="award">Award</SelectItem>
                        <SelectItem value="publish">Publish</SelectItem>
                      </SelectContent>
                    </Select>
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

            {/* File Upload Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Attached Files</h4>
              </div>
              
              {/* Existing Files */}
              {rfp?.files && rfp.files.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Current files:</p>
                  <div className="grid gap-2">
                    {rfp.files.map((file: RfpFile) => (
                      <div key={file.id} className="flex items-center justify-between p-2 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{file.name}</span>
                          <span className="text-xs text-muted-foreground">
                            ({(file.size / 1024).toFixed(1)} KB)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownloadFile(file.id, file.name)}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteFile(file.id, file.name)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* File Upload Component */}
              <div>
                <p className="text-sm text-muted-foreground mb-2">Add new files:</p>
                <FileUpload
                  onFilesSelected={setSelectedFiles}
                />
                {selectedFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-sm text-muted-foreground">Selected files to upload:</p>
                    {selectedFiles.map((file, index) => (
                      <div key={index} className="text-sm text-gray-600">
                        {file.name} ({(file.size / 1024).toFixed(1)} KB)
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
                {updateMutation.isPending ? "Updating..." : "Update RFP"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>

      {/* Bay Configuration Modal */}
      {selectedProperty && (
        <BayConfigurationModal
          isOpen={bayConfigModalOpen}
          onClose={() => setBayConfigModalOpen(false)}
          property={selectedProperty}
          onConfirm={handleFloorAreaChange}
          initialSelectedBays={selectedBayConfigurations}
        />
      )}
    </Dialog>
  );
}