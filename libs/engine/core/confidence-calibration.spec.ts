import * as fs from "fs";
import * as path from "path";
import {
  buildCalibrationProfiles,
  calibrateFindings,
  confidenceBand,
  CALIBRATION_SCHEMA_VERSION,
  type CalibrationConfig,
} from "./confidence-calibration";

const FIXTURES = path.resolve(__dirname, "../../../tests/fixtures/confidence-calibration");
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));

const metaOf = (result: { findings: any[]; suppressed: any[] }, index: number, message?: string) =>
  [...result.findings, ...result.suppressed].filter((f) => !message || f.message === message)[index]
    .metadata;

describe("confidenceBand", () => {
  it("maps confidence to bands with inclusive lower bounds", () => {
    expect(confidenceBand(0.8)).toBe("high");
    expect(confidenceBand(0.79)).toBe("medium");
    expect(confidenceBand(0.5)).toBe("medium");
    expect(confidenceBand(0.49)).toBe("low");
  });

  it("honours custom thresholds and falls back on invalid ones", () => {
    expect(confidenceBand(0.6, { high: 0.6, medium: 0.2 })).toBe("high");
    expect(confidenceBand(0.9, { high: 0.3, medium: 0.6 })).toBe("high"); // invalid -> defaults
    expect(confidenceBand(0.4, { high: 0.3, medium: 0.6 })).toBe("low");
  });
});

describe("buildCalibrationProfiles", () => {
  const fixture = load("realistic-review-history.json");

  it("aggregates verdicts per rule for the requested rule-pack version", () => {
    const { profiles, counts, issues } = buildCalibrationProfiles(fixture.outcomes, {
      rulePackVersion: fixture.rulePackVersion,
    });
    expect(profiles).toEqual([
      { ruleId: "storage-in-loop", truePositives: 10, falsePositives: 30, rulePackVersion: "2.1.0" },
      { ruleId: "unchecked-return", truePositives: 45, falsePositives: 5, rulePackVersion: "2.1.0" },
      { ruleId: "unused-import", truePositives: 2, falsePositives: 1, rulePackVersion: "2.1.0" },
    ]);
    expect(counts).toEqual({ received: 117, counted: 93, ignored: 3, otherVersion: 21, invalid: 0 });
    expect(issues).toEqual([]);
  });

  it("reports malformed outcomes instead of throwing", () => {
    const { profiles, counts, issues } = buildCalibrationProfiles([
      { ruleId: "", verdict: "true_positive" },
      { ruleId: "r", verdict: "maybe" as any },
      { ruleId: "r", verdict: "true_positive" },
    ]);
    expect(profiles).toHaveLength(1);
    expect(counts.invalid).toBe(2);
    expect(issues.map((i) => i.code)).toEqual(["INVALID_OUTCOME", "INVALID_OUTCOME"]);
  });
});

