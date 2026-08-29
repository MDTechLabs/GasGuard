/**
 * Tests for Soroban Analysis Report Version Manager
 */

import { describe, it, expect } from "@jest/globals";
import { ReportVersionManager } from "./report-version-manager";

describe("ReportVersionManager", () => {
  it("should create a new version", () => {
    const manager = new ReportVersionManager();
    const version = manager.createVersion({ findings: [], score: 85 });

    expect(version.id).toBe("v1");
    expect(version.version).toBe("1.1.0");
    expect(version.createdAt).toBeInstanceOf(Date);
    expect(version.data).toEqual({ findings: [], score: 85 });
  });

  it("should retrieve a specific version", () => {
    const manager = new ReportVersionManager();
    manager.createVersion({ findings: ["issue1"] });
    manager.createVersion({ findings: ["issue1", "issue2"] });

    const v1 = manager.getVersion("v1");
    expect(v1).toBeDefined();
    expect(v1!.data).toEqual({ findings: ["issue1"] });

    const v2 = manager.getVersion("v2");
    expect(v2).toBeDefined();
    expect(v2!.data).toEqual({ findings: ["issue1", "issue2"] });
  });

  it("should return undefined for non-existent version", () => {
    const manager = new ReportVersionManager();
    const result = manager.getVersion("v99");
    expect(result).toBeUndefined();
  });

  it("should diff two versions", () => {
    const manager = new ReportVersionManager();
    manager.createVersion({ score: 80, name: "test" });
    manager.createVersion({ score: 95, name: "test", extra: "data" });

    const diff = manager.diffVersions("v1", "v2");

    expect(diff.fromVersion).toBe("v1");
    expect(diff.toVersion).toBe("v2");
    expect(diff.added).toContain("extra");
    expect(diff.modified.length).toBeGreaterThan(0);
    expect(diff.modified[0].key).toBe("score");
    expect(diff.modified[0].oldValue).toBe(80);
    expect(diff.modified[0].newValue).toBe(95);
  });

  it("should detect removed keys in diff", () => {
    const manager = new ReportVersionManager();
    manager.createVersion({ score: 80, name: "test", oldField: "remove" });
    manager.createVersion({ score: 95, name: "test" });

    const diff = manager.diffVersions("v1", "v2");
    expect(diff.removed).toContain("oldField");
  });

  it("should list versions in creation order", () => {
    const manager = new ReportVersionManager();
    manager.createVersion({ a: 1 });
    manager.createVersion({ b: 2 });
    manager.createVersion({ c: 3 });

    const versions = manager.listVersions();
    expect(versions).toHaveLength(3);
    expect(versions[0].id).toBe("v1");
    expect(versions[1].id).toBe("v2");
    expect(versions[2].id).toBe("v3");
  });

  it("should export a dump of all versions", () => {
    const manager = new ReportVersionManager();
    manager.createVersion({ data: "first" });
    manager.createVersion({ data: "second" });

    const dump = manager.exportDump({ exportedBy: "test" });

    expect(dump.formatVersion).toBe("1.0");
    expect(dump.totalVersions).toBe(2);
    expect(dump.versions).toHaveLength(2);
    expect(dump.metadata).toEqual({ exportedBy: "test" });
  });

  it("should import versions from a dump", () => {
    const manager = new ReportVersionManager();
    manager.createVersion({ data: "first" });

    const dump = manager.exportDump();

    const manager2 = new ReportVersionManager();
    manager2.importDump(dump);

    expect(manager2.versionCount).toBe(1);
    const imported = manager2.getVersion("v1");
    expect(imported).toBeDefined();
    expect(imported!.data).toEqual({ data: "first" });
  });

  it("should maintain version counter on import", () => {
    const manager = new ReportVersionManager();
    manager.createVersion({ a: 1 });
    manager.createVersion({ b: 2 });

    const dump = manager.exportDump();

    const manager2 = new ReportVersionManager();
    manager2.importDump(dump);
    const next = manager2.createVersion({ c: 3 });

    expect(next.id).toBe("v3");
  });

  it("should clear all versions", () => {
    const manager = new ReportVersionManager();
    manager.createVersion({ a: 1 });
    manager.createVersion({ b: 2 });

    expect(manager.versionCount).toBe(2);
    manager.clear();
    expect(manager.versionCount).toBe(0);
  });

  it("should throw when diffing non-existent versions", () => {
    const manager = new ReportVersionManager();
    manager.createVersion({ a: 1 });

    expect(() => manager.diffVersions("v1", "v99")).toThrow(
      'Target version "v99" not found',
    );
    expect(() => manager.diffVersions("v99", "v1")).toThrow(
      'Source version "v99" not found',
    );
  });

  it("should detect no changes between identical versions", () => {
    const manager = new ReportVersionManager();
    manager.createVersion({ score: 80, name: "test" });
    manager.createVersion({ score: 80, name: "test" });

    const diff = manager.diffVersions("v1", "v2");
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
    expect(diff.summary).toContain("no changes detected");
  });
});
