import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { HierarchicalPropertySelector } from "./hierarchical-property-selector";
import { BaySelectionGrid } from "./bay-selection-grid";
import { FileUpload } from "./file-upload";
import { BayConfigurationModal } from "./bay-configuration-modal";
import { Edit, Save, X, Download, Trash2, Grid3x3, ChevronDown } from "lucide-react";
import { formatDateForInput } from "@shared/date-utils";
import type { RfpRequest, RfpFile, Property, BayConfiguration, Contact, BuildingCosts } from "@shared/schema";

const editRfpSchema = z.object({
  rfpNumber: z.string().min(1, "RFP number is required"),
  property: z.string().min(1, "Property is required"),
  isMultiBuilding: z.boolean().optional(),
  properties: z.array(z.string()).optional(),
  tenantName: z.string().min(1, "Tenant name is required"),
  alternateDescription: z.string().optional(),
  projectName: z.string().min(1, "Project name is required"),
  confidential: z.boolean(),
  sentBy: z.string().min(1, "Sent by is required"),
  receivedOn: z.string().min(1, "Received on date is required"),
  internalDueDate: z.string().min(1, "Internal due date is required"),
  responseToBrokerDue: z.string().optional(),
  developmentContact: z.string(),
  projectArea: z.string(),
  requestTypes: z.array(z.string()).min(1, "At least one request type is required"),
  notes: z.string(),
  status: z.enum(["received", "in-progress", "completed", "on-hold"]),
  workflowPhase: z.enum(["rfp-entry", "rfp-validation", "invitation-to-bid", "bid-collection", "evaluation", "award", "publish"]),
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
  const [isMultiBuilding, setIsMultiBuilding] = useState<boolean>(false);
  const [selectedProperties, setSelectedProperties] = useState<string[]>([]);
  const [selectedBaysPerBuilding, setSelectedBaysPerBuilding] = useState<{[propertyName: string]: BayConfiguration[]}>({});
  const [costsPerBuilding, setCostsPerBuilding] = useState<{[propertyName: string]: BuildingCosts}>({});
  const [bayConfigModalOpen, setBayConfigModalOpen] = useState(false);
  

  // Remove auto-modal behavior - let user manually open with button click
  // useEffect(() => {
  //   setBayConfigModalOpen(false);
  // }, [isMultiBuilding]);


  // Fetch properties for bay configuration
  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    enabled: isOpen,
  });

  // Fetch contacts for development contact dropdown
  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    enabled: isOpen,
  });


  // Handle bay configuration selection and use pre-calculated area from bay selector
  const handleFloorAreaChange = (
    area: number, 
    bayConfigs: BayConfiguration[], 
    overrideArea?: number,
    selectedBaysPerBuilding?: {[propertyName: string]: BayConfiguration[]},
    costsPerBuilding?: {[propertyName: string]: BuildingCosts}
  ) => {
    
    // Use the area calculated by the Bay Configuration Selector (already includes proportional mechanical allocation)
    setCalculatedFloorArea(area);
    setSelectedBayConfigurations(bayConfigs);
    
    // Update multi-building data if provided
    if (selectedBaysPerBuilding) {
      setSelectedBaysPerBuilding(selectedBaysPerBuilding);
    }
    if (costsPerBuilding) {
      setCostsPerBuilding(costsPerBuilding);
    }
    
    // Auto-populate the project area field with pre-calculated value
    if (area > 0) {
      const areaText = overrideArea 
        ? `${area.toLocaleString()} SF (override area for existing lease)`
        : `${area.toLocaleString()} SF (calculated from selected bay configurations)`;
      form.setValue("projectArea", areaText);
    } else {
      form.setValue("projectArea", "");
    }
  };

  // File management functions
  const deleteFileMutation = useMutation({
    mutationFn: async (fileId: string) => {
      if (!rfp) return;
      const response = await apiRequest(`/api/rfp-requests/${rfp.id}/files/${fileId}`, "DELETE");
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Success",
        description: "File deleted successfully",
        duration: 4000,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete file",
        variant: "destructive",
        duration: 6000,
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
      isMultiBuilding: false,
      properties: [],
      tenantName: "",
      alternateDescription: "",
      projectName: "",
      confidential: false,
      sentBy: "",
      receivedOn: "",
      internalDueDate: "",
      responseToBrokerDue: "",
      developmentContact: "",
      projectArea: "",
      requestTypes: [], // Empty by default - user selects what they need
      notes: "",
      status: "received",
      workflowPhase: "rfp-entry",
    },
  });

  // Ensure selectedProperty is maintained when form property changes or multi-building toggles
  useEffect(() => {
    const currentPropertyId = form.watch('property');
    if (currentPropertyId && properties.length > 0) {
      const property = properties.find(p => p.id.toString() === currentPropertyId);
      if (property) {
        setSelectedProperty(property);
      }
    }
  }, [form.watch('property'), properties, form]);

  useEffect(() => {
    if (rfp && isOpen) {

      // Extract alternate description from project name if it exists
      let alternateDescription = "";
      let cleanProjectName = rfp.projectName || "";
      
      if (rfp.projectName && rfp.projectName.includes("(") && rfp.projectName.includes(")")) {
        const match = rfp.projectName.match(/\(([^)]+)\)$/);
        if (match) {
          alternateDescription = match[1];
          cleanProjectName = rfp.projectName.replace(/\s*\([^)]+\)$/, "");
        }
      }

      // Set multi-building state
      const isMultiBuildingRfp = Boolean(rfp.isMultiBuilding);
      setIsMultiBuilding(isMultiBuildingRfp);
      
      // Set properties based on multi-building status
      if (isMultiBuildingRfp) {
        setSelectedProperties(rfp.properties || []);
        if (rfp.selectedBaysPerBuilding) {
          setSelectedBaysPerBuilding(rfp.selectedBaysPerBuilding);
        }
      }


      form.reset({
        rfpNumber: rfp.rfpNumber || "",
        property: rfp.property || "",
        isMultiBuilding: isMultiBuildingRfp,
        properties: rfp.properties || [],
        tenantName: rfp.tenantName || "",
        alternateDescription: alternateDescription,
        projectName: cleanProjectName,
        confidential: Boolean(rfp.confidential),
        sentBy: rfp.sentBy || "",
        receivedOn: formatDateForInput(rfp.receivedOn),
        internalDueDate: formatDateForInput(rfp.internalDueDate),
        responseToBrokerDue: formatDateForInput(rfp.responseToBrokerDue),
        developmentContact: rfp.developmentContact || "",
        projectArea: rfp.projectArea || "",
        requestTypes: rfp.id === 0 ? [] : (rfp.requestTypes || []), // Empty for new alternates
        notes: rfp.notes || "",
        status: rfp.status as "received" | "in-progress" | "completed" | "on-hold",
        workflowPhase: (rfp.workflowPhase || "rfp-entry") as "rfp-entry" | "rfp-validation" | "invitation-to-bid" | "bid-collection" | "evaluation" | "award" | "publish",
      });

      // Set selected property for bay configuration (BOTH single and multi-building)
      // Always maintain an anchor property for filtering in BayConfigurationModal
      if (properties.length > 0) {
        let anchorPropertyId = rfp.property;
        
        // For multi-building RFPs, use the first property if no single property set
        if (!anchorPropertyId && rfp.properties && rfp.properties.length > 0) {
          anchorPropertyId = rfp.properties[0];
        }
        
        if (anchorPropertyId) {
          const property = properties.find(p => p.id.toString() === anchorPropertyId);
          if (property) {
            setSelectedProperty(property);
          }
        }
      }

      // Initialize bay configurations if they exist (for both single and multi-building)
      if (rfp.selectedBayConfigurations && rfp.selectedBayConfigurations.length > 0) {
        setSelectedBayConfigurations(rfp.selectedBayConfigurations);
        
        // Calculate total using proportional method for display (only for single-building)
        if (!isMultiBuildingRfp) {
          const selectedBaySquareFootage = rfp.selectedBayConfigurations.reduce((sum: number, bay: any) => sum + (bay.squareFootage || 0), 0);
          const property = properties.find(p => p.id.toString() === rfp.property);
          const mechanicalRoomSF = property?.mechanicalRoomSquareFootage || 0;
          
          if (property?.bayConfigurations) {
            const totalPropertyBaysSF = property.bayConfigurations.reduce((sum: number, bay: any) => sum + (bay.squareFootage || 0), 0);
            const proportionalMechanical = totalPropertyBaysSF > 0 ? (selectedBaySquareFootage / totalPropertyBaysSF) * mechanicalRoomSF : 0;
            const totalRentableArea = selectedBaySquareFootage + proportionalMechanical;
            setCalculatedFloorArea(Math.round(totalRentableArea));
          }
        }
      } else if (isMultiBuildingRfp && rfp.selectedBaysPerBuilding) {
        // Calculate total area for multi-building RFPs
        let totalArea = 0;
        Object.values(rfp.selectedBaysPerBuilding).forEach(bays => {
          totalArea += bays.reduce((sum: number, bay: any) => sum + (bay.squareFootage || 0), 0);
        });
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

  // Handle multi-building selection changes
  const handleMultiBuildingSelection = (
    selectedBays: BayConfiguration[], 
    totalSquareFootage: number,
    selectedBaysPerBuilding?: {[propertyName: string]: BayConfiguration[]},
    costsPerBuilding?: {[propertyName: string]: BuildingCosts}
  ) => {
    if (selectedBaysPerBuilding) {
      setSelectedBaysPerBuilding(selectedBaysPerBuilding);
      
      // Update selected properties array
      const propertyNames = Object.keys(selectedBaysPerBuilding);
      const propertyIds: string[] = [];
      
      propertyNames.forEach(buildingKey => {
        // Extract property name and find corresponding ID
        const property = properties.find(p => {
          const expectedKey = `${p.propertyName} - Building ${p.building}`;
          return expectedKey === buildingKey;
        });
        if (property && !propertyIds.includes(property.id.toString())) {
          propertyIds.push(property.id.toString());
        }
      });
      
      setSelectedProperties(propertyIds);
      setCalculatedFloorArea(totalSquareFootage);
      
      // Update project area field
      if (totalSquareFootage > 0) {
        const areaText = `${totalSquareFootage.toLocaleString()} SF (calculated from selected bay configurations across multiple buildings)`;
        form.setValue("projectArea", areaText);
      } else {
        form.setValue("projectArea", "");
      }
    }
  };

  // Auto-format project name when tenant name, property, alternate description, or confidential status changes
  useEffect(() => {
    const subscription = form.watch((value, { name, type }) => {
      if (name === 'tenantName' || name === 'property' || name === 'alternateDescription' || name === 'confidential' || name === 'isMultiBuilding') {
        const tenantName = value.tenantName || '';
        const property = value.property || '';
        const alternateDescription = value.alternateDescription || '';
        const confidential = value.confidential || false;
        const isMultiBuildingValue = value.isMultiBuilding || false;
        
        // Handle multi-building toggle
        if (name === 'isMultiBuilding') {
          setIsMultiBuilding(isMultiBuildingValue);
          
          if (isMultiBuildingValue) {
            // When switching to multi-building, preserve the original property selection
            const currentPropertyId = value.property || form.getValues("property");
            const currentProperty = properties.find(p => p.id.toString() === currentPropertyId);
            
            
            // ALWAYS preserve selectedProperty for multi-building filtering, regardless of existing bays
            if (currentProperty) {
              setSelectedProperty(currentProperty);
            }
            
            // DON'T auto-open bay configurator on toggle - user should click button manually
            
            if (currentProperty && selectedBayConfigurations.length > 0) {
              // Pre-select the original property in multi-building mode
              setSelectedProperties([currentPropertyId]);
              
              // SMART BUILDING KEY: Use the actual building number from the property data
              // This ensures we use the correct building number (like "5" for Bridge Point Doral - Bldg. 5)
              // instead of defaulting to "1"
              const buildingKey = `${currentProperty.propertyName} - Building ${currentProperty.building}`;
              const multiBuildingData = {
                [buildingKey]: selectedBayConfigurations
              };
              
              console.debug('🏗️ Smart building key created:', {
                propertyName: currentProperty.propertyName,
                actualBuildingNumber: currentProperty.building,
                generatedKey: buildingKey
              });
              
              setSelectedBaysPerBuilding(multiBuildingData);
              
              // Keep the existing project area calculation
              // (don't clear it since user already has selections)
            } else {
              // No existing selections - don't create any default building keys
              // Let the user select buildings through the bay configurator modal
              setSelectedBayConfigurations([]);
              setSelectedProperties([]);
              setSelectedBaysPerBuilding({});
              setCalculatedFloorArea(0);
              form.setValue("projectArea", "");
            }
            
            // Keep the property field for filtering - don't clear it
            // form.setValue("property", ""); // REMOVED: Keep property for filtering
          } else {
            // When switching back to single building, try to preserve first selected property
            if (selectedProperties.length > 0) {
              const firstPropertyId = selectedProperties[0];
              form.setValue("property", firstPropertyId);
              
              // Find bays from the first property to restore
              const firstPropertyName = Object.keys(selectedBaysPerBuilding)[0];
              const firstPropertyBays = selectedBaysPerBuilding[firstPropertyName] || [];
              
              if (firstPropertyBays.length > 0) {
                setSelectedBayConfigurations(firstPropertyBays);
                const totalArea = firstPropertyBays.reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
                setCalculatedFloorArea(totalArea);
                form.setValue("projectArea", `${totalArea.toLocaleString()} SF (calculated from selected bay configurations)`);
              }
            }
            
            // Clear multi-building selections
            setSelectedProperties([]);
            setSelectedBaysPerBuilding({});
            form.setValue("properties", []);
          }
          
          return;
        }

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
        
        // Only auto-format if we have both tenant and property (for single-building) or properties (for multi-building), or if this is not a template alternate
        if (((tenantName && property && property !== "Select property...") && !isMultiBuildingValue) || 
            ((tenantName && isMultiBuildingValue && selectedProperties.length > 0)) || 
            (rfp && rfp.id !== 0)) {
          let propertyName = property;
          
          if (isMultiBuildingValue && selectedProperties.length > 0) {
            // For multi-building RFPs, get the base property name
            const firstSelectedProperty = properties.find(p => selectedProperties.includes(p.id.toString()));
            if (firstSelectedProperty) {
              propertyName = `${firstSelectedProperty.propertyName} - Multiple Bldgs.`;
            }
          } else {
            // Find the selected property by ID for single-building
            const selectedProp = properties.find(p => p.id.toString() === property);
            
            if (selectedProp) {
              // Only add building name if it exists, is not empty, and is different from property name
              if (selectedProp.building && 
                  selectedProp.building.trim() !== '') {
                propertyName = `${selectedProp.propertyName} - Bldg. ${selectedProp.building}`;
              } else {
                propertyName = selectedProp.propertyName;
              }
            }
          }
          
          let projectName = '';
          if (confidential) {
            projectName = `${propertyName} - Confidential Project`;
            if (alternateDescription) {
              projectName += ` (${alternateDescription})`;
            }
          } else if (tenantName) {
            projectName = `${tenantName} @ ${propertyName}`;
            if (alternateDescription) {
              projectName += ` (${alternateDescription})`;
            }
          } else {
            projectName = `@ ${propertyName}`;
            if (alternateDescription) {
              projectName += ` (${alternateDescription})`;
            }
          }
          
          form.setValue('projectName', projectName, { shouldValidate: false });
        }
      }
    });
    
    return () => subscription.unsubscribe();
  }, [form, properties, rfp]);

  const updateMutation = useMutation({
    mutationFn: async (data: EditRfpFormData) => {
      if (!rfp) throw new Error("No RFP selected");
      
      // Check if this is a new alternate creation (id: 0)
      if (rfp.id === 0 && rfp.parentRfpId) {
        // Create new alternate via the create-option endpoint
        const token = localStorage.getItem('auth-token');
        const response = await fetch(`/api/rfp-requests/${rfp.parentRfpId}/create-option`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          credentials: 'include',
          body: JSON.stringify({
            optionType: "alternate",
            optionTitle: data.alternateDescription || "Alternate",
            formData: {
              ...data,
              selectedBayConfigurations: isMultiBuilding ? [] : selectedBayConfigurations,
              isMultiBuilding: isMultiBuilding,
              selectedBaysPerBuilding: isMultiBuilding ? selectedBaysPerBuilding : {},
              properties: isMultiBuilding ? selectedProperties : []
            }
          })
        });
        
        if (!response.ok) throw new Error('Failed to create alternate');
        return response.json();
      }
      
      // Regular update for existing RFP
      const formData = new FormData();
      
      // Append form fields
      Object.entries(data).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, value.toString());
        }
      });
      
      // Add bay configurations (single or multi-building)
      if (isMultiBuilding) {
        formData.append('isMultiBuilding', 'true');
        formData.append('selectedBaysPerBuilding', JSON.stringify(selectedBaysPerBuilding));
        formData.append('properties', JSON.stringify(selectedProperties));
      } else if (selectedBayConfigurations.length > 0) {
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Success",
        description: rfp?.id === 0 ? "Alternate created successfully" : "RFP updated successfully",
        duration: 4000,
      });
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update RFP",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const updateAndAdvanceMutation = useMutation({
    mutationFn: async (data: EditRfpFormData) => {
      if (!rfp) throw new Error("No RFP selected");
      
      let rfpId = rfp.id;
      
      // Handle new alternate creation first
      if (rfp.id === 0) {
        const token = localStorage.getItem('auth-token');
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
        };
        
        // Add token if available for fallback auth
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        
        const createResponse = await fetch(`/api/rfp-requests/${rfp.parentRfpId}/create-option`, {
          method: 'POST',
          headers,
          credentials: 'include', // Include session cookies
          body: JSON.stringify({
            optionType: "alternate",
            optionTitle: data.alternateDescription || "Alternate",
            formData: {
              ...data,
              selectedBayConfigurations: isMultiBuilding ? [] : selectedBayConfigurations,
              isMultiBuilding: isMultiBuilding,
              selectedBaysPerBuilding: isMultiBuilding ? selectedBaysPerBuilding : {},
              properties: isMultiBuilding ? selectedProperties : []
            }
          })
        });
        
        if (!createResponse.ok) throw new Error('Failed to create alternate');
        const createdRfp = await createResponse.json();
        rfpId = createdRfp.id;
      } else {
        // Update existing RFP first
        const formData = new FormData();
        
        // Append form fields
        Object.entries(data).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            formData.append(key, JSON.stringify(value));
          } else if (value !== null && value !== undefined) {
            // Handle date fields specially to ensure proper format
            if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}$/)) {
              formData.append(key, value); // Already in YYYY-MM-DD format
            } else {
              formData.append(key, value.toString());
            }
          }
        });
        
        // Add bay configurations (single or multi-building)
        if (isMultiBuilding) {
          formData.append('isMultiBuilding', 'true');
          formData.append('selectedBaysPerBuilding', JSON.stringify(selectedBaysPerBuilding));
          formData.append('properties', JSON.stringify(selectedProperties));
        } else if (selectedBayConfigurations.length > 0) {
          formData.append('selectedBayConfigurations', JSON.stringify(selectedBayConfigurations));
        }
        
        // Append new files
        selectedFiles.forEach((file) => {
          formData.append('files', file);
        });
        
        const updateResponse = await fetch(`/api/rfp-requests/${rfp.id}/update-with-files`, {
          method: 'PATCH',
          body: formData,
        });
        
        if (!updateResponse.ok) {
          throw new Error('Failed to update RFP request');
        }
      }

      // Now advance the workflow phase to rfp-validation for both new and existing RFPs
      const advanceResponse = await fetch(`/api/rfp-requests/${rfpId}/workflow-phase`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
        },
        body: JSON.stringify({ phase: "rfp-validation" }),
      });
      
      if (!advanceResponse.ok) {
        throw new Error('Failed to advance workflow phase');
      }
      
      return advanceResponse.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Success",
        description: rfp?.id === 0 ? "Alternate created and advanced to validation phase" : "RFP updated and advanced to validation phase",
      });
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update and advance RFP",
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

            {/* Multi-Building Toggle */}
            <FormField
              control={form.control}
              name="isMultiBuilding"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(value) => {
                        field.onChange(value);
                        
                        const currentPropertyId = form.getValues("property") || rfp?.property;
                        const formState = form.getValues();
                        
                        
                        // Handle multi-building conversion directly
                        if (value && currentPropertyId) {
                          const currentProperty = properties.find(p => p.id.toString() === currentPropertyId);
                          
                          // Use the original RFP bay configurations directly
                          const rfpBayConfigurations = rfp?.selectedBayConfigurations || [];
                          
                          if (currentProperty && rfpBayConfigurations.length > 0) {
                            const buildingKey = `${currentProperty.propertyName} - Building ${currentProperty.building}`;
                            const multiBuildingData = {
                              [buildingKey]: rfpBayConfigurations
                            };
                            
                            
                            setSelectedProperties([currentPropertyId]);
                            setSelectedBaysPerBuilding(multiBuildingData);
                          }
                        }
                      }}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Multi-Building RFP</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Enable this for RFPs requiring multiple buildings in the same property park
                    </p>
                  </div>
                </FormItem>
              )}
            />

            {/* Property Selection - Conditional based on multi-building */}
            {!isMultiBuilding ? (
              <FormField
                control={form.control}
                name="property"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Property</FormLabel>
                    <FormControl>
                      <HierarchicalPropertySelector
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <div className="space-y-4">
                <FormLabel>Multi-Building Bay Selection</FormLabel>
                <p className="text-sm text-muted-foreground">
                  Select bays from multiple buildings within the same property park.
                </p>
                {/* Remove inline BaySelectionGrid to prevent auto-opening modal */}
                {/* Users should click "Configure Bays" button to open the modal */}
                <div className="space-y-4">
                  <div className="p-4 border rounded-lg bg-gray-50">
                    <div className="text-sm font-medium text-gray-700">Multi-Building Configuration</div>
                    <p className="text-xs text-gray-500 mt-1">
                      {Object.keys(selectedBaysPerBuilding).length > 0
                        ? `${Object.values(selectedBaysPerBuilding).flat().length} bays selected across ${Object.keys(selectedBaysPerBuilding).length} buildings (${calculatedFloorArea.toLocaleString()} SF)`
                        : 'Click "Configure Bays" below to select bays from multiple buildings'
                      }
                    </p>
                  </div>
                  
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      console.warn('✅ EXPECTED: Configure Bays button clicked (multi-building)');
                      setBayConfigModalOpen(true);
                    }}
                    className="flex items-center gap-2"
                    data-testid="button-configure-bays"
                  >
                    <Grid3x3 className="h-4 w-4" />
                    {Object.keys(selectedBaysPerBuilding).length > 0 ? 'Modify Bay Selection' : 'Configure Bays'}
                  </Button>
                </div>
              </div>
            )}

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

            {/* Show Alternate Description field only for alternates */}
            {rfp?.isOption && (
              <FormField
                control={form.control}
                name="alternateDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Alternate Description</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Design Option 1, Warehouse Expansion, etc." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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

            <FormField
              control={form.control}
              name="sentBy"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sent By</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <select
                        {...field}
                        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                      >
                        <option value="">Select property owner</option>
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
                    <FormLabel>Received On</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
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
                      <Input type="date" {...field} />
                    </FormControl>
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
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Development Contact - only for non-alternates */}
            {!rfp?.isOption && (
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
                          {(contacts as Contact[])
                            .filter((contact: Contact) => contact.tags && contact.tags.includes("Development"))
                            .map((contact: Contact) => (
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
            )}

            <FormField
                control={form.control}
                name="projectArea"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Area (sq ft)</FormLabel>
                    {!isMultiBuilding && selectedProperty ? (
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
                            onClick={() => {
                              console.warn('✅ EXPECTED: Configure Bays button clicked (single-building)');
                              setBayConfigModalOpen(true);
                            }}
                            className="flex items-center gap-2"
                            data-testid="button-configure-bays"
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
                    ) : isMultiBuilding ? (
                      <div className="space-y-4">
                        <div className="p-4 border rounded-lg bg-gray-50">
                          <div className="text-sm font-medium text-gray-700">Multi-Building Configuration</div>
                          <p className="text-xs text-gray-500 mt-1">
                            {Object.keys(selectedBaysPerBuilding).length > 0
                              ? `${Object.values(selectedBaysPerBuilding).flat().length} bays selected across ${Object.keys(selectedBaysPerBuilding).length} buildings (${calculatedFloorArea.toLocaleString()} SF)`
                              : 'No bays selected for area calculation'
                            }
                          </p>
                        </div>
                        
                        <FormControl>
                          <Input 
                            {...field}
                            readOnly
                            className="bg-gray-50"
                          />
                        </FormControl>
                        <p className="text-sm text-muted-foreground">
                          Automatically calculated from selected bay configurations across multiple buildings
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
                        {(() => {
                          const roundedTotal = Math.round(calculatedFloorArea);
                          return roundedTotal.toLocaleString();
                        })()} SF
                      </div>
                      <p className="text-xs text-gray-500">From selected bay configurations</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700">Warehouse Area</label>
                      <div className="text-lg font-semibold text-green-600">
                        {(() => {
                          const selectedBaySquareFootage = selectedBayConfigurations.reduce((sum, bay) => sum + (bay.squareFootage || 0), 0);
                          return selectedBaySquareFootage.toLocaleString();
                        })()} SF
                      </div>
                      <p className="text-xs text-gray-500">Available for tenant use</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700">Mechanical Allocation</label>
                      <div className="text-lg font-semibold text-orange-600">
                        {(() => {
                          const selectedBaySquareFootage = selectedBayConfigurations.reduce((sum, bay) => sum + (bay.squareFootage || 0), 0);
                          const mechanicalRoomSF = selectedProperty?.mechanicalRoomSquareFootage || 0;
                          
                          if (selectedProperty?.bayConfigurations) {
                            const totalPropertyBaysSF = selectedProperty.bayConfigurations.reduce((sum: number, bay: any) => sum + (bay.squareFootage || 0), 0);
                            const proportionalMechanical = totalPropertyBaysSF > 0 ? (selectedBaySquareFootage / totalPropertyBaysSF) * mechanicalRoomSF : 0;
                            return Math.round(proportionalMechanical).toLocaleString();
                          }
                          return '0';
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

            {/* Status and Workflow Phase removed - handled automatically by system */}

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
                disabled={updateMutation.isPending || updateAndAdvanceMutation.isPending}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              {rfp?.id === 0 ? (
                // For new alternates - auto-advance with green button
                <Button 
                  type="button"
                  onClick={() => {
                    const formData = form.getValues();
                    updateAndAdvanceMutation.mutate(formData);
                  }}
                  disabled={updateAndAdvanceMutation.isPending}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {updateAndAdvanceMutation.isPending ? "Creating & Advancing..." : "Create RFP & Advance"}
                </Button>
              ) : (
                <>
                  <Button 
                    type="submit" 
                    disabled={updateMutation.isPending || updateAndAdvanceMutation.isPending}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {updateMutation.isPending ? "Updating..." : "Update RFP"}
                  </Button>
                  {rfp?.workflowPhase === "rfp-entry" && (
                    <Button
                      type="button"
                      onClick={() => {
                        const formData = form.getValues();
                        updateAndAdvanceMutation.mutate(formData);
                      }}
                      disabled={updateMutation.isPending || updateAndAdvanceMutation.isPending}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {updateAndAdvanceMutation.isPending ? "Saving & Advancing..." : "Save & Advance to RFP Validation"}
                    </Button>
                  )}
                </>
              )}
            </div>
          </form>
        </Form>
      </DialogContent>

      {/* Bay Configuration Modal */}
      {(() => {
        // Derive anchor property for park filtering
        const anchorProperty = selectedProperty ?? 
          properties.find(p => p.id.toString() === form.getValues('property')) ?? 
          properties.find(p => p.id.toString() === (selectedProperties[0] || rfp?.properties?.[0] || ''));
        
        // Compute park-filtered properties list
        // For NEW RFPs: If no anchor property is found (new RFP creation), show ALL properties
        // For EXISTING RFPs: Filter by park based on anchor property
        const parkProperties = anchorProperty ? 
          properties.filter(p => p.propertyName === anchorProperty.propertyName) : 
          (isMultiBuilding ? properties : []); // Show all properties for new multi-building RFPs
        
        // Debug logging (one-time)
        if (bayConfigModalOpen) {
          console.log('🔧 MODAL OPENED - Bay Configuration Debug');
          console.log('🏢 ALL PROPERTIES AVAILABLE:', {
            totalPropertiesCount: properties.length,
            allPropertyNames: properties.map(p => `${p.propertyName} - Building ${p.building}`)
          });
          console.log('🏢 PROPERTIES PASSED TO MODAL:', {
            isMultiBuilding,
            selectedPropertyValue: form.getValues('property'),
            selectedPropertiesArray: selectedProperties,
            anchorPropertyName: anchorProperty?.propertyName,
            parkPropertiesCount: parkProperties.length,
            parkPropertyNames: parkProperties.map(p => `${p.propertyName} - Building ${p.building || 'N/A'}`)
          });
          console.log('🔧 INITIAL BAYS:', {
            singleBuildingBays: !isMultiBuilding ? selectedBayConfigurations.length : 'N/A',
            multiBuildingBays: isMultiBuilding ? Object.keys(selectedBaysPerBuilding).length : 'N/A',
            totalSelectedBays: !isMultiBuilding ? selectedBayConfigurations.length : Object.values(selectedBaysPerBuilding).flat().length
          });
        }
        
        return (
          <BayConfigurationModal
            isOpen={bayConfigModalOpen}
            onClose={() => setBayConfigModalOpen(false)}
            property={!isMultiBuilding ? anchorProperty : undefined}
            properties={isMultiBuilding ? parkProperties : undefined}
            isMultiBuilding={isMultiBuilding}
            onConfirm={handleFloorAreaChange}
            initialSelectedBays={!isMultiBuilding ? selectedBayConfigurations : undefined}
            initialSelectedBaysPerBuilding={isMultiBuilding ? selectedBaysPerBuilding : undefined}
            initialCostsPerBuilding={isMultiBuilding ? costsPerBuilding : undefined}
            onBaysPerBuildingChange={setSelectedBaysPerBuilding}
            costsPerBuilding={costsPerBuilding}
            onCostsPerBuildingChange={setCostsPerBuilding}
          />
        );
      })()}
    </Dialog>
  );
}