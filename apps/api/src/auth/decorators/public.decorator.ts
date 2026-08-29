import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Marks a route or controller as public, bypassing JWT authentication.
 * Use this decorator on endpoints that don't require authentication.
 *
 * @example
 * ```typescript
 * @Public()
 * @Get('health')
 * getHealth() { ... }
 * ```
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
