import { assertLockfileVerified, verifyLockfile } from "./lockfile-verification";

const pkg = JSON.stringify({ dependencies: { left: "^1.0.0" } });
const entry = { resolved: "https://registry.npmjs.org/left/-/left-1.0.0.tgz", integrity: "sha512-abc" };
const lock = (packages: object) => JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...packages } });

describe("verifyLockfile (#1349)", () => {
  it("accepts a complete, pinned lockfile", () => {
    expect(verifyLockfile(pkg, lock({ "node_modules/left": entry }))).toEqual({ ok: true, problems: [] });
  });

  it("flags a missing lockfile and uncovered dependencies", () => {
    expect(verifyLockfile(pkg, undefined).ok).toBe(false);
    expect(verifyLockfile(pkg, lock({})).problems[0]).toContain("left");
  });

  it("flags non-https and unhashed entries", () => {
    const http = { resolved: "http://evil.test/left.tgz", integrity: "sha512-abc" };
    expect(verifyLockfile(pkg, lock({ "node_modules/left": http })).ok).toBe(false);
    expect(verifyLockfile(pkg, lock({ "node_modules/left": { resolved: entry.resolved } })).ok).toBe(false);
  });

  it("throws from assertLockfileVerified on failure", () => {
    expect(() => assertLockfileVerified(pkg, "not json")).toThrow(/lockfile verification failed/);
  });
});
