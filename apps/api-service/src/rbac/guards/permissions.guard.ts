import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../enums/role.enum';
import { AuthenticatedRequest } from '../decorators/current-user.decorator';

export enum Permission {
  // Gas operations
  GAS_READ = 'gas:read',
  GAS_WRITE = 'gas:write',
  GAS_SUBSIDY_APPROVE = 'gas:subsidy:approve',

  // Analytics
  ANALYTICS_READ = 'analytics:read',
  ANALYTICS_EXPORT = 'analytics:export',

  // User management
  USER_READ = 'user:read',
  USER_WRITE = 'user:write',
  USER_DELETE = 'user:delete',
  USER_ROLE_ASSIGN = 'user:role:assign',

  // API keys
  API_KEY_READ = 'apikey:read',
  API_KEY_WRITE = 'apikey:write',
  API_KEY_REVOKE = 'apikey:revoke',

  // Audit
  AUDIT_READ = 'audit:read',

  // Admin
  SYSTEM_CONFIG = 'system:config',
  EMERGENCY_OVERRIDE = 'system:emergency:override',
  PAUSE_CONTROL = 'system:pause',
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

export const PERMISSIONS_KEY = 'permissions';

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!user.isActive) {
      throw new ForbiddenException('User account is deactivated');
    }

    const granted = ROLE_PERMISSIONS[user.role] ?? [];
    const missing = required.filter((p) => !granted.includes(p));

    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing permission(s): ${missing.join(', ')}`,
      );
    }

    return true;
  }
}
