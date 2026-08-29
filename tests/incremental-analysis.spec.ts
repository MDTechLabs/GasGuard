import { describe, it, expect, jest } from "@jest/globals";
import {
  StellarIncrementalScanEngine,
  ScanInput,
  ScanFinding,
} from "../src/scanning/incremental/stellar/incremental-scan-engine";

const mockFinding = (ruleId = "test-rule"): ScanFinding => ({
  ruleId,
  message: "Test finding",
  severity: "medium",
  line: 1,
});

const noopScan = (_input: ScanInput): ScanFinding[] => [];
const alwaysFindsScan = (input: ScanInput): ScanFinding[] => [
  mockFinding(input.filePath),
];

describe("StellarIncrementalScanEngine", () => {
  it("scans all files on the first run", () => {
    const engine = new StellarIncrementalScanEngine();
    const inputs: ScanInput[] = [
      { filePath: "a.rs", source: "fn main() {}" },
      { filePath: "b.rs", source: "fn other() {}" },
    ];

    const result = engine.scan(inputs, noopScan);

    expect(result.scanned).toEqual(["a.rs", "b.rs"]);
    expect(result.skipped).toHaveLength(0);
    expect(result.cacheHitRate).toBe(0);
  });

  it("skips unchanged files on subsequent runs", () => {
    const engine = new StellarIncrementalScanEngine();
    const inputs: ScanInput[] = [{ filePath: "a.rs", source: "fn main() {}" }];

    engine.scan(inputs, noopScan);
    const second = engine.scan(inputs, noopScan);

    expect(second.scanned).toHaveLength(0);
    expect(second.skipped).toEqual(["a.rs"]);
    expect(second.cacheHitRate).toBe(1);
  });

  it("rescans only changed files", () => {
    const engine = new StellarIncrementalScanEngine();
    const inputs: ScanInput[] = [
      { filePath: "a.rs", source: "fn main() {}" },
      { filePath: "b.rs", source: "fn other() {}" },
    ];

    engine.scan(inputs, noopScan);

    const changed: ScanInput[] = [
      { filePath: "a.rs", source: "fn main() { /* changed */ }" },
      { filePath: "b.rs", source: "fn other() {}" },
    ];
    const second = engine.scan(changed, noopScan);

    expect(second.scanned).toEqual(["a.rs"]);
    expect(second.skipped).toEqual(["b.rs"]);
    expect(second.cacheHitRate).toBeCloseTo(0.5);
  });

  it("returns cached findings for skipped files", () => {
    const engine = new StellarIncrementalScanEngine();
    const inputs: ScanInput[] = [{ filePath: "a.rs", source: "let x = 1;" }];

    engine.scan(inputs, alwaysFindsScan);
    const second = engine.scan(inputs, alwaysFindsScan);

    expect(second.results[0]?.findings).toHaveLength(1);
  });

  it("invalidate forces a rescan on the next run", () => {
    const engine = new StellarIncrementalScanEngine();
    const inputs: ScanInput[] = [{ filePath: "a.rs", source: "fn main() {}" }];

    engine.scan(inputs, noopScan);
    engine.invalidate("a.rs");
    const second = engine.scan(inputs, noopScan);

    expect(second.scanned).toEqual(["a.rs"]);
    expect(second.skipped).toHaveLength(0);
  });

  it("clearCache resets the engine state", () => {
    const engine = new StellarIncrementalScanEngine();
    const inputs: ScanInput[] = [{ filePath: "a.rs", source: "fn main() {}" }];

    engine.scan(inputs, noopScan);
    expect(engine.trackedCount).toBe(1);

    engine.clearCache();
    expect(engine.trackedCount).toBe(0);

    const second = engine.scan(inputs, noopScan);
    expect(second.scanned).toEqual(["a.rs"]);
  });

  it("handles empty inputs", () => {
    const engine = new StellarIncrementalScanEngine();
    const result = engine.scan([], noopScan);

    expect(result.results).toHaveLength(0);
    expect(result.scanned).toHaveLength(0);
    expect(result.cacheHitRate).toBe(0);
  });

  it("tracks scan duration", () => {
    const engine = new StellarIncrementalScanEngine();
    const inputs: ScanInput[] = [{ filePath: "a.rs", source: "fn main() {}" }];

    const result = engine.scan(inputs, noopScan);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
