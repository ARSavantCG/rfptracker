import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Crown } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function AdminSetup() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: user } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const makeAdminMutation = useMutation({
    mutationFn: () => apiRequest("/api/dev/make-admin", "POST", { userId: user?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Success",
        description: "You are now an administrator",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to assign admin privileges",
        variant: "destructive",
      });
    },
  });

  if (!user) {
    return null;
  }

  if (user.role === 'admin') {
    return (
      <Card className="max-w-md mx-auto">
        <CardHeader className="text-center">
          <Crown className="h-12 w-12 text-yellow-500 mx-auto mb-2" />
          <CardTitle>Administrator Access</CardTitle>
          <CardDescription>
            You have admin privileges and can access the Admin Panel
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader className="text-center">
        <Shield className="h-12 w-12 text-blue-500 mx-auto mb-2" />
        <CardTitle>Admin Setup Required</CardTitle>
        <CardDescription>
          Click below to gain administrator privileges for this application
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center">
        <Button 
          onClick={() => makeAdminMutation.mutate()}
          disabled={makeAdminMutation.isPending}
          className="w-full"
        >
          {makeAdminMutation.isPending ? "Setting up..." : "Become Administrator"}
        </Button>
      </CardContent>
    </Card>
  );
}