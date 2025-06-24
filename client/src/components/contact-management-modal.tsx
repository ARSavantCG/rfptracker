import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertContactSchema } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { TagInput } from "@/components/ui/tag-input";
import { Plus, Building, User, Mail, Phone, Trash2, Users, Edit, Save, X } from "lucide-react";
import type { Contact } from "@shared/schema";

const createContactSchema = insertContactSchema.extend({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email is required"),
  company: z.string().min(1, "Company is required"),
  type: z.enum(["architect", "contractor", "owner", "other"], { 
    required_error: "Please select a contact type" 
  }),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

type CreateContactFormData = z.infer<typeof createContactSchema>;

interface ContactManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ContactManagementModal({ isOpen, onClose }: ContactManagementModalProps) {
  const [activeTab, setActiveTab] = useState("add");
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [permissionsContact, setPermissionsContact] = useState<Contact | null>(null);
  const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(false);
  const { toast } = useToast();

  const form = useForm<CreateContactFormData>({
    resolver: zodResolver(createContactSchema),
    defaultValues: {
      name: "",
      email: "",
      company: "",
      phone: "",
      type: undefined,
      tags: [],
    },
  });

  // Fetch contacts
  const { data: contacts = [], isLoading: contactsLoading } = useQuery({
    queryKey: ["/api/contacts"],
    enabled: isOpen,
  });

  // Create contact mutation
  const createContactMutation = useMutation({
    mutationFn: async (data: CreateContactFormData) => {
      return apiRequest("/api/contacts", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({
        title: "Contact created",
        description: "New contact has been added successfully",
      });
      form.reset();
      setActiveTab("manage");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create contact. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Delete contact mutation
  const deleteContactMutation = useMutation({
    mutationFn: async (contactId: number) => {
      return apiRequest(`/api/contacts/${contactId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({
        title: "Contact deleted",
        description: "Contact has been removed successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete contact. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Update contact mutation
  const updateContactMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: CreateContactFormData }) => {
      return apiRequest(`/api/contacts/${id}`, "PATCH", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({
        title: "Contact updated",
        description: "Contact has been updated successfully",
      });
      setEditingContact(null);
      editForm.reset();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update contact. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CreateContactFormData) => {
    createContactMutation.mutate(data);
  };

  const handleDeleteContact = (contact: Contact) => {
    if (confirm(`Are you sure you want to delete ${contact.name}?`)) {
      deleteContactMutation.mutate(contact.id);
    }
  };

  const handleEditContact = (contact: Contact) => {
    setEditingContact(contact);
    editForm.reset({
      name: contact.name,
      email: contact.email,
      company: contact.company || "",
      phone: contact.phone || "",
      type: contact.type as "architect" | "contractor" | "owner" | "other",
      tags: contact.tags || [],
      notes: contact.notes || "",
    });
  };

  const onEditSubmit = (data: CreateContactFormData) => {
    if (editingContact) {
      updateContactMutation.mutate({ id: editingContact.id, data });
    }
  };

  const cancelEdit = () => {
    setEditingContact(null);
    editForm.reset();
  };

  const editForm = useForm<CreateContactFormData>({
    resolver: zodResolver(createContactSchema),
    defaultValues: {
      name: "",
      email: "",
      company: "",
      phone: "",
      type: undefined,
      tags: [],
      notes: "",
    },
  });

  // Filter contacts by type
  const architects = (contacts as Contact[]).filter((contact: Contact) => contact.type === "architect");
  const contractors = (contacts as Contact[]).filter((contact: Contact) => contact.type === "contractor");
  const owners = (contacts as Contact[]).filter((contact: Contact) => contact.type === "owner");
  const others = (contacts as Contact[]).filter((contact: Contact) => contact.type === "other");

  const [expandedContact, setExpandedContact] = useState<number | null>(null);

  const handlePermissions = (contact: Contact) => {
    setPermissionsContact(contact);
    setIsPermissionsModalOpen(true);
  };

  const ContactList = ({ contacts, title, icon: Icon }: { 
    contacts: Contact[]; 
    title: string; 
    icon: any;
  }) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <h4 className="font-medium text-sm">{title}</h4>
        <Badge variant="secondary" className="ml-auto text-xs px-1.5 py-0.5">
          {contacts.length}
        </Badge>
      </div>
      
      {contacts.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2 text-center border rounded border-dashed">
          No {title.toLowerCase()} added yet
        </p>
      ) : (
        <div className="space-y-1">
          {contacts.map((contact) => (
            <div key={contact.id} className="border rounded">
              <div
                className="flex items-center justify-between p-2 hover:bg-muted/50 cursor-pointer"
                onClick={() => setExpandedContact(expandedContact === contact.id ? null : contact.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm truncate">{contact.name}</p>
                    <span className="text-xs text-muted-foreground">•</span>
                    <p className="text-xs text-muted-foreground truncate">{contact.company}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditContact(contact);
                    }}
                    className="h-6 w-6 p-0 text-blue-600 hover:text-blue-700"
                  >
                    <Edit className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteContact(contact);
                    }}
                    disabled={deleteContactMutation.isPending}
                    className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              
              {expandedContact === contact.id && (
                <div className="px-2 pb-2 border-t bg-muted/20">
                  <div className="space-y-2 mt-2">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" />
                        {contact.email}
                      </div>
                      {contact.phone && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3" />
                          {contact.phone}
                        </div>
                      )}
                    </div>
                    {contact.tags && contact.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {contact.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Contact Management
          </DialogTitle>
          <DialogDescription>
            Add and manage your contacts including architects, contractors, owners, and other stakeholders
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2 shrink-0">
            <TabsTrigger value="add" className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Contact
            </TabsTrigger>
            <TabsTrigger value="manage" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Manage Contacts
            </TabsTrigger>
          </TabsList>

          <TabsContent value="add" className="mt-4 flex-1">
            <div className="space-y-3">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Contact name" {...field} className="h-8 text-sm" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="company"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Company</FormLabel>
                          <FormControl>
                            <Input placeholder="Company name" {...field} className="h-8 text-sm" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Email</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="email@company.com" {...field} className="h-8 text-sm" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Phone (Optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="(555) 123-4567" {...field} value={field.value || ""} className="h-8 text-sm" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm">Contact Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue placeholder="Select contact type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="architect">Architect</SelectItem>
                            <SelectItem value="contractor">General Contractor</SelectItem>
                            <SelectItem value="owner">Owner</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="border border-blue-200 p-3 rounded bg-blue-50 space-y-2">
                    <h4 className="text-sm font-medium text-blue-900">Contact Tags</h4>
                    <TagInput
                      label="Add Tags"
                      placeholder="Type 'Development' or other tags and press Enter"
                      value={form.watch("tags") || []}
                      onChange={(tags: string[]) => form.setValue("tags", tags)}
                      suggestions={["Development", "Property Management", "Leasing", "Operations", "Finance"]}
                    />
                    <div className="text-xs">
                      <p className="text-blue-600">Available tags: Development, Property Management, Leasing, Operations, Finance</p>
                      {form.watch("type") === "owner" && (
                        <p className="text-green-600 font-medium">
                          ✓ This is an Owner contact - Development tag is appropriate
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-3">
                    <Button 
                      type="submit" 
                      disabled={createContactMutation.isPending}
                      className="h-8 px-3 text-sm"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      {createContactMutation.isPending ? "Adding..." : "Add Contact"}
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          </TabsContent>

          <TabsContent value="manage" className="mt-4 flex-1 min-h-0">
            {contactsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-sm text-muted-foreground">Loading contacts...</div>
              </div>
            ) : (
              <div className="h-[50vh] overflow-y-auto space-y-4">
                <ContactList 
                  contacts={architects} 
                  title="Architects" 
                  icon={Building}
                />
                
                <ContactList 
                  contacts={contractors} 
                  title="General Contractors" 
                  icon={User}
                />
                
                <ContactList 
                  contacts={owners} 
                  title="Owners" 
                  icon={Users}
                />
                
                <ContactList 
                  contacts={others} 
                  title="Other Contacts" 
                  icon={User}
                />
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Edit Contact Modal */}
        {editingContact && (
          <Dialog open={!!editingContact} onOpenChange={() => setEditingContact(null)}>
            <DialogContent className="sm:max-w-[700px] max-h-[95vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit Contact</DialogTitle>
                <DialogDescription>
                  Update contact information for {editingContact.name}
                </DialogDescription>
              </DialogHeader>

              <Form {...editForm}>
                <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={editForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Full name" {...field} className="h-8 text-sm" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={editForm.control}
                      name="company"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Company</FormLabel>
                          <FormControl>
                            <Input placeholder="Company name" {...field} className="h-8 text-sm" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={editForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Email</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="email@company.com" {...field} className="h-8 text-sm" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={editForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Phone (Optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="(555) 123-4567" {...field} value={field.value || ""} className="h-8 text-sm" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={editForm.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm">Contact Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue placeholder="Select contact type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="architect">Architect</SelectItem>
                            <SelectItem value="contractor">General Contractor</SelectItem>
                            <SelectItem value="owner">Owner</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={editForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm">Notes</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Additional notes or comments..."
                            {...field}
                            value={field.value || ""}
                            className="h-20 text-sm resize-none"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* IMPORTANT: Tags section with prominent spacing */}
                  <div className="pt-6 border-t-2 border-gray-200">
                    <div className="border-4 border-red-500 p-6 rounded-lg bg-red-50 space-y-4">
                      <h4 className="text-xl font-bold text-red-900 text-center">🏷️ CONTACT TAGS SECTION</h4>
                      <TagInput
                        label="Add Tags Here"
                        placeholder="Type 'Development' and press Enter to add tag"
                        value={editForm.watch("tags") || []}
                        onChange={(tags: string[]) => editForm.setValue("tags", tags)}
                        suggestions={["Development", "Property Management", "Leasing", "Operations", "Finance"]}
                        className="border-2 border-red-300"
                      />
                      <div className="text-sm bg-white p-2 rounded border">
                        <p className="font-medium text-red-700">Available tags: Development, Property Management, Leasing, Operations, Finance</p>
                        {editForm.watch("type") === "owner" && (
                          <p className="text-green-700 font-bold mt-1">
                            ✓ OWNER CONTACT - Development tag available here!
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end space-x-2 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={cancelEdit}
                      className="h-8 px-3 text-sm"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={updateContactMutation.isPending}
                      className="h-8 px-3 text-sm"
                    >
                      {updateContactMutation.isPending ? "Updating..." : "Update Contact"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}

        <div className="flex justify-end pt-4">
          <Button variant="outline" onClick={onClose} className="h-8 px-3 text-sm">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}