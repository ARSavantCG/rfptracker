import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClipboardList, Save, AlertCircle, Edit, X, Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { Property } from '@shared/schema';

interface BuildingSpecificationsModalProps {
  property: Property;
}

interface BuildingSpecifications {
  slabThickness?: string;
  clearHeight?: string;
  floorFlatness?: string;
  truckApronSlab?: string;
  rampCapacity?: string;
  roofRValue?: string;
  firePumpInfo?: string;
  fireSprinklerInfo?: string;
}

export function BuildingSpecificationsModal({ property }: BuildingSpecificationsModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [specifications, setSpecifications] = useState<BuildingSpecifications>({
    slabThickness: property.slabThickness || '',
    clearHeight: property.clearHeight || '',
    floorFlatness: property.floorFlatness || '',
    truckApronSlab: property.truckApronSlab || '',
    rampCapacity: property.rampCapacity || '',
    roofRValue: property.roofRValue || '',
    firePumpInfo: property.firePumpInfo || '',
    fireSprinklerInfo: property.fireSprinklerInfo || '',
  });

  const saveMutation = useMutation({
    mutationFn: async (specs: BuildingSpecifications) => {
      return await apiRequest(`/api/properties/${property.id}`, 'PATCH', specs);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/properties'] });
      toast({
        title: "Success",
        description: "Building specifications updated successfully",
        duration: 4000,
      });
    },
    onError: (error) => {
      console.error('Error saving building specifications:', error);
      toast({
        title: "Error",
        description: "Failed to save building specifications",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const handleSave = () => {
    saveMutation.mutate(specifications, {
      onSuccess: () => {
        setIsEditing(false);
      }
    });
  };

  const handleCancel = () => {
    // Reset to original values
    setSpecifications({
      slabThickness: property.slabThickness || '',
      clearHeight: property.clearHeight || '',
      floorFlatness: property.floorFlatness || '',
      truckApronSlab: property.truckApronSlab || '',
      rampCapacity: property.rampCapacity || '',
      roofRValue: property.roofRValue || '',
      firePumpInfo: property.firePumpInfo || '',
      fireSprinklerInfo: property.fireSprinklerInfo || '',
    });
    setIsEditing(false);
  };

  const handlePrint = async () => {
    try {
      const token = localStorage.getItem('auth-token');
      
      if (!token) {
        toast({
          title: "Authentication required",
          description: "Please log in to generate building specifications report",
          variant: "destructive",
          duration: 6000,
        });
        return;
      }
      
      const response = await fetch(`/api/properties/${property.id}/building-specifications/print`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.status === 401) {
        toast({
          title: "Authentication expired",
          description: "Please log in again to generate the report",
          variant: "destructive",
          duration: 6000,
        });
        return;
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Get HTML content and open in new window for PDF conversion
      const html = await response.text();
      const blob = new Blob([html], { type: 'text/html' });
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => window.URL.revokeObjectURL(url), 100);
      
      toast({
        title: "Report opened",
        description: "Building specifications report opened in new window. Use browser's print function to save as PDF.",
        duration: 4000,
      });
    } catch (error) {
      console.error('Print error:', error);
      toast({
        title: "Error",
        description: `Failed to generate building specifications report: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
        duration: 6000,
      });
    }
  };

  const handleInputChange = (field: keyof BuildingSpecifications, value: string) => {
    setSpecifications(prev => ({
      ...prev,
      [field]: value
    }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1"
        >
          <ClipboardList className="h-3 w-3" />
          Building Specs
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Building Specifications - {property.propertyName}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                className="gap-2"
              >
                <Printer className="h-4 w-4" />
                Print
              </Button>
              {!isEditing ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                  className="gap-2"
                >
                  <Edit className="h-4 w-4" />
                  Edit
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancel}
                    className="gap-2"
                  >
                    <X className="h-4 w-4" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saveMutation.isPending}
                    className="gap-2"
                  >
                    <Save className="h-4 w-4" />
                    {saveMutation.isPending ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Structural Specifications */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Structural Specifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="slabThickness">Slab Thickness & PSI</Label>
                  <Input
                    id="slabThickness"
                    placeholder="e.g., 6 inches @ 4000 PSI"
                    value={specifications.slabThickness}
                    onChange={(e) => handleInputChange('slabThickness', e.target.value)}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label htmlFor="clearHeight">Clear Height</Label>
                  <Input
                    id="clearHeight"
                    placeholder="e.g., 32 feet"
                    value={specifications.clearHeight}
                    onChange={(e) => handleInputChange('clearHeight', e.target.value)}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label htmlFor="floorFlatness">Floor Flatness/Level (FF/FL)</Label>
                  <Input
                    id="floorFlatness"
                    placeholder="e.g., FF 25 / FL 20"
                    value={specifications.floorFlatness}
                    onChange={(e) => handleInputChange('floorFlatness', e.target.value)}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label htmlFor="truckApronSlab">Truck Apron Slab</Label>
                  <Input
                    id="truckApronSlab"
                    placeholder="e.g., 8 inches @ 4000 PSI"
                    value={specifications.truckApronSlab}
                    onChange={(e) => handleInputChange('truckApronSlab', e.target.value)}
                    disabled={!isEditing}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Operational Specifications */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Operational Specifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="rampCapacity">Ramp Capacity</Label>
                  <Input
                    id="rampCapacity"
                    placeholder="e.g., 80,000 lbs (leave blank if no ramps)"
                    value={specifications.rampCapacity}
                    onChange={(e) => handleInputChange('rampCapacity', e.target.value)}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label htmlFor="roofRValue">Roof R-Value</Label>
                  <Input
                    id="roofRValue"
                    placeholder="e.g., R-30"
                    value={specifications.roofRValue}
                    onChange={(e) => handleInputChange('roofRValue', e.target.value)}
                    disabled={!isEditing}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Fire & Safety Systems */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Fire & Safety Systems</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="firePumpInfo">Fire Pump Information</Label>
                <Input
                  id="firePumpInfo"
                  placeholder="e.g., 1500 GPM @ 100 PSI"
                  value={specifications.firePumpInfo}
                  onChange={(e) => handleInputChange('firePumpInfo', e.target.value)}
                  disabled={!isEditing}
                />
              </div>
              <div>
                <Label htmlFor="fireSprinklerInfo">Fire Sprinkler System</Label>
                <Textarea
                  id="fireSprinklerInfo"
                  placeholder="e.g., Standard ESFR system with 55-gallon drums storage capacity"
                  value={specifications.fireSprinklerInfo}
                  onChange={(e) => handleInputChange('fireSprinklerInfo', e.target.value)}
                  rows={3}
                  disabled={!isEditing}
                />
              </div>
            </CardContent>
          </Card>



          {/* Info Note */}
          <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">Building Specifications Usage</p>
              <p>These specifications will be available for inclusion in RFP documents and lease documentation. Fill in the information that's relevant to your property - not all fields are required.</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}