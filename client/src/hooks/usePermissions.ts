import { useQuery } from "@tanstack/react-query";
import { Permission, UserRole } from "@shared/schema";
import { ROLE_PERMISSIONS } from "@shared/schema";

export function usePermissions() {
  const { data: user } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 1000, // 1 second for development
  });

  const hasPermission = (permission: Permission): boolean => {
    if (!user) return false;
    
    // Check role-based permissions
    const rolePermissions = ROLE_PERMISSIONS[user.role as UserRole] || [];
    if (rolePermissions.includes(permission)) return true;
    
    // Check custom permissions
    const customPermissions = user.permissions || [];
    return customPermissions.includes(permission);
  };

  const hasRole = (role: UserRole): boolean => {
    return user?.role === role;
  };

  const isAdmin = (): boolean => {
    if (!user) return false;
    return user.role === 'admin' || hasPermission('admin.access');
  };

  const isManager = (): boolean => {
    return hasRole('manager') || hasRole('admin');
  };

  const canAccess = (permissions: Permission[]): boolean => {
    return permissions.some(permission => hasPermission(permission));
  };

  return {
    hasPermission,
    hasRole,
    isAdmin,
    isManager,
    canAccess,
    user,
    // Specific permission helpers
    canViewUsers: () => hasPermission('users.view'),
    canEditUsers: () => hasPermission('users.edit'),
    canCreateUsers: () => hasPermission('users.create'),
    canDeleteUsers: () => hasPermission('users.delete'),
    canCreateRfp: () => hasPermission('rfp.create'),
    canEditRfp: () => hasPermission('rfp.edit'),
    canViewRfp: () => hasPermission('rfp.view'),
    canDeleteRfp: () => hasPermission('rfp.delete'),
    canCreateProperties: () => hasPermission('properties.create'),
    canEditProperties: () => hasPermission('properties.edit'),
    canViewProperties: () => hasPermission('properties.view'),
    canDeleteProperties: () => hasPermission('properties.delete'),
    canCreateContacts: () => hasPermission('contacts.create'),
    canEditContacts: () => hasPermission('contacts.edit'),
    canViewContacts: () => hasPermission('contacts.view'),
    canDeleteContacts: () => hasPermission('contacts.delete'),
    canViewReports: () => hasPermission('reports.view'),
    canGenerateReports: () => hasPermission('reports.generate'),
    canCreateRom: () => hasPermission('rom.create'),
    canEditRom: () => hasPermission('rom.edit'),
    canViewRom: () => hasPermission('rom.view'),
    canDeleteRom: () => hasPermission('rom.delete'),
    canManageRomScope: () => hasPermission('rom.scope.manage'),
    // RFP Workflow step permissions
    canAccessRfpStep: (step: number) => hasPermission(`rfp.step.${step}` as any),
    getMaxRfpStep: () => {
      for (let step = 6; step >= 1; step--) {
        if (hasPermission(`rfp.step.${step}` as any)) {
          return step;
        }
      }
      return 0; // No RFP access
    }
  };
}