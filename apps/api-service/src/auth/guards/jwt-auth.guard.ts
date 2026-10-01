/**
 * Privilege Boundary Documentation
 *
 * This module defines the authentication guards that enforce the privilege
 * boundary between unauthenticated and authenticated callers. `JwtAuthGuard`
 * rejects requests without a valid JWT, while `OptionalJwtAuthGuard` allows
 * anonymous access but attaches identity when a token is present. Downstream
 * authorization (roles, scopes, ownership) MUST be enforced separately; these
 * guards only establish *who* the caller is, not *what* they may do.
 */
import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Observable } from "rxjs";

/**
 * JWT Authentication Guard
 * Protects routes by requiring a valid JWT token
 *
 * Usage:
 * ```typescript
 * @UseGuards(JwtAuthGuard)
 * @Controller('protected')
 * export class ProtectedController { }
 * ```
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  /**
   * Privilege boundary: any route guarded by this class requires a verified
   * JWT. Unauthenticated callers are rejected before the handler executes.
   * Do not weaken this guard to allow anonymous access; use
   * `OptionalJwtAuthGuard` for mixed routes instead.
   */
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // Add custom authentication logic here if needed
    // For example, checking if the route is public
    return super.canActivate(context);
  }

  /**
   * Failure handling for the privilege boundary: if token validation fails or
   * no user is resolved, throw `UnauthorizedException` so the request never
   * reaches protected handlers with an ambiguous identity.
   */
  handleRequest(err: Error, user: any, info: any) {
    // You can throw an exception based on either "info" or "err" arguments
    if (err || !user) {
      throw err || new UnauthorizedException("Authentication required");
    }
    return user;
  }
}

/**
 * Optional JWT Authentication Guard
 * Attaches user to request if token is present, but doesn't require it
 *
 * Usage:
 * ```typescript
 * @UseGuards(OptionalJwtAuthGuard)
 * @Controller('mixed')
 * export class MixedController { }
 * ```
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard("jwt") {
  /**
   * Privilege boundary: this guard does NOT enforce authentication. It only
   * populates `request.user` when a valid token is supplied. Routes using it
   * MUST perform their own authorization checks before acting on behalf of a
   * user, and MUST treat `null` user as fully unprivileged.
   */
  handleRequest(err: Error, user: any) {
    // Return user if authenticated, null otherwise (no error)
    return user || null;
  }
}
