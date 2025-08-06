import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
// Removed Select import - using native HTML selects for consistency
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Settings, Shield, Users, Building, BarChart3, FileText, Workflow, Calculator, ChevronDown } from "lucide-react";

interface Contact {
  id: number;
  name: string;
  email: string;
  company: string | null;
  type: string;
  permissions: string[];
}

interface ContactPermissionsModalProps {
  contact: Contact | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ContactPermissionsModal({ contact, isOpen, onClose }: ContactPermissionsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<string>("custom");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [originalPermissions, setOriginalPermissions] = useState<string[]>([]);

  // Permission categories aligned with main navigation
  const permissionCategories = [
    {
      id: 'contacts',
      title: 'Contacts',
      description: 'Contact management and communication',
      icon: Users,
      permissions: [
        { id: 'contacts.view', label: 'View Contacts' },
        { id: 'contacts.create', label: 'Create Contacts' },
        { id: 'contacts.edit', label: 'Edit Contacts' },
        { id: 'contacts.delete', label: 'Delete Contacts' },
      ]
    },
    {
      id: 'properties',
      title: 'Properties',
      description: 'Property and bay management',
      icon: Building,
      permissions: [
        { id: 'properties.view', label: 'View Properties' },
        { id: 'properties.create', label: 'Create Properties' },
        { id: 'properties.edit', label: 'Edit Properties' },
        { id: 'properties.delete', label: 'Delete Properties' },
      ]
    },
    {
      id: 'rom',
      title: 'ROM Pilot',
      description: 'Create and manage rough order of magnitude cost estimates',
      icon: Calculator,
      permissions: [
        { id: 'rom.view', label: 'View' },
        { id: 'rom.create', label: 'Create' },
        { id: 'rom.edit', label: 'Edit' },
        { id: 'rom.delete', label: 'Delete' },
        { id: 'rom.scope.manage', label: 'Manage Scope Items' },
      ]
    },
    {
      id: 'reports',
      title: 'Reports & Analytics',
      description: 'Access executive summaries, financial reports, and historical data',
      icon: FileText,
      permissions: [
        { id: 'reports.view', label: 'View' },
        { id: 'reports.generate', label: 'Generate' },
      ]
    },
    {
      id: 'rfp',
      title: 'RFP Management',
      description: 'Request for Proposal workflow',
      icon: Workflow,
      permissions: [
        { id: 'rfp.view', label: 'View RFPs' },
        { id: 'rfp.create', label: 'Create RFPs' },
        { id: 'rfp.edit', label: 'Edit RFPs' },
        { id: 'rfp.delete', label: 'Delete RFPs' },
      ]
    },
    {
      id: 'rfp-workflow',
      title: 'RFP Workflow Steps',
      description: 'Control which workflow steps user can access',
      icon: Workflow,
      permissions: [
        { id: 'rfp.step.1', label: 'Step 1: RFP Entry' },
        { id: 'rfp.step.2', label: 'Step 2: Invitation to Bid' },
        { id: 'rfp.step.3', label: 'Step 3: Bid Collection' },
        { id: 'rfp.step.4', label: 'Step 4: Evaluation' },
        { id: 'rfp.step.5', label: 'Step 5: Award' },
        { id: 'rfp.step.6', label: 'Step 6: Publish' },
      ]
    },
    {
      id: 'admin',
      title: 'Admin Panel',
      description: 'System administration and user management',
      icon: Shield,
      permissions: [
        { id: 'admin.access', label: 'Admin Panel Access' },
        { id: 'users.view', label: 'View Users' },
        { id: 'users.create', label: 'Create Users' },
        { id: 'users.edit', label: 'Edit Users' },
        { id: 'users.delete', label: 'Delete Users' },
      ]
    }
  ];

  // Predefined roles
  const roles = [
    {
      id: 'admin',
      label: 'Admin',
      description: 'Full system access including admin panel',
      permissions: [
        'admin.access', 'users.view', 'users.create', 'users.edit', 'users.delete',
        'contacts.view', 'contacts.create', 'contacts.edit', 'contacts.delete',
        'properties.view', 'properties.create', 'properties.edit', 'properties.delete',
        'rom.view', 'rom.create', 'rom.edit', 'rom.delete', 'rom.scope.manage',
        'reports.view', 'reports.generate',
        'rfp.view', 'rfp.create', 'rfp.edit', 'rfp.delete',
        'rfp.step.1', 'rfp.step.2', 'rfp.step.3', 'rfp.step.4', 'rfp.step.5', 'rfp.step.6'
      ]
    },
    {
      id: 'manager',
      label: 'Manager',
      description: 'Management level access with most permissions',
      permissions: [
        'contacts.view', 'contacts.create', 'contacts.edit',
        'properties.view', 'properties.create', 'properties.edit',
        'rom.view', 'rom.create', 'rom.edit',
        'reports.view', 'reports.generate',
        'rfp.view', 'rfp.create', 'rfp.edit',
        'rfp.step.1', 'rfp.step.2', 'rfp.step.3', 'rfp.step.4', 'rfp.step.5', 'rfp.step.6',
        'users.view'
      ]
    },
    {
      id: 'user',
      label: 'User',
      description: 'Basic user access - view only with limited RFP steps',
      permissions: [
        'contacts.view',
        'properties.view',
        'rom.view',
        'reports.view',
        'rfp.view',
        'rfp.step.1' // Only Step 1 access by default
      ]
    },
    {
      id: 'custom',
      label: 'Custom',
      description: 'Custom permission set',
      permissions: []
    }
  ];

  useEffect(() => {
    if (contact && isOpen) {
      const currentPermissions = contact.permissions || [];
      setSelectedPermissions([...currentPermissions]);
      setOriginalPermissions([...currentPermissions]);
      
      // Try to match to a predefined role
      const matchingRole = roles.find(role => 
        role.id !== 'custom' &&
        role.permissions.length === currentPermissions.length &&
        role.permissions.every(perm => currentPermissions.includes(perm))
      );
      
      setSelectedRole(matchingRole?.id || 'custom');
    }
  }, [contact, isOpen]);

  const handleRoleChange = (roleId: string) => {
    setSelectedRole(roleId);
    const role = roles.find(r => r.id === roleId);
    if (role) {
      setSelectedPermissions([...role.permissions]);
    }
  };

  const handlePermissionToggle = (permissionId: string) => {
    const updated = selectedPermissions.includes(permissionId)
      ? selectedPermissions.filter(p => p !== permissionId)
      : [...selectedPermissions, permissionId];
    
    setSelectedPermissions(updated);
    
    // Check if still matches a predefined role
    const matchingRole = roles.find(role => 
      role.id !== 'custom' &&
      role.permissions.length === updated.length &&
      role.permissions.every(perm => updated.includes(perm))
    );
    
    setSelectedRole(matchingRole?.id || 'custom');
  };

  const updatePermissionsMutation = useMutation({
    mutationFn: async (data: { permissions: string[] }) => {
      return await apiRequest(`/api/contacts/${contact?.id}/permissions`, 'PATCH', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/authorized-contacts'] });
      setOriginalPermissions([...selectedPermissions]);
      toast({
        title: "Permissions Updated",
        description: "Contact permissions have been updated successfully.",
        duration: 4000,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update permissions. Please try again.",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const handleSave = () => {
    updatePermissionsMutation.mutate({ permissions: selectedPermissions });
  };

  const handleCancel = () => {
    setSelectedPermissions([...originalPermissions]);
    const matchingRole = roles.find(role => 
      role.id !== 'custom' &&
      role.permissions.length === originalPermissions.length &&
      role.permissions.every(perm => originalPermissions.includes(perm))
    );
    setSelectedRole(matchingRole?.id || 'custom');
    onClose();
  };

  if (!contact) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleCancel}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Manage Permissions - {contact.name}
          </DialogTitle>
          <DialogDescription>
            Configure access permissions for {contact.name} ({contact.email})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Role Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Permission Role</CardTitle>
              <CardDescription>
                Choose a predefined role or create a custom permission set
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <select
                  value={selectedRole}
                  onChange={(e) => handleRoleChange(e.target.value)}
                  className="w-full h-10 px-3 py-2 text-sm bg-background border border-input rounded-md appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="">Select a role</option>
                  {roles.map(role => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
              
              {selectedRole !== 'custom' && (
                <div className="mt-2 text-sm text-muted-foreground">
                  {roles.find(r => r.id === selectedRole)?.description}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Permission Categories */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Granular Permissions</CardTitle>
              <CardDescription>
                Fine-tune specific permissions within each area
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {permissionCategories.map((category) => {
                const categoryPermissions = category.permissions.map(p => p.id);
                const hasAnyPermission = categoryPermissions.some(p => selectedPermissions.includes(p));
                const hasAllPermissions = categoryPermissions.every(p => selectedPermissions.includes(p));
                
                return (
                  <div key={category.id} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <category.icon className="h-5 w-5 text-blue-600" />
                      <div className="flex-1">
                        <h3 className="font-semibold">{category.title}</h3>
                        <p className="text-sm text-muted-foreground">{category.description}</p>
                      </div>
                      <Badge variant={hasAnyPermission ? "default" : "secondary"}>
                        {hasAllPermissions ? "Full Access" : hasAnyPermission ? "Limited" : "No Access"}
                      </Badge>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3 ml-8">
                      {category.permissions.map((permission) => (
                        <div key={permission.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={permission.id}
                            checked={selectedPermissions.includes(permission.id)}
                            onCheckedChange={() => handlePermissionToggle(permission.id)}
                          />
                          <Label 
                            htmlFor={permission.id}
                            className="text-sm font-normal cursor-pointer"
                          >
                            {permission.label}
                          </Label>
                        </div>
                      ))}
                    </div>
                    
                    <Separator />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex justify-between">
            <div className="text-sm text-muted-foreground">
              {selectedPermissions.length} permissions selected
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button 
                onClick={handleSave}
                disabled={updatePermissionsMutation.isPending}
              >
                {updatePermissionsMutation.isPending ? "Saving..." : "Save Permissions"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}