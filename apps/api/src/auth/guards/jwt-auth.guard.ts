import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Otherwise, apply JWT authentication
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    // Custom error handling
    if (err || !user) {
      let message = "Invalid or expired JWT access token.";

      if (info?.name === "TokenExpiredError") {
        message = "JWT access token has expired.";
      } else if (info?.name === "JsonWebTokenError") {
        message = "Invalid JWT access token format.";
      } else if (info?.message) {
        message = info.message;
      }

      throw new UnauthorizedException({
        error: "Unauthorized",
        message,
        timestamp: new Date().toISOString(),
      });
    }

    return user;
  }
}
