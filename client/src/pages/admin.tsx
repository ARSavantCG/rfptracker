import { useState, useEffect } from "react";
import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Users, Settings, Edit, Trash2, CheckCircle, XCircle, User as UserIcon, KeyRound, FileText, HardDrive, Layout, Clock, Scale, ChevronDown, Hash, BarChart, ExternalLink, Mail, ClipboardCheck, Tags, Database, Wrench, CloudUpload, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { apiRequest } from "@/lib/queryClient";
import Navigation from "@/components/navigation";
import ContactPasswordModal from "@/components/contact-password-modal";
import AdminResetPasswordModal from "@/components/admin-reset-password-modal";
import { FileCleanupPanel } from "@/components/file-cleanup-panel";
import { RfpDocumentEditor } from "@/components/rfp-document-editor-fixed";
import { EnhancedRfpCustomizer } from "@/components/enhanced-rfp-customizer";
import { TimezoneAdminPanel } from "@/components/timezone-admin-panel";
import { LegalCompliancePanel } from "@/components/legal-compliance-panel";
import { PropertyRenumberingPanel } from "@/components/property-renumbering-panel";
import { TemplatesManagement } from "@/components/templates-management";
import type { User, UserRole, Permission } from "@shared/schema";
import { ROLE_PERMISSIONS } from "@shared/schema";

