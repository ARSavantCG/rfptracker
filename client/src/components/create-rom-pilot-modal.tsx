import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Calculator, User } from "lucide-react";
import type { Property } from "@shared/schema";

interface CreateRomPilotModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateRomPilotModal({ isOpen, onClose, onSuccess }: CreateRomPilotModalProps) {
  const { toast } = useToast();
  const [projectName, setProjectName] = useState("");
  const [property, setProperty] = useState("");
  const [squareFootage, setSquareFootage] = useState("");
  const [notes, setNotes] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch properties for selection
  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    enabled: isOpen,
  });

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setProjectName("");
      setProperty("");
      setSquareFootage("");
      setNotes("");
      setCreatedBy("");
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!projectName.trim()) {
      toast({
        title: "Validation Error",
        description: "Project name is required",
        variant: "destructive",
      });
      return;
    }

    if (!property) {
      toast({
        title: "Validation Error", 
        description: "Property selection is required",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Calculate basic estimate based on square footage
      const sf = parseInt(squareFootage) || 0;
      const estimatePerSF = 50; // Basic $50/SF estimate
      const totalEstimate = (sf * estimatePerSF).toString();

      const romPilotData = {
        projectName: projectName.trim(),
        property,
        totalEstimate,
        notes: notes.trim() || null,
        createdBy: createdBy.trim() || null,
      };

      const response = await fetch("/api/rom-pilots", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(romPilotData),
      });

      if (!response.ok) {
        throw new Error("Failed to create ROM Pilot");
      }

      toast({
        title: "Success",
        description: "ROM Pilot created successfully",
      });

      onSuccess();
    } catch (error) {
      console.error("Error creating ROM Pilot:", error);
      toast({
        title: "Error",
        description: "Failed to create ROM Pilot. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Calculator className="h-5 w-5" />
            <span>Create New ROM Pilot</span>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Project Name */}
          <div className="space-y-2">
            <Label htmlFor="project-name">Project Name *</Label>
            <Input
              id="project-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Enter project name"
              required
            />
          </div>

          {/* Property Selection */}
          <div className="space-y-2">
            <Label htmlFor="property">Property *</Label>
            <Select value={property} onValueChange={setProperty}>
              <SelectTrigger>
                <SelectValue placeholder="Select a property" />
              </SelectTrigger>
              <SelectContent>
                {properties.map((prop) => (
                  <SelectItem key={prop.id} value={prop.propertyName}>
                    {prop.propertyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Square Footage */}
          <div className="space-y-2">
            <Label htmlFor="square-footage">Square Footage</Label>
            <Input
              id="square-footage"
              type="number"
              value={squareFootage}
              onChange={(e) => setSquareFootage(e.target.value)}
              placeholder="Enter square footage"
              min="0"
            />
            {squareFootage && (
              <p className="text-xs text-gray-600">
                Estimated cost: ${(parseInt(squareFootage) * 50).toLocaleString()} (@ $50/SF)
              </p>
            )}
          </div>

          {/* Created By */}
          <div className="space-y-2">
            <Label htmlFor="created-by">Created By</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="created-by"
                value={createdBy}
                onChange={(e) => setCreatedBy(e.target.value)}
                placeholder="Your name (optional)"
                className="pl-10"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any additional notes about this ROM pilot..."
              rows={3}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create ROM Pilot"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}