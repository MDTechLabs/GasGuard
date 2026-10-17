import {
  filterSuppressedSecrets,
  isSuppressedSecret,
  type SuppressionInput,
} from "./secret-false-positive-suppression";

describe("secret false-positive suppression (#1175)", () => {
  const detection = (overrides: Partial<SuppressionInput> = {}): SuppressionInput => ({
    value: "Zx9Qm2Kd7Vp1Lr4Tb8Nw",
    filePath: "src/config/secrets.ts",
    line: 'const apiKey = "Zx9Qm2Kd7Vp1Lr4Tb8Nw";',
    ...overrides,
  });

  it("keeps a credential in first-party source", () => {
    expect(isSuppressedSecret(detection())).toEqual({ suppressed: false });
  });

  it("suppresses test fixtures", () => {
    const decision = isSuppressedSecret(detection({ filePath: "src/__tests__/secrets.spec.ts" }));
    expect(decision.suppressed).toBe(true);
    expect(decision.ruleId).toBe("documentation-path");
  });

  it("suppresses documentation", () => {
    expect(isSuppressedSecret(detection({ filePath: "docs/secrets.md" })).suppressed).toBe(true);
  });

  it("suppresses placeholder values", () => {
    const decision = isSuppressedSecret(
      detection({ value: "changeme-please", line: 'const token = "changeme-please";' }),
    );
    expect(decision.suppressed).toBe(true);
    expect(decision.ruleId).toBe("placeholder-value");
  });

  it("honours the inline allowance marker", () => {
    const decision = isSuppressedSecret(
      detection({ line: 'const apiKey = "Zx9Qm2Kd7Vp1Lr4Tb8Nw"; // gasguard:allow-secret' }),
    );
    expect(decision.suppressed).toBe(true);
    expect(decision.ruleId).toBe("inline-allowance");
  });

  it("splits detections into kept and suppressed without leaking values", () => {
    const report = filterSuppressedSecrets([
      { id: "a", ...detection() },
      { id: "b", ...detection({ filePath: "test/fixtures/keys.json" }) },
    ]);

    expect(report.kept.map((item) => item.id)).toEqual(["a"]);
    expect(report.suppressed).toEqual([
      { id: "b", ruleId: "documentation-path", reason: "path is documentation or an example fixture" },
    ]);
    expect(JSON.stringify(report)).not.toContain("Zx9Qm2Kd7Vp1Lr4Tb8Nw");
  });
});
