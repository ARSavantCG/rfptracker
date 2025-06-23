import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Users } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { TagInput } from "@/components/ui/tag-input";
import type { Contact, InsertContact } from "@shared/schema";

interface ContactFormModalProps {
  contact?: Contact;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

export function ContactFormModal({ contact, trigger, onSuccess }: ContactFormModalProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<InsertContact>>({
    name: contact?.name || "",
    email: contact?.email || "",
    phone: contact?.phone || "",
    company: contact?.company || "",
    type: (contact?.type as "architect" | "contractor" | "owner" | "other") || "contractor",
    notes: contact?.notes || "",
    tags: contact?.tags || [],
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!contact;

  const createMutation = useMutation({
    mutationFn: (data: InsertContact) => apiRequest("/api/contacts", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({
        title: "Contact created",
        description: "Contact has been successfully created.",
      });
      setOpen(false);
      onSuccess?.();
      resetForm();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create contact. Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<InsertContact>) => apiRequest(`/api/contacts/${contact?.id}`, "PATCH", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({
        title: "Contact updated",
        description: "Contact has been successfully updated.",
      });
      setOpen(false);
      onSuccess?.();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update contact. Please try again.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      email: "",
      phone: "",
      company: "",
      type: "contractor",
      notes: "",
      tags: [],
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.email || !formData.type) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    if (isEdit) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate(formData as InsertContact);
    }
  };

  const handleInputChange = (field: keyof InsertContact, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const defaultTrigger = isEdit ? (
    <Button variant="outline" size="sm">
      <Edit className="h-4 w-4 mr-1" />
      Edit
    </Button>
  ) : (
    <Button className="bg-blue-600 hover:bg-blue-700">
      <Plus className="h-4 w-4 mr-2" />
      Add Contact
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Users className="h-5 w-5 text-blue-600" />
            <span>{isEdit ? "Edit Contact" : "Add New Contact"}</span>
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name || ""}
                onChange={(e) => handleInputChange("name", e.target.value)}
                placeholder="Full name"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="type">Type *</Label>
              <Select
                value={formData.type}
                onValueChange={(value) => handleInputChange("type", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contractor">Contractor</SelectItem>
                  <SelectItem value="architect">Architect</SelectItem>
                  <SelectItem value="owner">Property Owner</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={formData.email || ""}
              onChange={(e) => handleInputChange("email", e.target.value)}
              placeholder="email@company.com"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone || ""}
                onChange={(e) => handleInputChange("phone", e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                value={formData.company || ""}
                onChange={(e) => handleInputChange("company", e.target.value)}
                placeholder="Company name"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes ?? ""}
              onChange={(e) => handleInputChange("notes", e.target.value)}
              placeholder="Additional notes or comments..."
              rows={3}
            />
          </div>

          {/* PROMINENT TAGS SECTION */}
          <div className="border-4 border-red-500 p-6 rounded-lg bg-red-50 space-y-4">
            <h4 className="text-xl font-bold text-red-900 text-center">🏷️ CONTACT TAGS SECTION</h4>
            <div className="space-y-2">
              <Label className="text-red-900 font-bold">Add Tags</Label>
              <TagInput
                label=""
                placeholder="Type 'Development' and press Enter to add tag"
                value={formData.tags || []}
                onChange={(tags: string[]) => setFormData(prev => ({ ...prev, tags }))}
                suggestions={["Development", "Property Management", "Leasing", "Operations", "Finance"]}
                className="border-2 border-red-300"
              />
              <div className="text-sm bg-white p-3 rounded border">
                <p className="font-bold text-red-700">Available tags: Development, Property Management, Leasing, Operations, Finance</p>
                {formData.type === "owner" && (
                  <p className="text-green-700 font-bold mt-2">
                    ✓ OWNER CONTACT - Development tag is appropriate for this contact type!
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {createMutation.isPending || updateMutation.isPending
                ? "Saving..."
                : isEdit
                ? "Update Contact"
                : "Create Contact"
              }
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}