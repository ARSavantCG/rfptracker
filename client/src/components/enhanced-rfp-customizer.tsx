/**
 * Enhanced RFP Customizer - Advanced RFP Template Management
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// Removed Select import - using native HTML selects for consistency
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { 
  FileText, Save, Eye, Settings, Layout, Type, Columns, 
  Bold, Italic, Underline, Palette, AlignLeft, AlignCenter, 
  AlignRight, Plus, Trash2, Copy, RotateCcw, ChevronDown 
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface TableColumnSettings {
  description: number;
  quantity: number;
  unit: number;
  notes: number;
}

interface SpaceTableSettings {
  spaceType: number;
  area: number;
  notes: number;
}

interface RfpFormatSettings {
  tableColumns: {
    scopeOfWork: TableColumnSettings;
    spaceRequirements: SpaceTableSettings;
  };
  fonts: {
    headerSize: number;
    bodySize: number;
    tableHeaderSize: number;
    tableBodySize: number;
  };
  colors: {
    headerBackground: string;
    tableHeaderBackground: string;
    tableBorderColor: string;
    primaryAccent: string;
  };
  spacing: {
    sectionMargin: number;
    tableMargin: number;
    cellPadding: number;
  };
  layout: {
    pageMargins: string;
    tableLayout: 'auto' | 'fixed';
    headerAlignment: 'left' | 'center' | 'right';
  };
}

const DEFAULT_SETTINGS: RfpFormatSettings = {
  tableColumns: {
    scopeOfWork: {
      description: 30,
      quantity: 12,
      unit: 8,
      notes: 50
    },
    spaceRequirements: {
      spaceType: 30,
      area: 30,
      notes: 40
    }
  },
  fonts: {
    headerSize: 24,
    bodySize: 12,
    tableHeaderSize: 11,
    tableBodySize: 12
  },
  colors: {
    headerBackground: '#f8f9fa',
    tableHeaderBackground: '#f8f9fa',
    tableBorderColor: '#e5e7eb',
    primaryAccent: '#3b82f6'
  },
  spacing: {
    sectionMargin: 20,
    tableMargin: 15,
    cellPadding: 8
  },
  layout: {
    pageMargins: '1in',
    tableLayout: 'fixed',
    headerAlignment: 'left'
  }
};

export function EnhancedRfpCustomizer() {
  const [selectedDocumentType, setSelectedDocumentType] = useState<string>('contractor');
  const [formatSettings, setFormatSettings] = useState<RfpFormatSettings>(DEFAULT_SETTINGS);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Load current settings
  const { data: currentSettings, refetch: refetchSettings } = useQuery({
    queryKey: ['/api/rfp-format-settings'],
    queryFn: async () => {
      try {
        const response = await apiRequest('/api/rfp-format-settings');
        return response || DEFAULT_SETTINGS;
      } catch (error) {
        return DEFAULT_SETTINGS;
      }
    }
  });

  useEffect(() => {
    if (currentSettings) {
      setFormatSettings(currentSettings);
    }
  }, [currentSettings]);

  // Save settings mutation
  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: RfpFormatSettings) => {
      return await apiRequest('/api/rfp-format-settings', 'POST', settings);
    },
    onSuccess: () => {
      setUnsavedChanges(false);
      queryClient.invalidateQueries({ queryKey: ['/api/rfp-format-settings'] });
      toast({
        title: "Settings Saved",
        description: "RFP formatting settings have been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    },
  });

  // Generate preview mutation
  const generatePreviewMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('/api/rfp-preview', 'POST', {
        documentType: selectedDocumentType,
        formatSettings
      });
    },
    onSuccess: (data) => {
      setPreviewContent(data.html || '');
      setShowPreview(true);
    },
    onError: (error: any) => {
      toast({
        title: "Preview Error",
        description: error.message || "Failed to generate preview",
        variant: "destructive",
      });
    },
  });

  const updateTableColumn = (
    table: 'scopeOfWork' | 'spaceRequirements',
    column: string,
    value: number
  ) => {
    const newSettings = { ...formatSettings };
    (newSettings.tableColumns[table] as any)[column] = value;
    
    // Auto-adjust other columns to maintain 100% total
    if (table === 'scopeOfWork') {
      const total = Object.values(newSettings.tableColumns.scopeOfWork).reduce((sum, val) => sum + val, 0);
      if (total !== 100) {
        const remaining = 100 - value;
        const otherColumns = Object.keys(newSettings.tableColumns.scopeOfWork).filter(k => k !== column);
        const distribute = remaining / otherColumns.length;
        otherColumns.forEach(col => {
          (newSettings.tableColumns.scopeOfWork as any)[col] = Math.max(5, Math.round(distribute));
        });
      }
    }
    
    setFormatSettings(newSettings);
    setUnsavedChanges(true);
  };

  const resetToDefaults = () => {
    setFormatSettings(DEFAULT_SETTINGS);
    setUnsavedChanges(true);
  };

  const handleSave = () => {
    saveSettingsMutation.mutate(formatSettings);
  };

  const handlePreview = () => {
    generatePreviewMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Enhanced RFP Customizer</h2>
          <p className="text-muted-foreground">
            Customize table layouts, fonts, colors, and formatting for all RFP documents
          </p>
        </div>
        <div className="flex gap-2">
          {unsavedChanges && (
            <Badge variant="outline" className="text-orange-600 border-orange-600">
              Unsaved Changes
            </Badge>
          )}
          <Button variant="outline" onClick={resetToDefaults}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset to Defaults
          </Button>
          <Button variant="outline" onClick={handlePreview} disabled={generatePreviewMutation.isPending}>
            <Eye className="h-4 w-4 mr-2" />
            Preview
          </Button>
          <Button onClick={handleSave} disabled={saveSettingsMutation.isPending}>
            <Save className="h-4 w-4 mr-2" />
            Save Settings
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Document Type Selector */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Document Type Preview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <select
                value={selectedDocumentType}
                onChange={(e) => setSelectedDocumentType(e.target.value)}
                className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="">Select document type for preview</option>
                <option value="contractor">Contractor RFP</option>
                <option value="architect">Architect RFP</option>
                <option value="broker-contractor">Broker-Contractor RFP</option>
                <option value="broker-architect">Broker-Architect RFP</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </CardContent>
        </Card>

        {/* Table Column Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Columns className="h-5 w-5" />
              Table Column Widths
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Scope of Work Table */}
            <div>
              <h4 className="font-semibold mb-3">Scope of Work Table</h4>
              <div className="space-y-3">
                <div>
                  <Label className="text-sm">Description ({formatSettings.tableColumns.scopeOfWork.description}%)</Label>
                  <Slider
                    value={[formatSettings.tableColumns.scopeOfWork.description]}
                    onValueChange={([value]) => updateTableColumn('scopeOfWork', 'description', value)}
                    max={60}
                    min={15}
                    step={1}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm">Quantity ({formatSettings.tableColumns.scopeOfWork.quantity}%)</Label>
                  <Slider
                    value={[formatSettings.tableColumns.scopeOfWork.quantity]}
                    onValueChange={([value]) => updateTableColumn('scopeOfWork', 'quantity', value)}
                    max={25}
                    min={8}
                    step={1}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm">Unit ({formatSettings.tableColumns.scopeOfWork.unit}%)</Label>
                  <Slider
                    value={[formatSettings.tableColumns.scopeOfWork.unit]}
                    onValueChange={([value]) => updateTableColumn('scopeOfWork', 'unit', value)}
                    max={20}
                    min={5}
                    step={1}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm">Notes ({formatSettings.tableColumns.scopeOfWork.notes}%)</Label>
                  <Slider
                    value={[formatSettings.tableColumns.scopeOfWork.notes]}
                    onValueChange={([value]) => updateTableColumn('scopeOfWork', 'notes', value)}
                    max={70}
                    min={20}
                    step={1}
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Space Requirements Table */}
            <div>
              <h4 className="font-semibold mb-3">Space Requirements Table</h4>
              <div className="space-y-3">
                <div>
                  <Label className="text-sm">Space Type ({formatSettings.tableColumns.spaceRequirements.spaceType}%)</Label>
                  <Slider
                    value={[formatSettings.tableColumns.spaceRequirements.spaceType]}
                    onValueChange={([value]) => {
                      const newSettings = { ...formatSettings };
                      newSettings.tableColumns.spaceRequirements.spaceType = value;
                      setFormatSettings(newSettings);
                      setUnsavedChanges(true);
                    }}
                    max={50}
                    min={20}
                    step={1}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm">Area ({formatSettings.tableColumns.spaceRequirements.area}%)</Label>
                  <Slider
                    value={[formatSettings.tableColumns.spaceRequirements.area]}
                    onValueChange={([value]) => {
                      const newSettings = { ...formatSettings };
                      newSettings.tableColumns.spaceRequirements.area = value;
                      setFormatSettings(newSettings);
                      setUnsavedChanges(true);
                    }}
                    max={50}
                    min={20}
                    step={1}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm">Notes ({formatSettings.tableColumns.spaceRequirements.notes}%)</Label>
                  <Slider
                    value={[formatSettings.tableColumns.spaceRequirements.notes]}
                    onValueChange={([value]) => {
                      const newSettings = { ...formatSettings };
                      newSettings.tableColumns.spaceRequirements.notes = value;
                      setFormatSettings(newSettings);
                      setUnsavedChanges(true);
                    }}
                    max={60}
                    min={20}
                    step={1}
                    className="mt-1"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Typography Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Type className="h-5 w-5" />
              Typography & Fonts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm">Header Size ({formatSettings.fonts.headerSize}px)</Label>
              <Slider
                value={[formatSettings.fonts.headerSize]}
                onValueChange={([value]) => {
                  const newSettings = { ...formatSettings };
                  newSettings.fonts.headerSize = value;
                  setFormatSettings(newSettings);
                  setUnsavedChanges(true);
                }}
                max={36}
                min={16}
                step={1}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Body Text Size ({formatSettings.fonts.bodySize}px)</Label>
              <Slider
                value={[formatSettings.fonts.bodySize]}
                onValueChange={([value]) => {
                  const newSettings = { ...formatSettings };
                  newSettings.fonts.bodySize = value;
                  setFormatSettings(newSettings);
                  setUnsavedChanges(true);
                }}
                max={16}
                min={9}
                step={1}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Table Header Size ({formatSettings.fonts.tableHeaderSize}px)</Label>
              <Slider
                value={[formatSettings.fonts.tableHeaderSize]}
                onValueChange={([value]) => {
                  const newSettings = { ...formatSettings };
                  newSettings.fonts.tableHeaderSize = value;
                  setFormatSettings(newSettings);
                  setUnsavedChanges(true);
                }}
                max={14}
                min={8}
                step={1}
                className="mt-1"
              />
            </div>
          </CardContent>
        </Card>

        {/* Color & Layout Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Colors & Layout
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm">Table Header Background</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="color"
                  value={formatSettings.colors.tableHeaderBackground}
                  onChange={(e) => {
                    const newSettings = { ...formatSettings };
                    newSettings.colors.tableHeaderBackground = e.target.value;
                    setFormatSettings(newSettings);
                    setUnsavedChanges(true);
                  }}
                  className="w-12 h-8 p-1 border rounded"
                />
                <Input
                  value={formatSettings.colors.tableHeaderBackground}
                  onChange={(e) => {
                    const newSettings = { ...formatSettings };
                    newSettings.colors.tableHeaderBackground = e.target.value;
                    setFormatSettings(newSettings);
                    setUnsavedChanges(true);
                  }}
                  placeholder="#f8f9fa"
                />
              </div>
            </div>
            <div>
              <Label className="text-sm">Table Border Color</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="color"
                  value={formatSettings.colors.tableBorderColor}
                  onChange={(e) => {
                    const newSettings = { ...formatSettings };
                    newSettings.colors.tableBorderColor = e.target.value;
                    setFormatSettings(newSettings);
                    setUnsavedChanges(true);
                  }}
                  className="w-12 h-8 p-1 border rounded"
                />
                <Input
                  value={formatSettings.colors.tableBorderColor}
                  onChange={(e) => {
                    const newSettings = { ...formatSettings };
                    newSettings.colors.tableBorderColor = e.target.value;
                    setFormatSettings(newSettings);
                    setUnsavedChanges(true);
                  }}
                  placeholder="#e5e7eb"
                />
              </div>
            </div>
            <div>
              <Label className="text-sm">Cell Padding ({formatSettings.spacing.cellPadding}px)</Label>
              <Slider
                value={[formatSettings.spacing.cellPadding]}
                onValueChange={([value]) => {
                  const newSettings = { ...formatSettings };
                  newSettings.spacing.cellPadding = value;
                  setFormatSettings(newSettings);
                  setUnsavedChanges(true);
                }}
                max={16}
                min={4}
                step={1}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Header Alignment</Label>
              <Select
                value={formatSettings.layout.headerAlignment}
                onValueChange={(value: 'left' | 'center' | 'right') => {
                  const newSettings = { ...formatSettings };
                  newSettings.layout.headerAlignment = value;
                  setFormatSettings(newSettings);
                  setUnsavedChanges(true);
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">Left</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="right">Right</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold">RFP Preview - {selectedDocumentType}</h3>
              <Button variant="outline" onClick={() => setShowPreview(false)}>
                Close Preview
              </Button>
            </div>
            <div className="p-4 overflow-auto max-h-[70vh]">
              <div 
                dangerouslySetInnerHTML={{ __html: previewContent }} 
                className="prose max-w-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}