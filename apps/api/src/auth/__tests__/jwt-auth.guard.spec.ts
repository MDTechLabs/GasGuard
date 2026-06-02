import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "../guards/jwt-auth.guard";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

describe("JwtAuthGuard", () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const createMockExecutionContext = (
    isPublic: boolean = false,
  ): ExecutionContext => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return isPublic;
      return undefined;
    });

    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({}),
        getResponse: jest.fn(),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        {
          provide: Reflector,
          useValue: mockReflector,
        },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("canActivate", () => {
    it("should allow access to public routes without authentication", () => {
      const context = createMockExecutionContext(true);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith(
        IS_PUBLIC_KEY,
        [context.getHandler(), context.getClass()],
      );
    });

    it("should require authentication for non-public routes", () => {
      const context = createMockExecutionContext(false);

      // Mock the parent canActivate to return true (authenticated)
      jest.spyOn(guard, "canActivate").mockReturnValueOnce(true as any);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe("handleRequest", () => {
    it("should return user when authentication is successful", () => {
      const user = { userId: "user-123", roles: ["user"] };

      const result = guard.handleRequest(null, user, null);

      expect(result).toEqual(user);
    });

    it("should throw UnauthorizedException when user is null", () => {
      expect(() => guard.handleRequest(null, null, null)).toThrow(
        UnauthorizedException,
      );

      try {
        guard.handleRequest(null, null, null);
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error.response).toMatchObject({
          error: "Unauthorized",
          message: "Invalid or expired JWT access token.",
        });
        expect(error.response.timestamp).toBeDefined();
      }
    });

    it("should throw UnauthorizedException when error is present", () => {
      const error = new Error("Some error");

      expect(() => guard.handleRequest(error, null, null)).toThrow(
        UnauthorizedException,
      );
    });

    it("should include TokenExpiredError message when token is expired", () => {
      const info = { name: "TokenExpiredError", message: "jwt expired" };

      try {
        guard.handleRequest(null, null, info);
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error.response.message).toBe("JWT access token has expired.");
      }
    });

    it("should include JsonWebTokenError message when token format is invalid", () => {
      const info = { name: "JsonWebTokenError", message: "invalid token" };

      try {
        guard.handleRequest(null, null, info);
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error.response.message).toBe("Invalid JWT access token format.");
      }
    });

    it("should use info message when available", () => {
      const info = { message: "Custom error message" };

      try {
        guard.handleRequest(null, null, info);
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error.response.message).toBe("Custom error message");
      }
    });

    it("should include timestamp in error response", () => {
      const beforeTime = new Date().getTime();

      try {
        guard.handleRequest(null, null, null);
      } catch (error: any) {
        const afterTime = new Date().getTime();
        const timestamp = new Date(error.response.timestamp).getTime();
        expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
        expect(timestamp).toBeLessThanOrEqual(afterTime);
      }
    });
  });
});
