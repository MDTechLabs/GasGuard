import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "../guards/jwt-auth.guard";
import { RolesGuard } from "../guards/roles.guard";
import { ROLES_KEY } from "../decorators/roles.decorator";

/**
 * Contract: every auth failure is a 401/403 with a JSON body of
 * `{ error, message, timestamp }` (ISO-8601), and never echoes credentials.
 */
describe("API authentication failure contract", () => {
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const jwtGuard = new JwtAuthGuard(reflector);
  const rolesGuard = new RolesGuard(reflector);

  const contextWith = (user?: unknown): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const capture = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e as UnauthorizedException | ForbiddenException;
    }
    throw new Error("expected the call to throw");
  };

  const expectContract = (
    e: UnauthorizedException | ForbiddenException,
    status: number,
    error: string,
  ) => {
    expect(e.getStatus()).toBe(status);
    const body = e.getResponse() as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(["error", "message", "timestamp"]);
    expect(body.error).toBe(error);
    expect(typeof body.message).toBe("string");
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    return body;
  };

  describe("401 Unauthorized (JwtAuthGuard)", () => {
    it.each([
      ["missing token", null, { message: "No auth token" }, "No auth token"],
      ["expired token", null, { name: "TokenExpiredError" }, "JWT access token has expired."],
      ["malformed token", null, { name: "JsonWebTokenError" }, "Invalid JWT access token format."],
      ["no failure detail", null, undefined, "Invalid or expired JWT access token."],
    ])("%s", (_name, user, info, message) => {
      const body = expectContract(
        capture(() => jwtGuard.handleRequest(null, user, info)),
        401,
        "Unauthorized",
      );
      expect(body.message).toBe(message);
    });

    it("rejects when the strategy errors even if a user is present", () => {
      expectContract(
        capture(() => jwtGuard.handleRequest(new Error("boom"), { userId: "u" }, undefined)),
        401,
        "Unauthorized",
      );
    });

    it("does not leak the underlying error text or token", () => {
      const body = expectContract(
        capture(() =>
          jwtGuard.handleRequest(new Error("secret-token-abc"), null, undefined),
        ),
        401,
        "Unauthorized",
      );
      expect(JSON.stringify(body)).not.toContain("secret-token-abc");
    });

    it("passes an authenticated user through unchanged", () => {
      const user = { userId: "u1", roles: [], permissions: [] };
      expect(jwtGuard.handleRequest(null, user, undefined)).toBe(user);
    });
  });

  describe("403 Forbidden (RolesGuard)", () => {
    beforeEach(() => {
      (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) =>
        key === ROLES_KEY ? ["admin"] : undefined,
      );
    });

    it("unauthenticated request to a role-protected route", () => {
      expectContract(capture(() => rolesGuard.canActivate(contextWith())), 403, "Forbidden");
    });

    it("authenticated user without the role", () => {
      const body = expectContract(
        capture(() =>
          rolesGuard.canActivate(contextWith({ userId: "u", roles: ["viewer"], permissions: [] })),
        ),
        403,
        "Forbidden",
      );
      expect(body.message).toContain("admin");
    });

    it("user with no roles property", () => {
      expectContract(
        capture(() => rolesGuard.canActivate(contextWith({ userId: "u" }))),
        403,
        "Forbidden",
      );
    });

    it("allows a user with the role", () => {
      expect(
        rolesGuard.canActivate(contextWith({ userId: "u", roles: ["admin"], permissions: [] })),
      ).toBe(true);
    });
  });
});
