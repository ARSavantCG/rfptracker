import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { FileUpload } from "./file-upload";
import { PropertySelector } from "./property-selector";
import { useToast } from "@/hooks/use-toast";
import { type Property, type Contact } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";

const createRfpSchema = z.object({
  property: z.string().min(1, "Property is required"),
  tenantName: z.string().min(1, "Tenant name is required"),
  projectName: z.string().min(1, "Project name is required"),
  rfpRequest: z.string().min(1, "RFP request is required"),
  receivedOn: z.string().min(1, "Received on date is required"),
  internalDueDate: z.string().min(1, "Internal due date is required"),

  developmentContact: z.string().optional(),
  projectArea: z.string().optional(),
  confidential: z.boolean().default(false),
  requestTypes: z.array(z.string()).min(1, "At least one request type is required"),
  notes: z.string().optional(),
});

type CreateRfpFormData = z.infer<typeof createRfpSchema>;

interface CreateRfpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateRfpModal({ isOpen, onClose }: CreateRfpModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const form = useForm<CreateRfpFormData>({
    resolver: zodResolver(createRfpSchema),
    defaultValues: {
      property: "",
      tenantName: "",
      projectName: "",
      rfpRequest: "",
      receivedOn: "",
      internalDueDate: "",
      developmentContact: "",
      projectArea: "",
      confidential: false,
      requestTypes: [],
      notes: "",
    },
  });

  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateRfpFormData) => {
      const formData = new FormData();
      
      // Append form fields
      Object.entries(data).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, value.toString());
        }
      });
      
      // Append files
      selectedFiles.forEach((file) => {
        formData.append('files', file);
      });
      
      const response = await fetch('/api/rfp-requests/with-files', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Failed to create RFP request');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Success",
        description: "RFP request created successfully",
      });
      handleClose();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create RFP request",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CreateRfpFormData) => {
    createMutation.mutate(data);
  };

  const handleRequestTypeChange = (type: string, checked: boolean) => {
    const currentTypes = form.getValues('requestTypes');
    if (checked) {
      form.setValue('requestTypes', [...currentTypes, type]);
    } else {
      form.setValue('requestTypes', currentTypes.filter(t => t !== type));
    }
  };

  const handleClose = () => {
    form.reset();
    setSelectedFiles([]);
    onClose();
  };

  const handleFilesSelected = (files: File[]) => {
    setSelectedFiles(files);
  };

  // Auto-generate project name when property and tenant change
  useEffect(() => {
    const propertyId = form.watch('property');
    const tenantName = form.watch('tenantName');
    const confidential = form.watch('confidential');
    
    if (propertyId && tenantName && properties.length > 0) {
      // Find the selected property by ID
      const selectedProperty = properties.find(p => p.id.toString() === propertyId);
      const propertyName = selectedProperty 
        ? `${selectedProperty.propertyName} - ${selectedProperty.building}`
        : propertyId;
      
      const projectName = confidential 
        ? `${propertyName} - Confidential Project`
        : `${tenantName} @ ${propertyName}`;
      form.setValue('projectName', projectName);
    }
  }, [form.watch('property'), form.watch('tenantName'), form.watch('confidential'), properties]);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Create New RFP Request</DialogTitle>
          <DialogDescription>
            Fill out the form to create a new request for proposal.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Basic Information</h3>
                
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="property"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Property *</FormLabel>
                      <PropertySelector
                        value={field.value}
                        onChange={field.onChange}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tenantName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tenant Name *</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Tenant or client name"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Project Details</h3>
              
              <FormField
                control={form.control}
                name="projectName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Name *</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Auto-generated from property and tenant"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="rfpRequest"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>RFP Request *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select request source" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {contacts.map((contact) => (
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="receivedOn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Received On *</FormLabel>
                      <FormControl>
                        <Input 
                          type="date"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-sm text-muted-foreground">
                        When we received this request
                      </p>
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
                        <Input 
                          type="date"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-sm text-muted-foreground">
                        Internal deadline to provide RFP response
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>



              <FormField
                control={form.control}
                name="developmentContact"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Development Contact</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select development contact" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {contacts.map((contact) => (
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
                name="projectArea"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rentable Square Footage</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="e.g., 10,000 sq ft"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-sm text-muted-foreground">
                      Total area that tenant will pay rent on
                    </p>
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
                      <FormLabel>
                        Confidential Project
                      </FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Mark this project as confidential
                      </p>
                    </div>
                  </FormItem>
                )}
              />
            </div>

            {/* Request Types */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Request Type *</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {['Pricing', 'Schedule', 'Space Plan'].map((type) => (
                  <div key={type} className="flex items-center space-x-2">
                    <Checkbox
                      id={type}
                      checked={form.watch('requestTypes').includes(type.toLowerCase().replace(' ', '-'))}
                      onCheckedChange={(checked) => 
                        handleRequestTypeChange(type.toLowerCase().replace(' ', '-'), checked as boolean)
                      }
                    />
                    <label 
                      htmlFor={type}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {type}
                    </label>
                  </div>
                ))}
              </div>
              {form.formState.errors.requestTypes && (
                <p className="text-sm font-medium text-destructive">
                  {form.formState.errors.requestTypes.message}
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Additional Information</h3>
              
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Additional notes or requirements..."
                        className="min-h-[100px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <label className="text-sm font-medium">Attachments</label>
                <FileUpload onFilesSelected={handleFilesSelected} />
              </div>
              
              {selectedFiles.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Selected Files:</p>
                  <ul className="text-sm text-gray-600 space-y-1">
                    {selectedFiles.map((file, index) => (
                      <li key={index} className="flex justify-between items-center">
                        <span>{file.name}</span>
                        <button
                          type="button"
                          onClick={() => setSelectedFiles(files => files.filter((_, i) => i !== index))}
                          className="text-red-500 hover:text-red-700"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 pt-6 border-t">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create RFP"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}