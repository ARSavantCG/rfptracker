import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
// Removed Select import - using native HTML selects for consistency
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { FormulaInput } from "@/components/formula-input";
import { evaluateFormula } from "@shared/formula-utils";
import { Plus, Edit2, Trash2, Package, DollarSign, ChevronDown, ChevronRight, Upload, FileText, X, Edit3, Check, Printer, Download } from "lucide-react";

interface RomScopeItem {
  id: number;
  category: string;
  name: string;
  description: string | null;
  unit: string;
  unitPrice: string;
  minimumCost?: string | null;
  hasMinimumCost?: boolean | null;
  csiDivision?: string | null; // CSI Division for grouping (e.g., "26 - Electrical")
  csiCode?: string | null; // Specific CSI code (e.g., "26 05 00")
  source: string | null;
  lastUpdated: string | null;
  isActive: boolean;
  attachments: Array<{
    id: string;
    fileName: string;
    filePath: string;
    uploadedAt: string;
  }>;
  referencePricing?: Array<{
    contractorName: string;
    price: string;
    date: string;
  }>;
  itemGroup?: string | null; // For tiered pricing - groups related tiers
  minSquareFootage?: number | null; // Minimum square footage for this tier
  maxSquareFootage?: number | null; // Maximum square footage for this tier
  createdAt: string;
  updatedAt: string;
}

