import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { JwtUser } from "../strategies/jwt.strategy";

/**
 * Extracts the current authenticated user from the request.
 * Returns the full user object or a specific property if key is provided.
 *
 * @param key - Optional property key to extract from user object
 * @returns The user object or the specified property value
 *
 * @example
 * ```typescript
 * @Get('profile')
 * getProfile(@CurrentUser() user: JwtUser) { ... }
 *
 * @Get('user-id')
 * getUserId(@CurrentUser('userId') userId: string) { ... }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (key: keyof JwtUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtUser }>();
    const user = request.user;

    if (!user) {
      return undefined;
    }

    return key ? user[key] : user;
  },
);
