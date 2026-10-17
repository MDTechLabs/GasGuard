import {
  loadMaliciousFixtures,
  scanFixtureSignals,
  type MaliciousSignalKind,
} from "./malicious-repository-fixtures";

describe("malicious repository fixtures (#1100)", () => {
  const files = loadMaliciousFixtures();

  it("checks in at least one fixture file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never contains a real credential", () => {
    for (const file of files) {
      expect(file.content).not.toMatch(/AKIA[0-9A-Z]{16}/);
      expect(file.content).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
    }
  });

  it("flags the install-time network script", () => {
    const kinds = signalKinds("install-script/package.json");
    expect(kinds).toContain("lifecycle-script-network");
  });

  it("flags the hardcoded credential fixture", () => {
    const kinds = signalKinds("hardcoded-credential/config.txt");
    expect(kinds).toContain("hardcoded-credential");
  });

  it("flags the path traversal entry list", () => {
    const kinds = signalKinds("traversal/paths.txt");
    expect(kinds).toContain("path-traversal-entry");
  });

  it("does not flag a clean fixture", () => {
    const clean = [{ path: "clean/package.json", content: '{"name":"clean"}' }];
    expect(scanFixtureSignals(clean)).toEqual([]);
  });

  function signalKinds(path: string): MaliciousSignalKind[] {
    return scanFixtureSignals(files)
      .filter((signal) => signal.file === path)
      .map((signal) => signal.kind);
  }
});
