import {
  analyzeFootprint,
  analyzeFootprintObject,
} from "../footprint-analyzer";

describe("analyzeFootprint", () => {
  it("returns no findings for clean source code without storage operations", () => {
    const source = `pub fn add(a: i128, b: i128) -> i128 { a + b }`;
    const report = analyzeFootprint(source);
    expect(report.findings).toHaveLength(0);
    expect(report.entries).toHaveLength(0);
  });

  it("detects storage read operations", () => {
    const source = `
      let value = env.storage().instance().get(&key);
    `;
    const report = analyzeFootprint(source);
    expect(report.entries.length).toBeGreaterThan(0);
    expect(report.readEntries.length).toBeGreaterThan(0);
  });

  it("detects storage write operations", () => {
    const source = `
      env.storage().instance().set(&key, &value);
    `;
    const report = analyzeFootprint(source);
    expect(report.entries.length).toBeGreaterThan(0);
    expect(report.writeEntries.length).toBeGreaterThan(0);
  });

  it("detects duplicate storage entries", () => {
    const source = `
      let val1 = env.storage().instance().get(&key);
      let val2 = env.storage().instance().get(&key);
    `;
    const report = analyzeFootprint(source);
    const duplicateFindings = report.findings.filter(
      (f) => f.patternId === "duplicate-entry",
    );
    expect(duplicateFindings.length).toBeGreaterThan(0);
  });

  it("classifies read-write access correctly", () => {
    const source = `
      let val = env.storage().persistent().get(&key);
      env.storage().persistent().set(&key, &new_val);
    `;
    const report = analyzeFootprint(source);
    const readWriteEntries = report.entries.filter(
      (e) => e.accessType === "read-write",
    );
    expect(readWriteEntries.length).toBeGreaterThan(0);
  });

  it("generates optimization suggestions for duplicates", () => {
    const source = `
      let val1 = env.storage().instance().get(&key);
      let val2 = env.storage().instance().get(&key);
    `;
    const report = analyzeFootprint(source);
    const optimizationFindings = report.findings.filter(
      (f) => f.ruleId === "soroban-footprint-optimization",
    );
    expect(optimizationFindings.length).toBeGreaterThan(0);
  });

  it("provides metrics in the report", () => {
    const source = `
      let val1 = env.storage().instance().get(&key1);
      let val2 = env.storage().instance().get(&key2);
      env.storage().instance().set(&key3, &value);
    `;
    const report = analyzeFootprint(source);
    expect(report.metrics.totalEntries).toBeGreaterThan(0);
    expect(report.metrics.readOnlyEntries).toBeGreaterThanOrEqual(0);
    expect(report.metrics.readWriteEntries).toBeGreaterThanOrEqual(0);
  });

  it("handles multiple storage scopes", () => {
    const source = `
      let val1 = env.storage().instance().get(&key1);
      let val2 = env.storage().persistent().get(&key2);
      let val3 = env.storage().temporary().get(&key3);
    `;
    const report = analyzeFootprint(source);
    expect(report.entries.length).toBe(3);
  });
});

describe("analyzeFootprintObject", () => {
  it("returns no findings for empty footprint", () => {
    const footprint = { readOnly: [], readWrite: [] };
    const report = analyzeFootprintObject(footprint);
    expect(report.findings).toHaveLength(0);
    expect(report.entries).toHaveLength(0);
  });

  it("detects duplicate read-only entries", () => {
    const footprint = {
      readOnly: ["key1", "key2", "key1"],
      readWrite: [],
    };
    const report = analyzeFootprintObject(footprint);
    const duplicateFindings = report.findings.filter(
      (f) => f.patternId === "duplicate-entry",
    );
    expect(duplicateFindings.length).toBe(1);
    expect(report.metrics.duplicateEntries).toBe(1);
  });

  it("detects duplicate read-write entries", () => {
    const footprint = {
      readOnly: [],
      readWrite: ["key1", "key2", "key1"],
    };
    const report = analyzeFootprintObject(footprint);
    const duplicateFindings = report.findings.filter(
      (f) => f.patternId === "duplicate-entry",
    );
    expect(duplicateFindings.length).toBe(1);
    expect(report.metrics.duplicateEntries).toBe(1);
  });

  it("detects overlapping access between readOnly and readWrite", () => {
    const footprint = {
      readOnly: ["key1"],
      readWrite: ["key1"],
    };
    const report = analyzeFootprintObject(footprint);
    const overlapFindings = report.findings.filter(
      (f) => f.patternId === "overlapping-access",
    );
    expect(overlapFindings.length).toBe(1);
  });

  it("provides correct metrics", () => {
    const footprint = {
      readOnly: ["key1", "key2"],
      readWrite: ["key3"],
    };
    const report = analyzeFootprintObject(footprint);
    expect(report.metrics.totalEntries).toBe(3);
    expect(report.metrics.readOnlyEntries).toBe(2);
    expect(report.metrics.readWriteEntries).toBe(1);
    expect(report.metrics.duplicateEntries).toBe(0);
  });

  it("classifies access types correctly", () => {
    const footprint = {
      readOnly: ["key1"],
      readWrite: ["key2"],
    };
    const report = analyzeFootprintObject(footprint);
    expect(report.readEntries.length).toBe(1);
    expect(report.writeEntries.length).toBe(1);
    expect(report.readEntries[0].accessType).toBe("read");
    expect(report.writeEntries[0].accessType).toBe("read-write");
  });

  it("generates summary with entry counts", () => {
    const footprint = {
      readOnly: ["key1", "key2"],
      readWrite: ["key3", "key4"],
    };
    const report = analyzeFootprintObject(footprint);
    expect(report.summary).toContain("4");
    expect(report.summary).toContain("2");
  });
});
