import { useState, useEffect } from "react";
import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Shield, Users, Settings, Edit, Trash2, CheckCircle, XCircle, User as UserIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { apiRequest } from "@/lib/queryClient";
import Navigation from "@/components/navigation";
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
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
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
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
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
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
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
            <Select value={selectedRole} onValueChange={handleRoleChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin - Full system access</SelectItem>
                <SelectItem value="manager">Manager - Advanced access</SelectItem>
                <SelectItem value="user">User - View only access</SelectItem>
                <SelectItem value="custom">Custom - Manual permissions</SelectItem>
              </SelectContent>
            </Select>
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

export default function Admin() {
  const { isAdmin } = usePermissions();

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
            <p className="text-gray-600">Manage admin accounts and authorized ownership contacts</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {/* System Users - Combined with Authorized Contacts */}
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
        </div>
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
            <Select value={role} onValueChange={applyRolePermissions}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin - Full system access</SelectItem>
                <SelectItem value="manager">Manager - Create and edit content</SelectItem>
                <SelectItem value="user">User - View only access</SelectItem>
              </SelectContent>
            </Select>
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