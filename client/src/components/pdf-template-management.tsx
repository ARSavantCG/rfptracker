/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
// Removed Select import - using native HTML selects for consistency
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, Save, X, ChevronDown } from "lucide-react";
import type { PdfTemplate, InsertPdfTemplate } from "@shared/schema";

export function PdfTemplateManagement() {
  const [editingTemplate, setEditingTemplate] = useState<PdfTemplate | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['/api/pdf-templates'],
  });

  const createTemplateMutation = useMutation({
    mutationFn: async (template: InsertPdfTemplate) => {
      return apiRequest('/api/pdf-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pdf-templates'] });
      setShowCreateDialog(false);
      toast({
        title: "Template created",
        description: "PDF template has been created successfully.",
      });
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, template }: { id: number; template: Partial<InsertPdfTemplate> }) => {
      return apiRequest(`/api/pdf-templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pdf-templates'] });
      setEditingTemplate(null);
      toast({
        title: "Template updated",
        description: "PDF template has been updated successfully.",
      });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/pdf-templates/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pdf-templates'] });
      toast({
        title: "Template deleted",
        description: "PDF template has been deleted successfully.",
      });
    },
  });

  const handleCreateTemplate = (formData: FormData) => {
    const template: InsertPdfTemplate = {
      templateKey: formData.get('templateKey') as string,
      templateName: formData.get('templateName') as string,
      templateType: formData.get('templateType') as string,
      section: formData.get('section') as string,
      content: formData.get('content') as string,
      description: formData.get('description') as string || undefined,
      isActive: true,
    };
    createTemplateMutation.mutate(template);
  };

  const handleUpdateTemplate = (template: PdfTemplate, formData: FormData) => {
    const updatedTemplate: Partial<InsertPdfTemplate> = {
      templateName: formData.get('templateName') as string,
      templateType: formData.get('templateType') as string,
      section: formData.get('section') as string,
      content: formData.get('content') as string,
      description: formData.get('description') as string || undefined,
      isActive: template.isActive,
    };
    updateTemplateMutation.mutate({ id: template.id, template: updatedTemplate });
  };

  const groupedTemplates = templates.reduce((acc: Record<string, PdfTemplate[]>, template: PdfTemplate) => {
    if (!acc[template.templateType]) {
      acc[template.templateType] = [];
    }
    acc[template.templateType].push(template);
    return acc;
  }, {});

  const templateTypes = [
    { value: 'common', label: 'Common (All Types)' },
    { value: 'architect', label: 'Architect' },
    { value: 'contractor', label: 'Contractor' },
    { value: 'broker-architect', label: 'Broker-Architect' },
    { value: 'broker-contractor', label: 'Broker-Contractor' },
  ];

  const sectionTypes = [
    { value: 'header', label: 'Header' },
    { value: 'subtitle', label: 'Subtitle' },
    { value: 'introduction', label: 'Introduction' },
    { value: 'submission_requirements', label: 'Submission Requirements' },
    { value: 'footer', label: 'Footer' },
    { value: 'custom', label: 'Custom Section' },
  ];

  if (isLoading) {
    return <div className="p-6">Loading PDF templates...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">PDF Template Management</h2>
          <p className="text-muted-foreground">
            Manage customizable text content for RFP PDF generation
          </p>
        </div>

        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create PDF Template</DialogTitle>
              <DialogDescription>
                Add a new customizable text template for PDF generation.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => {
              e.preventDefault();
              handleCreateTemplate(new FormData(e.currentTarget));
            }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="templateKey">Template Key</Label>
                  <Input
                    id="templateKey"
                    name="templateKey"
                    placeholder="unique_template_key"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="templateName">Template Name</Label>
                  <Input
                    id="templateName"
                    name="templateName"
                    placeholder="Display Name"
                    required
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="templateType">Template Type</Label>
                  <div className="relative">
                    <select 
                      name="templateType" 
                      required
                      className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      <option value="">Select type</option>
                      {templateTypes.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="section">Section</Label>
                  <div className="relative">
                    <select 
                      name="section" 
                      required
                      className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      <option value="">Select section</option>
                      {sectionTypes.map((section) => (
                        <option key={section.value} value={section.value}>
                          {section.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              </div>

              <div>
                <Label htmlFor="content">Content</Label>
                <Textarea
                  id="content"
                  name="content"
                  placeholder="Template content..."
                  required
                  rows={6}
                />
              </div>

              <div>
                <Label htmlFor="description">Description (Optional)</Label>
                <Input
                  id="description"
                  name="description"
                  placeholder="Brief description of this template"
                />
              </div>

              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createTemplateMutation.isPending}>
                  {createTemplateMutation.isPending ? "Creating..." : "Create Template"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-6">
        {Object.entries(groupedTemplates).map(([type, typeTemplates]) => (
          <Card key={type}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {templateTypes.find(t => t.value === type)?.label || type}
                <Badge variant="secondary">{typeTemplates.length}</Badge>
              </CardTitle>
              <CardDescription>
                Templates for {type} PDF generation
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {typeTemplates.map((template) => (
                  <div key={template.id} className="border rounded-lg p-4">
                    {editingTemplate?.id === template.id ? (
                      <form onSubmit={(e) => {
                        e.preventDefault();
                        handleUpdateTemplate(template, new FormData(e.currentTarget));
                      }} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label htmlFor={`edit-name-${template.id}`}>Template Name</Label>
                            <Input
                              id={`edit-name-${template.id}`}
                              name="templateName"
                              defaultValue={template.templateName}
                              required
                            />
                          </div>
                          <div>
                            <Label htmlFor={`edit-section-${template.id}`}>Section</Label>
                            <div className="relative">
                              <select 
                                name="section" 
                                defaultValue={template.section}
                                className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                              >
                                {sectionTypes.map((section) => (
                                  <option key={section.value} value={section.value}>
                                    {section.label}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                            </div>
                          </div>
                        </div>
                        
                        <div>
                          <Label htmlFor={`edit-content-${template.id}`}>Content</Label>
                          <Textarea
                            id={`edit-content-${template.id}`}
                            name="content"
                            defaultValue={template.content}
                            required
                            rows={4}
                          />
                        </div>
                        
                        <div>
                          <Label htmlFor={`edit-description-${template.id}`}>Description</Label>
                          <Input
                            id={`edit-description-${template.id}`}
                            name="description"
                            defaultValue={template.description || ''}
                          />
                        </div>

                        <input type="hidden" name="templateType" value={template.templateType} />

                        <div className="flex justify-end space-x-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingTemplate(null)}
                          >
                            <X className="h-4 w-4 mr-1" />
                            Cancel
                          </Button>
                          <Button type="submit" size="sm" disabled={updateTemplateMutation.isPending}>
                            <Save className="h-4 w-4 mr-1" />
                            {updateTemplateMutation.isPending ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold">{template.templateName}</h4>
                            <Badge variant="outline">{template.section}</Badge>
                            <Badge variant="outline" className="text-xs">
                              {template.templateKey}
                            </Badge>
                          </div>
                          <div className="flex items-center space-x-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingTemplate(template)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteTemplateMutation.mutate(template.id)}
                              disabled={deleteTemplateMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        
                        <p className="text-sm text-muted-foreground mb-2">
                          {template.description}
                        </p>
                        
                        <div className="bg-muted p-3 rounded text-sm">
                          {template.content.length > 200 
                            ? `${template.content.substring(0, 200)}...`
                            : template.content
                          }
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}