describe("realistic review history", () => {
  const fixture = load("realistic-review-history.json");
  const { profiles } = buildCalibrationProfiles(fixture.outcomes, {
    rulePackVersion: fixture.rulePackVersion,
  });
  const config: CalibrationConfig = {
    rulePackVersion: fixture.rulePackVersion,
    profiles: profiles.map((p) => (p.ruleId === "storage-in-loop" ? { ...p, priorConfidence: 0.6 } : p)),
  };
  const result = calibrateFindings(fixture.findings, config);

  it("calibrates an accurate rule up and a noisy rule down", () => {
    const [plain, withRaw] = result.findings.filter((f: any) => f.ruleId === "unchecked-return");
    // (45 + 0.5*10) / (50 + 10)
    expect(plain.metadata).toMatchObject({
      confidence: 0.8333,
      confidenceBand: "high",
      confidenceSource: "calibrated",
      calibrationSamples: 50,
    });
    // odds 9 (raw 0.9) x odds 5 (45/5 after smoothing) = 45 -> 45/46
    expect(withRaw.metadata).toMatchObject({
      confidence: 0.9783,
      rawConfidence: 0.9,
      confidenceSource: "calibrated",
    });

    const noisy = result.findings.find((f: any) => f.ruleId === "storage-in-loop")!;
    // (10 + 0.6*10) / (40 + 10)
    expect(noisy.metadata).toMatchObject({ confidence: 0.32, confidenceBand: "low" });
  });

  it("leaves rules with too little history uncalibrated", () => {
    const sparse = result.findings.find((f: any) => f.ruleId === "unused-import")!;
    expect(sparse.metadata).toMatchObject({
      confidence: 0.5,
      confidenceSource: "prior",
      calibrationSamples: 3,
    });
    const unknown = result.findings.find((f: any) => f.ruleId === "new-rule")!;
    expect(unknown.metadata).toMatchObject({ confidence: 0.7, confidenceSource: "raw" });
  });

  it("suppresses nothing by default and reports per-rule summaries", () => {
    expect(result.schemaVersion).toBe(CALIBRATION_SCHEMA_VERSION);
    expect(result.suppressed).toEqual([]);
    expect(result.counts).toEqual({ received: 5, kept: 5, suppressed: 0, calibrated: 3, uncalibrated: 2 });
    expect(result.rules.find((r) => r.ruleId === "unchecked-return")).toMatchObject({
      findings: 2,
      meanConfidence: 0.9058,
    });
    expect(result.issues).toEqual([]);
  });

  it("preserves finding fields and does not mutate the input", () => {
    const input = JSON.parse(JSON.stringify(fixture.findings));
    const frozen = JSON.parse(JSON.stringify(fixture.findings));
    calibrateFindings(input, config);
    expect(input).toEqual(frozen);
    expect(result.findings[0]).toMatchObject({
      message: "return value ignored",
      location: { file: "contracts/Vault.sol", startLine: 42 },
    });
  });

  it("suppresses below minConfidence while keeping the confidence visible", () => {
    const filtered = calibrateFindings(fixture.findings, { ...config, minConfidence: 0.4 });
    expect(filtered.suppressed.map((f: any) => f.ruleId)).toEqual(["storage-in-loop"]);
    expect(filtered.suppressed[0]!.metadata.confidence).toBe(0.32);
    expect(filtered.counts).toMatchObject({ kept: 4, suppressed: 1 });
    expect(filtered.rules.find((r) => r.ruleId === "storage-in-loop")!.suppressed).toBe(1);
  });

  it("is deterministic and idempotent", () => {
    const again = calibrateFindings(fixture.findings, {
      ...config,
      profiles: [...config.profiles!].reverse(),
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(result));

    const twice = calibrateFindings(result.findings, config);
    expect(twice.findings).toEqual(result.findings);
  });

  it("ignores profiles recorded against a different rule-pack version", () => {
    const stale = calibrateFindings(fixture.findings, { ...config, rulePackVersion: "3.0.0" });
    expect(stale.issues.filter((i) => i.code === "STALE_PROFILE")).toHaveLength(3);
    expect(stale.counts.calibrated).toBe(0);
  });
});

describe("regression: edge cases", () => {
  const fixture = load("regression-edge-cases.json");
  const result = calibrateFindings(fixture.findings, fixture.config);
  const byRule = (ruleId: string) =>
    [...result.findings, ...result.suppressed].find((f: any) => f.ruleId === ruleId)!.metadata;

  it("falls back to the prior when a profile is stale or invalid, and says why", () => {
    for (const ruleId of ["stale-rule", "bad-counts", "bad-prior"]) {
      expect(byRule(ruleId)).toMatchObject({ confidence: 0.5, confidenceSource: "prior" });
    }
    expect(result.issues.map((i) => i.code)).toEqual([
      "DUPLICATE_PROFILE",
      "INVALID_CONFIDENCE",
      "INVALID_PROFILE",
      "INVALID_PROFILE",
      "MISSING_RULE_ID",
      "STALE_PROFILE",
    ]);
  });

  it("keeps the duplicate profile with the most samples", () => {
    // (90 + 5) / (100 + 10)
    expect(byRule("dup-rule")).toMatchObject({ confidence: 0.8636, calibrationSamples: 100 });
  });

  it("stays finite for saturated counts and extreme raw confidence", () => {
    expect(byRule("always-wrong").confidence).toBeCloseTo(0.7071, 3);
    expect(byRule("always-right").confidence).toBeCloseTo(0.2929, 3);
    for (const f of [...result.findings, ...result.suppressed]) {
      expect(Number.isFinite(f.metadata.confidence)).toBe(true);
      expect(f.metadata.confidence).toBeGreaterThanOrEqual(0);
      expect(f.metadata.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("applies pinned overrides and per-rule thresholds", () => {
    expect(byRule("pinned-rule")).toMatchObject({
      confidence: 0.95,
      confidenceSource: "override",
      rawConfidence: 0.1,
    });
    expect(result.suppressed.map((f: any) => f.ruleId).sort()).toEqual(["always-right", "noisy-rule"]);
  });

  it("ignores invalid raw confidence and handles findings without a ruleId", () => {
    expect(byRule("garbage-confidence")).toMatchObject({ confidence: 0.5, confidenceSource: "prior" });
    expect(byRule("garbage-confidence").rawConfidence).toBeUndefined();
    expect(result.counts).toEqual({ received: 10, kept: 8, suppressed: 2, calibrated: 3, uncalibrated: 7 });
  });

  it("reports invalid configuration and uses defaults", () => {
    const res = calibrateFindings([{ ruleId: "r", message: "m" }], {
      defaultPrior: 2,
      minSamples: -1,
      bandThresholds: { high: 0.2, medium: 0.9 },
    });
    expect(res.issues.map((i) => i.code)).toEqual(["INVALID_CONFIG", "INVALID_CONFIG", "INVALID_CONFIG"]);
    expect(metaOf(res, 0)).toMatchObject({ confidence: 0.5, confidenceBand: "medium" });
  });

  it("returns an empty result for empty input", () => {
    const res = calibrateFindings([]);
    expect(res.findings).toEqual([]);
    expect(res.counts.received).toBe(0);
  });
});
