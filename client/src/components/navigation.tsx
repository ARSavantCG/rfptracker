import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Home, FileText, BarChart3, Users, Building, Calculator, Settings, LogOut, User, Key, ChevronDown, ClipboardCheck, FileBarChart, Tags, ClipboardList, Menu, X } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import ChangePasswordModal from "./change-password-modal";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  openInNewTab?: boolean;
}

export default function Navigation() {
  const [location, setLocation] = useLocation();
  const { isAdmin } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  
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
        duration: 6000,
      });
      window.location.reload();
    },
  });

  // Close dropdown and mobile menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setIsMobileMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Close mobile menu on navigation
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location]);

  // Handle nav item click
  const handleNavClick = (item: NavItem) => {
    if (item.openInNewTab) {
      window.open(item.path, '_blank');
    } else {
      setLocation(item.path);
    }
    setIsMobileMenuOpen(false);
  };

  // Base navigation items
  const baseNavItems: NavItem[] = [
    { path: "/", label: "Dashboard", icon: Home },
    { path: "/contacts", label: "Contacts", icon: Users },
    { path: "/properties", label: "Properties", icon: Building },
    { path: "/reports", label: "Reports", icon: BarChart3 },
    { path: "/data-scrubbing", label: "Data Scrubbing", icon: ClipboardCheck },
    { path: "/data-mapping", label: "Data Mapping", icon: Tags },
    { path: "/project-report-generator", label: "Project Reports", icon: FileBarChart },
    { path: "/property-data-audit", label: "Property Audit", icon: ClipboardList, openInNewTab: true },
    { path: "/rom-pilot", label: "ROM Pilot", icon: Calculator },
  ];

  // Add admin item if user is admin
  const adminItems: NavItem[] = isAdmin() ? [{ path: "/admin", label: "Admin Panel", icon: Settings }] : [];
  const navItems: NavItem[] = [...baseNavItems, ...adminItems];

  return (
    <>
      <nav className="bg-white border-b border-gray-200 px-4 lg:px-6 py-3">
        <div className="flex items-center justify-between">
          {/* Mobile: Hamburger + Logo */}
          <div className="flex items-center">
            {/* Hamburger menu button - visible on tablet/mobile */}
            <Button
              variant="ghost"
              className="lg:hidden mr-2 p-2"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? (
                <X className="h-6 w-6 text-gray-600" />
              ) : (
                <Menu className="h-6 w-6 text-gray-600" />
              )}
            </Button>

            {/* Logo */}
            <div className="flex items-center space-x-2">
              <FileText className="h-6 w-6 text-blue-600" />
              <span className="text-xl font-bold text-gray-900">RFP Tracker</span>
            </div>
          </div>

          {/* Desktop navigation - hidden on tablet/mobile */}
          <div className="hidden lg:flex items-center space-x-1 ml-8">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.path;
              
              if (item.openInNewTab) {
                return (
                  <Button
                    key={item.path}
                    variant="ghost"
                    className="flex items-center space-x-2"
                    onClick={() => window.open(item.path, '_blank')}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </Button>
                );
              }
              
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
              <div className="relative" ref={dropdownRef}>
                <Button 
                  variant="ghost" 
                  className="flex items-center space-x-2 p-2 hover:bg-gray-100"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                >
                  <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                    <span className="text-white font-medium text-sm">
                      {(currentUser as any).firstName?.[0] || (currentUser as any).email?.[0]?.toUpperCase() || (currentUser as any).username?.[0]?.toUpperCase() || 'U'}
                    </span>
                  </div>
                  <div className="hidden sm:block text-sm text-left">
                    <div className="font-medium text-gray-900">
                      {(currentUser as any).firstName || (currentUser as any).email?.split('@')[0] || (currentUser as any).username || 'User'}
                    </div>
                    {isAdmin() && (
                      <div className="text-xs text-green-600 font-medium">Administrator</div>
                    )}
                  </div>
                  <ChevronDown className="hidden sm:block h-4 w-4 text-gray-500" />
                </Button>
                
                {isDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50">
                    <div className="py-1">
                      <button
                        onClick={() => {
                          setShowChangePassword(true);
                          setIsDropdownOpen(false);
                        }}
                        className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
                      >
                        <Key className="mr-2 h-4 w-4" />
                        Change Password
                      </button>
                      <div className="border-t border-gray-100 my-1"></div>
                      <button
                        onClick={() => {
                          logoutMutation.mutate();
                          setIsDropdownOpen(false);
                        }}
                        disabled={logoutMutation.isPending}
                        className="flex items-center w-full px-4 py-2 text-sm text-red-600 hover:bg-gray-100 focus:outline-none focus:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <LogOut className="mr-2 h-4 w-4" />
                        {logoutMutation.isPending ? "Signing Out..." : "Sign Out"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Mobile slide-out menu */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40" onClick={() => setIsMobileMenuOpen(false)}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black bg-opacity-50" />
          
          {/* Menu panel */}
          <div 
            ref={mobileMenuRef}
            className="absolute left-0 top-0 h-full w-72 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Menu header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
              <div className="flex items-center space-x-2">
                <FileText className="h-6 w-6 text-blue-600" />
                <span className="text-lg font-bold text-gray-900">Menu</span>
              </div>
              <Button
                variant="ghost"
                className="p-2"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <X className="h-5 w-5 text-gray-500" />
              </Button>
            </div>

            {/* Navigation items */}
            <div className="py-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.path;
                
                return (
                  <button
                    key={item.path}
                    onClick={() => handleNavClick(item)}
                    className={cn(
                      "flex items-center w-full px-4 py-3 text-left transition-colors",
                      isActive 
                        ? "bg-blue-50 text-blue-700 border-l-4 border-blue-600" 
                        : "text-gray-700 hover:bg-gray-100 border-l-4 border-transparent"
                    )}
                  >
                    <Icon className={cn("h-5 w-5 mr-3", isActive ? "text-blue-600" : "text-gray-500")} />
                    <span className="font-medium">{item.label}</span>
                    {item.openInNewTab && (
                      <span className="ml-auto text-xs text-gray-400">Opens new tab</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* User section at bottom */}
            {currentUser && (
              <div className="absolute bottom-0 left-0 right-0 border-t border-gray-200 p-4 bg-gray-50">
                <div className="flex items-center space-x-3 mb-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                    <span className="text-white font-medium">
                      {(currentUser as any).firstName?.[0] || (currentUser as any).email?.[0]?.toUpperCase() || 'U'}
                    </span>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">
                      {(currentUser as any).firstName || (currentUser as any).email?.split('@')[0] || 'User'}
                    </div>
                    {isAdmin() && (
                      <div className="text-xs text-green-600 font-medium">Administrator</div>
                    )}
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setShowChangePassword(true);
                      setIsMobileMenuOpen(false);
                    }}
                  >
                    <Key className="h-4 w-4 mr-1" />
                    Password
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-red-600 hover:text-red-700"
                    onClick={() => {
                      logoutMutation.mutate();
                      setIsMobileMenuOpen(false);
                    }}
                    disabled={logoutMutation.isPending}
                  >
                    <LogOut className="h-4 w-4 mr-1" />
                    Sign Out
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Change Password Modal */}
      <ChangePasswordModal 
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
    </>
  );
}