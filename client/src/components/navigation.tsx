import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Home, FileText, BarChart3, Users, Building, Calculator, Settings } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

export default function Navigation() {
  const [location] = useLocation();
  const { isAdmin } = usePermissions();

  // Base navigation items
  const baseNavItems = [
    { path: "/", label: "Dashboard", icon: Home },
    { path: "/contacts", label: "Contacts", icon: Users },
    { path: "/properties", label: "Properties", icon: Building },
    { path: "/rom-pilot", label: "ROM Pilot", icon: Calculator },
    { path: "/reports", label: "Reports", icon: BarChart3 },
  ];

  // Add admin item if user is admin
  const adminItems = isAdmin() ? [{ path: "/admin", label: "Admin Panel", icon: Settings }] : [];
  const navItems = [...baseNavItems, ...adminItems];

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-3">
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
    </nav>
  );
}