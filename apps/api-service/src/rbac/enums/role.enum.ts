export enum UserRole {
  ADMIN = "admin",
  OPERATOR = "operator",
  VIEWER = "viewer",
}

export const RoleHierarchy: UserRole[] = [
  UserRole.VIEWER,
  UserRole.OPERATOR,
  UserRole.ADMIN,
];

/**
 * @param userRole - The role of the user
 * @param requiredRole - The minimum required role
 * @returns boolean indicating if user has sufficient permissions
 */
export function hasRoleAccess(
  userRole: UserRole,
  requiredRole: UserRole,
): boolean {
  const userRoleIndex = RoleHierarchy.indexOf(userRole);
  const requiredRoleIndex = RoleHierarchy.indexOf(requiredRole);

  if (userRoleIndex === -1 || requiredRoleIndex === -1) {
    return false;
  }

  return userRoleIndex >= requiredRoleIndex;
}
