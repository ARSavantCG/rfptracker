import { useAuth } from "./useAuth";
import { Permission, ROLE_PERMISSIONS, UserRole } from "@shared/schema";

export function usePermissions() {
  const { user } = useAuth();

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
    return hasRole('admin');
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
  };
}