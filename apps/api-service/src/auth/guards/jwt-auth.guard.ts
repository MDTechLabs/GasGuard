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
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // Add custom authentication logic here if needed
    // For example, checking if the route is public
    return super.canActivate(context);
  }

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
  handleRequest(err: Error, user: any) {
    // Return user if authenticated, null otherwise (no error)
    return user || null;
  }
}
