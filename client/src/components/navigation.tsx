import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Home, FileText, BarChart3, Users, Building, Calculator, Settings, LogOut } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Navigation() {
  const [location] = useLocation();
  const { isAdmin } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: currentUser } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('/api/auth/logout', 'POST');
    },
    onSuccess: () => {
      localStorage.removeItem('auth-token');
      queryClient.clear();
      window.location.reload();
    },
    onError: () => {
      localStorage.removeItem('auth-token');
      toast({
        title: "Logout Error",
        description: "Failed to logout properly",
        variant: "destructive",
      });
      window.location.reload();
    },
  });

  // Base navigation items
  const baseNavItems = [
    { path: "/", label: "Dashboard", icon: Home },
    { path: "/contacts", label: "Contacts", icon: Users },
    { path: "/properties", label: "Properties", icon: Building },
    { path: "/reports", label: "Reports", icon: BarChart3 },
    { path: "/rom-pilot", label: "ROM Pilot", icon: Calculator },
  ];

  // Add admin item if user is admin
  const adminItems = isAdmin() ? [{ path: "/admin", label: "Admin Panel", icon: Settings }] : [];
  const navItems = [...baseNavItems, ...adminItems];

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-1">
          <div className="flex items-center space-x-2 mr-8">
            <FileText className="h-6 w-6 text-blue-600" />
            <span className="text-xl font-bold text-gray-900">RFP Tracker</span>
          </div>
          
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path;
            
            return (
              <Link key={item.path} href={item.path}>
                <Button
                  variant={isActive ? "default" : "ghost"}
                  className={cn(
                    "flex items-center space-x-2",
                    isActive && "bg-blue-600 text-white hover:bg-blue-700"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Button>
              </Link>
            );
          })}
        </div>

        {/* User Profile Section */}
        {currentUser && (
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                <span className="text-white font-medium text-sm">
                  {currentUser.firstName?.[0] || currentUser.email?.[0]?.toUpperCase() || currentUser.username?.[0]?.toUpperCase() || 'U'}
                </span>
              </div>
              <div className="text-sm">
                <div className="font-medium text-gray-900">
                  {currentUser.firstName || currentUser.email?.split('@')[0] || currentUser.username || 'User'}
                </div>
                {isAdmin() && (
                  <div className="text-xs text-green-600 font-medium">Administrator</div>
                )}
              </div>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => logoutMutation.mutate()}
                    disabled={logoutMutation.isPending}
                    className="text-gray-600 hover:text-gray-900"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Sign Out</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
    </nav>
  );
}