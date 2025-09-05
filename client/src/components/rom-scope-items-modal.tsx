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
import { Plus, Edit2, Trash2, Package, DollarSign, ChevronDown, Upload, FileText, X } from "lucide-react";

interface RomScopeItem {
  id: number;
  category: string;
  name: string;
  description: string | null;
  unit: string;
  unitPrice: string;
  source: string | null;
  lastUpdated: string | null;
  isActive: boolean;
  attachments: Array<{
    id: string;
    fileName: string;
    filePath: string;
    uploadedAt: string;
  }>;
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

  // Check if user has ROM scope delete permissions (only for deleting master scope items)
  const canDeleteRomScope = user?.permissions?.includes('rom.scope.delete') || false;
  
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState<RomScopeItem | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    category: "",
    name: "",
    description: "",
    unit: "",
    unitPrice: "",
    source: "",
    lastUpdated: "",
    attachments: [] as Array<{
      id: string;
      fileName: string;
      filePath: string;
      uploadedAt: string;
    }>,
  });

  const [fileUploadInputs, setFileUploadInputs] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Fetch scope items
  const { data: scopeItems = [], isLoading } = useQuery<RomScopeItem[]>({
    queryKey: ["/api/rom-scope-items"],
    enabled: isOpen,
  });

  // Categories for organization
  const categories = [
    "Tenant Improvements",
    "Design / Soft Costs / Other Fees"
  ];

  // Units for pricing
  const units = [
    "SF", "LF", "Each", "Hour", "Fixture", "Outlet", "Lot", "%", "$"
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
      source: "",
      lastUpdated: "",
      attachments: [],
    });
    setFileUploadInputs([]);
    setShowAddForm(false);
    setEditingItem(null);
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

    // For formula inputs, we store the raw value (which could be a formula or a number)
    const submitData = {
      ...formData,
      unitPrice: formData.unitPrice, // Keep the raw value (formula or number)
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
      source: item.source || "",
      lastUpdated: item.lastUpdated ? new Date(item.lastUpdated).toISOString().split('T')[0] : "",
      attachments: item.attachments || [],
    });
    setFileUploadInputs([]);
    setEditingItem(item);
    setShowAddForm(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this scope item?")) {
      deleteMutation.mutate(id);
    }
  };

  // Group items by category
  const itemsByCategory = scopeItems.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, RomScopeItem[]>);

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
                      placeholder="e.g., Drywall Installation"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    placeholder="Detailed description of the work item..."
                    rows={2}
                  />
                </div>

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
                          setFormData({...formData, unitPrice: rawValue});
                        }}
                        placeholder="0.00 or =15000*1.15"
                        className="pl-10"
                        decimalPlaces={2}
                        type="currency"
                      />
                    </div>
                  </div>
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
                      placeholder="e.g., ABC Construction, Internal Estimate"
                    />
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
                          <div className="flex items-center space-x-2">
                            <FileText className="h-4 w-4 text-gray-600" />
                            <span className="text-sm">{file.fileName}</span>
                            <span className="text-xs text-gray-500">
                              (uploaded {new Date(file.uploadedAt).toLocaleDateString()})
                            </span>
                          </div>
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
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
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
            <Button 
              onClick={() => setShowAddForm(true)}
              className="flex items-center space-x-2"
            >
              <Plus className="h-4 w-4" />
              <span>Add Item</span>
            </Button>
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
              {Object.entries(itemsByCategory).map(([category, items]) => (
                <div key={category} className="border rounded-lg">
                  <div className="bg-gray-50 px-4 py-3 border-b">
                    <h4 className="font-medium text-gray-900">{category}</h4>
                    <p className="text-sm text-gray-500">{items.length} item{items.length !== 1 ? 's' : ''}</p>
                  </div>
                  
                  <div className="divide-y">
                    {items.map((item) => (
                      <div key={item.id} className="p-3 flex justify-between items-center">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3">
                            <h5 className="font-medium text-gray-900">{item.name}</h5>
                            <span className="text-sm text-gray-500">
                              ${(() => {
                                const result = evaluateFormula(item.unitPrice);
                                const displayValue = result.value !== null ? result.value.toFixed(2) : parseFloat(item.unitPrice || "0").toFixed(2);
                                return parseFloat(displayValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                              })()} per {item.unit}
                              {item.unitPrice.startsWith('=') && (
                                <span className="ml-1 text-xs text-blue-600">📊</span>
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
                            onClick={() => handleEdit(item)}
                          >
                            <Edit2 className="h-4 w-4" />
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
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}