function SystemUsersAndContacts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [selectedContactForPassword, setSelectedContactForPassword] = useState<any>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedContactForReset, setSelectedContactForReset] = useState<any>(null);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: authorizedContacts, isLoading: contactsLoading } = useQuery({
    queryKey: ["/api/admin/authorized-contacts"],
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/api/admin/users/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Success",
        description: "User deleted successfully",
        duration: 4000,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<User> }) => {
      return await apiRequest(`/api/admin/users/${id}`, "PATCH", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setEditDialogOpen(false);
      setProfileDialogOpen(false);
      setSelectedUser(null);
      toast({
        title: "Success",
        description: "User updated successfully",
        duration: 4000,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const updateContactMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      return await apiRequest(`/api/contacts/${id}`, "PATCH", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/authorized-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setContactDialogOpen(false);
      setSelectedContact(null);
      toast({
        title: "Success",
        description: "Contact permissions updated successfully",
        duration: 4000,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    setEditDialogOpen(true);
  };

  const handleEditProfile = (user: User) => {
    setSelectedUser(user);
    setProfileDialogOpen(true);
  };

  const handleEditContact = (contact: any) => {
    setSelectedContact(contact);
    setContactDialogOpen(true);
  };

  const handleDeleteUser = (id: string) => {
    deleteUserMutation.mutate(id);
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-800';
      case 'manager': return 'bg-blue-100 text-blue-800';
      case 'user': return 'bg-green-100 text-green-800';
      case 'custom': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getContactRole = (contact: any) => {
    if (!contact.permissions || contact.permissions.length === 0) {
      return 'User';
    }
    
    // Check for admin permissions
    if (contact.permissions.includes('admin.access')) {
      return 'Admin';
    }
    
    // Check for manager-level permissions (can create/edit/delete across all areas)
    const hasCreatePermissions = contact.permissions.some((p: string) => p.includes('.create'));
    const hasEditPermissions = contact.permissions.some((p: string) => p.includes('.edit'));
    const hasDeletePermissions = contact.permissions.some((p: string) => p.includes('.delete'));
    
    // Full manager has all three types across multiple areas
    if (hasCreatePermissions && hasEditPermissions && hasDeletePermissions) {
      const createCount = contact.permissions.filter((p: string) => p.includes('.create')).length;
      const editCount = contact.permissions.filter((p: string) => p.includes('.edit')).length;
      const deleteCount = contact.permissions.filter((p: string) => p.includes('.delete')).length;
      
      // If they have comprehensive permissions (3+ of each type), they're a manager
      if (createCount >= 3 && editCount >= 3 && deleteCount >= 3) {
        return 'Manager';
      }
    }
    
    // If has any create/edit/delete permissions or special permissions like reports.generate, it's custom
    if (hasCreatePermissions || hasEditPermissions || hasDeletePermissions || 
        contact.permissions.includes('reports.generate') || 
        contact.permissions.includes('users.view')) {
      return 'Custom';
    }
    
    // Otherwise just basic view permissions = User
    return 'User';
  };

  if (usersLoading || contactsLoading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="text-gray-600 mt-2">Loading users and contacts...</p>
      </div>
    );
  }

  // Sort contacts alphabetically by name
  const sortedContacts = authorizedContacts ? [...authorizedContacts].sort((a, b) => 
    a.name.localeCompare(b.name)
  ) : [];

  return (
    <div className="space-y-6">
      {/* System Users Section */}
      {users && users.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Admin Users</h3>
          <div className="space-y-4">
            {users.map((user: User) => (
              <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-blue-600 font-medium">
                      {user.firstName?.[0] || user.email?.[0] || 'U'}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">
                      {user.firstName && user.lastName 
                        ? `${user.firstName} ${user.lastName}`
                        : user.email
                      }
                    </h3>
                    <p className="text-sm text-gray-600">{user.email}</p>
                    <div className="flex items-center space-x-2 mt-1">
                      <Badge className={getRoleBadgeColor(user.role)}>
                        {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                      </Badge>
                      {user.isActive ? (
                        <div className="flex items-center text-green-600 text-sm">
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Active
                        </div>
                      ) : (
                        <div className="flex items-center text-red-600 text-sm">
                          <XCircle className="h-4 w-4 mr-1" />
                          Inactive
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEditProfile(user)}
                  >
                    <UserIcon className="h-4 w-4 mr-1" />
                    Edit Profile
                  </Button>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEditUser(user)}
                  >
                    <Settings className="h-4 w-4 mr-1" />
                    Permissions
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Authorized Contacts Section */}
      {sortedContacts.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Authorized Ownership Contacts</h3>
          <div className="space-y-4">
            {sortedContacts.map((contact: any) => (
              <div key={contact.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                    <span className="text-purple-600 font-medium">
                      {contact.name?.[0] || 'U'}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">{contact.name}</h3>
                    <p className="text-sm text-gray-600">{contact.email}</p>
                    <p className="text-xs text-gray-500">{contact.company}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge variant="default" className={getRoleBadgeColor(getContactRole(contact).toLowerCase())}>
                    {getContactRole(contact)}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEditContact(contact)}
                  >
                    <Settings className="h-4 w-4 mr-1" />
                    Permissions
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedContactForReset(contact);
                      setShowResetPasswordModal(true);
                    }}
                  >
                    <KeyRound className="h-4 w-4 mr-1" />
                    {contact.passwordHash ? 'Reset Password' : 'Set Password'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {(!users || users.length === 0) && sortedContacts.length === 0 && (
        <div className="text-center py-8">
          <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">No system users or authorized contacts yet</p>
          <p className="text-sm text-gray-500 mt-2">
            Grant system access to owner contacts in the Contacts section
          </p>
        </div>
      )}

      {/* User Edit Dialog */}
      <UserEditDialog
        user={selectedUser}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSave={(updates) => {
          if (selectedUser) {
            updateUserMutation.mutate({ id: selectedUser.id, updates });
          }
        }}
        isSaving={updateUserMutation.isPending}
      />

      {/* User Profile Dialog */}
      {selectedUser && (
        <UserProfileDialog
          user={selectedUser}
          open={profileDialogOpen}
          onOpenChange={setProfileDialogOpen}
          onSave={(updates) => {
            updateUserMutation.mutate({ id: selectedUser.id, updates });
          }}
          onDelete={(userId) => deleteUserMutation.mutate(userId)}
          isSaving={updateUserMutation.isPending}
          isDeleting={deleteUserMutation.isPending}
        />
      )}

      {/* Contact Permissions Dialog */}
      {selectedContact && (
        <ContactPermissionsDialog
          contact={selectedContact}
          open={contactDialogOpen}
          onOpenChange={setContactDialogOpen}
          onSave={(updates) => {
            updateContactMutation.mutate({ id: selectedContact.id, updates });
          }}
          isSaving={updateContactMutation.isPending}
        />
      )}

      {/* Contact Password Modal */}
      <ContactPasswordModal
        contact={selectedContactForPassword}
        open={showPasswordModal}
        onClose={() => {
          setShowPasswordModal(false);
          setSelectedContactForPassword(null);
        }}
      />

      {/* Admin Reset Password Modal */}
      <AdminResetPasswordModal
        contact={selectedContactForReset}
        isOpen={showResetPasswordModal}
        onClose={() => {
          setShowResetPasswordModal(false);
          setSelectedContactForReset(null);
        }}
      />
    </div>
  );
}

// Contact Permissions Dialog Component
interface ContactPermissionsDialogProps {
  contact: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updates: any) => void;
  isSaving: boolean;
}

function ContactPermissionsDialog({ contact, open, onOpenChange, onSave, isSaving }: ContactPermissionsDialogProps) {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>('custom');
  const [originalPermissions, setOriginalPermissions] = useState<Permission[]>([]);
  const [originalRole, setOriginalRole] = useState<string>('custom');

  // Update state when contact changes or dialog opens
  useEffect(() => {
    if (contact && open) {
      const currentPerms = contact.permissions || [];
      setPermissions([...currentPerms]);
      setOriginalPermissions([...currentPerms]);
      
      // Determine current role based on permissions
      let role = 'custom';
      if (currentPerms.length === 0) {
        role = 'user';
      } else if (currentPerms.includes('admin.access')) {
        role = 'admin';
      } else if (currentPerms.includes('users.view') || currentPerms.includes('users.edit')) {
        role = 'manager';
      }
      
      setSelectedRole(role);
      setOriginalRole(role);
    }
  }, [contact, open]);

  const togglePermission = (permission: Permission) => {
    setPermissions(prev => 
      prev.includes(permission)
        ? prev.filter(p => p !== permission)
        : [...prev, permission]
    );
    setSelectedRole('custom'); // Switch to custom when manually changing permissions
  };

  const handleRoleChange = (role: string) => {
    setSelectedRole(role);
    
    // Apply role-based permissions
    switch (role) {
      case 'admin':
        setPermissions([
          'rfp.create', 'rfp.edit', 'rfp.delete', 'rfp.view',
          'properties.create', 'properties.edit', 'properties.delete', 'properties.view',
          'contacts.create', 'contacts.edit', 'contacts.delete', 'contacts.view',
          'rom.create', 'rom.edit', 'rom.delete', 'rom.view', 'rom.scope.manage',
          'reports.view', 'reports.generate',
          'users.create', 'users.edit', 'users.delete', 'users.view',
          'admin.access'
        ]);
        break;
      case 'manager':
        setPermissions([
          'rfp.create', 'rfp.edit', 'rfp.view',
          'properties.create', 'properties.edit', 'properties.view',
          'contacts.create', 'contacts.edit', 'contacts.view',
          'rom.create', 'rom.edit', 'rom.view',
          'reports.view', 'reports.generate',
          'users.view'
        ]);
        break;
      case 'user':
        setPermissions([
          'rfp.view',
          'properties.view',
          'contacts.view',
          'rom.view',
          'reports.view'
        ]);
        break;
      case 'custom':
        // Keep current permissions for custom
        break;
    }
  };

  const handleSave = () => {
    onSave({
      permissions,
    });
  };

  const handleCancel = () => {
    // Revert to original state
    setPermissions([...originalPermissions]);
    setSelectedRole(originalRole);
    onOpenChange(false);
  };

  if (!contact) return null;

  const permissionCategories = {
    'RFP Management': {
      permissions: ['rfp.create', 'rfp.edit', 'rfp.delete', 'rfp.view'] as Permission[],
      description: 'Control RFP creation, editing, and workflow management'
    },
    'Properties': {
      permissions: ['properties.create', 'properties.edit', 'properties.delete', 'properties.view'] as Permission[],
      description: 'Manage property configurations and bay calculations'
    },
    'Contacts': {
      permissions: ['contacts.create', 'contacts.edit', 'contacts.delete', 'contacts.view'] as Permission[],
      description: 'Handle contractor, architect, and ownership contact data'
    },
    'Reports & Analytics': {
      permissions: ['reports.view', 'reports.generate'] as Permission[],
      description: 'Access executive summaries, financial reports, and historical data'
    },
    'User Administration': {
      permissions: ['users.create', 'users.edit', 'users.delete', 'users.view'] as Permission[],
      description: 'Manage user accounts and permission assignments'
    },
    'System Administration': {
      permissions: ['admin.access'] as Permission[],
      description: 'Full system access and administrative controls'
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        handleCancel();
      } else {
        onOpenChange(isOpen);
      }
    }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Contact Permissions - {contact.name}</span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Contact Info */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                <span className="text-purple-600 font-medium text-lg">
                  {contact.name?.[0] || 'C'}
                </span>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">{contact.name}</h3>
                <p className="text-sm text-gray-600">{contact.email}</p>
                <p className="text-xs text-gray-500">{contact.company}</p>
                <div className="flex items-center space-x-2 mt-1">
                  <Badge variant="default">Owner</Badge>
                  <Badge variant="default" className="bg-green-100 text-green-800">
                    System Access
                  </Badge>
                </div>
              </div>
            </div>
          </div>

          {/* User Role Selection */}
          <div className="space-y-4">
            <label className="text-base font-medium">User Role</label>
            <div className="relative">
              <select
                value={selectedRole}
                onChange={(e) => handleRoleChange(e.target.value)}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
              >
                <option value="">Select a role</option>
                <option value="admin">Admin - Full system access</option>
                <option value="manager">Manager - Advanced access</option>
                <option value="user">User - View only access</option>
                <option value="custom">Custom - Manual permissions</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
            </div>
            <p className="text-sm text-gray-600">
              Selecting a role applies default permissions. You can customize individual permissions below.
            </p>
          </div>

          {/* Account Status */}
          <div className="space-y-4">
            <label className="text-base font-medium">Account Status</label>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="account-active"
                checked={true}
                disabled={true}
              />
              <label htmlFor="account-active" className="text-sm font-medium">
                Account Active - User can access the system
              </label>
            </div>
          </div>

          {/* Granular Permissions */}
          <div className="space-y-4">
            <label className="text-base font-medium">Granular Permissions</label>
            <p className="text-sm text-gray-600">
              Fine-tune what this ownership contact can access and modify in the system.
            </p>
            
            <div className="space-y-4">
              {Object.entries(permissionCategories).map(([category, { permissions: categoryPerms, description }]) => {
                const hasAnyPermission = categoryPerms.some(perm => permissions.includes(perm));
                const hasAllPermissions = categoryPerms.every(perm => permissions.includes(perm));
                
                return (
                  <div key={category} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{category}</h4>
                        <p className="text-sm text-gray-600 mt-1">{description}</p>
                      </div>
                      <Badge 
                        variant={hasAllPermissions ? "default" : hasAnyPermission ? "secondary" : "outline"}
                        className="ml-3"
                      >
                        {hasAllPermissions ? "Full Access" : hasAnyPermission ? "Partial" : "No Access"}
                      </Badge>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      {categoryPerms.map(permission => {
                        const isChecked = permissions.includes(permission);
                        const permissionLabel = permission.split('.')[1];
                        const actionLabel = permissionLabel.charAt(0).toUpperCase() + permissionLabel.slice(1);
                        
                        return (
                          <div key={permission} className="flex items-center space-x-2">
                            <Checkbox
                              id={permission}
                              checked={isChecked}
                              onCheckedChange={() => togglePermission(permission)}
                            />
                            <label 
                              htmlFor={permission} 
                              className={`text-sm ${isChecked ? 'text-gray-900 font-medium' : 'text-gray-600'}`}
                            >
                              {actionLabel}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving Changes...' : 'Save Permissions'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface UserProfileDialogProps {
  user: User | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updates: Partial<User>) => void;
  onDelete: (userId: string) => void;
  isSaving: boolean;
  isDeleting: boolean;
}

function UserProfileDialog({ user, open, onOpenChange, onSave, onDelete, isSaving, isDeleting }: UserProfileDialogProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [originalFirstName, setOriginalFirstName] = useState('');
  const [originalLastName, setOriginalLastName] = useState('');
  const [originalEmail, setOriginalEmail] = useState('');

  // Update state when user changes or dialog opens
  React.useEffect(() => {
    if (user && open) {
      const userFirstName = user.firstName || '';
      const userLastName = user.lastName || '';
      const userEmail = user.email || '';
      
      setFirstName(userFirstName);
      setLastName(userLastName);
      setEmail(userEmail);
      
      setOriginalFirstName(userFirstName);
      setOriginalLastName(userLastName);
      setOriginalEmail(userEmail);
    }
  }, [user, open]);

  const handleSave = () => {
    onSave({
      firstName: firstName.trim() || null,
      lastName: lastName.trim() || null,
      email: email.trim() || null,
    });
  };

  const handleCancel = () => {
    // Revert to original state
    setFirstName(originalFirstName);
    setLastName(originalLastName);
    setEmail(originalEmail);
    onOpenChange(false);
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        handleCancel();
      } else {
        onOpenChange(isOpen);
      }
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <UserIcon className="h-5 w-5" />
            <span>Edit User Profile</span>
          </DialogTitle>
          <DialogDescription>
            Update the user's name and contact information.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* User Info Display */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-blue-600 font-medium text-lg">
                  {firstName?.[0] || email?.[0] || 'U'}
                </span>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">User Profile</h3>
                <p className="text-sm text-gray-600">Update name and contact information</p>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Enter first name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Enter last name"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email address"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t space-y-4">
            <div className="flex justify-end space-x-3">
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Profile'}
              </Button>
            </div>
            
            {/* Delete User Section - Small and at bottom */}
            <div className="pt-4 border-t border-gray-100">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 h-6 px-2"
                    disabled={isDeleting}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete User Account
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete User Account</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to permanently delete this user account? This action cannot be undone and will remove all associated data.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        onDelete(user.id);
                        onOpenChange(false);
                      }}
                      className="bg-red-600 hover:bg-red-700"
                      disabled={isDeleting}
                    >
                      {isDeleting ? 'Deleting...' : 'Delete User'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmailTestPanel() {
  const { toast } = useToast();
  const [testEmail, setTestEmail] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleSendTestEmail = async () => {
    if (!testEmail.trim()) {
      toast({
        title: "Error",
        description: "Please enter an email address",
        variant: "destructive",
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(testEmail)) {
      toast({
        title: "Error",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);
    try {
      const token = localStorage.getItem('auth-token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const response = await fetch('/api/email/test', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ email: testEmail }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        toast({
          title: "Success",
          description: `Test email sent to ${testEmail}`,
        });
      } else {
        toast({
          title: "Error",
          description: data.message || "Failed to send test email",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send test email",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Mail className="h-5 w-5" />
          <span>Email Testing</span>
        </CardTitle>
        <CardDescription>
          Send test emails to preview how automated notifications will look
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="font-medium text-blue-900 mb-2">Automated Email Schedule</h3>
          <p className="text-sm text-blue-700">
            Status report emails are automatically sent every <strong>Monday, Wednesday, and Friday at 8 AM</strong> to all contacts tagged as "Owner". 
            Additionally, emails are sent when an RFP is created (Step 1 complete) and when published (Step 6 complete).
          </p>
        </div>

        <div className="space-y-4">
          <h3 className="font-medium text-gray-900">Send Test Status Report</h3>
          <p className="text-sm text-gray-600">
            Send a test status report email to yourself to preview the format before it goes out to Owner contacts.
          </p>
          
          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                type="email"
                placeholder="Enter your email address"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                data-testid="input-test-email"
              />
            </div>
            <Button 
              onClick={handleSendTestEmail}
              disabled={isSending}
              data-testid="button-send-test-email"
            >
              <Mail className="h-4 w-4 mr-2" />
              {isSending ? 'Sending...' : 'Send Test Email'}
            </Button>
          </div>
          
          <p className="text-xs text-gray-500">
            The test email will be marked with [TEST] in the subject line.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Admin() {
  const { isAdmin } = usePermissions();
  const { toast } = useToast();
  const [migrationState, setMigrationState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [migrationResult, setMigrationResult] = useState<{
    total: number;
    succeeded: number;
    failed: number;
    failures: { file: string; error: string }[];
  } | null>(null);

  const handleMigrateUploads = async () => {
    setMigrationState('running');
    setMigrationResult(null);
    try {
      const token = localStorage.getItem('auth-token');
      const res = await fetch('/api/admin/migrate-uploads', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setMigrationResult(data);
      setMigrationState('done');
    } catch (err: any) {
      setMigrationState('error');
      toast({
        title: 'Migration failed',
        description: err.message || 'Unknown error',
        variant: 'destructive',
        duration: 6000,
      });
    }
  };

  if (!isAdmin()) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-center">
          <Shield className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
          <p className="text-gray-600">You need administrator privileges to access this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-center space-x-3">
          <Settings className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
            <p className="text-gray-600">System administration and configuration management</p>
          </div>
        </div>

        <Tabs defaultValue="users" className="w-full">
          <TabsList className="flex flex-wrap w-full gap-1 h-auto p-2">
            <TabsTrigger value="users" className="flex items-center gap-2 flex-shrink-0">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">User Management</span>
              <span className="sm:hidden">Users</span>
            </TabsTrigger>
            <TabsTrigger value="templates" className="flex items-center gap-2 flex-shrink-0">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Document Editor</span>
              <span className="sm:hidden">Docs</span>
            </TabsTrigger>
            <TabsTrigger value="customizer" className="flex items-center gap-2 flex-shrink-0">
              <Layout className="h-4 w-4" />
              <span className="hidden sm:inline">RFP Customizer</span>
              <span className="sm:hidden">RFP</span>
            </TabsTrigger>
            <TabsTrigger value="reports" className="flex items-center gap-2 flex-shrink-0">
              <BarChart className="h-4 w-4" />
              Reports
            </TabsTrigger>
            <TabsTrigger value="storage" className="flex items-center gap-2 flex-shrink-0">
              <HardDrive className="h-4 w-4" />
              <span className="hidden sm:inline">File Storage</span>
              <span className="sm:hidden">Files</span>
            </TabsTrigger>
            <TabsTrigger value="timezone" className="flex items-center gap-2 flex-shrink-0">
              <Clock className="h-4 w-4" />
              <span className="hidden sm:inline">Date & Time</span>
              <span className="sm:hidden">Time</span>
            </TabsTrigger>
            <TabsTrigger value="legal" className="flex items-center gap-2 flex-shrink-0">
              <Scale className="h-4 w-4" />
              <span className="hidden sm:inline">Legal Compliance</span>
              <span className="sm:hidden">Legal</span>
            </TabsTrigger>
            <TabsTrigger value="renumber" className="flex items-center gap-2 flex-shrink-0">
              <Hash className="h-4 w-4" />
              Properties
            </TabsTrigger>
            <TabsTrigger value="rfp-templates" className="flex items-center gap-2 flex-shrink-0">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">RFP Templates</span>
              <span className="sm:hidden">Templates</span>
            </TabsTrigger>
            <TabsTrigger value="email" className="flex items-center gap-2 flex-shrink-0">
              <Mail className="h-4 w-4" />
              <span className="hidden sm:inline">Email Testing</span>
              <span className="sm:hidden">Email</span>
            </TabsTrigger>
            <TabsTrigger value="data-quality" className="flex items-center gap-2 flex-shrink-0">
              <ClipboardCheck className="h-4 w-4" />
              <span className="hidden sm:inline">Data Quality</span>
              <span className="sm:hidden">Data</span>
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="flex items-center gap-2 flex-shrink-0">
              <Wrench className="h-4 w-4" />
              <span className="hidden sm:inline">System Maintenance</span>
              <span className="sm:hidden">Maintenance</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Users className="h-5 w-5" />
                  <span>System Users</span>
                </CardTitle>
                <CardDescription>
                  Manage admin accounts and authorized ownership contacts
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SystemUsersAndContacts />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="templates" className="mt-6">
            <RfpDocumentEditor />
          </TabsContent>

          <TabsContent value="customizer" className="mt-6">
            <EnhancedRfpCustomizer />
          </TabsContent>

          <TabsContent value="reports" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <BarChart className="h-5 w-5" />
                  <span>System Reports</span>
                </CardTitle>
                <CardDescription>
                  Administrative reports for system analysis and data export
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Property Summary Report */}
                  <div className="p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-600" />
                        Property Summary Report
                      </h3>
                      <ExternalLink className="h-4 w-4 text-gray-400" />
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Comprehensive summary of all properties including bay configurations, 
                      building specifications, electrical capacity, and executed leases.
                    </p>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        onClick={() => window.location.href = '/admin/property-summary-report'}
                        className="flex-1"
                      >
                        <FileText className="h-3 w-3 mr-1" />
                        View Report
                      </Button>
                    </div>
                  </div>

                  {/* Vendor Workload Report */}
                  <div className="p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                        <Users className="h-4 w-4 text-green-600" />
                        Vendor Workload Report
                      </h3>
                      <ExternalLink className="h-4 w-4 text-gray-400" />
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Analysis of architect and contractor workloads across all active RFPs 
                      with filtering and PDF export capabilities.
                    </p>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        onClick={() => window.open('/reports', '_blank')}
                        className="flex-1"
                        variant="outline"
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        View in Reports
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                  <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Report Notes:</h4>
                  <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                    <li>• All reports use real-time data from your database</li>
                    <li>• Reports include Bridge Industrial branding and logos</li>
                    <li>• Property Summary includes legal compliance totals</li>
                    <li>• Reports can be viewed in browser or exported as HTML/PDF</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="storage" className="mt-6">
            <FileCleanupPanel />
          </TabsContent>

          <TabsContent value="timezone" className="mt-6">
            <TimezoneAdminPanel />
          </TabsContent>

          <TabsContent value="legal" className="mt-6">
            <LegalCompliancePanel />
          </TabsContent>

          <TabsContent value="renumber" className="mt-6">
            <PropertyRenumberingPanel />
          </TabsContent>

          <TabsContent value="rfp-templates" className="mt-6">
            <TemplatesManagement />
          </TabsContent>

          <TabsContent value="email" className="mt-6">
            <EmailTestPanel />
          </TabsContent>

          <TabsContent value="data-quality" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <ClipboardCheck className="h-5 w-5" />
                  <span>Data Quality Tools</span>
                </CardTitle>
                <CardDescription>
                  Clean and categorize bid data for accurate cost benchmarking and analytics
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Data Scrubbing */}
                  <div className="p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                        <ClipboardCheck className="h-4 w-4 text-green-600" />
                        Data Scrubbing
                      </h3>
                      <ExternalLink className="h-4 w-4 text-gray-400" />
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Mark individual bid line items as "clean" data suitable for analytical 
                      reports and cost benchmarking. Filter and bulk update capabilities.
                    </p>
                    <Button 
                      size="sm" 
                      onClick={() => window.open('/data-scrubbing', '_blank')}
                      className="w-full"
                    >
                      <ClipboardCheck className="h-3 w-3 mr-1" />
                      Open Data Scrubbing
                    </Button>
                  </div>

                  {/* Data Mapping */}
                  <div className="p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                        <Tags className="h-4 w-4 text-blue-600" />
                        Data Mapping
                      </h3>
                      <ExternalLink className="h-4 w-4 text-gray-400" />
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Assign standardized master categories to bid line items for consistent 
                      cost categorization across all projects.
                    </p>
                    <Button 
                      size="sm" 
                      onClick={() => window.open('/data-mapping', '_blank')}
                      className="w-full"
                      variant="outline"
                    >
                      <Tags className="h-3 w-3 mr-1" />
                      Open Data Mapping
                    </Button>
                  </div>

                  {/* Historical Import */}
                  <div className="p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                        <Database className="h-4 w-4 text-green-600" />
                        Historical Project Import
                      </h3>
                      <ExternalLink className="h-4 w-4 text-gray-400" />
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Import historical project actuals (manual entry or CSV) to build cost 
                      intelligence benchmarks and train the ROM pricing system.
                    </p>
                    <Button 
                      size="sm" 
                      onClick={() => window.open('/historical-import', '_blank')}
                      className="w-full"
                      variant="outline"
                    >
                      <Database className="h-3 w-3 mr-1" />
                      Open Historical Import
                    </Button>
                  </div>
                </div>

                <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
                  <h4 className="font-medium text-amber-900 mb-2">Data Quality Workflow:</h4>
                  <ol className="text-sm text-amber-800 space-y-1 list-decimal list-inside">
                    <li>Use <strong>Data Mapping</strong> to assign master categories to unmapped line items</li>
                    <li>Use <strong>Data Scrubbing</strong> to mark reliable pricing data as "clean"</li>
                    <li>Generate reports using only clean, categorized data for accurate benchmarking</li>
                  </ol>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="maintenance" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-gray-600" />
                  System Maintenance
                </CardTitle>
                <CardDescription>
                  One-time administrative operations for system upkeep and data migrations.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="border rounded-lg p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <CloudUpload className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                    <div>
                      <h3 className="font-medium text-gray-900">Migrate Files to Object Storage</h3>
                      <p className="text-sm text-gray-500 mt-1">
                        Backs up all files currently in the local <code className="bg-gray-100 px-1 rounded text-xs">uploads/</code> directory to Replit Object Storage so they persist across redeploys. Safe to run more than once — existing files are simply overwritten.
                      </p>
                    </div>
                  </div>

                  <Button
                    onClick={handleMigrateUploads}
                    disabled={migrationState === 'running'}
                    className="w-full sm:w-auto"
                  >
                    {migrationState === 'running' ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                        Migrating...
                      </>
                    ) : (
                      <>
                        <CloudUpload className="h-4 w-4 mr-2" />
                        Migrate Files to Object Storage
                      </>
                    )}
                  </Button>

                  {migrationState === 'done' && migrationResult && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                        <CheckCircle className="h-5 w-5 shrink-0" />
                        <span className="font-medium">
                          Migration complete — {migrationResult.succeeded} of {migrationResult.total} file{migrationResult.total !== 1 ? 's' : ''} backed up successfully
                        </span>
                      </div>
                      {migrationResult.failures.length > 0 && (
                        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-2">
                          <div className="flex items-center gap-2 text-red-700 font-medium">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            {migrationResult.failed} file{migrationResult.failed !== 1 ? 's' : ''} failed:
                          </div>
                          <ul className="text-sm text-red-600 space-y-1 pl-6 list-disc">
                            {migrationResult.failures.map((f, i) => (
                              <li key={i}>
                                <span className="font-mono">{f.file}</span>
                                {f.error && <span className="text-red-400 ml-2">— {f.error}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

interface UserEditDialogProps {
  user: User | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updates: Partial<User>) => void;
  isSaving: boolean;
}

function UserEditDialog({ user, open, onOpenChange, onSave, isSaving }: UserEditDialogProps) {
  const [role, setRole] = useState<UserRole>('user');
  const [isActive, setIsActive] = useState(true);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [originalRole, setOriginalRole] = useState<UserRole>('user');
  const [originalIsActive, setOriginalIsActive] = useState(true);
  const [originalPermissions, setOriginalPermissions] = useState<Permission[]>([]);

  // Update state when user changes or dialog opens
  React.useEffect(() => {
    if (user && open) {
      const userRole = user.role as UserRole;
      const userActive = user.isActive ?? true;
      const userPerms = user.permissions || [];
      
      setRole(userRole);
      setIsActive(userActive);
      setPermissions([...userPerms]);
      
      setOriginalRole(userRole);
      setOriginalIsActive(userActive);
      setOriginalPermissions([...userPerms]);
    }
  }, [user, open]);

  const togglePermission = (permission: Permission) => {
    setPermissions(prev => 
      prev.includes(permission)
        ? prev.filter(p => p !== permission)
        : [...prev, permission]
    );
  };

  const applyRolePermissions = (newRole: UserRole) => {
    setRole(newRole);
    setPermissions(ROLE_PERMISSIONS[newRole] || []);
  };

  const handleSave = () => {
    onSave({
      role,
      isActive,
      permissions,
    });
  };

  const handleCancel = () => {
    // Revert to original state
    setRole(originalRole);
    setIsActive(originalIsActive);
    setPermissions([...originalPermissions]);
    onOpenChange(false);
  };

  if (!user) return null;

  const permissionCategories = {
    'RFP Management': {
      permissions: ['rfp.create', 'rfp.edit', 'rfp.delete', 'rfp.view'] as Permission[],
      description: 'Control RFP creation, editing, and workflow management'
    },
    'Properties': {
      permissions: ['properties.create', 'properties.edit', 'properties.delete', 'properties.view'] as Permission[],
      description: 'Manage property configurations and bay calculations'
    },
    'Contacts': {
      permissions: ['contacts.create', 'contacts.edit', 'contacts.delete', 'contacts.view'] as Permission[],
      description: 'Handle contractor, architect, and ownership contact data'
    },
    'Reports & Analytics': {
      permissions: ['reports.view', 'reports.generate'] as Permission[],
      description: 'Access executive summaries, financial reports, and historical data'
    },
    'User Administration': {
      permissions: ['users.create', 'users.edit', 'users.delete', 'users.view'] as Permission[],
      description: 'Manage user accounts and permission assignments'
    },
    'System Administration': {
      permissions: ['admin.access'] as Permission[],
      description: 'Full system access and administrative controls'
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        handleCancel();
      } else {
        onOpenChange(isOpen);
      }
    }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>User Permissions - {user.firstName} {user.lastName}</span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* User Info */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-blue-600 font-medium text-lg">
                  {user.firstName?.[0] || user.email?.[0] || 'U'}
                </span>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">
                  {user.firstName && user.lastName 
                    ? `${user.firstName} ${user.lastName}`
                    : user.email
                  }
                </h3>
                <p className="text-sm text-gray-600">{user.email}</p>
              </div>
            </div>
          </div>

          {/* Role Selection */}
          <div className="space-y-3">
            <label htmlFor="role" className="text-base font-medium">User Role</label>
            <div className="relative">
              <select
                id="role"
                value={role}
                onChange={(e) => applyRolePermissions(e.target.value)}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
              >
                <option value="">Select a role</option>
                <option value="admin">Admin - Full system access</option>
                <option value="manager">Manager - Create and edit content</option>
                <option value="user">User - View only access</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
            </div>
            <p className="text-sm text-gray-600">
              Selecting a role applies default permissions. You can customize individual permissions below.
            </p>
          </div>

          {/* Account Status */}
          <div className="space-y-3">
            <label className="text-base font-medium">Account Status</label>
            <div className="flex items-center space-x-3">
              <Checkbox
                id="active"
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked as boolean)}
              />
              <label htmlFor="active" className="text-sm">
                Account Active - User can access the system
              </label>
            </div>
          </div>

          {/* Granular Permissions */}
          <div className="space-y-4">
            <label className="text-base font-medium">Granular Permissions</label>
            <p className="text-sm text-gray-600">
              Fine-tune what this user can access and modify in the system.
            </p>
            
            <div className="space-y-4">
              {Object.entries(permissionCategories).map(([category, { permissions: categoryPerms, description }]) => {
                const hasAnyPermission = categoryPerms.some(perm => permissions.includes(perm));
                const hasAllPermissions = categoryPerms.every(perm => permissions.includes(perm));
                
                return (
                  <div key={category} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{category}</h4>
                        <p className="text-sm text-gray-600 mt-1">{description}</p>
                      </div>
                      <Badge 
                        variant={hasAllPermissions ? "default" : hasAnyPermission ? "secondary" : "outline"}
                        className="ml-3"
                      >
                        {hasAllPermissions ? "Full Access" : hasAnyPermission ? "Partial" : "No Access"}
                      </Badge>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      {categoryPerms.map(permission => {
                        const isChecked = permissions.includes(permission);
                        const permissionLabel = permission.split('.')[1];
                        const actionLabel = permissionLabel.charAt(0).toUpperCase() + permissionLabel.slice(1);
                        
                        return (
                          <div key={permission} className="flex items-center space-x-2">
                            <Checkbox
                              id={permission}
                              checked={isChecked}
                              onCheckedChange={() => togglePermission(permission)}
                            />
                            <label 
                              htmlFor={permission} 
                              className={`text-sm ${isChecked ? 'text-gray-900 font-medium' : 'text-gray-600'}`}
                            >
                              {actionLabel}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving Changes...' : 'Save Permissions'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}