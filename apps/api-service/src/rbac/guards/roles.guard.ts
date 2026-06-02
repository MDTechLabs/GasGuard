import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole, hasRoleAccess } from "../enums/role.enum";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { AuthenticatedRequest } from "../decorators/current-user.decorator";

/**
 * Guard to enforce role-based access control
 * Checks if the authenticated user has one of the required roles
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get required roles from the route handler or controller
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no roles are specified, allow access (public endpoint)
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    // Check if user is authenticated
    if (!user) {
      throw new UnauthorizedException("Authentication required");
    }

    // Check if user account is active
    if (!user.isActive) {
      throw new ForbiddenException("User account is deactivated");
    }

    // Check if user account is locked
    if (user.isLocked()) {
      throw new ForbiddenException("User account is temporarily locked");
    }

    // Check if user has any of the required roles
    const hasRequiredRole = requiredRoles.some((role: UserRole) =>
      hasRoleAccess(user.role, role),
    );

    if (!hasRequiredRole) {
      throw new ForbiddenException(
        `Access denied. Required role(s): ${requiredRoles.join(", ")}. Your role: ${user.role}`,
      );
    }

    return true;
  }
}
