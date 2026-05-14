import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { type RfpRequest } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";

interface CreateAlternateModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentRfp: RfpRequest;
  onAlternateCreated?: (alternateRfp: any) => void;
}

export function CreateAlternateModal({ isOpen, onClose, parentRfp, onAlternateCreated }: CreateAlternateModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [alternateTitle, setAlternateTitle] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      return await fetch(`/api/rfp-requests/${parentRfp.id}/create-option`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          optionType: "alternate",
          optionTitle: alternateTitle,
        })
      }).then(res => {
        if (!res.ok) throw new Error('Failed to create alternate');
        return res.json();
      });
    },
    onSuccess: (alternateRfp) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Success",
        description: "RFP alternate created successfully. Opening Step 1...",
        duration: 4000,
      });
      handleClose();
      
      // Auto-redirect to Step 1 of the new alternate
      if (onAlternateCreated) {
        onAlternateCreated(alternateRfp);
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create RFP alternate",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!alternateTitle.trim()) {
      toast({
        title: "Error",
        description: "Alternate title is required",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate();
  };

  const handleClose = () => {
    setAlternateTitle("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-gray-900">
            Create RFP Alternate
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-600 mt-1">
            Creating alternate for: {parentRfp.rfpNumber} - {parentRfp.tenantName}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="alternateTitle">Alternate Title *</Label>
            <Input
              id="alternateTitle"
              value={alternateTitle}
              onChange={(e) => setAlternateTitle(e.target.value)}
              placeholder="e.g., Full Building, West End Cap, Different Configuration"
            />
            <p className="text-sm text-gray-600">
              This will be used to differentiate this alternate from the original RFP
            </p>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || !alternateTitle.trim()}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {createMutation.isPending ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  Creating Alternate...
                </>
              ) : (
                'Create Alternate & Open Step 1'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}