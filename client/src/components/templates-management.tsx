import { useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Edit, Copy, Archive, Trash2, Search, FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface TemplateItem {
  code: string;
  label: string;
  type: "cost" | "allowance" | "percent" | "note";
  qty?: number | null;
  unit_cost?: number | null;
  percent?: number | null;
  percent_of?: string | null;
  tags?: string[];
  notes?: string;
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
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TemplateRecord | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "",
    items: [] as TemplateItem[]
  });

  const { data: templatesData, isLoading } = useQuery({
    queryKey: ["/api/templates", searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchTerm) params.append("search", searchTerm);
      const response = await fetch(`/api/templates?${params}`);
      if (!response.ok) throw new Error("Failed to fetch templates");
      return response.json();
    }
  });

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
      apiRequest(`/api/templates/${id}/archive`, "PATCH", { archived }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({ title: "Template archived successfully", duration: 4000 });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive", duration: 6000 });
    }
  });

  const resetForm = () => {
    setFormData({ name: "", description: "", category: "", items: [] });
  };

  const handleEdit = (template: TemplateRecord) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      description: template.description || "",
      category: template.category || "",
      items: template.items
    });
  };

  const handleSubmit = () => {
    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const templates = templatesData?.items || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              <CardTitle>
                Templates 
                {templates.length > 0 && (
                  <Badge variant="outline" className="ml-2">{templates.length}</Badge>
                )}
              </CardTitle>
            </div>
            <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-template">
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="mb-4">
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => duplicateMutation.mutate(template.id)}
                          data-testid={`button-duplicate-${template.id}`}
                        >
                          <Copy className="h-4 w-4 text-green-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => archiveMutation.mutate({ id: template.id, archived: !template.metadata.isArchived })}
                          data-testid={`button-archive-${template.id}`}
                        >
                          <Archive className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog || !!editingTemplate} onOpenChange={(open) => {
        if (!open) {
          setShowCreateDialog(false);
          setEditingTemplate(null);
          resetForm();
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Template" : "Create Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
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
                placeholder="e.g., TI, Core/Shell"
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
            <div className="text-sm text-muted-foreground">
              <p>Note: Template items can be added and edited after creation through the full template editor.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => {
              setShowCreateDialog(false);
              setEditingTemplate(null);
              resetForm();
            }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!formData.name} data-testid="button-save-template">
              {editingTemplate ? "Save Changes" : "Create Template"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
