import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Home, FileText, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Navigation() {
  const [location] = useLocation();

  const navItems = [
    { path: "/", label: "Dashboard", icon: Home },
    { path: "/reports", label: "Reports", icon: BarChart3 },
  ];

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