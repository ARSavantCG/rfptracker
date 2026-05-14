import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Edit2, Copy, Trash2, Search, FileText, AlertCircle, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";

interface RomScopeItem {
  id: number;
  name: string;
  description: string;
  unit: string;
  unitPrice: string;
  minimumCost: string | null;
  category: string;
  source: string;
}

interface TemplateItem {
  code: string;
  label: string;
  type: "cost" | "allowance" | "percent" | "note";
  qty?: number | null;
  unit?: string | null;
  unit_cost?: number | null;
  percent?: number | null;
  percent_of?: string | null;
  tags?: string[];
  notes?: string;
  romScopeItemId?: number | null;
  sourceType?: "rom" | "custom";
}

interface TemplateRecord {
  id: string;
  name: string;
  description?: string;
  category?: string;
  version?: number;
  items: TemplateItem[];
  metadata: {
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    isArchived: boolean;
    updatedBy?: string;
  };
}

export function TemplatesManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TemplateRecord | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "",
    items: [] as TemplateItem[]
  });
  
  // ROM Pilot item selection
  const [romSearchTerm, setRomSearchTerm] = useState("");
  const [selectedRomItems, setSelectedRomItems] = useState<Set<number>>(new Set());
  const [showCustomItemPrompt, setShowCustomItemPrompt] = useState(false);
  
  // Delete confirmation
  const [deletingTemplate, setDeletingTemplate] = useState<TemplateRecord | null>(null);

  // Fetch templates
  const { data: templatesData, isLoading } = useQuery({
    queryKey: ["/api/templates", searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchTerm) params.append("search", searchTerm);
      const response = await fetch(`/api/templates?${params}`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` }
      });
      if (!response.ok) throw new Error("Failed to fetch templates");
      return response.json();
    }
  });

  // Fetch ROM scope items
  const { data: romItems = [], isLoading: isLoadingRom, isError: isRomError } = useQuery<RomScopeItem[]>({
    queryKey: ["/api/rom-scope-items"],
    enabled: showCreateDialog || !!editingTemplate
  });

  // Filter ROM items by search
  const filteredRomItems = useMemo(() => {
    if (!romSearchTerm) return romItems;
    const term = romSearchTerm.toLowerCase();
    return romItems.filter((item: RomScopeItem) =>
      item.name.toLowerCase().includes(term) ||
      item.category.toLowerCase().includes(term) ||
      item.description?.toLowerCase().includes(term)
    );
  }, [romItems, romSearchTerm]);

  // Group ROM items by category
  const groupedRomItems = useMemo(() => {
    const groups: Record<string, RomScopeItem[]> = {};
    filteredRomItems.forEach((item: RomScopeItem) => {
      if (!groups[item.category]) {
        groups[item.category] = [];
      }
      groups[item.category].push(item);
    });
    return groups;
  }, [filteredRomItems]);

  const templates = templatesData?.items || [];
  const isAdmin = user?.permissions?.includes?.("admin.access");

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("/api/templates", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      setShowCreateDialog(false);
      resetForm();
      toast({ title: "Template created successfully", duration: 4000 });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive", duration: 6000 });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => 
      apiRequest(`/api/templates/${id}`, "PATCH", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      setEditingTemplate(null);
      resetForm();
      toast({ title: "Template updated successfully", duration: 4000 });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive", duration: 6000 });
    }
  });

  const duplicateMutation = useMutation({
    mutationFn: async (id: string) => apiRequest(`/api/templates/${id}/duplicate`, "POST"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({ title: "Template duplicated successfully", duration: 4000 });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive", duration: 6000 });
    }
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) =>
      apiRequest(`/api/templates/${id}/archive`, "PUT", { archived }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({ title: "Template archived successfully", duration: 4000 });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive", duration: 6000 });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest(`/api/templates/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      setDeletingTemplate(null);
      toast({ title: "Template deleted successfully", duration: 4000 });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive", duration: 6000 });
    }
  });

  const resetForm = () => {
    setFormData({ name: "", description: "", category: "", items: [] });
    setSelectedRomItems(new Set());
    setRomSearchTerm("");
  };

  const handleEdit = (template: TemplateRecord) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      description: template.description || "",
      category: template.category || "",
      items: template.items || []
    });
    // Pre-select ROM items if they exist
    const romIds = new Set(template.items.filter(item => item.romScopeItemId).map(item => item.romScopeItemId!));
    setSelectedRomItems(romIds);
  };

  const handleToggleRomItem = (itemId: number) => {
    setSelectedRomItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleSubmit = () => {
    if (!formData.name) {
      toast({ title: "Error", description: "Template name is required", variant: "destructive" });
      return;
    }

    // Convert selected ROM items to template items WITH SNAPSHOTS
    // IMPORTANT: Preserve existing snapshots for items already in template
    const templateItems: TemplateItem[] = Array.from(selectedRomItems).map(romId => {
      // Check if this ROM item already exists in the template
      const existingItem = formData.items.find(item => item.romScopeItemId === romId);
      
      if (existingItem) {
        // Deep clone to prevent mutation of original item in React state
        // This preserves the original snapshot timestamp immutably
        return JSON.parse(JSON.stringify(existingItem));
      }
      
      // New ROM item - create fresh snapshot with current timestamp
      const romItem = romItems.find((item: RomScopeItem) => item.id === romId);
      if (!romItem) return null;
      
      return {
        code: `ROM-${romItem.id}`,
        label: romItem.name,
        type: "cost" as const,
        qty: 1,
        unit: romItem.unit,
        unit_cost: parseFloat(romItem.unitPrice) || 0,
        tags: [romItem.category.toLowerCase().replace(/\s+/g, "-")],
        notes: romItem.description,
        romScopeItemId: romItem.id,
        sourceType: "rom" as const,
        // Capture immutable snapshot for staleness detection
        snapshot: {
          label: romItem.name,
          unit: romItem.unit,
          unitPrice: parseFloat(romItem.unitPrice),
          category: romItem.category,
          source: romItem.source || 'ROM Pilot',
          capturedAt: new Date().toISOString(),
          // Tiered pricing fields for automatic tier selection
          itemGroup: romItem.itemGroup || undefined,
          minSquareFootage: romItem.minSquareFootage || undefined,
          maxSquareFootage: romItem.maxSquareFootage || undefined,
        }
      };
    }).filter(Boolean) as TemplateItem[];

    // Preserve ALL existing items that aren't in the current ROM selection
    // This includes custom items, legacy items, and any items without sourceType
    const existingItemsToKeep = formData.items.filter(item => 
      // Keep if it's NOT a ROM item, OR if it's a ROM item not in current selection
      !item.romScopeItemId || !selectedRomItems.has(item.romScopeItemId)
    );
    
    const allItems = [...templateItems, ...existingItemsToKeep];

    const payload = {
      name: formData.name,
      description: formData.description,
      category: formData.category,
      items: allItems
    };

    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleRemoveSelectedItem = (itemId: number) => {
    setSelectedRomItems(prev => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  };

  return (
    <div className="space-y-6" data-testid="templates-management">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>RFP Templates</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Create reusable cost templates from ROM pilot items
              </p>
            </div>
            <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-template">
              <Plus className="h-4 w-4 mr-2" />
              Create Template
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search templates..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-templates"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading templates...</div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">No templates found</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {searchTerm ? "Try a different search term" : "Create your first template to get started"}
              </p>
              {!searchTerm && (
                <Button onClick={() => setShowCreateDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Template
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[300px]">Name</TableHead>
                  <TableHead className="w-40">Category</TableHead>
                  <TableHead className="w-24 text-center">#Items</TableHead>
                  <TableHead className="w-48">Last Updated</TableHead>
                  <TableHead className="w-40">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template: TemplateRecord) => (
                  <TableRow key={template.id} className={template.metadata.isArchived ? "opacity-60" : ""}>
                    <TableCell className="font-medium">
                      {template.name}
                      {template.metadata.isArchived && (
                        <Badge variant="secondary" className="ml-2">Archived</Badge>
                      )}
                    </TableCell>
                    <TableCell>{template.category || "—"}</TableCell>
                    <TableCell className="text-center">{template.items.length}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(template.metadata.updatedAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(template)}
                          data-testid={`button-edit-${template.id}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => duplicateMutation.mutate(template.id)}
                          data-testid={`button-duplicate-${template.id}`}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeletingTemplate(template)}
                            data-testid={`button-delete-${template.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Template Dialog */}
      <Dialog open={showCreateDialog || !!editingTemplate} onOpenChange={(open) => {
        if (!open) {
          setShowCreateDialog(false);
          setEditingTemplate(null);
          resetForm();
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Template" : "Create Template"}</DialogTitle>
          </DialogHeader>
          
          <div className="grid grid-cols-2 gap-4 py-4 overflow-y-auto">
            {/* Left: Template Info */}
            <div className="space-y-4 pr-4 border-r">
              <div className="space-y-2">
                <Label htmlFor="name">Template Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Baseline Industrial TI"
                  data-testid="input-template-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="e.g., Industrial, Office"
                  data-testid="input-template-category"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of this template"
                  rows={3}
                  data-testid="textarea-template-description"
                />
              </div>

              {/* Selected Items Summary */}
              <div className="space-y-2 pt-4">
                <Label>Selected Items ({selectedRomItems.size})</Label>
                {selectedRomItems.size === 0 ? (
                  <p className="text-sm text-muted-foreground">No items selected yet</p>
                ) : (
                  <div className="space-y-1 max-h-[300px] overflow-y-auto border rounded-md p-2">
                    {Array.from(selectedRomItems).map(itemId => {
                      const romItem = romItems.find((item: RomScopeItem) => item.id === itemId);
                      if (!romItem) return null;
                      return (
                        <div key={itemId} className="flex items-center justify-between text-sm py-1 px-2 hover:bg-slate-50 rounded">
                          <span className="truncate flex-1">{romItem.name}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveSelectedItem(itemId)}
                            className="h-6 w-6 p-0 ml-2"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {isAdmin && (
                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCustomItemPrompt(true)}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Custom Item (Admin Only)
                  </Button>
                </div>
              )}
            </div>

            {/* Right: ROM Pilot Items Browser */}
            <div className="space-y-4 pl-4">
              <div>
                <Label>Select from ROM Pilot</Label>
                <div className="relative mt-2">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search ROM items..."
                    value={romSearchTerm}
                    onChange={(e) => setRomSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="border rounded-md max-h-[500px] overflow-y-auto">
                {isLoadingRom ? (
                  <div className="text-center py-12 text-muted-foreground">
                    Loading ROM pilot items...
                  </div>
                ) : isRomError ? (
                  <div className="text-center py-12">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 text-red-500" />
                    <p className="text-sm text-red-600">Failed to load ROM pilot items</p>
                    <p className="text-xs text-muted-foreground mt-1">Please try again later</p>
                  </div>
                ) : romItems.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-sm">No ROM pilot items found</p>
                    <p className="text-xs mt-1">Add items in ROM Pilot management first</p>
                  </div>
                ) : Object.entries(groupedRomItems).length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p className="text-sm">No items match your search</p>
                  </div>
                ) : (
                  Object.entries(groupedRomItems).map(([category, items]) => (
                  <div key={category} className="border-b last:border-b-0">
                    <div className="bg-slate-50 px-3 py-2 font-medium text-sm sticky top-0">
                      {category} ({items.length})
                    </div>
                    <div className="divide-y">
                      {items.map((item: RomScopeItem) => (
                        <div
                          key={item.id}
                          className="flex items-start gap-3 p-3 hover:bg-slate-50"
                        >
                          <Checkbox
                            checked={selectedRomItems.has(item.id)}
                            onCheckedChange={() => handleToggleRomItem(item.id)}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">{item.name}</div>
                            {item.description && (
                              <div className="text-xs text-muted-foreground mt-0.5">{item.description}</div>
                            )}
                            <div className="text-xs text-muted-foreground mt-1">
                              {item.unit} • ${parseFloat(item.unitPrice).toFixed(2)}/{item.unit}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="ghost" onClick={() => {
              setShowCreateDialog(false);
              setEditingTemplate(null);
              resetForm();
            }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!formData.name || selectedRomItems.size === 0} data-testid="button-save-template">
              {editingTemplate ? "Save Changes" : "Create Template"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Custom Item Prompt */}
      <AlertDialog open={showCustomItemPrompt} onOpenChange={setShowCustomItemPrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Add Item to ROM Pilot First
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This item is not in the ROM Pilot. For consistency and reusability, we recommend adding it to the ROM Pilot first.
              </p>
              <p className="font-medium">
                Would you like to navigate to ROM Pilot management to add this item?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setShowCustomItemPrompt(false);
              window.location.href = "/rom-pilot";
            }}>
              Go to ROM Pilot
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingTemplate} onOpenChange={(open) => !open && setDeletingTemplate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingTemplate?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingTemplate && deleteMutation.mutate(deletingTemplate.id)}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
