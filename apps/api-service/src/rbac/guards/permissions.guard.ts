/**
 * Privilege Boundary Documentation
 * ================================
 *
 * This module defines the authorization boundary for the GasGuard API.
 * It is the single source of truth for mapping authenticated users to the
 * permissions they are allowed to exercise. All route-level authorization
 * MUST flow through `PermissionsGuard` and `RequirePermissions`; ad-hoc
 * role checks elsewhere are considered a privilege-boundary violation.
 *
 * Trust boundaries
 * ----------------
 * - Untrusted: the HTTP request, including `request.user` before it has
 *   been populated by the authentication layer. `PermissionsGuard` treats
 *   a missing `user` as unauthenticated and rejects the request.
 * - Semi-trusted: the authenticated principal supplied by the auth layer.
 *   Its `role` and `isActive` fields are trusted only after authentication
 *   has succeeded; deactivated accounts are rejected here as defense in
 *   depth even if the auth layer already filtered them.
 * - Trusted: the `ROLE_PERMISSIONS` table below and the `Permission` enum.
 *   These are compile-time constants and must not be derived from request
 *   input, environment variables, or database state at request time.
 *
 * Privilege escalation invariants
 * -------------------------------
 * - Permissions are additive per role; there is no deny-list. A role's
 *   effective permissions are exactly `ROLE_PERMISSIONS[role]`.
 * - Unknown roles resolve to an empty permission set (`?? []`), so a
 *   malformed or forged role cannot grant access.
 * - `UserRole.ADMIN` is intentionally granted `Object.values(Permission)`.
 *   Adding a new `Permission` therefore grants it to ADMIN automatically;
 *   reviewers MUST treat new enum members as privilege-boundary changes.
 * - `EMERGENCY_OVERRIDE` and `PAUSE_CONTROL` are ADMIN-only and must never
 *   be added to lower-privileged roles without a security review.
 *
 * Failure modes
 * -------------
 * - No metadata / empty requirement list: fail-open (route is public with
 *   respect to permissions). This is intentional for endpoints that are
 *   protected by other guards or are genuinely public.
 * - Missing user: `UnauthorizedException` (401).
 * - Deactivated user or missing permission: `ForbiddenException` (403).
 *
 * Dependencies
 * ------------
 * - Upstream: the authentication layer must populate `AuthenticatedRequest.user`
 *   with a valid `UserRole` and boolean `isActive` before this guard runs.
 * - Cross-component: `ROLE_PERMISSIONS` is consumed by tests and by any
 *   tooling that audits effective permissions; keep it exported and stable.
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SetMetadata } from "@nestjs/common";
import { UserRole } from "../enums/role.enum";
import { AuthenticatedRequest } from "../decorators/current-user.decorator";

export enum Permission {
  // Gas operations
  GAS_READ = "gas:read",
  GAS_WRITE = "gas:write",
  GAS_SUBSIDY_APPROVE = "gas:subsidy:approve",

  // Analytics
  ANALYTICS_READ = "analytics:read",
  ANALYTICS_EXPORT = "analytics:export",

  // User management
  USER_READ = "user:read",
  USER_WRITE = "user:write",
  USER_DELETE = "user:delete",
  USER_ROLE_ASSIGN = "user:role:assign",

  // API keys
  API_KEY_READ = "apikey:read",
  API_KEY_WRITE = "apikey:write",
  API_KEY_REVOKE = "apikey:revoke",

  // Audit
  AUDIT_READ = "audit:read",

  // Admin
  SYSTEM_CONFIG = "system:config",
  EMERGENCY_OVERRIDE = "system:emergency:override",
  PAUSE_CONTROL = "system:pause",
}

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.VIEWER]: [
    Permission.GAS_READ,
    Permission.ANALYTICS_READ,
    Permission.USER_READ,
    Permission.API_KEY_READ,
  ],
  [UserRole.OPERATOR]: [
    Permission.GAS_READ,
    Permission.GAS_WRITE,
    Permission.GAS_SUBSIDY_APPROVE,
    Permission.ANALYTICS_READ,
    Permission.ANALYTICS_EXPORT,
    Permission.USER_READ,
    Permission.API_KEY_READ,
    Permission.API_KEY_WRITE,
    Permission.API_KEY_REVOKE,
    Permission.AUDIT_READ,
  ],
  [UserRole.ADMIN]: Object.values(Permission),
};

export const PERMISSIONS_KEY = "permissions";

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException("Authentication required");
    }

    if (!user.isActive) {
      throw new ForbiddenException("User account is deactivated");
    }

    const granted = ROLE_PERMISSIONS[user.role] ?? [];
    const missing = required.filter((p) => !granted.includes(p));

    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing permission(s): ${missing.join(", ")}`,
      );
    }

    return true;
  }
}
