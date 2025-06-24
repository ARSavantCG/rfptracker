/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Copy, Eye, EyeOff } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface ContactPasswordModalProps {
  contact: {
    id: number;
    name: string;
    email: string;
    passwordHash?: string;
  } | null;
  open: boolean;
  onClose: () => void;
}

export default function ContactPasswordModal({
  contact,
  open,
  onClose,
}: ContactPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<'manual' | 'generate'>('manual');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const setPasswordMutation = useMutation({
    mutationFn: async ({ contactId, password }: { contactId: number; password: string }) => {

      return apiRequest(`/api/admin/contacts/${contactId}/set-password`, 'POST', { password });
    },
    onSuccess: () => {
      const isReset = contact?.passwordHash;
      toast({
        title: isReset ? "Password Reset" : "Password Set",
        description: isReset ? "Password has been reset successfully" : "Password has been set successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/authorized-contacts'] });
      onClose();
      setPassword("");
      setGeneratedPassword("");
      setMode('manual');
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to set password",
        variant: "destructive",
      });
    },
  });

  const generatePasswordMutation = useMutation({
    mutationFn: async (contactId: number) => {
      return apiRequest(`/api/admin/contacts/${contactId}/generate-password`, 'POST');
    },
    onSuccess: (data) => {
      setGeneratedPassword(data.tempPassword);
      setMode('generate');
      toast({
        title: "Password Generated",
        description: "Temporary password has been generated",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/authorized-contacts'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate password",
        variant: "destructive",
      });
    },
  });

  const handleSetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contact || !password || password.length < 8) return;
    
    setPasswordMutation.mutate({ contactId: contact.id, password });
  };

  const handleGeneratePassword = () => {
    if (!contact) return;
    generatePasswordMutation.mutate(contact.id);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied",
        description: "Copied to clipboard",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const resetForm = () => {
    setPassword("");
    setGeneratedPassword("");
    setMode('manual');
    setShowPassword(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  if (!contact) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {contact.passwordHash ? 'Reset Password' : 'Set Password'} for {contact.name}
          </DialogTitle>
          <DialogDescription>
            {contact.passwordHash 
              ? `Reset the login password for ${contact.email}` 
              : `Set a login password for ${contact.email}`
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mode === 'manual' && !generatedPassword && (
            <>
              <form onSubmit={handleSetPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password (min 8 characters)"
                      disabled={setPasswordMutation.isPending}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  {password && password.length < 8 && (
                    <p className="text-sm text-red-500">Password must be at least 8 characters</p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={setPasswordMutation.isPending || !password || password.length < 8}
                    className="flex-1"
                  >
                    {setPasswordMutation.isPending ? "Setting..." : "Set Password"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleGeneratePassword}
                    disabled={generatePasswordMutation.isPending}
                  >
                    {generatePasswordMutation.isPending ? "Generating..." : "Generate"}
                  </Button>
                </div>
              </form>
            </>
          )}

          {generatedPassword && (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <h4 className="font-medium text-green-800 mb-2">Temporary Password Generated</h4>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 bg-white rounded border text-sm font-mono">
                    {generatedPassword}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(generatedPassword)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-sm text-green-700 mt-2">
                  Share this password securely with {contact.name}. They can use it to log in with their email: {contact.email}
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium">Login Instructions for {contact.name}:</h4>
                <div className="text-sm text-gray-600 space-y-1">
                  <p>• Username: {contact.email}</p>
                  <p>• Password: {generatedPassword}</p>
                  <p>• They can reset their password using "Forgot Password" on the login page</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose}>
              {generatedPassword ? "Done" : "Cancel"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}