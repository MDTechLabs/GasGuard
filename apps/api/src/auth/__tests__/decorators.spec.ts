import { Public, IS_PUBLIC_KEY, Roles, Role, ROLES_KEY } from "../decorators";
import { CurrentUser } from "../decorators/current-user.decorator";

describe("Decorators", () => {
  describe("Public decorator", () => {
    it("should export IS_PUBLIC_KEY constant", () => {
      expect(IS_PUBLIC_KEY).toBe("isPublic");
    });

    it("should be a function", () => {
      expect(typeof Public).toBe("function");
    });
  });

  describe("Roles decorator", () => {
    it("should export ROLES_KEY constant", () => {
      expect(ROLES_KEY).toBe("roles");
    });

    it("should be a function", () => {
      expect(typeof Roles).toBe("function");
    });
  });

  describe("Role constants", () => {
    it("should have ADMIN role", () => {
      expect(Role.ADMIN).toBe("admin");
    });

    it("should have ANALYST role", () => {
      expect(Role.ANALYST).toBe("analyst");
    });

    it("should have USER role", () => {
      expect(Role.USER).toBe("user");
    });

    it("should have READONLY role", () => {
      expect(Role.READONLY).toBe("readonly");
    });

    it("should have correct role values", () => {
      expect(Role.ADMIN).toBe("admin");
      expect(Role.ANALYST).toBe("analyst");
      expect(Role.USER).toBe("user");
      expect(Role.READONLY).toBe("readonly");
    });
  });

  describe("CurrentUser decorator", () => {
    it("should be defined", () => {
      expect(CurrentUser).toBeDefined();
      expect(typeof CurrentUser).toBe("function");
    });
  });
});
