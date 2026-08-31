import {
  detectRedundantFootprintEntries,
  detectRedundantFootprintInObject,
} from "../redundant-footprint-entries-rule";

describe("detectRedundantFootprintEntries", () => {
  it("returns no findings for clean source code", () => {
    const source = `pub fn add(a: i128, b: i128) -> i128 { a + b }`;
    const report = detectRedundantFootprintEntries(source);
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toContain("No footprint entries detected");
  });

  it("detects duplicate entries in source code", () => {
    const source = `
      let val1 = env.storage().instance().get(&key);
      let val2 = env.storage().instance().get(&key);
    `;
    const report = detectRedundantFootprintEntries(source);
    const duplicateFindings = report.findings.filter(
      (f) => f.patternId === "duplicate-entry",
    );
    expect(duplicateFindings.length).toBeGreaterThan(0);
    expect(report.metrics.duplicateEntries).toBeGreaterThan(0);
  });

  it("provides correct metrics", () => {
    const source = `
      let val1 = env.storage().instance().get(&key1);
      let val2 = env.storage().instance().get(&key2);
    `;
    const report = detectRedundantFootprintEntries(source);
    expect(report.metrics.totalEntries).toBe(2);
    expect(report.metrics.duplicateEntries).toBe(0);
  });

  it("generates summary with findings", () => {
    const source = `
      let val1 = env.storage().instance().get(&key);
      let val2 = env.storage().instance().get(&key);
    `;
    const report = detectRedundantFootprintEntries(source);
    expect(report.summary).toContain("duplicate");
  });
});

describe("detectRedundantFootprintInObject", () => {
  it("returns no findings for empty footprint", () => {
    const footprint = { readOnly: [], readWrite: [] };
    const report = detectRedundantFootprintInObject(footprint);
    expect(report.findings).toHaveLength(0);
  });

  it("detects duplicate entries in footprint object", () => {
    const footprint = {
      readOnly: ["key1", "key2", "key1"],
      readWrite: [],
    };
    const report = detectRedundantFootprintInObject(footprint);
    const duplicateFindings = report.findings.filter(
      (f) => f.patternId === "duplicate-entry",
    );
    expect(duplicateFindings.length).toBe(1);
    expect(report.metrics.duplicateEntries).toBe(1);
  });

  it("detects overlapping access patterns", () => {
    const footprint = {
      readOnly: ["key1"],
      readWrite: ["key1"],
    };
    const report = detectRedundantFootprintInObject(footprint);
    const overlapFindings = report.findings.filter(
      (f) => f.patternId === "overlapping-access",
    );
    expect(overlapFindings.length).toBe(1);
  });

  it("provides correct metrics for mixed entries", () => {
    const footprint = {
      readOnly: ["key1", "key2"],
      readWrite: ["key3", "key4", "key3"],
    };
    const report = detectRedundantFootprintInObject(footprint);
    expect(report.metrics.totalEntries).toBe(5);
    expect(report.metrics.readOnlyEntries).toBe(2);
    expect(report.metrics.readWriteEntries).toBe(3);
    expect(report.metrics.duplicateEntries).toBe(1);
  });

  it("includes entry details in findings", () => {
    const footprint = {
      readOnly: ["key1", "key1"],
      readWrite: [],
    };
    const report = detectRedundantFootprintInObject(footprint);
    const finding = report.findings.find(
      (f) => f.patternId === "duplicate-entry",
    );
    expect(finding?.entry).toBeDefined();
    expect(finding?.entry?.key).toBe("key1");
    expect(finding?.entry?.isDuplicate).toBe(true);
  });
});
