import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { FileUpload } from "./file-upload";
import { useToast } from "@/hooks/use-toast";

const createRfpSchema = z.object({
  client: z.string().min(1, "Client name is required"),
  project: z.string().min(1, "Project name is required"),
  status: z.enum(["received", "in-progress", "completed", "on-hold"]),
  requestTypes: z.array(z.string()).min(1, "At least one request type is required"),
  contactPerson: z.string().optional(),
  contactEmail: z.string().email("Invalid email address").optional().or(z.literal("")),
  dateReceived: z.string().min(1, "Date received is required"),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
});

type CreateRfpFormData = z.infer<typeof createRfpSchema>;

interface CreateRfpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateRfpModal({ isOpen, onClose }: CreateRfpModalProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<CreateRfpFormData>({
    resolver: zodResolver(createRfpSchema),
    defaultValues: {
      status: "received",
      requestTypes: [],
      dateReceived: new Date().toISOString().split('T')[0],
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateRfpFormData) => {
      console.log('Raw form data:', data);
      console.log('Selected files:', selectedFiles);
      
      const formData = new FormData();
      
      // Add form fields with explicit handling
      formData.append("client", data.client || "");
      formData.append("project", data.project || "");
      formData.append("status", data.status || "received");
      formData.append("requestTypes", JSON.stringify(data.requestTypes || []));
      formData.append("dateReceived", data.dateReceived || "");
      
      if (data.contactPerson) formData.append("contactPerson", data.contactPerson);
      if (data.contactEmail) formData.append("contactEmail", data.contactEmail);
      if (data.dueDate) formData.append("dueDate", data.dueDate);
      if (data.notes) formData.append("notes", data.notes);

      // Add files
      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });

      // Debug FormData contents
      console.log('FormData contents:');
      for (let [key, value] of formData.entries()) {
        console.log(key, value);
      }

      // Use direct fetch instead of apiRequest to avoid JSON content-type issues
      const response = await fetch("/api/rfp-requests", {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
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
      form.reset();
      setSelectedFiles([]);
      onClose();
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
    console.log('Form data being submitted:', data);
    createMutation.mutate(data);
  };

  const handleRequestTypeChange = (value: string, checked: boolean) => {
    const current = form.getValues("requestTypes");
    if (checked) {
      form.setValue("requestTypes", [...current, value]);
    } else {
      form.setValue("requestTypes", current.filter(type => type !== value));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div 
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" 
          onClick={onClose}
        ></div>
        
        <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
        
        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
          <div className="bg-white px-6 pt-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900">Create New RFP Request</h3>
              <button 
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>
            
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <label htmlFor="client" className="block text-sm font-medium text-gray-700">
                    Client Name *
                  </label>
                  <input
                    type="text"
                    id="client"
                    {...form.register("client")}
                    className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter client name"
                  />
                  {form.formState.errors.client && (
                    <p className="mt-1 text-sm text-red-600">{form.formState.errors.client.message}</p>
                  )}
                </div>
                
                <div>
                  <label htmlFor="project" className="block text-sm font-medium text-gray-700">
                    Project Name *
                  </label>
                  <input
                    type="text"
                    id="project"
                    {...form.register("project")}
                    className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter project name"
                  />
                  {form.formState.errors.project && (
                    <p className="mt-1 text-sm text-red-600">{form.formState.errors.project.message}</p>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <label htmlFor="status" className="block text-sm font-medium text-gray-700">
                    Initial Status
                  </label>
                  <select
                    id="status"
                    {...form.register("status")}
                    className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="received">Received</option>
                    <option value="in-progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="on-hold">On Hold</option>
                  </select>
                </div>
                
                <div>
                  <label htmlFor="dateReceived" className="block text-sm font-medium text-gray-700">
                    Date Received *
                  </label>
                  <input
                    type="date"
                    id="dateReceived"
                    {...form.register("dateReceived")}
                    className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {form.formState.errors.dateReceived && (
                    <p className="mt-1 text-sm text-red-600">{form.formState.errors.dateReceived.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <label htmlFor="contactPerson" className="block text-sm font-medium text-gray-700">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    id="contactPerson"
                    {...form.register("contactPerson")}
                    className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter contact name"
                  />
                </div>
                
                <div>
                  <label htmlFor="contactEmail" className="block text-sm font-medium text-gray-700">
                    Contact Email
                  </label>
                  <input
                    type="email"
                    id="contactEmail"
                    {...form.register("contactEmail")}
                    className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter contact email"
                  />
                  {form.formState.errors.contactEmail && (
                    <p className="mt-1 text-sm text-red-600">{form.formState.errors.contactEmail.message}</p>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700">
                  Due Date
                </label>
                <input
                  type="date"
                  id="dueDate"
                  {...form.register("dueDate")}
                  className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Request Type *
                </label>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex items-center">
                    <input
                      id="pricing"
                      type="checkbox"
                      onChange={(e) => handleRequestTypeChange("pricing", e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="pricing" className="ml-2 block text-sm text-gray-700">
                      Pricing
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      id="spacePlans"
                      type="checkbox"
                      onChange={(e) => handleRequestTypeChange("space-plans", e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="spacePlans" className="ml-2 block text-sm text-gray-700">
                      Space Plans
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      id="schedule"
                      type="checkbox"
                      onChange={(e) => handleRequestTypeChange("schedule", e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="schedule" className="ml-2 block text-sm text-gray-700">
                      Schedule
                    </label>
                  </div>
                </div>
                {form.formState.errors.requestTypes && (
                  <p className="mt-1 text-sm text-red-600">{form.formState.errors.requestTypes.message}</p>
                )}
              </div>
              
              <div>
                <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
                  Notes
                </label>
                <textarea
                  id="notes"
                  rows={3}
                  {...form.register("notes")}
                  className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Add any additional details or notes..."
                />
              </div>
              
              <FileUpload
                onFilesSelected={setSelectedFiles}
                className="space-y-4"
              />
              
              <div className="flex justify-end space-x-3 pt-6 pb-6 border-t border-gray-200">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                >
                  {createMutation.isPending ? "Creating..." : "Create RFP Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
