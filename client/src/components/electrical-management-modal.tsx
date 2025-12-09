import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Zap, Printer } from "lucide-react";
import { ElectricalCapacityManagement } from "./electrical-capacity-management";
import type { Property } from "@shared/schema";

interface ElectricalManagementModalProps {
  property: Property;
}

export function ElectricalManagementModal({ property }: ElectricalManagementModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handlePrint = async () => {
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/properties/${property.id}/electrical/print`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Print failed');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      console.error('Electrical print error:', error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex items-center gap-1 text-xs px-2 py-1 h-6">
          <Zap className="h-3 w-3" />
          Manage Electrical
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between pr-12">
          <DialogTitle>Electrical Capacity Management - {property.propertyName}</DialogTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="flex items-center gap-1 mr-2 mt-1"
          >
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </DialogHeader>
        <div className="mt-4">
          <ElectricalCapacityManagement 
            propertyId={property.id} 
            propertyName={property.propertyName || 'Property'}
            property={property}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}