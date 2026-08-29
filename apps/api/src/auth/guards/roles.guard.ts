import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { JwtUser } from "../strategies/jwt.strategy";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no roles are required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user: JwtUser }>();

    if (!user) {
      throw new ForbiddenException({
        error: "Forbidden",
        message: "Access denied: User not authenticated",
        timestamp: new Date().toISOString(),
      });
    }

    const userRoles = user.roles || [];

    // Check if user has at least one of the required roles
    const hasRole = requiredRoles.some((role) => userRoles.includes(role));

    if (!hasRole) {
      throw new ForbiddenException({
        error: "Forbidden",
        message: `Access denied: Required roles are [${requiredRoles.join(", ")}]`,
        timestamp: new Date().toISOString(),
      });
    }

    return true;
  }
}
