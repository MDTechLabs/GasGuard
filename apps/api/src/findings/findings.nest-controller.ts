/**
 * NestJS adapter for the findings API (Issue #1241 — cursor pagination).
 *
 * findings.controller.ts / findings.service.ts / cursor.ts (#992) already
 * implement full keyset/cursor pagination with tenant isolation (#996); that
 * logic was only reachable through apps/api/src/server.ts, an Express
 * entrypoint the deployed container does not run (main.ts boots the
 * NestJS AppModule — see apps/api/src/main.ts and the Dockerfile CMD).
 * This controller registers the existing handlers on a real, guarded Nest
 * route instead of duplicating their logic, so `GET /v1/findings` and
 * `GET /v1/findings/:id` go through the same global guards (rate limiting,
 * JWT auth, RBAC) as every other endpoint in this app.
 */
import { Controller, Get, Req, Res } from "@nestjs/common";
import { Request, Response } from "express";
import { findingsController } from "./findings.controller";

@Controller({ path: "findings", version: "1" })
export class FindingsNestController {
  @Get()
  list(@Req() req: Request, @Res() res: Response): void {
    findingsController.list(req, res);
  }

  @Get(":id")
  getOne(@Req() req: Request, @Res() res: Response): void {
    findingsController.getOne(req, res);
  }
}
