import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";
import { insertPropertySchema, type Property } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

type CreatePropertyFormData = z.infer<typeof insertPropertySchema>;

interface PropertySelectorProps {
  value?: string;
  onChange: (value: string) => void;
  className?: string;
}

export function PropertySelector({ value, onChange, className }: PropertySelectorProps) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: properties = [], isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const form = useForm<CreatePropertyFormData>({
    resolver: zodResolver(insertPropertySchema),
    defaultValues: {
      propertyName: "",
      building: "",
      streetAddress: "",
      city: "",
      state: "",
      zip: "",
    },
  });

  const createMutation = useMutation<Property, Error, CreatePropertyFormData>({
    mutationFn: async (data: CreatePropertyFormData) => {
      const response = await apiRequest("/api/properties", "POST", data);
      return await response.json();
    },
    onSuccess: (newProperty: Property) => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      onChange(newProperty.displayName);
      setIsAddModalOpen(false);
      form.reset();
      toast({
        title: "Success",
        description: "Property added successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add property",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CreatePropertyFormData) => {
    createMutation.mutate(data);
  };

  const handleAddNew = () => {
    setIsAddModalOpen(true);
  };

  return (
    <>
      <div className={`flex gap-2 ${className || ""}`}>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select a property..." />
          </SelectTrigger>
          <SelectContent>
            {isLoading ? (
              <SelectItem value="loading" disabled>Loading properties...</SelectItem>
            ) : properties.length === 0 ? (
              <SelectItem value="empty" disabled>No properties available</SelectItem>
            ) : (
              properties.map((property) => (
                <SelectItem key={property.id} value={property.displayName}>
                  {property.displayName}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <Button 
          type="button" 
          variant="outline" 
          size="sm" 
          onClick={handleAddNew}
          className="px-3"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add New Property</DialogTitle>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="streetAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Street Address</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="123 Main Street" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="New York" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="NY" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="zip"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ZIP Code</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="10001" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end space-x-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "Adding..." : "Add Property"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}