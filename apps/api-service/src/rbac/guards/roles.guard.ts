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
 * Privilege boundary for role-based access control.
 *
 * This guard is the single enforcement point for role-gated routes.
 * The boundary layers are, in order of evaluation:
 *
 * 1. Authentication boundary -- a missing `user` on the request means the
 *    authentication layer (e.g. JWT/session guard) did not run or did not
 *    populate the context. Requests are rejected with 401 rather than
 *    falling through to a role check against an undefined principal.
 * 2. Account-status boundary -- deactivated or locked accounts are rejected
 *    with 403 regardless of the roles they hold. Status is checked before
 *    role membership so that a stale token cannot be used to exercise
 *    privileges after an administrative revocation.
 * 3. Role boundary -- the authenticated and active principal must hold at
 *    least one of the roles declared by `@Roles(...)` on the handler or
 *    controller. Role hierarchy is delegated to `hasRoleAccess()` so that
 *    higher-privilege roles inherit lower-privilege access in a single,
 *    auditable place.
 *
 * Secure defaults:
 * - Routes with no `@Roles()` metadata are treated as public and allowed.
 *   Authorization is opt-in via decorator metadata; this guard never
 *   grants access based on the absence of a decision from another layer.
 * - Any error condition fails closed with an explicit HTTP 401/403.
 * - The guard never mutates the request or the user object; it is a
 *   pure decision function and thus safe to compose with other guards.
 *
 * Operational notes:
 * - Rejections are logged by the global exception filter with the correct
 *   HTTP status code; this guard intentionally does not log the raw token or
 *   any credential and only references the role name in the denial message.
 * - The guard is stateless and can be registered globally or per-controller
 *   without changing behavior.
 *
 * @see ROLES_KEY for the metadata key used to declare required roles.
 * @see hasRoleAccess for the role-hierarchy semantics.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Resolve the required roles from the route handler first, then the
    // controller. Handler metadata takes precedence over controller metadata
    // so a single route can tighten or loosen the controller-level boundary.
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Secure default: no declared roles means the route is public.
    // Authorization is opt-in via @Roles(...) metadata.
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    // Authentication boundary: a role-gated route must never be evaluated
    // against an unauthenticated principal.
    if (!user) {
      throw new UnauthorizedException("Authentication required");
    }

    // Account-status boundary: deactivated accounts lose all role-gated
    // access even if their token is still valid.
    if (!user.isActive) {
      throw new ForbiddenException("User account is deactivated");
    }

    // Account-status boundary: temporarily locked accounts are denied even
    // with a valid token and an appropriate role.
    if (user.isLocked()) {
      throw new ForbiddenException("User account is temporarily locked");
    }

    // Role boundary: the principal must hold at least one of the required
    // roles. `hasRoleAccess` encodes the hierarchy so this check remains a
    // single auditable decision point.
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
