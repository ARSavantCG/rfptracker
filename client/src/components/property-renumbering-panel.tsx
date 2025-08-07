import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Hash, RefreshCw, AlertTriangle, CheckCircle } from "lucide-react";
import type { Property } from "@shared/schema";

interface PropertyMapping {
  oldId: number;
  newId: number;
  propertyName: string;
  building?: string;
  hasConflict: boolean;
}

export function PropertyRenumberingPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mappings, setMappings] = useState<PropertyMapping[]>([]);
  const [isChanged, setIsChanged] = useState(false);

  // Fetch all properties
  const { data: properties = [], isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  // Initialize mappings when properties load
  useEffect(() => {
    if (properties.length > 0 && mappings.length === 0) {
      const initialMappings = properties
        .sort((a: Property, b: Property) => a.id - b.id)
        .map((prop: Property) => ({
          oldId: prop.id,
          newId: prop.id,
          propertyName: prop.propertyName,
          building: prop.building,
          hasConflict: false
        }));
      setMappings(initialMappings);
    }
  }, [properties, mappings.length]);

  // Check for conflicts whenever mappings change
  useEffect(() => {
    const newIdCounts = new Map();
    mappings.forEach(mapping => {
      const count = newIdCounts.get(mapping.newId) || 0;
      newIdCounts.set(mapping.newId, count + 1);
    });

    const updatedMappings = mappings.map(mapping => ({
      ...mapping,
      hasConflict: newIdCounts.get(mapping.newId) > 1
    }));

    setMappings(updatedMappings);
  }, []); // Only run when mappings structure changes, not values

  const updateMapping = (oldId: number, newId: number) => {
    const updated = mappings.map(mapping => 
      mapping.oldId === oldId 
        ? { ...mapping, newId: parseInt(newId.toString()) || mapping.oldId }
        : mapping
    );
    
    // Check for conflicts
    const newIdCounts = new Map();
    updated.forEach(mapping => {
      const count = newIdCounts.get(mapping.newId) || 0;
      newIdCounts.set(mapping.newId, count + 1);
    });

    const finalMappings = updated.map(mapping => ({
      ...mapping,
      hasConflict: newIdCounts.get(mapping.newId) > 1
    }));

    setMappings(finalMappings);
    setIsChanged(finalMappings.some(m => m.oldId !== m.newId));
  };

  const resetMappings = () => {
    const resetMappings = mappings.map(mapping => ({
      ...mapping,
      newId: mapping.oldId,
      hasConflict: false
    }));
    setMappings(resetMappings);
    setIsChanged(false);
  };

  const generateSequentialIds = () => {
    const sequential = mappings.map((mapping, index) => ({
      ...mapping,
      newId: index + 1,
      hasConflict: false
    }));
    setMappings(sequential);
    setIsChanged(true);
  };

  const renumberMutation = useMutation({
    mutationFn: async () => {
      const changedMappings = mappings.filter(m => m.oldId !== m.newId);
      if (changedMappings.length === 0) {
        throw new Error("No changes to apply");
      }
      
      return await apiRequest('/api/properties/renumber', 'POST', {
        mappings: changedMappings
      });
    },
    onSuccess: () => {
      toast({
        title: "Properties Renumbered",
        description: "Property IDs have been updated successfully. All related RFP records have been updated.",
        duration: 4000,
      });
      
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      setIsChanged(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Renumbering Failed",
        description: error.message || "Failed to renumber properties",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const hasConflicts = mappings.some(m => m.hasConflict);
  const changedCount = mappings.filter(m => m.oldId !== m.newId).length;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin mr-2" />
            Loading properties...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hash className="h-5 w-5" />
            <CardTitle>Property Renumbering</CardTitle>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={resetMappings}
              disabled={!isChanged || renumberMutation.isPending}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Reset
            </Button>
            <Button
              variant="outline"
              onClick={generateSequentialIds}
              disabled={renumberMutation.isPending}
            >
              Auto-Sequential
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  disabled={!isChanged || hasConflicts || renumberMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Apply Renumbering ({changedCount})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm Property Renumbering</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently change property IDs and update all related RFP records. 
                    {changedCount} properties will be renumbered. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => renumberMutation.mutate()}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Apply Changes
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        <CardDescription>
          Manage property ID numbering for sequential organization. Changes will automatically update all related RFP records.
          {hasConflicts && (
            <div className="flex items-center gap-2 mt-2 p-2 bg-red-50 border border-red-200 rounded">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <span className="text-red-700 text-sm">Duplicate IDs detected. Please resolve conflicts before applying changes.</span>
            </div>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4 text-sm font-medium text-gray-700 border-b pb-2">
            <div>Property Name</div>
            <div>Current ID</div>
            <div>New ID</div>
            <div>Status</div>
          </div>
          
          {mappings.map((mapping) => (
            <div key={mapping.oldId} className="grid grid-cols-4 gap-4 items-center py-2 border-b">
              <div className="font-medium">
                {mapping.propertyName}
                {mapping.building && (
                  <span className="text-gray-500 ml-1">- Bldg. {mapping.building}</span>
                )}
              </div>
              
              <div className="text-gray-600">{mapping.oldId}</div>
              
              <div>
                <Input
                  type="number"
                  value={mapping.newId}
                  onChange={(e) => updateMapping(mapping.oldId, parseInt(e.target.value) || mapping.oldId)}
                  className={`w-20 ${mapping.hasConflict ? 'border-red-500 bg-red-50' : ''}`}
                  min="1"
                />
              </div>
              
              <div>
                {mapping.hasConflict ? (
                  <Badge variant="destructive" className="text-xs">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Conflict
                  </Badge>
                ) : mapping.oldId !== mapping.newId ? (
                  <Badge variant="secondary" className="text-xs">
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Changed
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    No Change
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
        
        {changedCount > 0 && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
            <div className="text-sm text-blue-800">
              <strong>Summary:</strong> {changedCount} properties will be renumbered. 
              All RFP requests referencing these properties will be automatically updated.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}