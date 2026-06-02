import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "../guards/roles.guard";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { JwtUser } from "../strategies/jwt.strategy";

describe("RolesGuard", () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const createMockExecutionContext = (
    user: JwtUser | null,
    requiredRoles?: string[],
  ): ExecutionContext => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === ROLES_KEY) return requiredRoles;
      return undefined;
    });

    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ user }),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: mockReflector,
        },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("canActivate", () => {
    it("should allow access when no roles are required", () => {
      const context = createMockExecutionContext(
        { userId: "user-123", roles: [], permissions: [] },
        [],
      );

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it("should allow access when roles array is empty", () => {
      const context = createMockExecutionContext(
        { userId: "user-123", roles: [], permissions: [] },
        [],
      );

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it("should allow access when roles is undefined", () => {
      const context = createMockExecutionContext(
        { userId: "user-123", roles: [], permissions: [] },
        undefined,
      );

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it("should allow access when user has one of the required roles", () => {
      const context = createMockExecutionContext(
        { userId: "user-123", roles: ["user", "analyst"], permissions: [] },
        ["admin", "analyst"],
      );

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it("should allow access when user has exact required role", () => {
      const context = createMockExecutionContext(
        { userId: "user-123", roles: ["admin"], permissions: [] },
        ["admin"],
      );

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it("should deny access when user has none of the required roles", () => {
      const context = createMockExecutionContext(
        { userId: "user-123", roles: ["user"], permissions: [] },
        ["admin"],
      );

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);

      try {
        guard.canActivate(context);
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.response).toMatchObject({
          error: "Forbidden",
          message: "Access denied: Required roles are [admin]",
        });
        expect(error.response.timestamp).toBeDefined();
      }
    });

    it("should deny access when user roles array is empty", () => {
      const context = createMockExecutionContext(
        { userId: "user-123", roles: [], permissions: [] },
        ["admin"],
      );

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when user is not authenticated", () => {
      const context = createMockExecutionContext(null, ["admin"]);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);

      try {
        guard.canActivate(context);
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.response.message).toBe(
          "Access denied: User not authenticated",
        );
      }
    });

    it("should include all required roles in error message", () => {
      const context = createMockExecutionContext(
        { userId: "user-123", roles: ["user"], permissions: [] },
        ["admin", "analyst", "manager"],
      );

      try {
        guard.canActivate(context);
      } catch (error) {
        expect(error.response.message).toBe(
          "Access denied: Required roles are [admin, analyst, manager]",
        );
      }
    });

    it("should handle user with undefined roles property", () => {
      const context = createMockExecutionContext(
        { userId: "user-123", roles: undefined as any, permissions: [] },
        ["admin"],
      );

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it("should include timestamp in error response", () => {
      const context = createMockExecutionContext(
        { userId: "user-123", roles: ["user"], permissions: [] },
        ["admin"],
      );

      const beforeTime = new Date().getTime();

      try {
        guard.canActivate(context);
      } catch (error: any) {
        const afterTime = new Date().getTime();
        const timestamp = new Date(error.response.timestamp).getTime();
        expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
        expect(timestamp).toBeLessThanOrEqual(afterTime);
      }
    });
  });
});
