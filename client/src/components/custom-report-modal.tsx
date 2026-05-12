import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
// Removed Select import - using native HTML selects for consistency
import { Download, Settings, ArrowUp, ArrowDown, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CustomReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  filters: any;
}

interface FieldOption {
  id: string;
  label: string;
  description: string;
}

const availableFields: FieldOption[] = [
  { id: "rfpNumber", label: "RFP Number", description: "Unique RFP identifier" },
  { id: "property", label: "Property", description: "Property name or location" },
  { id: "tenantName", label: "Tenant Name", description: "Name of the tenant" },
  { id: "projectName", label: "Project Name", description: "Full project name" },
  { id: "rentableSF", label: "Rentable SF", description: "Rentable square footage" },
  { id: "sentBy", label: "Sent By", description: "Who sent the RFP" },
  { id: "receivedOn", label: "Date Received", description: "When RFP was received" },
  { id: "internalDueDate", label: "Due Date", description: "Internal due date" },
  { id: "daysUntilDue", label: "Days Until Due", description: "Days remaining until due" },
  { id: "status", label: "Status", description: "Current RFP status" },
  { id: "workflowPhase", label: "Workflow Phase", description: "Current workflow phase" },
  { id: "developmentContact", label: "Development Contact", description: "Development team contact" },
  { id: "requestTypes", label: "Request Types", description: "Types of work requested" },
  { id: "confidential", label: "Confidential", description: "Confidentiality status" },
  { id: "notes", label: "Notes", description: "Additional notes" },
];

export function CustomReportModal({ isOpen, onClose, filters }: CustomReportModalProps) {
  const { toast } = useToast();
  const [selectedFields, setSelectedFields] = useState<string[]>([
    "rfpNumber", "projectName", "rentableSF", "receivedOn", "internalDueDate", "status"
  ]);
  const [reportTitle, setReportTitle] = useState("Custom RFP Report");
  const [sortBy, setSortBy] = useState("receivedOn");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const handleFieldToggle = (fieldId: string) => {
    setSelectedFields(prev => 
      prev.includes(fieldId) 
        ? prev.filter(id => id !== fieldId)
        : [...prev, fieldId]
    );
  };

  const moveFieldUp = (fieldId: string) => {
    setSelectedFields(prev => {
      const index = prev.indexOf(fieldId);
      if (index > 0) {
        const newFields = [...prev];
        [newFields[index - 1], newFields[index]] = [newFields[index], newFields[index - 1]];
        return newFields;
      }
      return prev;
    });
  };

  const moveFieldDown = (fieldId: string) => {
    setSelectedFields(prev => {
      const index = prev.indexOf(fieldId);
      if (index < prev.length - 1) {
        const newFields = [...prev];
        [newFields[index], newFields[index + 1]] = [newFields[index + 1], newFields[index]];
        return newFields;
      }
      return prev;
    });
  };

  const generateCustomReport = async () => {
    if (selectedFields.length === 0) {
      toast({
        title: "No Fields Selected",
        description: "Please select at least one field for your report.",
        variant: "destructive",
        duration: 6000,
      });
      return;
    }

    try {
      const reportConfig = {
        fields: selectedFields,
        title: reportTitle,
        sortBy,
        sortOrder,
        filters
      };

      const response = await fetch(`/api/reports/custom?config=${encodeURIComponent(JSON.stringify(reportConfig))}`, { credentials: 'include' });
      
      if (!response.ok) {
        throw new Error('Failed to generate custom report');
      }

      // Open the report in a new tab
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
      
      toast({
        title: "Report Generated",
        description: "Your custom report has been generated and opened in a new tab.",
        duration: 4000,
      });
      
      onClose();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate custom report. Please try again.",
        variant: "destructive",
        duration: 6000,
      });
    }
  };

  const selectedFieldsOrdered = selectedFields
    .map(id => availableFields.find(field => field.id === id))
    .filter(Boolean) as FieldOption[];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Custom Report Builder</span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Field Selection */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="report-title">Report Title</Label>
              <input
                id="report-title"
                type="text"
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <h3 className="font-medium mb-3">Available Fields</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-3">
                {availableFields.map((field) => (
                  <div key={field.id} className="flex items-start space-x-3">
                    <Checkbox
                      id={field.id}
                      checked={selectedFields.includes(field.id)}
                      onCheckedChange={() => handleFieldToggle(field.id)}
                    />
                    <div className="flex-1">
                      <Label htmlFor={field.id} className="font-medium">
                        {field.label}
                      </Label>
                      <p className="text-xs text-gray-600">{field.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Selected Fields & Configuration */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="sort-by">Sort By</Label>
                <div className="relative">
                  <select
                    id="sort-by"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    {selectedFields.map(fieldId => {
                      const field = availableFields.find(f => f.id === fieldId);
                      return field ? (
                        <option key={fieldId} value={fieldId}>
                          {field.label}
                        </option>
                      ) : null;
                    })}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              <div>
                <Label htmlFor="sort-order">Sort Order</Label>
                <div className="relative">
                  <select
                    id="sort-order"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}
                    className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-medium mb-3">Selected Fields & Order</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-3">
                {selectedFieldsOrdered.length === 0 ? (
                  <p className="text-gray-500 text-sm">No fields selected</p>
                ) : (
                  selectedFieldsOrdered.map((field, index) => (
                    <div key={field.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          {index + 1}
                        </span>
                        <span className="font-medium">{field.label}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => moveFieldUp(field.id)}
                          disabled={index === 0}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => moveFieldDown(field.id)}
                          disabled={index === selectedFieldsOrdered.length - 1}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-3 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={generateCustomReport} disabled={selectedFields.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Generate Report
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}