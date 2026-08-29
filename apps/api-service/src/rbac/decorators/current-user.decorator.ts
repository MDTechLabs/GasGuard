import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { User } from "../../database/entities/user.entity";

/**
 * Interface for authenticated request
 */
export interface AuthenticatedRequest extends Request {
  user: User;
}

/**
 * Decorator to extract the current authenticated user from the request
 * @example
 * ```typescript
 * @Get('profile')
 * getProfile(@CurrentUser() user: User) {
 *   return user;
 * }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (
    data: keyof User | undefined,
    ctx: ExecutionContext,
  ): User | Partial<User> => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      return null as unknown as User;
    }

    // If a specific property is requested, return only that property
    if (data) {
      return user[data];
    }

    return user;
  },
);

/**
 * Decorator to extract the current user's ID
 * @example
 * ```typescript
 * @Get('my-transactions')
 * getMyTransactions(@CurrentUserId() userId: string) {
 *   return this.service.getTransactionsForUser(userId);
 * }
 * ```
 */
export const CurrentUserId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user?.id;
  },
);

/**
 * Decorator to extract the current user's role
 * @example
 * ```typescript
 * @Get('admin-stats')
 * getAdminStats(@CurrentUserRole() role: UserRole) {
 *   // Only accessible if user has appropriate role
 * }
 * ```
 */
export const CurrentUserRole = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user?.role;
  },
);
