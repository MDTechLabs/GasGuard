import { SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "roles";

/**
 * Defines the roles required to access a route or controller.
 * Must be used in combination with JwtAuthGuard and RolesGuard.
 *
 * @param roles - Array of role names required for access
 *
 * @example
 * ```typescript
 * @Roles('admin', 'analyst')
 * @Get('sensitive-data')
 * getSensitiveData() { ... }
 * ```
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Predefined role constants for consistent role naming across the application.
 */
export const Role = {
  ADMIN: "admin",
  ANALYST: "analyst",
  USER: "user",
  READONLY: "readonly",
} as const;

export type RoleType = (typeof Role)[keyof typeof Role];