interface RomScopeItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RomScopeItemsModal({ isOpen, onClose }: RomScopeItemsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Check if user has admin permissions for ROM scope management
  const canDeleteRomScope = user?.permissions?.includes('admin.access') || false;
  
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState<RomScopeItem | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    category: "",
    name: "",
    description: "",
    unit: "",
    unitPrice: "",
    minimumCost: "",
    hasMinimumCost: false,
    csiDivision: "",
    csiCode: "",
    source: "",
    lastUpdated: "",
    includeByDefault: false,
    itemGroup: "", // Tiered pricing group name
    minSquareFootage: "", // Minimum square footage for tier
    maxSquareFootage: "", // Maximum square footage for tier
    attachments: [] as Array<{
      id: string;
      fileName: string;
      filePath: string;
      uploadedAt: string;
    }>,
    referencePricing: [] as Array<{
      contractorName: string;
      price: string;
      date: string;
    }>,
  });

  const [fileUploadInputs, setFileUploadInputs] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editingFileName, setEditingFileName] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [collapsedCsiDivisions, setCollapsedCsiDivisions] = useState<Set<string>>(new Set());
  const [isAddingReferencePrice, setIsAddingReferencePrice] = useState(false);
  const [newReferencePrice, setNewReferencePrice] = useState({
    contractorName: "",
    price: "",
    date: new Date().toISOString().split('T')[0],
  });

  // Fetch scope items
  const { data: scopeItems = [], isLoading } = useQuery<RomScopeItem[]>({
    queryKey: ["/api/rom-scope-items"],
    enabled: isOpen,
    staleTime: 1000, // Quick refresh for latest data
  });

  // Categories for organization
  const categories = [
    "Tenant Improvements",
    "Design / Soft Costs / Other Fees"
  ];

  // Units for pricing
  const units = [
    "sf.", "lf.", "ls.", "ea.", "$", "%"
  ];

  // CSI MasterFormat 2020 Divisions (used for Tenant Improvements grouping)
  const csiDivisions = [
    "03 - Concrete",
    "04 - Masonry",
    "05 - Metals",
    "06 - Wood, Plastics, and Composites",
    "07 - Thermal and Moisture Protection",
    "08 - Openings",
    "09 - Finishes",
    "10 - Specialties",
    "11 - Equipment",
    "12 - Furnishings",
    "13 - Special Construction",
    "14 - Conveying Equipment",
    "21 - Fire Suppression",
    "22 - Plumbing",
    "23 - HVAC",
    "26 - Electrical",
    "27 - Communications",
    "28 - Electronic Safety and Security",
    "31 - Earthwork",
    "32 - Exterior Improvements",
    "33 - Utilities",
  ];

  // File handling functions
  const handleFileSelect = (files: FileList | null) => {
    if (files) {
      const newFiles = Array.from(files);
      setFileUploadInputs(prev => [...prev, ...newFiles]);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files) {
      handleFileSelect(files);
    }
  };

  const removeFileInput = (index: number) => {
    setFileUploadInputs(prev => prev.filter((_, i) => i !== index));
  };

  const removeExistingFile = (fileId: string) => {
    setFormData(prev => ({
      ...prev,
      attachments: prev.attachments.filter(file => file.id !== fileId)
    }));
  };

  // File renaming helpers
  const startEditingFile = (fileId: string, currentName: string) => {
    setEditingFileId(fileId);
    setEditingFileName(currentName);
  };

  const saveFileRename = () => {
    if (editingFileId && editingFileName.trim()) {
      const updatedAttachments = formData.attachments.map(att =>
        att.id === editingFileId ? { ...att, fileName: editingFileName.trim() } : att
      );
      setFormData({ ...formData, attachments: updatedAttachments });
    }
    setEditingFileId(null);
    setEditingFileName("");
  };

  const cancelFileRename = () => {
    setEditingFileId(null);
    setEditingFileName("");
  };

  // Category collapse helpers
  const toggleCategory = (category: string) => {
    const newCollapsed = new Set(collapsedCategories);
    if (newCollapsed.has(category)) {
      newCollapsed.delete(category);
    } else {
      newCollapsed.add(category);
    }
    setCollapsedCategories(newCollapsed);
  };

  // CSI Division collapse helpers
  const toggleCsiDivision = (division: string) => {
    const newCollapsed = new Set(collapsedCsiDivisions);
    if (newCollapsed.has(division)) {
      newCollapsed.delete(division);
    } else {
      newCollapsed.add(division);
    }
    setCollapsedCsiDivisions(newCollapsed);
  };

  // Group Tenant Improvements by CSI Division
  const groupItemsByCsiDivision = (items: RomScopeItem[]) => {
    const grouped: Record<string, RomScopeItem[]> = {};
    items.forEach(item => {
      const division = item.csiDivision || "General (No CSI Division)";
      if (!grouped[division]) {
        grouped[division] = [];
      }
      grouped[division].push(item);
    });
    // Sort by CSI Division number (extract first number)
    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      const numA = parseInt(a.match(/^\d+/)?.[0] || "999");
      const numB = parseInt(b.match(/^\d+/)?.[0] || "999");
      return numA - numB;
    });
    const sortedGrouped: Record<string, RomScopeItem[]> = {};
    sortedKeys.forEach(key => {
      sortedGrouped[key] = grouped[key].sort((a, b) => a.name.localeCompare(b.name));
    });
    return sortedGrouped;
  };

  // Reference pricing helpers
  const startAddingReferencePrice = () => {
    setIsAddingReferencePrice(true);
    setNewReferencePrice({
      contractorName: "",
      price: "",
      date: new Date().toISOString().split('T')[0],
    });
  };

  const cancelAddReferencePrice = () => {
    setIsAddingReferencePrice(false);
    setNewReferencePrice({
      contractorName: "",
      price: "",
      date: new Date().toISOString().split('T')[0],
    });
  };

  const saveReferencePrice = () => {
    if (!newReferencePrice.contractorName || !newReferencePrice.price || !newReferencePrice.date) {
      toast({
        title: "Error",
        description: "Please fill in all reference pricing fields",
        variant: "destructive",
        duration: 4000,
      });
      return;
    }

    setFormData(prev => ({
      ...prev,
      referencePricing: [...prev.referencePricing, newReferencePrice]
    }));
    
    setIsAddingReferencePrice(false);
    setNewReferencePrice({
      contractorName: "",
      price: "",
      date: new Date().toISOString().split('T')[0],
    });
  };

  const removeReferencePrice = (index: number) => {
    setFormData(prev => ({
      ...prev,
      referencePricing: prev.referencePricing.filter((_, i) => i !== index)
    }));
  };

  // Print function - opens in new tab like other reports
  const handlePrint = () => {
    const printContent = generateScopeItemsPrintHtml(scopeItems);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
    }
  };

  // Generate print HTML with Bridge Industrial styling
  const generateScopeItemsPrintHtml = (items: RomScopeItem[]) => {
    const itemsByCategory = items.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {} as Record<string, RomScopeItem[]>);

    // Sort items alphabetically within each category
    Object.keys(itemsByCategory).forEach(category => {
      itemsByCategory[category].sort((a, b) => a.name.localeCompare(b.name));
    });

    const currentDate = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric'
    });

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>ROM Scope Items Library</title>
        <style>
          @page {
            size: A4;
            margin: 0.5in;
          }
          
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
          
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 10px;
            line-height: 1.4;
            color: #1f2937;
            margin: 0;
            padding: 0;
          }
          
          .header {
            border-bottom: 3px solid rgb(0,50,130);
            padding-bottom: 20px;
            margin-bottom: 30px;
          }
          
          .document-title {
            font-size: 24px;
            font-weight: bold;
            background: rgb(0,50,130);
            color: white;
            padding: 10px;
            border-radius: 5px;
            text-align: center;
            margin-bottom: 10px;
          }
          
          .project-title {
            font-size: 14px;
            color: #666;
            text-align: center;
            margin-bottom: 20px;
          }
          
          .category-section {
            margin-bottom: 25px;
            break-inside: avoid;
          }
          
          .category-header {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            padding: 8px 12px;
            font-weight: bold;
            color: #374151;
            border-radius: 5px 5px 0 0;
            font-size: 11px;
          }
          
          .category-table {
            width: 100%;
            border-collapse: collapse;
            border: 1px solid #e5e7eb;
            border-top: none;
            margin-bottom: 20px;
          }
          
          .category-table th {
            background: #f3f4f6;
            font-weight: bold;
            padding: 8px;
            text-align: left;
            border-bottom: 1px solid #d1d5db;
            font-size: 9px;
            color: #374151;
          }
          
          .category-table td {
            padding: 6px 8px;
            border-bottom: 1px solid #e5e7eb;
            font-size: 9px;
            vertical-align: top;
          }
          
          .category-table tr:nth-child(even) {
            background: #f9fafb;
          }
          
          .item-name {
            font-weight: 500;
            color: #1f2937;
          }
          
          .item-price {
            font-weight: 500;
            color: #059669;
            text-align: right;
          }
          
          .item-date {
            color: #6b7280;
            font-size: 8px;
          }
          
          .has-file {
            color: #2563eb;
            font-weight: bold;
            text-align: center;
          }
          
          .no-file {
            color: #9ca3af;
            text-align: center;
          }
          
          .footer {
            position: fixed;
            bottom: 0.5in;
            left: 0.5in;
            right: 0.5in;
            text-align: center;
            font-size: 8px;
            color: #6b7280;
            border-top: 1px solid #e5e7eb;
            padding-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="document-title">ROM PILOT SCOPE ITEMS LIBRARY</div>
          <div class="project-title">Bridge Industrial - Construction Cost Management</div>
          <div class="project-title">Generated on ${currentDate}</div>
        </div>
        
        ${Object.entries(itemsByCategory).map(([category, categoryItems]) => `
          <div class="category-section">
            <div class="category-header">
              ${category} (${categoryItems.length} item${categoryItems.length !== 1 ? 's' : ''})
            </div>
            <table class="category-table">
              <thead>
                <tr>
                  <th style="width: 30%; text-align: left;">Item Name</th>
                  <th style="width: 15%; text-align: center;">Cost per Unit</th>
                  <th style="width: 12%; text-align: center;">Last Updated</th>
                  <th style="width: 8%; text-align: center;">File(s)</th>
                  <th style="width: 15%; text-align: center;">Source</th>
                  <th style="width: 20%; text-align: center;">Notes</th>
                </tr>
              </thead>
              <tbody>
                ${categoryItems.map(item => {
                  const result = evaluateFormula(item.unitPrice);
                  const displayValue = result.value !== null ? result.value.toFixed(2) : parseFloat(item.unitPrice || "0").toFixed(2);
                  const formattedPrice = parseFloat(displayValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  
                  // Use created date if no lastUpdated, otherwise use lastUpdated
                  const lastUpdated = item.lastUpdated ? 
                    new Date(item.lastUpdated).toLocaleDateString() : 
                    new Date(item.createdAt).toLocaleDateString();
                  
                  const hasFiles = item.attachments && item.attachments.length > 0;
                  
                  return `
                    <tr>
                      <td class="item-name">${item.name}</td>
                      <td class="item-price" style="text-align: center;">$${formattedPrice} per ${item.unit}</td>
                      <td class="item-date" style="text-align: center;">${lastUpdated}</td>
                      <td class="${hasFiles ? 'has-file' : 'no-file'}" style="text-align: center;">
                        ${hasFiles ? 'Yes' : 'No'}
                      </td>
                      <td style="text-align: center;">${item.source || '—'}</td>
                      <td style="text-align: center;">${item.description || '—'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `).join('')}
        
        <div class="footer">
          © ${new Date().getFullYear()} Bridge Industrial - ROM Scope Items Library
        </div>
      </body>
      </html>
    `;
  };

  // Download existing file
  const handleDownloadFile = (fileName: string, filePath: string) => {
    const link = document.createElement('a');
    link.href = `/api/rom-scope-items/download/${encodeURIComponent(fileName)}?path=${encodeURIComponent(filePath)}`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Create/Update mutations
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      // Handle file uploads first if any
      const uploadedFiles = [];
      for (const file of fileUploadInputs) {
        const formData = new FormData();
        formData.append('file', file);
        
        const uploadResponse = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
        
        if (uploadResponse.ok) {
          const fileData = await uploadResponse.json();
          uploadedFiles.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            fileName: file.name,
            filePath: fileData.filePath,
            uploadedAt: new Date().toISOString(),
          });
        }
      }
      
      // Include uploaded files in the data
      const dataWithFiles = {
        ...data,
        attachments: [...(data.attachments || []), ...uploadedFiles]
      };
      
      return apiRequest("/api/rom-scope-items", "POST", dataWithFiles);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rom-scope-items"] });
      resetForm();
      toast({
        title: "Success",
        description: "Scope item created successfully",
        duration: 4000,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create scope item",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      // Handle file uploads first if any
      const uploadedFiles = [];
      for (const file of fileUploadInputs) {
        const formData = new FormData();
        formData.append('file', file);
        
        const uploadResponse = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
        
        if (uploadResponse.ok) {
          const fileData = await uploadResponse.json();
          uploadedFiles.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            fileName: file.name,
            filePath: fileData.filePath,
            uploadedAt: new Date().toISOString(),
          });
        }
      }
      
      // Include uploaded files in the data
      const dataWithFiles = {
        ...data,
        attachments: [...(data.attachments || []), ...uploadedFiles]
      };
      
      return apiRequest(`/api/rom-scope-items/${id}`, "PUT", dataWithFiles);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rom-scope-items"] });
      resetForm();
      toast({
        title: "Success",
        description: "Scope item updated successfully",
        duration: 4000,
      });
    },
    onError: () => {
      toast({
        title: "Error", 
        description: "Failed to update scope item",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/rom-scope-items/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rom-scope-items"] });
      toast({
        title: "Success",
        description: "Scope item deleted successfully",
        duration: 4000,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete scope item",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const resetForm = () => {
    setFormData({
      category: "",
      name: "",
      description: "",
      unit: "",
      unitPrice: "",
      minimumCost: "",
      hasMinimumCost: false,
      csiDivision: "",
      csiCode: "",
      source: "",
      lastUpdated: "",
      includeByDefault: false,
      itemGroup: "",
      minSquareFootage: "",
      maxSquareFootage: "",
      attachments: [],
      referencePricing: [],
    });
    setFileUploadInputs([]);
    setShowAddForm(false);
    setEditingItem(null);
    setIsAddingReferencePrice(false);
    setNewReferencePrice({
      contractorName: "",
      price: "",
      date: new Date().toISOString().split('T')[0],
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.category || !formData.unit || !formData.unitPrice) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
        duration: 6000,
      });
      return;
    }

    // Validate minimum cost if enabled
    if (formData.hasMinimumCost && !formData.minimumCost) {
      toast({
        title: "Error",
        description: "Please enter a minimum cost or disable the minimum cost option",
        variant: "destructive",
        duration: 6000,
      });
      return;
    }

    // For formula inputs, we store the raw value (which could be a formula or a number)
    const submitData = {
      ...formData,
      unitPrice: formData.unitPrice, // Keep the raw value (formula or number)
      minimumCost: formData.hasMinimumCost ? formData.minimumCost : null,
      itemGroup: formData.itemGroup || null,
      minSquareFootage: formData.minSquareFootage ? parseInt(formData.minSquareFootage) : null,
      maxSquareFootage: formData.maxSquareFootage ? parseInt(formData.maxSquareFootage) : null,
      lastUpdated: new Date(), // Always set to current date when saving
    };

    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, ...submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const handleEdit = (item: RomScopeItem) => {
    setFormData({
      category: item.category,
      name: item.name,
      description: item.description || "",
      unit: item.unit,
      unitPrice: item.unitPrice,
      minimumCost: item.minimumCost || "",
      hasMinimumCost: item.hasMinimumCost || false,
      csiDivision: item.csiDivision || "",
      csiCode: item.csiCode || "",
      source: item.source || "",
      lastUpdated: item.lastUpdated ? new Date(item.lastUpdated).toISOString().split('T')[0] : "",
      includeByDefault: (item as any).includeByDefault || false,
      itemGroup: item.itemGroup || "",
      minSquareFootage: item.minSquareFootage?.toString() || "",
      maxSquareFootage: item.maxSquareFootage?.toString() || "",
      attachments: item.attachments || [],
      referencePricing: item.referencePricing || [],
    });
    setFileUploadInputs([]);
    setEditingItem(item);
    setShowAddForm(false); // Disable top form when using inline editing
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this scope item?")) {
      deleteMutation.mutate(id);
    }
  };

  // Group items by category and sort alphabetically by name
  const itemsByCategory = scopeItems.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, RomScopeItem[]>);

  // Sort items alphabetically within each category
  Object.keys(itemsByCategory).forEach(category => {
    itemsByCategory[category].sort((a, b) => a.name.localeCompare(b.name));
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Package className="h-5 w-5" />
            <span>ROM Scope Items Management</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Add/Edit Form */}
          {showAddForm && (
            <div className="border rounded-lg p-4 bg-gray-50">
              <h3 className="text-lg font-medium mb-4">
                {editingItem ? "Edit Scope Item" : "Add New Scope Item"}
              </h3>
              
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="category">Category *</Label>
                    <div className="relative">
                      <select
                        value={formData.category}
                        onChange={(e) => setFormData({...formData, category: e.target.value})}
                        className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      >
                        <option value="">Select category</option>
                        {categories.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="name">Item Name *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    rows={2}
                  />
                </div>

                {/* CSI Division and Code - Only show for Tenant Improvements */}
                {formData.category === "Tenant Improvements" && (
                  <div className="grid grid-cols-2 gap-4 p-3 bg-blue-50 rounded-md border border-blue-200">
                    <div className="space-y-2">
                      <Label htmlFor="csiDivision">CSI Division</Label>
                      <div className="relative">
                        <select
                          value={formData.csiDivision}
                          onChange={(e) => setFormData({...formData, csiDivision: e.target.value})}
                          className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        >
                          <option value="">No Division (General)</option>
                          {csiDivisions.map((div) => (
                            <option key={div} value={div}>{div}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      </div>
                      <p className="text-xs text-gray-500">Group this item by CSI MasterFormat Division</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="csiCode">CSI Code</Label>
                      <Input
                        id="csiCode"
                        value={formData.csiCode}
                        onChange={(e) => setFormData({...formData, csiCode: e.target.value})}
                        placeholder="e.g., 26 05 00"
                      />
                      <p className="text-xs text-gray-500">Optional specific CSI code for this item</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="unit">Unit *</Label>
                    <div className="relative">
                      <select
                        value={formData.unit}
                        onChange={(e) => setFormData({...formData, unit: e.target.value})}
                        className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      >
                        <option value="">Select unit</option>
                        {units.map((unit) => (
                          <option key={unit} value={unit}>{unit}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="unitPrice">Unit Price *</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 z-10" />
                      <FormulaInput
                        value={formData.unitPrice}
                        onChange={(rawValue, evaluatedValue) => {
                          setFormData({...formData, unitPrice: rawValue.toString()});
                        }}
                        className="pl-10"
                        decimalPlaces={2}
                        formatThousands={true}
                      />
                    </div>
                  </div>
                </div>

                {/* Minimum Cost Section */}
                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="hasMinimumCost"
                      checked={formData.hasMinimumCost}
                      onChange={(e) => setFormData({...formData, hasMinimumCost: e.target.checked})}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <Label htmlFor="hasMinimumCost" className="text-sm font-medium text-gray-700">
                      Enable minimum cost (e.g., architectural services minimum $15,000)
                    </Label>
                  </div>
                  
                  {formData.hasMinimumCost && (
                    <div className="space-y-2">
                      <Label htmlFor="minimumCost">Minimum Cost *</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 z-10" />
                        <FormulaInput
                          value={formData.minimumCost}
                          onChange={(rawValue, evaluatedValue) => {
                            setFormData({...formData, minimumCost: rawValue.toString()});
                          }}
                          className="pl-10"
                          decimalPlaces={2}
                          formatThousands={true}
                        />
                      </div>
                      <p className="text-xs text-gray-500">
                        Total cost will never be less than this amount, regardless of quantity × unit price
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="source">Source</Label>
                    <Input
                      id="source"
                      value={formData.source}
                      onChange={(e) => setFormData({...formData, source: e.target.value})}
                      onKeyDown={(e) => {
                        if (e.key === 'Tab' && !e.shiftKey) {
                          e.preventDefault();
                          const lastUpdatedInput = document.querySelector('input[id="lastUpdated"]') as HTMLInputElement;
                          if (lastUpdatedInput) {
                            lastUpdatedInput.focus();
                            lastUpdatedInput.select();
                          }
                        }
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="includeByDefault"
                        checked={formData.includeByDefault}
                        onChange={(e) => setFormData({...formData, includeByDefault: e.target.checked})}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <Label htmlFor="includeByDefault" className="text-sm font-medium text-gray-700">
                        Include by default in ROMs and RFP Evaluations
                      </Label>
                    </div>
                    <p className="text-xs text-gray-500">
                      When checked, this item will automatically be added to new ROM pilots and RFP evaluations
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lastUpdated">Last Updated</Label>
                    <Input
                      id="lastUpdated"
                      type="date"
                      value={new Date().toISOString().split('T')[0]}
                      readOnly
                      className="bg-gray-100 cursor-not-allowed"
                      onKeyDown={(e) => {
                        if (e.key === 'Tab' && e.shiftKey) {
                          e.preventDefault();
                          const sourceInput = document.querySelector('input[id="source"]') as HTMLInputElement;
                          if (sourceInput) {
                            sourceInput.focus();
                            sourceInput.select();
                          }
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Tiered Pricing Section */}
                <div className="space-y-4 pt-4 border-t">
                  <div className="flex items-center space-x-2">
                    <Label className="text-sm font-semibold">Tiered Pricing (Optional)</Label>
                    <p className="text-xs text-gray-500">
                      Use for items with different pricing based on square footage tiers
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="itemGroup">Item Group</Label>
                      <Input
                        id="itemGroup"
                        data-testid="input-itemGroup"
                        placeholder="e.g., Office Area"
                        value={formData.itemGroup}
                        onChange={(e) => setFormData({...formData, itemGroup: e.target.value})}
                      />
                      <p className="text-xs text-gray-500">
                        Groups related tiers together
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="minSquareFootage">Min Square Footage</Label>
                      <Input
                        id="minSquareFootage"
                        data-testid="input-minSquareFootage"
                        type="number"
                        placeholder="e.g., 3001"
                        value={formData.minSquareFootage}
                        onChange={(e) => setFormData({...formData, minSquareFootage: e.target.value})}
                      />
                      <p className="text-xs text-gray-500">
                        Leave blank for no minimum
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="maxSquareFootage">Max Square Footage</Label>
                      <Input
                        id="maxSquareFootage"
                        data-testid="input-maxSquareFootage"
                        type="number"
                        placeholder="e.g., 5000"
                        value={formData.maxSquareFootage}
                        onChange={(e) => setFormData({...formData, maxSquareFootage: e.target.value})}
                      />
                      <p className="text-xs text-gray-500">
                        Leave blank for no maximum
                      </p>
                    </div>
                  </div>
                </div>

                {/* File Attachments Section */}
                <div className="space-y-4 pt-4 border-t">
                  <div className="space-y-2">
                    <Label htmlFor="attachments">Attachments</Label>
                    <div 
                      className={`border-2 border-dashed rounded-lg p-4 transition-colors ${
                        isDragging 
                          ? 'border-blue-500 bg-blue-50' 
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <div className="text-center">
                        <Upload className={`h-8 w-8 mx-auto mb-2 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
                        <input
                          type="file"
                          multiple
                          onChange={(e) => handleFileSelect(e.target.files)}
                          className="hidden"
                          id="file-upload"
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png"
                        />
                        <Label 
                          htmlFor="file-upload" 
                          className="cursor-pointer text-sm text-blue-600 hover:text-blue-700"
                        >
                          Choose files or drag and drop
                        </Label>
                        <p className="text-xs text-gray-500 mt-1">
                          Specifications, drawings, or related documents
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* New file uploads */}
                  {fileUploadInputs.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Files to upload:</p>
                      {fileUploadInputs.map((file, index) => (
                        <div key={index} className="flex items-center justify-between bg-blue-50 p-2 rounded">
                          <div className="flex items-center space-x-2 flex-1">
                            <FileText className="h-4 w-4 text-blue-600" />
                            <input
                              type="text"
                              value={file.name}
                              onChange={(e) => {
                                const newFiles = [...fileUploadInputs];
                                // Create a new file with the new name
                                const newFile = new File([file], e.target.value, { type: file.type });
                                newFiles[index] = newFile;
                                setFileUploadInputs(newFiles);
                              }}
                              className="text-sm bg-transparent border-none outline-none flex-1"
                              placeholder="Enter file name"
                            />
                            <span className="text-xs text-gray-500">
                              ({(file.size / 1024).toFixed(1)} KB)
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFileInput(index)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Existing attachments */}
                  {formData.attachments.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Current attachments:</p>
                      {formData.attachments.map((file) => (
                        <div key={file.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                          <div className="flex items-center space-x-2 flex-1">
                            <FileText className="h-4 w-4 text-gray-600" />
                            
                            {editingFileId === file.id ? (
                              // Edit mode
                              <div className="flex items-center space-x-2 flex-1">
                                <input
                                  type="text"
                                  value={editingFileName}
                                  onChange={(e) => setEditingFileName(e.target.value)}
                                  className="text-sm bg-white border border-blue-300 rounded px-2 py-1 flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  placeholder="Enter file name"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveFileRename();
                                    if (e.key === 'Escape') cancelFileRename();
                                  }}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={saveFileRename}
                                  className="text-green-600 hover:text-green-700"
                                  title="Save"
                                >
                                  <Check className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={cancelFileRename}
                                  className="text-gray-500 hover:text-gray-700"
                                  title="Cancel"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              // View mode
                              <div className="flex items-center space-x-2 flex-1">
                                <span className="text-sm flex-1">{file.fileName}</span>
                                <span className="text-xs text-gray-500">
                                  (uploaded {new Date(file.uploadedAt).toLocaleDateString()})
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => startEditingFile(file.id, file.fileName)}
                                  className="text-blue-600 hover:text-blue-700"
                                  title="Rename file"
                                >
                                  <Edit3 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                          
                          {editingFileId !== file.id && (
                            <div className="flex items-center space-x-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDownloadFile(file.fileName, file.filePath)}
                                title="Download file"
                              >
                                <i className="fas fa-download h-3 w-3"></i>
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeExistingFile(file.id)}
                                title="Delete file"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-end space-x-3 pt-4 border-t">
                  <Button type="button" variant="outline" onClick={resetForm}>
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {editingItem ? "Update Item" : "Add Item"}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Header Actions */}
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Scope Items Library</h3>
              <p className="text-sm text-gray-500">
                Manage predefined scope items for ROM estimates
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Button 
                onClick={handlePrint}
                variant="outline"
                className="flex items-center space-x-2"
              >
                <Printer className="h-4 w-4" />
                <span>Print Library</span>
              </Button>
              <Button 
                onClick={() => setShowAddForm(true)}
                className="flex items-center space-x-2"
              >
                <Plus className="h-4 w-4" />
                <span>Add Item</span>
              </Button>
            </div>
          </div>

          {/* Items List */}
          {isLoading ? (
            <div className="text-center py-8">Loading scope items...</div>
          ) : scopeItems.length === 0 ? (
            <div className="text-center py-8">
              <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Scope Items</h3>
              <p className="text-gray-500 mb-4">Get started by adding your first scope item</p>
              <Button onClick={() => setShowAddForm(true)}>Add First Item</Button>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(itemsByCategory).map(([category, items]) => {
                const isCollapsed = collapsedCategories.has(category);
                return (
                  <div key={category} className="border rounded-lg">
                    <div 
                      className="bg-gray-50 px-4 py-3 border-b cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => toggleCategory(category)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900">{category}</h4>
                          <p className="text-sm text-gray-500">{items.length} item{items.length !== 1 ? 's' : ''}</p>
                        </div>
                        <div className="flex items-center">
                          {isCollapsed ? (
                            <ChevronRight className="h-5 w-5 text-gray-500" />
                          ) : (
                            <ChevronDown className="h-5 w-5 text-gray-500" />
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {!isCollapsed && (
                      <div className="divide-y">
                    {/* For Tenant Improvements, group by CSI Division */}
                    {category === "Tenant Improvements" ? (
                      Object.entries(groupItemsByCsiDivision(items)).map(([csiDivision, divisionItems]) => {
                        const isDivisionCollapsed = collapsedCsiDivisions.has(csiDivision);
                        return (
                          <div key={csiDivision} className="border-t first:border-t-0">
                            {/* CSI Division Header */}
                            <div 
                              className="bg-blue-50 px-4 py-2 cursor-pointer hover:bg-blue-100 transition-colors flex items-center justify-between"
                              onClick={() => toggleCsiDivision(csiDivision)}
                            >
                              <div className="flex items-center gap-2">
                                {isDivisionCollapsed ? (
                                  <ChevronRight className="h-4 w-4 text-blue-600" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-blue-600" />
                                )}
                                <span className="font-medium text-blue-800 text-sm">{csiDivision}</span>
                                <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                                  {divisionItems.length} item{divisionItems.length !== 1 ? 's' : ''}
                                </span>
                              </div>
                            </div>
                            {/* Division Items */}
                            {!isDivisionCollapsed && divisionItems.map((item) => (
                              <div key={item.id} className="pl-4 border-l-2 border-blue-200 ml-2">
                                {/* Item Display Row */}
                                <div className="p-3 flex justify-between items-center">
                                  <div className="flex-1">
                                    <div className="flex items-center space-x-3">
                                      <h5 className="font-medium text-gray-900">{item.name}</h5>
                                      {item.csiCode && (
                                        <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono">
                                          {item.csiCode}
                                        </span>
                                      )}
                                      <span className="text-sm text-gray-500 flex items-center space-x-1">
                                        <span>
                                          ${(() => {
                                            const result = evaluateFormula(item.unitPrice);
                                            const displayValue = result.value !== null ? result.value.toFixed(2) : parseFloat(item.unitPrice || "0").toFixed(2);
                                            return parseFloat(displayValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                          })()} per {item.unit}
                                          {item.unitPrice.startsWith('=') && (
                                            <span className="ml-1 text-xs text-blue-600">📊</span>
                                          )}
                                        </span>
                                        {item.hasMinimumCost && item.minimumCost && (
                                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                                            Min: ${parseFloat(item.minimumCost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </span>
                                        )}
                                        {item.attachments && item.attachments.length > 0 && (
                                          <button
                                            onClick={() => handleDownloadFile(item.attachments[0].fileName, item.attachments[0].filePath)}
                                            className="text-blue-600 hover:text-blue-800 transition-colors"
                                            title={`Download ${item.attachments[0].fileName}`}
                                          >
                                            <FileText className="h-4 w-4" />
                                          </button>
                                        )}
                                      </span>
                                    </div>
                                    {item.description && (
                                      <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                                    )}
                                  </div>
                                  
                                  <div className="flex space-x-2 ml-4">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        if (editingItem?.id === item.id) {
                                          setEditingItem(null);
                                          setShowAddForm(false);
                                        } else {
                                          handleEdit(item);
                                        }
                                      }}
                                    >
                                      {editingItem?.id === item.id ? (
                                        <X className="h-4 w-4" />
                                      ) : (
                                        <Edit2 className="h-4 w-4" />
                                      )}
                                    </Button>
                                    {canDeleteRomScope && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleDelete(item.id)}
                                        className="text-red-600 hover:text-red-700"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                </div>

                                {/* Inline Edit Form for CSI grouped items */}
                                {editingItem?.id === item.id && (
                                  <div className="border-t border-l-4 border-l-blue-500 bg-blue-50 p-4 m-3 rounded-md">
                                    <form onSubmit={handleSubmit} className="space-y-4">
                                      <div className="flex items-center justify-between mb-3">
                                        <h4 className="text-lg font-semibold text-gray-900">Edit: {item.name}</h4>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => {
                                            setEditingItem(null);
                                            setShowAddForm(false);
                                            resetForm();
                                          }}
                                        >
                                          <X className="h-4 w-4" />
                                        </Button>
                                      </div>
                                      {/* Use same form fields as the regular edit form - simplified version */}
                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                          <Label>Category *</Label>
                                          <div className="relative">
                                            <select
                                              value={formData.category}
                                              onChange={(e) => setFormData({...formData, category: e.target.value})}
                                              className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                            >
                                              <option value="">Select category</option>
                                              {categories.map((cat) => (
                                                <option key={cat} value={cat}>{cat}</option>
                                              ))}
                                            </select>
                                            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                          </div>
                                        </div>
                                        <div className="space-y-2">
                                          <Label>Name *</Label>
                                          <Input
                                            value={formData.name}
                                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                                          />
                                        </div>
                                      </div>
                                      {formData.category === "Tenant Improvements" && (
                                        <div className="grid grid-cols-2 gap-4 p-3 bg-white rounded-md border border-blue-200">
                                          <div className="space-y-2">
                                            <Label>CSI Division</Label>
                                            <div className="relative">
                                              <select
                                                value={formData.csiDivision}
                                                onChange={(e) => setFormData({...formData, csiDivision: e.target.value})}
                                                className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                              >
                                                <option value="">No Division (General)</option>
                                                {csiDivisions.map((div) => (
                                                  <option key={div} value={div}>{div}</option>
                                                ))}
                                              </select>
                                              <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                            </div>
                                          </div>
                                          <div className="space-y-2">
                                            <Label>CSI Code</Label>
                                            <Input
                                              value={formData.csiCode}
                                              onChange={(e) => setFormData({...formData, csiCode: e.target.value})}
                                              placeholder="e.g., 26 05 00"
                                            />
                                          </div>
                                        </div>
                                      )}
                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                          <Label>Unit *</Label>
                                          <div className="relative">
                                            <select
                                              value={formData.unit}
                                              onChange={(e) => setFormData({...formData, unit: e.target.value})}
                                              className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                            >
                                              <option value="">Select unit</option>
                                              {units.map((unit) => (
                                                <option key={unit} value={unit}>{unit}</option>
                                              ))}
                                            </select>
                                            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                          </div>
                                        </div>
                                        <div className="space-y-2">
                                          <Label>Unit Price *</Label>
                                          <div className="relative">
                                            <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 z-10" />
                                            <FormulaInput
                                              value={formData.unitPrice}
                                              onChange={(rawValue) => {
                                                setFormData({...formData, unitPrice: rawValue.toString()});
                                              }}
                                              className="pl-10"
                                              decimalPlaces={2}
                                              formatThousands={true}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                      {/* File Attachments Section - Inline Edit */}
                                      <div className="space-y-4 pt-4 border-t">
                                        <div className="space-y-2">
                                          <Label>Attachments</Label>
                                          <div 
                                            className={`border-2 border-dashed rounded-lg p-4 transition-colors ${
                                              isDragging 
                                                ? 'border-blue-500 bg-blue-50' 
                                                : 'border-gray-300 hover:border-gray-400'
                                            }`}
                                            onDragOver={handleDragOver}
                                            onDragLeave={handleDragLeave}
                                            onDrop={handleDrop}
                                          >
                                            <div className="text-center">
                                              <Upload className={`h-8 w-8 mx-auto mb-2 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
                                              <input
                                                type="file"
                                                multiple
                                                onChange={(e) => handleFileSelect(e.target.files)}
                                                className="hidden"
                                                id="file-upload-csi-inline"
                                                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png"
                                              />
                                              <Label 
                                                htmlFor="file-upload-csi-inline" 
                                                className="cursor-pointer text-sm text-blue-600 hover:text-blue-700"
                                              >
                                                Choose files or drag and drop
                                              </Label>
                                              <p className="text-xs text-gray-500 mt-1">
                                                Specifications, drawings, or related documents
                                              </p>
                                            </div>
                                          </div>
                                        </div>

                                        {/* New file uploads */}
                                        {fileUploadInputs.length > 0 && (
                                          <div className="space-y-2">
                                            <p className="text-sm font-medium">Files to upload:</p>
                                            {fileUploadInputs.map((file, index) => (
                                              <div key={index} className="flex items-center justify-between bg-blue-50 p-2 rounded">
                                                <div className="flex items-center space-x-2 flex-1">
                                                  <FileText className="h-4 w-4 text-blue-600" />
                                                  <input
                                                    type="text"
                                                    value={file.name}
                                                    onChange={(e) => {
                                                      const newFiles = [...fileUploadInputs];
                                                      const newFile = new File([file], e.target.value, { type: file.type });
                                                      newFiles[index] = newFile;
                                                      setFileUploadInputs(newFiles);
                                                    }}
                                                    className="text-sm bg-transparent border-none outline-none flex-1"
                                                    placeholder="Enter file name"
                                                  />
                                                  <span className="text-xs text-gray-500">
                                                    ({(file.size / 1024).toFixed(1)} KB)
                                                  </span>
                                                </div>
                                                <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="sm"
                                                  onClick={() => removeFileInput(index)}
                                                >
                                                  <X className="h-4 w-4" />
                                                </Button>
                                              </div>
                                            ))}
                                          </div>
                                        )}

                                        {/* Existing attachments */}
                                        {formData.attachments.length > 0 && (
                                          <div className="space-y-2">
                                            <p className="text-sm font-medium">Current attachments:</p>
                                            {formData.attachments.map((file) => (
                                              <div key={file.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                                                <div className="flex items-center space-x-2 flex-1">
                                                  <FileText className="h-4 w-4 text-gray-600" />
                                                  
                                                  {editingFileId === file.id ? (
                                                    <div className="flex items-center space-x-2 flex-1">
                                                      <input
                                                        type="text"
                                                        value={editingFileName}
                                                        onChange={(e) => setEditingFileName(e.target.value)}
                                                        className="text-sm bg-white border border-blue-300 rounded px-2 py-1 flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                        placeholder="Enter file name"
                                                        autoFocus
                                                        onKeyDown={(e) => {
                                                          if (e.key === 'Enter') saveFileRename();
                                                          if (e.key === 'Escape') cancelFileRename();
                                                        }}
                                                      />
                                                      <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={saveFileRename}
                                                        className="text-green-600 hover:text-green-700"
                                                        title="Save"
                                                      >
                                                        <Check className="h-4 w-4" />
                                                      </Button>
                                                      <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={cancelFileRename}
                                                        className="text-gray-500 hover:text-gray-700"
                                                        title="Cancel"
                                                      >
                                                        <X className="h-4 w-4" />
                                                      </Button>
                                                    </div>
                                                  ) : (
                                                    <div className="flex items-center space-x-2 flex-1">
                                                      <span className="text-sm flex-1">{file.fileName}</span>
                                                      <span className="text-xs text-gray-500">
                                                        (uploaded {new Date(file.uploadedAt).toLocaleDateString()})
                                                      </span>
                                                      <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => startEditingFile(file.id, file.fileName)}
                                                        className="text-blue-600 hover:text-blue-700"
                                                        title="Rename file"
                                                      >
                                                        <Edit3 className="h-4 w-4" />
                                                      </Button>
                                                    </div>
                                                  )}
                                                </div>
                                                
                                                {editingFileId !== file.id && (
                                                  <div className="flex items-center space-x-1">
                                                    <Button
                                                      type="button"
                                                      variant="ghost"
                                                      size="sm"
                                                      onClick={() => handleDownloadFile(file.fileName, file.filePath)}
                                                      title="Download file"
                                                    >
                                                      <Download className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                      type="button"
                                                      variant="ghost"
                                                      size="sm"
                                                      onClick={() => removeExistingFile(file.id)}
                                                      title="Delete file"
                                                    >
                                                      <X className="h-4 w-4" />
                                                    </Button>
                                                  </div>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>

                                      <div className="flex justify-end space-x-3 pt-4 border-t">
                                        <Button type="button" variant="outline" onClick={resetForm}>
                                          Cancel
                                        </Button>
                                        <Button 
                                          type="submit" 
                                          disabled={updateMutation.isPending}
                                          className="bg-green-600 hover:bg-green-700 text-white"
                                        >
                                          Update Item
                                        </Button>
                                      </div>
                                    </form>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })
                    ) : (
                      /* Regular flat display for non-Tenant Improvements categories */
                      items.map((item) => (
                      <div key={item.id}>
                        {/* Item Display Row */}
                        <div className="p-3 flex justify-between items-center">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3">
                              <h5 className="font-medium text-gray-900">{item.name}</h5>
                              <span className="text-sm text-gray-500 flex items-center space-x-1">
                                <span>
                                  ${(() => {
                                    const result = evaluateFormula(item.unitPrice);
                                    const displayValue = result.value !== null ? result.value.toFixed(2) : parseFloat(item.unitPrice || "0").toFixed(2);
                                    return parseFloat(displayValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                  })()} per {item.unit}
                                  {item.unitPrice.startsWith('=') && (
                                    <span className="ml-1 text-xs text-blue-600">📊</span>
                                  )}
                                </span>
                                {item.hasMinimumCost && item.minimumCost && (
                                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                                    Min: ${parseFloat(item.minimumCost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                )}
                                {item.attachments && item.attachments.length > 0 && (
                                  <button
                                    onClick={() => handleDownloadFile(item.attachments[0].fileName, item.attachments[0].filePath)}
                                    className="text-blue-600 hover:text-blue-800 transition-colors"
                                    title={`Download ${item.attachments[0].fileName}`}
                                  >
                                    <FileText className="h-4 w-4" />
                                  </button>
                                )}
                              </span>
                            </div>
                            {item.description && (
                              <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                            )}
                          </div>
                          
                          <div className="flex space-x-2 ml-4">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (editingItem?.id === item.id) {
                                  // Cancel editing
                                  setEditingItem(null);
                                  setShowAddForm(false);
                                } else {
                                  // Start editing this item
                                  handleEdit(item);
                                }
                              }}
                            >
                              {editingItem?.id === item.id ? (
                                <X className="h-4 w-4" />
                              ) : (
                                <Edit2 className="h-4 w-4" />
                              )}
                            </Button>
                            {canDeleteRomScope && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDelete(item.id)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Inline Edit Form - appears right below the item when editing */}
                        {editingItem?.id === item.id && (
                          <div className="border-t border-l-4 border-l-blue-500 bg-blue-50 p-4 m-3 rounded-md">
                            <form onSubmit={handleSubmit} className="space-y-4">
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="text-lg font-semibold text-gray-900">Edit: {item.name}</h4>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setEditingItem(null);
                                    setShowAddForm(false);
                                    resetForm();
                                  }}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label htmlFor="category">Category *</Label>
                                  <div className="relative">
                                    <select
                                      value={formData.category}
                                      onChange={(e) => setFormData({...formData, category: e.target.value})}
                                      className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                    >
                                      <option value="">Select category</option>
                                      {categories.map((cat) => (
                                        <option key={cat} value={cat}>{cat}</option>
                                      ))}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <Label htmlFor="name">Name *</Label>
                                  <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                                    placeholder="Enter scope item name"
                                  />
                                </div>
                              </div>

                              <div className="space-y-2">
                                <Label htmlFor="description">Description</Label>
                                <Textarea
                                  id="description"
                                  value={formData.description}
                                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                                  placeholder="Enter description"
                                  rows={2}
                                />
                              </div>

                              {/* CSI Division and Code - Only show for Tenant Improvements */}
                              {formData.category === "Tenant Improvements" && (
                                <div className="grid grid-cols-2 gap-4 p-3 bg-white rounded-md border border-blue-200">
                                  <div className="space-y-2">
                                    <Label htmlFor="csiDivision-edit">CSI Division</Label>
                                    <div className="relative">
                                      <select
                                        value={formData.csiDivision}
                                        onChange={(e) => setFormData({...formData, csiDivision: e.target.value})}
                                        className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                      >
                                        <option value="">No Division (General)</option>
                                        {csiDivisions.map((div) => (
                                          <option key={div} value={div}>{div}</option>
                                        ))}
                                      </select>
                                      <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                    </div>
                                  </div>

                                  <div className="space-y-2">
                                    <Label htmlFor="csiCode-edit">CSI Code</Label>
                                    <Input
                                      id="csiCode-edit"
                                      value={formData.csiCode}
                                      onChange={(e) => setFormData({...formData, csiCode: e.target.value})}
                                      placeholder="e.g., 26 05 00"
                                    />
                                  </div>
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label htmlFor="unit">Unit *</Label>
                                  <div className="relative">
                                    <select
                                      value={formData.unit}
                                      onChange={(e) => setFormData({...formData, unit: e.target.value})}
                                      className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                    >
                                      <option value="">Select unit</option>
                                      {units.map((unit) => (
                                        <option key={unit} value={unit}>{unit}</option>
                                      ))}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <Label htmlFor="unitPrice">Unit Price *</Label>
                                  <div className="relative">
                                    <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 z-10" />
                                    <FormulaInput
                                      value={formData.unitPrice}
                                      onChange={(rawValue, evaluatedValue) => {
                                        setFormData({...formData, unitPrice: rawValue.toString()});
                                      }}
                                      placeholder="0.00 or =15000*1.15"
                                      className="pl-10"
                                      decimalPlaces={2}
                                      formatThousands={true}
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Minimum Cost Section */}
                              <div className="space-y-4">
                                <div className="flex items-center space-x-2">
                                  <input
                                    type="checkbox"
                                    id="hasMinimumCost"
                                    checked={formData.hasMinimumCost}
                                    onChange={(e) => setFormData({...formData, hasMinimumCost: e.target.checked})}
                                    className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                  />
                                  <Label htmlFor="hasMinimumCost" className="text-sm font-medium text-gray-700">
                                    Enable minimum cost (e.g., architectural services minimum $15,000)
                                  </Label>
                                </div>
                                
                                {formData.hasMinimumCost && (
                                  <div className="space-y-2">
                                    <Label htmlFor="minimumCost">Minimum Cost *</Label>
                                    <div className="relative">
                                      <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 z-10" />
                                      <FormulaInput
                                        value={formData.minimumCost}
                                        onChange={(rawValue, evaluatedValue) => {
                                          setFormData({...formData, minimumCost: rawValue.toString()});
                                        }}
                                        placeholder="15000.00"
                                        className="pl-10"
                                        decimalPlaces={2}
                                        formatThousands={true}
                                      />
                                    </div>
                                    <p className="text-xs text-gray-500">
                                      Total cost will never be less than this amount, regardless of quantity × unit price
                                    </p>
                                  </div>
                                )}
                              </div>

                              {/* Source and Include by Default Section */}
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label htmlFor="source">Source</Label>
                                  <Input
                                    id="source"
                                    value={formData.source}
                                    onChange={(e) => setFormData({...formData, source: e.target.value})}
                                    placeholder="e.g., RS Means 2024"
                                  />
                                </div>

                                <div className="space-y-2">
                                  <div className="flex items-center space-x-2">
                                    <input
                                      type="checkbox"
                                      id="includeByDefault-inline"
                                      checked={formData.includeByDefault}
                                      onChange={(e) => setFormData({...formData, includeByDefault: e.target.checked})}
                                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    />
                                    <Label htmlFor="includeByDefault-inline" className="text-sm font-medium text-gray-700">
                                      Include by default in ROMs and RFP Evaluations
                                    </Label>
                                  </div>
                                  <p className="text-xs text-gray-500">
                                    When checked, this item will automatically be added to new ROM pilots and RFP evaluations
                                  </p>
                                </div>
                              </div>

                              {/* Reference Pricing Section */}
                              {canDeleteRomScope && (
                                <div className="space-y-4 pt-4 border-t">
                                  <div className="flex items-center justify-between">
                                    <Label className="text-base font-semibold">Reference Pricing (for quarterly contractor verification)</Label>
                                    <Button 
                                      type="button"
                                      onClick={startAddingReferencePrice} 
                                      size="sm" 
                                      variant="outline"
                                      disabled={isAddingReferencePrice}
                                    >
                                      <Plus className="h-4 w-4 mr-1" /> Add Reference Price
                                    </Button>
                                  </div>
                                  <p className="text-xs text-gray-500">
                                    Reference pricing is for tracking only and is not used in ROM Pilot calculations or RFP Evaluations
                                  </p>

                                  {/* Existing reference prices table */}
                                  {formData.referencePricing.length > 0 && (
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full divide-y divide-gray-200 border border-gray-200 rounded-md">
                                        <thead className="bg-gray-50">
                                          <tr>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                              Contractor Name
                                            </th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                              Price
                                            </th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                              Date
                                            </th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                              Actions
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                          {formData.referencePricing.map((ref, index) => (
                                            <tr key={index}>
                                              <td className="px-4 py-2 text-sm text-gray-900">
                                                {ref.contractorName}
                                              </td>
                                              <td className="px-4 py-2 text-sm text-gray-900">
                                                ${parseFloat(ref.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                              </td>
                                              <td className="px-4 py-2 text-sm text-gray-900">
                                                {new Date(ref.date).toLocaleDateString()}
                                              </td>
                                              <td className="px-4 py-2 text-sm">
                                                <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="sm"
                                                  onClick={() => removeReferencePrice(index)}
                                                  className="text-red-600 hover:text-red-700"
                                                >
                                                  <Trash2 className="h-4 w-4" />
                                                </Button>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}

                                  {/* Add new reference price form */}
                                  {isAddingReferencePrice && (
                                    <div className="bg-gray-50 p-4 rounded-lg space-y-4 border border-gray-200">
                                      <h5 className="text-sm font-medium text-gray-900">Add Reference Price</h5>
                                      <div className="grid grid-cols-3 gap-4">
                                        <div className="space-y-2">
                                          <Label htmlFor="contractor-name">Contractor Name *</Label>
                                          <Input
                                            id="contractor-name"
                                            value={newReferencePrice.contractorName}
                                            onChange={(e) => setNewReferencePrice({...newReferencePrice, contractorName: e.target.value})}
                                            placeholder="Enter contractor name"
                                          />
                                        </div>
                                        <div className="space-y-2">
                                          <Label htmlFor="ref-price">Price *</Label>
                                          <div className="relative">
                                            <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 z-10" />
                                            <FormulaInput
                                              value={newReferencePrice.price}
                                              onChange={(rawValue, evaluatedValue) => {
                                                setNewReferencePrice({...newReferencePrice, price: rawValue.toString()});
                                              }}
                                              placeholder="0.00"
                                              className="pl-10"
                                              decimalPlaces={2}
                                              formatThousands={true}
                                            />
                                          </div>
                                        </div>
                                        <div className="space-y-2">
                                          <Label htmlFor="ref-date">Date *</Label>
                                          <Input
                                            id="ref-date"
                                            type="date"
                                            value={newReferencePrice.date}
                                            onChange={(e) => setNewReferencePrice({...newReferencePrice, date: e.target.value})}
                                          />
                                        </div>
                                      </div>
                                      <div className="flex justify-end space-x-2">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          onClick={cancelAddReferencePrice}
                                        >
                                          Cancel
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          onClick={saveReferencePrice}
                                          className="bg-blue-600 hover:bg-blue-700"
                                        >
                                          Save Reference Price
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Tiered Pricing Section */}
                              <div className="space-y-4 pt-4 border-t">
                                <div className="flex items-center space-x-2">
                                  <Label className="text-sm font-semibold">Tiered Pricing (Optional)</Label>
                                  <p className="text-xs text-gray-500">
                                    Use for items with different pricing based on square footage tiers
                                  </p>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                  <div className="space-y-2">
                                    <Label htmlFor="itemGroup-inline">Item Group</Label>
                                    <Input
                                      id="itemGroup-inline"
                                      data-testid="input-itemGroup-inline"
                                      placeholder="e.g., Office Area"
                                      value={formData.itemGroup}
                                      onChange={(e) => setFormData({...formData, itemGroup: e.target.value})}
                                    />
                                    <p className="text-xs text-gray-500">
                                      Groups related tiers together
                                    </p>
                                  </div>

                                  <div className="space-y-2">
                                    <Label htmlFor="minSquareFootage-inline">Min Square Footage</Label>
                                    <Input
                                      id="minSquareFootage-inline"
                                      data-testid="input-minSquareFootage-inline"
                                      type="number"
                                      placeholder="e.g., 3001"
                                      value={formData.minSquareFootage}
                                      onChange={(e) => setFormData({...formData, minSquareFootage: e.target.value})}
                                    />
                                    <p className="text-xs text-gray-500">
                                      Leave blank for no minimum
                                    </p>
                                  </div>

                                  <div className="space-y-2">
                                    <Label htmlFor="maxSquareFootage-inline">Max Square Footage</Label>
                                    <Input
                                      id="maxSquareFootage-inline"
                                      data-testid="input-maxSquareFootage-inline"
                                      type="number"
                                      placeholder="e.g., 5000"
                                      value={formData.maxSquareFootage}
                                      onChange={(e) => setFormData({...formData, maxSquareFootage: e.target.value})}
                                    />
                                    <p className="text-xs text-gray-500">
                                      Leave blank for no maximum
                                    </p>
                                  </div>
                                </div>
                              </div>

                              {/* File Attachments Section */}
                              <div className="space-y-4 pt-4 border-t">
                                <div className="space-y-2">
                                  <Label htmlFor="attachments">Attachments</Label>
                                  <div 
                                    className={`border-2 border-dashed rounded-lg p-4 transition-colors ${
                                      isDragging 
                                        ? 'border-blue-500 bg-blue-50' 
                                        : 'border-gray-300 hover:border-gray-400'
                                    }`}
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                  >
                                    <div className="text-center">
                                      <Upload className={`h-8 w-8 mx-auto mb-2 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
                                      <input
                                        type="file"
                                        multiple
                                        onChange={(e) => handleFileSelect(e.target.files)}
                                        className="hidden"
                                        id="file-upload-inline"
                                        accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png"
                                      />
                                      <Label 
                                        htmlFor="file-upload-inline" 
                                        className="cursor-pointer text-sm text-blue-600 hover:text-blue-700"
                                      >
                                        Choose files or drag and drop
                                      </Label>
                                      <p className="text-xs text-gray-500 mt-1">
                                        Specifications, drawings, or related documents
                                      </p>
                                    </div>
                                  </div>
                                </div>

                                {/* New file uploads */}
                                {fileUploadInputs.length > 0 && (
                                  <div className="space-y-2">
                                    <p className="text-sm font-medium">Files to upload:</p>
                                    {fileUploadInputs.map((file, index) => (
                                      <div key={index} className="flex items-center justify-between bg-blue-50 p-2 rounded">
                                        <div className="flex items-center space-x-2 flex-1">
                                          <FileText className="h-4 w-4 text-blue-600" />
                                          <input
                                            type="text"
                                            value={file.name}
                                            onChange={(e) => {
                                              const newFiles = [...fileUploadInputs];
                                              const newFile = new File([file], e.target.value, { type: file.type });
                                              newFiles[index] = newFile;
                                              setFileUploadInputs(newFiles);
                                            }}
                                            className="text-sm bg-transparent border-none outline-none flex-1"
                                            placeholder="Enter file name"
                                          />
                                          <span className="text-xs text-gray-500">
                                            ({(file.size / 1024).toFixed(1)} KB)
                                          </span>
                                        </div>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => removeFileInput(index)}
                                        >
                                          <X className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Existing attachments */}
                                {formData.attachments.length > 0 && (
                                  <div className="space-y-2">
                                    <p className="text-sm font-medium">Current attachments:</p>
                                    {formData.attachments.map((file) => (
                                      <div key={file.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                                        <div className="flex items-center space-x-2 flex-1">
                                          <FileText className="h-4 w-4 text-gray-600" />
                                          
                                          {editingFileId === file.id ? (
                                            <div className="flex items-center space-x-2 flex-1">
                                              <input
                                                type="text"
                                                value={editingFileName}
                                                onChange={(e) => setEditingFileName(e.target.value)}
                                                className="text-sm bg-white border border-blue-300 rounded px-2 py-1 flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                placeholder="Enter file name"
                                                autoFocus
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') saveFileRename();
                                                  if (e.key === 'Escape') cancelFileRename();
                                                }}
                                              />
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={saveFileRename}
                                                className="text-green-600 hover:text-green-700"
                                                title="Save"
                                              >
                                                <Check className="h-4 w-4" />
                                              </Button>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={cancelFileRename}
                                                className="text-gray-500 hover:text-gray-700"
                                                title="Cancel"
                                              >
                                                <X className="h-4 w-4" />
                                              </Button>
                                            </div>
                                          ) : (
                                            <div className="flex items-center space-x-2 flex-1">
                                              <span className="text-sm flex-1">{file.fileName}</span>
                                              <span className="text-xs text-gray-500">
                                                (uploaded {new Date(file.uploadedAt).toLocaleDateString()})
                                              </span>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => startEditingFile(file.id, file.fileName)}
                                                className="text-blue-600 hover:text-blue-700"
                                                title="Rename file"
                                              >
                                                <Edit3 className="h-4 w-4" />
                                              </Button>
                                            </div>
                                          )}
                                        </div>
                                        
                                        {editingFileId !== file.id && (
                                          <div className="flex items-center space-x-1">
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => handleDownloadFile(file.fileName, file.filePath)}
                                              title="Download file"
                                            >
                                              <i className="fas fa-download h-3 w-3"></i>
                                            </Button>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => removeExistingFile(file.id)}
                                              title="Delete file"
                                            >
                                              <X className="h-4 w-4" />
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="flex justify-end space-x-2 pt-4 border-t">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => {
                                    setEditingItem(null);
                                    setShowAddForm(false);
                                    resetForm();
                                  }}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="submit"
                                  disabled={updateMutation.isPending}
                                  className="bg-blue-600 hover:bg-blue-700"
                                >
                                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                                </Button>
                              </div>
                            </form>
                          </div>
                        )}
                      </div>
                    ))
                    )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}