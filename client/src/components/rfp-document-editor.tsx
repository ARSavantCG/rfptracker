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
// Removed Select import - using native HTML selects for consistency
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FileText, Edit, Save, Eye, Plus, Download, Bold, Italic, Underline, Trash2, Type, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";

interface DocumentSection {
  id: string;
  title: string;
  content: string;
  editable: boolean;
  templateKey?: string;
  isCustom?: boolean;
  headerFormat?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    fontSize?: string;
  };
}

export function RfpDocumentEditor() {
  const [selectedDocumentType, setSelectedDocumentType] = useState<string>('');
  const [editingSections, setEditingSections] = useState<Set<string>>(new Set());
  const [sectionContent, setSectionContent] = useState<Record<string, string>>({});
  const [customSections, setCustomSections] = useState<DocumentSection[]>([]);
  const [headerFormats, setHeaderFormats] = useState<Record<string, any>>({});
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get list of RFPs to choose from (for preview only)
  const { data: rfps = [] } = useQuery({
    queryKey: ['/api/rfp-requests'],
  });

  // Get templates for customization
  const { data: templates = [] } = useQuery({
    queryKey: ['/api/pdf-templates'],
  });

  // Generate document sections based on document type only
  const generateDocumentSections = (): DocumentSection[] => {
    if (!selectedDocumentType) return [];

    const baseContent = {
      header: getTemplateContent('header', selectedDocumentType) || 'REQUEST FOR PROPOSAL',
      subtitle: getTemplateContent('subtitle', selectedDocumentType) || `${selectedDocumentType.toUpperCase().replace('-', ' ')} SERVICES`,
      introduction: getTemplateContent('introduction', 'common') || 'Bridge Industrial is seeking qualified professionals to provide services for the following project. Please review the project details and requirements below.',
      scope_of_work: getTemplateContent('scope_of_work', selectedDocumentType) || `Based on the project requirements, we are requesting proposals for:\n\n• Project planning and design\n• Timeline development\n• Cost estimation\n• Quality assurance\n• Project coordination`,
      submission_requirements: getTemplateContent('submission_requirements', 'common') || `Please provide the following with your proposal:\n• Detailed project timeline and milestones\n• Comprehensive cost breakdown\n• Relevant project experience and references\n• Proof of insurance and licensing\n• Any questions or clarifications needed`,
      contact_footer: getTemplateContent('contact_footer', 'common') || 'For questions regarding this RFP, please contact the development team member listed above.',
      request_types_text: getTemplateContent('request_types_text', 'common') || 'Please indicate which of the following you can provide:'
    };

    const baseSections: DocumentSection[] = [
      { id: 'header', title: 'Document Header', content: baseContent.header, editable: true, templateKey: `${selectedDocumentType}_header`, headerFormat: { bold: true, fontSize: '24px' } },
      { id: 'subtitle', title: 'Service Type Subtitle', content: baseContent.subtitle, editable: true, templateKey: `${selectedDocumentType}_subtitle`, headerFormat: { bold: true, fontSize: '18px' } },
      { id: 'introduction', title: 'Introduction Text', content: baseContent.introduction, editable: true, templateKey: 'common_introduction' },
      { id: 'scope_of_work', title: 'Scope of Work', content: baseContent.scope_of_work, editable: true, templateKey: `${selectedDocumentType}_scope_of_work`, headerFormat: { bold: true, fontSize: '16px' } },
      { id: 'submission_requirements', title: 'Submission Requirements', content: baseContent.submission_requirements, editable: true, templateKey: 'common_submission_requirements', headerFormat: { bold: true, fontSize: '16px' } },
      { id: 'request_types_text', title: 'Request Types Section', content: baseContent.request_types_text, editable: true, templateKey: 'common_request_types_text', headerFormat: { bold: true, fontSize: '16px' } },
      { id: 'contact_footer', title: 'Contact Footer', content: baseContent.contact_footer, editable: true, templateKey: 'common_contact_footer' }
    ];

    // Combine base sections with custom sections
    const allSections = [...baseSections, ...customSections];
    
    // Initialize section order if not set
    if (sectionOrder.length === 0) {
      setSectionOrder(allSections.map(s => s.id));
    }
    
    // Sort sections by order if order is set
    if (sectionOrder.length > 0) {
      return sectionOrder
        .map(id => allSections.find(s => s.id === id))
        .filter(Boolean) as DocumentSection[];
    }
    
    return allSections;
  };

  const getTemplateContent = (section: string, type: string): string | undefined => {
    const template = templates.find((t: any) => 
      t.templateKey === `${type}_${section}` || t.templateKey === `common_${section}`
    );
    return template?.content;
  };

  const documentSections = generateDocumentSections();

  // Initialize section content when document type changes
  useEffect(() => {
    const initialContent: Record<string, string> = {};
    documentSections.forEach(section => {
      initialContent[section.id] = section.content;
    });
    setSectionContent(initialContent);
  }, [selectedDocumentType]);

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

  const addCustomSection = () => {
    if (!newSectionTitle.trim()) return;
    
    const newSection: DocumentSection = {
      id: `custom_${Date.now()}`,
      title: newSectionTitle,
      content: 'Enter your content here...',
      editable: true,
      isCustom: true,
      headerFormat: { bold: true, fontSize: '16px' }
    };
    
    setCustomSections(prev => [...prev, newSection]);
    setSectionContent(prev => ({
      ...prev,
      [newSection.id]: newSection.content
    }));
    // Add to end of section order
    setSectionOrder(prev => [...prev, newSection.id]);
    setNewSectionTitle('');
  };

  const removeCustomSection = (sectionId: string) => {
    setCustomSections(prev => prev.filter(s => s.id !== sectionId));
    setSectionContent(prev => {
      const newContent = { ...prev };
      delete newContent[sectionId];
      return newContent;
    });
    // Remove from section order
    setSectionOrder(prev => prev.filter(id => id !== sectionId));
  };

  const handleDragEnd = (result: any) => {
    if (!result.destination) return;

    const items = Array.from(sectionOrder);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setSectionOrder(items);
  };

  const moveSectionUp = (sectionId: string) => {
    const currentIndex = sectionOrder.indexOf(sectionId);
    if (currentIndex > 0) {
      const newOrder = [...sectionOrder];
      [newOrder[currentIndex], newOrder[currentIndex - 1]] = [newOrder[currentIndex - 1], newOrder[currentIndex]];
      setSectionOrder(newOrder);
    }
  };

  const moveSectionDown = (sectionId: string) => {
    const currentIndex = sectionOrder.indexOf(sectionId);
    if (currentIndex < sectionOrder.length - 1) {
      const newOrder = [...sectionOrder];
      [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
      setSectionOrder(newOrder);
    }
  };

  const updateHeaderFormat = (sectionId: string, format: any) => {
    setHeaderFormats(prev => ({
      ...prev,
      [sectionId]: format
    }));
  };

  const getSectionHeaderStyle = (section: DocumentSection) => {
    const format = headerFormats[section.id] || section.headerFormat || {};
    return {
      fontWeight: format.bold ? 'bold' : 'normal',
      fontStyle: format.italic ? 'italic' : 'normal',
      textDecoration: format.underline ? 'underline' : 'none',
      fontSize: format.fontSize || '16px'
    };
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
    if (!selectedDocumentType) return;

    try {
      // Use the first available RFP for preview, or show message if none available
      if (rfps.length === 0) {
        toast({
          title: "No RFPs Available",
          description: "Please create an RFP first to preview the document template.",
          variant: "destructive",
        });
        return;
      }

      const sampleRfp = rfps[0]; // Use first RFP as sample for preview
      const url = `/api/rfp-requests/${sampleRfp.id}/generate-pdf/${selectedDocumentType}?preview=true`;
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
          <CardTitle>Select Document Type to Edit</CardTitle>
          <CardDescription>
            Choose a document type to customize the standard content used for all RFPs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="type-select">Document Type</Label>
              <div className="relative">
                <select
                  id="type-select"
                  value={selectedDocumentType}
                  onChange={(e) => setSelectedDocumentType(e.target.value)}
                  className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="">Select document type to edit</option>
                  {documentTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>

          {selectedDocumentType && (
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
      {selectedDocumentType && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Document Content</h3>
            <Badge variant="outline">
              {documentTypes.find(t => t.value === selectedDocumentType)?.label}
            </Badge>
          </div>

          {/* Add Custom Section */}
          <Card className="border-2 border-dashed border-gray-300">
            <CardContent className="pt-6">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter new section title (e.g., 'Special Requirements', 'Project Timeline')"
                  value={newSectionTitle}
                  onChange={(e) => setNewSectionTitle(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addCustomSection()}
                />
                <Button onClick={addCustomSection} disabled={!newSectionTitle.trim()}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Section
                </Button>
              </div>
            </CardContent>
          </Card>

          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="sections">
              {(provided) => (
                <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-4">
                  {documentSections.map((section, index) => (
                    <Draggable key={section.id} draggableId={section.id} index={index}>
                      {(provided, snapshot) => (
                        <Card 
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`${section.isCustom ? "border-blue-200" : ""} ${snapshot.isDragging ? "shadow-lg" : ""}`}
                        >
                          <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div {...provided.dragHandleProps} className="cursor-grab hover:cursor-grabbing">
                                  <GripVertical className="h-4 w-4 text-gray-400" />
                                </div>
                                <CardTitle 
                                  className="text-base" 
                                  style={getSectionHeaderStyle(section)}
                                >
                                  {section.title}
                                </CardTitle>
                                {section.isCustom && (
                                  <Badge variant="outline" className="text-xs bg-blue-50">
                                    Custom
                                  </Badge>
                                )}
                              </div>
                              <div className="flex gap-2">
                                {/* Reorder Controls */}
                                <div className="flex gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => moveSectionUp(section.id)}
                                    disabled={index === 0}
                                    title="Move up"
                                  >
                                    <ChevronUp className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => moveSectionDown(section.id)}
                                    disabled={index === documentSections.length - 1}
                                    title="Move down"
                                  >
                                    <ChevronDown className="h-4 w-4" />
                                  </Button>
                                </div>
                                
                                {/* Header Formatting Controls */}
                                {editingSections.has(section.id) && (
                                  <div className="flex gap-1 mr-2">
                                    <Button
                                      variant={headerFormats[section.id]?.bold || section.headerFormat?.bold ? "default" : "outline"}
                                      size="sm"
                                      onClick={() => {
                                        const currentFormat = headerFormats[section.id] || section.headerFormat || {};
                                        updateHeaderFormat(section.id, { ...currentFormat, bold: !currentFormat.bold });
                                      }}
                                    >
                                      <Bold className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant={headerFormats[section.id]?.italic || section.headerFormat?.italic ? "default" : "outline"}
                                      size="sm"
                                      onClick={() => {
                                        const currentFormat = headerFormats[section.id] || section.headerFormat || {};
                                        updateHeaderFormat(section.id, { ...currentFormat, italic: !currentFormat.italic });
                                      }}
                                    >
                                      <Italic className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant={headerFormats[section.id]?.underline || section.headerFormat?.underline ? "default" : "outline"}
                                      size="sm"
                                      onClick={() => {
                                        const currentFormat = headerFormats[section.id] || section.headerFormat || {};
                                        updateHeaderFormat(section.id, { ...currentFormat, underline: !currentFormat.underline });
                                      }}
                                    >
                                      <Underline className="h-4 w-4" />
                                    </Button>
                                  </div>
                                )}
                                
                                {section.templateKey && (
                                  <Badge variant="secondary" className="text-xs">
                                    Template
                                  </Badge>
                                )}
                                
                                {section.isCustom && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => removeCustomSection(section.id)}
                                    className="text-red-600 hover:text-red-700"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
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
                    {/* Header Title Editing */}
                    {section.isCustom && (
                      <div>
                        <Label htmlFor={`title-${section.id}`} className="text-sm font-medium">
                          Section Title
                        </Label>
                        <Input
                          id={`title-${section.id}`}
                          value={section.title}
                          onChange={(e) => {
                            setCustomSections(prev => 
                              prev.map(s => s.id === section.id ? { ...s, title: e.target.value } : s)
                            );
                          }}
                          className="mb-2"
                        />
                      </div>
                    )}
                    
                    <div>
                      <Label htmlFor={`content-${section.id}`} className="text-sm font-medium">
                        Content
                      </Label>
                      <Textarea
                        id={`content-${section.id}`}
                        value={sectionContent[section.id] || section.content}
                        onChange={(e) => updateSectionContent(section.id, e.target.value)}
                        rows={Math.max(4, (sectionContent[section.id] || section.content).split('\n').length + 2)}
                        className="min-h-[100px]"
                      />
                    </div>
                    
                    <div className="flex justify-end space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleEditSection(section.id)}
                      >
                        Done Editing
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-muted p-4 rounded-md border">
                    <div className="space-y-2">
                      <div 
                        className="font-semibold text-sm"
                        style={getSectionHeaderStyle(section)}
                      >
                        {section.title}
                      </div>
                      <Separator />
                      <div className="whitespace-pre-wrap text-sm">
                        {sectionContent[section.id] || section.content}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!selectedDocumentType && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">Select a document type to start editing templates</p>
              <p className="text-sm text-gray-500 mt-2">
                Customize the standard content that applies to all RFPs of that type
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}