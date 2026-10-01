import { buildInteractiveConfig, validateConfidenceThreshold } from "./init";

describe("interactive configuration", () => {
  it("builds the standard config shape and normalizes pattern lists", () => {
    expect(
      buildInteractiveConfig({
        include: " contracts/**/*.sol, , src/**/*.rs ",
        exclude: "vendor/**, target/**",
        format: "sarif",
        summary: false,
        confidenceThreshold: "0.85",
        autoFix: false,
      }),
    ).toEqual({
      version: "1.0.0",
      scan: {
        include: ["contracts/**/*.sol", "src/**/*.rs"],
        exclude: ["vendor/**", "target/**"],
        maxFiles: 1000,
      },
      rules: {
        enabled: ["SOL-001", "SOL-002", "SOL-003", "VY-001", "VY-002"],
        severity: ["high", "medium", "low"],
      },
      output: {
        format: "sarif",
        summary: false,
        fixPreview: false,
        confidenceThreshold: 0.85,
      },
      autoFix: { enabled: false, safeOnly: true, backup: true },
    });
  });

  it("accepts confidence boundaries and rejects invalid values", () => {
    expect(validateConfidenceThreshold("0")).toBe(true);
    expect(validateConfidenceThreshold("1")).toBe(true);
    expect(validateConfidenceThreshold("0.7")).toBe(true);
    expect(validateConfidenceThreshold(" ")).not.toBe(true);
    expect(validateConfidenceThreshold("-0.1")).not.toBe(true);
    expect(validateConfidenceThreshold("1.1")).not.toBe(true);
    expect(validateConfidenceThreshold("nope")).not.toBe(true);
  });
});
