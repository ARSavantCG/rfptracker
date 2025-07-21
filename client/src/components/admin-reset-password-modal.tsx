import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Eye, EyeOff, Copy } from "lucide-react";
import type { Contact } from "@shared/schema";

interface AdminResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  contact: Contact | null;
}

export default function AdminResetPasswordModal({ isOpen, onClose, contact }: AdminResetPasswordModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState("");

  const resetPasswordMutation = useMutation({
    mutationFn: async (data: { contactId: number; newPassword: string }) => {
      return await apiRequest('/api/admin/reset-password', 'POST', data);
    },
    onSuccess: () => {
      toast({
        title: "Password Reset Successful",
        description: `Password has been reset for ${contact?.name}`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      // Don't close modal immediately so admin can copy password
    },
    onError: (error: any) => {
      toast({
        title: "Password Reset Failed",
        description: error.message || "Failed to reset password",
        variant: "destructive",
      });
    },
  });

  const generatePassword = () => {
    // Generate a secure but memorable password
    const words = ['Blue', 'Green', 'Red', 'Gold', 'Silver', 'Moon', 'Sun', 'Star', 'Ocean', 'Forest'];
    const numbers = Math.floor(Math.random() * 999) + 100;
    const password = words[Math.floor(Math.random() * words.length)] + numbers;
    setNewPassword(password);
    setGeneratedPassword(password);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!contact) return;
    
    if (newPassword.length < 6) {
      toast({
        title: "Password Too Short",
        description: "Password must be at least 6 characters long.",
        variant: "destructive",
      });
      return;
    }
    
    resetPasswordMutation.mutate({
      contactId: contact.id,
      newPassword: newPassword
    });
    
    setGeneratedPassword(newPassword);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generatedPassword);
      toast({
        title: "Password Copied",
        description: "The new password has been copied to your clipboard.",
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Could not copy password. Please select and copy manually.",
        variant: "destructive",
      });
    }
  };

  const handleClose = () => {
    setNewPassword("");
    setGeneratedPassword("");
    setShowPassword(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset Password - {contact?.name}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
            <p className="text-sm text-yellow-800">
              <strong>Admin Action:</strong> You are resetting the password for {contact?.name} ({contact?.email}).
              Make sure to securely share the new password with them.
            </p>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <div className="flex space-x-2">
                <div className="relative flex-1">
                  <Input
                    id="newPassword"
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    className="pr-10"
                    placeholder="Enter new password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={generatePassword}
                >
                  Generate
                </Button>
              </div>
            </div>
            
            {generatedPassword && resetPasswordMutation.isSuccess && (
              <div className="bg-green-50 border border-green-200 rounded-md p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-green-800">Password Reset Complete</p>
                    <p className="text-sm text-green-700 mt-1">New Password: <span className="font-mono">{generatedPassword}</span></p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={copyToClipboard}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            
            <div className="flex justify-end space-x-2 pt-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={handleClose}
                disabled={resetPasswordMutation.isPending}
              >
                {resetPasswordMutation.isSuccess ? "Done" : "Cancel"}
              </Button>
              {!resetPasswordMutation.isSuccess && (
                <Button 
                  type="submit" 
                  disabled={resetPasswordMutation.isPending}
                >
                  {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password"}
                </Button>
              )}
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}