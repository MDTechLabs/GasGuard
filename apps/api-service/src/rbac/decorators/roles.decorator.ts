import { SetMetadata } from "@nestjs/common";
import { UserRole } from "../enums/role.enum";

/**
 * Metadata key for roles
 */
export const ROLES_KEY = "roles";

/**
 * Decorator to specify required roles for accessing a route
 * @param roles - Array of roles that are allowed to access the route
 * @example
 * ```typescript
 * @Roles(UserRole.ADMIN, UserRole.OPERATOR)
 * @Get('sensitive-data')
 * getSensitiveData() { ... }
 * ```
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Decorator to allow only Admin access
 * @example
 * ```typescript
 * @AdminOnly()
 * @Delete('users/:id')
 * deleteUser() { ... }
 * ```
 */
export const AdminOnly = () => Roles(UserRole.ADMIN);

/**
 * Decorator to allow Operator and Admin access
 * @example
 * ```typescript
 * @OperatorAndAbove()
 * @Post('transactions')
 * createTransaction() { ... }
 * ```
 */
export const OperatorAndAbove = () => Roles(UserRole.OPERATOR, UserRole.ADMIN);

/**
 * Decorator to allow all authenticated users (Viewer and above)
 * This is the default behavior when no @Roles decorator is used
 * @example
 * ```typescript
 * @ViewerAndAbove()
 * @Get('reports')
 * getReports() { ... }
 * ```
 */
export const ViewerAndAbove = () =>
  Roles(UserRole.VIEWER, UserRole.OPERATOR, UserRole.ADMIN);
