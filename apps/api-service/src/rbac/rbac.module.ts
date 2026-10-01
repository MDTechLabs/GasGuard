import { Module, Global } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "../database/entities/user.entity";
import { RbacService } from "./services/rbac.service";
import { RolesGuard } from "./guards/roles.guard";

/**
 * Privilege boundary documentation.
 *
 * This module is the single authority for role-based access control (RBAC)
 * in the GasGuard API service. It defines the privilege boundary between
 * authenticated callers and privileged operations.
 *
 * Security invariants:
 * - The module is global so that guards and the RBAC service can be
 *   consumed without re-importing; however, neither the service nor the
 *   guard exposes any mutating operation that bypasses role checks.
 * - RolesGuard must be applied at the controller or route level for any
 *   endpoint that requires elevated privileges. Failure to apply it is a
 *   configuration error, not a default-allow.
 * - The User entity is the only persistence dependency; no credentials or
 *   secrets are held in this module.
 *
 * Operational notes:
 * - Authorization decisions are logged by RbacService with the caller
 *   identity and required role; credentials and tokens are never logged.
 * - Failures are fail-closed: a missing or malformed role denies access.
 *
 * Troubleshooting:
 * - If a route returns 403 for a valid user, verify the route decorator
 *   requires the correct role and that the user's role is present in
 *   the User entity.
 * - If RolesGuard is not executing, ensure the guard is registered and
 *   bound to the request pipeline via @useGuards or a global guard.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [RbacService, RolesGuard],
  exports: [RbacService, RolesGuard],
})
export class RbacModule {}
