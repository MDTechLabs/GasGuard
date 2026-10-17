import * as path from "path";

import {
  PathTraversalError,
  isSafeRepositoryPath,
  resolveRepositoryPath,
} from "./path-traversal-guard";

describe("resolveRepositoryPath (#1098)", () => {
  const root = path.join("/tmp", "gasguard-fixture-root");

  it("resolves a nested path inside the repository", () => {
    expect(resolveRepositoryPath(root, "contracts/token/src/lib.rs")).toBe(
      path.join(root, "contracts/token/src/lib.rs"),
    );
  });

  it("leaves a simple relative path unchanged", () => {
    expect(resolveRepositoryPath(root, "package.json")).toBe(
      path.join(root, "package.json"),
    );
  });

  it("rejects parent-directory traversal", () => {
    expect(() => resolveRepositoryPath(root, "../outside.txt")).toThrow(
      PathTraversalError,
    );
    expect(() => resolveRepositoryPath(root, "src/../../outside.txt")).toThrow(
      PathTraversalError,
    );
  });

  it("rejects absolute and drive-letter paths", () => {
    expect(() => resolveRepositoryPath(root, "/etc/passwd")).toThrow(PathTraversalError);
    expect(() => resolveRepositoryPath(root, "C:\\Windows\\win.ini")).toThrow(
      PathTraversalError,
    );
  });

  it("rejects null bytes and control characters", () => {
    expect(() => resolveRepositoryPath(root, "src/\u0000secret")).toThrow(
      PathTraversalError,
    );
  });

  it("rejects empty and non-string entries", () => {
    expect(() => resolveRepositoryPath(root, "   ")).toThrow(TypeError);
  });

  it("reports safety without throwing", () => {
    expect(isSafeRepositoryPath(root, "src/index.ts")).toBe(true);
    expect(isSafeRepositoryPath(root, "../../etc/passwd")).toBe(false);
  });
});
