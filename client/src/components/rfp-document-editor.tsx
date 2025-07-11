/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import { useState, useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FileText, Edit, Save, Eye, Plus, Download } from "lucide-react";

interface DocumentSection {
  id: string;
  title: string;
  content: string;
  editable: boolean;
  templateKey?: string;
}

export function RfpDocumentEditor() {
  const [selectedRfp, setSelectedRfp] = useState<any>(null);
  const [selectedDocumentType, setSelectedDocumentType] = useState<string>('');
  const [editingSections, setEditingSections] = useState<Set<string>>(new Set());
  const [sectionContent, setSectionContent] = useState<Record<string, string>>({});
  const [showPreview, setShowPreview] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get list of RFPs to choose from
  const { data: rfps = [] } = useQuery({
    queryKey: ['/api/rfp-requests'],
  });

  // Get templates for customization
  const { data: templates = [] } = useQuery({
    queryKey: ['/api/pdf-templates'],
  });

  // Generate document sections based on selected RFP and type
  const generateDocumentSections = (): DocumentSection[] => {
    if (!selectedRfp || !selectedDocumentType) return [];

    const baseContent = {
      header: getTemplateContent('header', selectedDocumentType) || 'REQUEST FOR PROPOSAL',
      subtitle: getTemplateContent('subtitle', selectedDocumentType) || `${selectedDocumentType.toUpperCase()} SERVICES`,
      project_info: `Project: ${selectedRfp.projectName}\nProperty: ${selectedRfp.property}\nDue Date: ${selectedRfp.internalDueDate || 'TBD'}`,
      introduction: getTemplateContent('introduction', 'common') || 'Bridge Industrial is seeking qualified professionals to provide services for the following project. Please review the project details and requirements below.',
      scope_of_work: `Based on the project requirements, we are requesting proposals for:\n\n• Project planning and design\n• Timeline development\n• Cost estimation\n• Quality assurance\n• Project coordination`,
      submission_requirements: getTemplateContent('submission_requirements', 'common') || `Please provide the following with your proposal:\n• Detailed project timeline and milestones\n• Comprehensive cost breakdown\n• Relevant project experience and references\n• Proof of insurance and licensing\n• Any questions or clarifications needed`,
      contact_info: `For questions regarding this RFP, please contact:\n\n${selectedRfp.developmentContact || 'Development Team'}\nBridge Industrial`,
      footer: getTemplateContent('footer', 'common') || 'For questions regarding this RFP, please contact the development team member listed above.'
    };

    return [
      { id: 'header', title: 'Document Header', content: baseContent.header, editable: true, templateKey: `${selectedDocumentType}_header` },
      { id: 'subtitle', title: 'Service Type Subtitle', content: baseContent.subtitle, editable: true, templateKey: `${selectedDocumentType}_subtitle` },
      { id: 'project_info', title: 'Project Information', content: baseContent.project_info, editable: true },
      { id: 'introduction', title: 'Introduction', content: baseContent.introduction, editable: true, templateKey: 'common_introduction' },
      { id: 'scope_of_work', title: 'Scope of Work', content: baseContent.scope_of_work, editable: true },
      { id: 'submission_requirements', title: 'Submission Requirements', content: baseContent.submission_requirements, editable: true, templateKey: 'submission_requirements' },
      { id: 'contact_info', title: 'Contact Information', content: baseContent.contact_info, editable: true },
      { id: 'footer', title: 'Footer', content: baseContent.footer, editable: true, templateKey: 'contact_footer' }
    ];
  };

  const getTemplateContent = (section: string, type: string): string | undefined => {
    const template = templates.find((t: any) => 
      t.section === section && (t.templateType === type || t.templateType === 'common')
    );
    return template?.content;
  };

  const documentSections = generateDocumentSections();

  // Initialize section content when RFP or document type changes
  useEffect(() => {
    const initialContent: Record<string, string> = {};
    documentSections.forEach(section => {
      initialContent[section.id] = section.content;
    });
    setSectionContent(initialContent);
  }, [selectedRfp, selectedDocumentType]);

  const toggleEditSection = (sectionId: string) => {
    const newEditing = new Set(editingSections);
    if (newEditing.has(sectionId)) {
      newEditing.delete(sectionId);
    } else {
      newEditing.add(sectionId);
    }
    setEditingSections(newEditing);
  };

  const updateSectionContent = (sectionId: string, content: string) => {
    setSectionContent(prev => ({
      ...prev,
      [sectionId]: content
    }));
  };

  const saveTemplateUpdates = useMutation({
    mutationFn: async () => {
      const updates = [];
      for (const section of documentSections) {
        if (section.templateKey && sectionContent[section.id] !== section.content) {
          updates.push({
            templateKey: section.templateKey,
            content: sectionContent[section.id]
          });
        }
      }

      // Update templates that have changed
      for (const update of updates) {
        const template = templates.find((t: any) => t.templateKey === update.templateKey);
        if (template) {
          await apiRequest(`/api/pdf-templates/${template.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: update.content }),
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pdf-templates'] });
      toast({
        title: "Templates updated",
        description: "Your changes have been saved and will apply to future RFPs.",
      });
    },
  });

  const generatePreviewPdf = async () => {
    if (!selectedRfp || !selectedDocumentType) return;

    try {
      // Create a preview URL with current content
      const url = `/api/rfp-requests/${selectedRfp.id}/generate-pdf/${selectedDocumentType}?preview=true`;
      window.open(url, '_blank');
    } catch (error) {
      toast({
        title: "Preview Error",
        description: "Failed to generate preview. Please try again.",
        variant: "destructive",
      });
    }
  };

  const documentTypes = [
    { value: 'architect', label: 'Architect RFP' },
    { value: 'contractor', label: 'Contractor RFP' },
    { value: 'broker-architect', label: 'Broker-Architect RFP' },
    { value: 'broker-contractor', label: 'Broker-Contractor RFP' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">RFP Document Editor</h2>
          <p className="text-muted-foreground">
            Edit RFP content directly and preview changes in real-time
          </p>
        </div>
      </div>

      {/* Document Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Document to Edit</CardTitle>
          <CardDescription>
            Choose an RFP project and document type to customize the content
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="rfp-select">RFP Project</Label>
              <Select value={selectedRfp?.id?.toString() || ''} onValueChange={(value) => {
                const rfp = rfps.find((r: any) => r.id.toString() === value);
                setSelectedRfp(rfp);
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an RFP project" />
                </SelectTrigger>
                <SelectContent>
                  {rfps.map((rfp: any) => (
                    <SelectItem key={rfp.id} value={rfp.id.toString()}>
                      {rfp.projectName} - {rfp.rfpNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="type-select">Document Type</Label>
              <Select value={selectedDocumentType} onValueChange={setSelectedDocumentType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select document type" />
                </SelectTrigger>
                <SelectContent>
                  {documentTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedRfp && selectedDocumentType && (
            <div className="mt-4 flex gap-2">
              <Button onClick={generatePreviewPdf} variant="outline">
                <Eye className="h-4 w-4 mr-2" />
                Preview PDF
              </Button>
              <Button onClick={() => saveTemplateUpdates.mutate()} disabled={saveTemplateUpdates.isPending}>
                <Save className="h-4 w-4 mr-2" />
                {saveTemplateUpdates.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Document Content Editor */}
      {selectedRfp && selectedDocumentType && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Document Content</h3>
            <Badge variant="outline">
              {documentTypes.find(t => t.value === selectedDocumentType)?.label}
            </Badge>
          </div>

          {documentSections.map((section) => (
            <Card key={section.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{section.title}</CardTitle>
                  <div className="flex items-center gap-2">
                    {section.templateKey && (
                      <Badge variant="secondary" className="text-xs">
                        Template
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleEditSection(section.id)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {editingSections.has(section.id) ? (
                  <div className="space-y-3">
                    <Textarea
                      value={sectionContent[section.id] || section.content}
                      onChange={(e) => updateSectionContent(section.id, e.target.value)}
                      rows={section.content.split('\n').length + 2}
                      className="min-h-[100px]"
                    />
                    <div className="flex justify-end space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleEditSection(section.id)}
                      >
                        Done
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-muted p-4 rounded-md">
                    <pre className="whitespace-pre-wrap text-sm font-mono">
                      {sectionContent[section.id] || section.content}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!selectedRfp && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">Select an RFP project and document type to start editing</p>
              <p className="text-sm text-gray-500 mt-2">
                Choose from your existing RFP projects to customize the content
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}