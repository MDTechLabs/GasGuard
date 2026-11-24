import {
  applySuppressions,
  evaluateSuppression,
  type FindingSuppression,
} from "./finding-suppression-policy";

describe("finding suppression expiry and justification (#1329)", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  const suppression = (overrides: Partial<FindingSuppression> = {}): FindingSuppression => ({
    ruleId: "SOL-REENTRANCY-001",
    path: "contracts/Vault.sol",
    justification: "Guarded by nonReentrant on every external entry point",
    owner: "security-team",
    expiresAt: "2026-09-01",
    ...overrides,
  });

  const finding = (id: string, ruleId = "SOL-REENTRANCY-001", filePath = "contracts/Vault.sol") => ({
    id,
    ruleId,
    filePath,
  });

  it("accepts a justified, unexpired suppression", () => {
    expect(evaluateSuppression(suppression(), now)).toMatchObject({ active: true, problems: [] });
  });

  it("rejects a missing or blank justification", () => {
    expect(evaluateSuppression(suppression({ justification: "   " }), now).problems).toEqual([
      "missing-justification",
    ]);
  });

  it("rejects placeholder and too-short justifications", () => {
    expect(evaluateSuppression(suppression({ justification: "TODO" }), now).problems).toEqual([
      "placeholder-justification",
    ]);
    expect(evaluateSuppression(suppression({ justification: "looks fine" }), now).problems).toEqual([
      "justification-too-short",
    ]);
  });

  it("rejects a missing or unparseable expiry", () => {
    expect(evaluateSuppression(suppression({ expiresAt: "" }), now).problems).toEqual(["missing-expiry"]);
    expect(evaluateSuppression(suppression({ expiresAt: "next week" }), now).problems).toEqual([
      "invalid-expiry",
    ]);
  });

  it("treats a bare date as valid through the end of that UTC day", () => {
    const sameDay = new Date("2026-09-01T23:00:00Z");
    expect(evaluateSuppression(suppression({ expiresAt: "2026-09-01" }), sameDay).active).toBe(true);
    const nextDay = new Date("2026-09-02T00:00:00Z");
    expect(evaluateSuppression(suppression({ expiresAt: "2026-09-01" }), nextDay).problems).toEqual([
      "expired",
    ]);
  });

  it("rejects an expiry further out than the policy allows", () => {
    expect(evaluateSuppression(suppression({ expiresAt: "2028-01-01" }), now).problems).toEqual([
      "expiry-too-far",
    ]);
  });

  it("allows an expiry exactly at the maximum lifetime", () => {
    const limit = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();
    expect(evaluateSuppression(suppression({ expiresAt: limit }), now).active).toBe(true);
  });

  it("collects every problem rather than stopping at the first", () => {
    const verdict = evaluateSuppression(
      suppression({ ruleId: "", path: "", justification: "", expiresAt: "" }),
      now,
    );
    expect(verdict.problems).toEqual([
      "missing-rule-id",
      "missing-path",
      "missing-justification",
      "missing-expiry",
    ]);
  });

  it("hides findings covered by an active suppression and reports the justification", () => {
    const outcome = applySuppressions([finding("a"), finding("b", "SOL-OVERFLOW-002")], [suppression()], now);
    expect(outcome.kept.map((item) => item.id)).toEqual(["b"]);
    expect(outcome.suppressed).toEqual([
      {
        id: "a",
        ruleId: "SOL-REENTRANCY-001",
        justification: "Guarded by nonReentrant on every external entry point",
        expiresAt: "2026-09-01",
      },
    ]);
    expect(outcome.rejected).toEqual([]);
  });

  it("brings a finding back once its suppression has expired", () => {
    const later = new Date("2026-09-02T00:00:00Z");
    const outcome = applySuppressions([finding("a")], [suppression()], later);
    expect(outcome.kept.map((item) => item.id)).toEqual(["a"]);
    expect(outcome.suppressed).toEqual([]);
    expect(outcome.rejected[0].problems).toEqual(["expired"]);
  });

  it("does not suppress with an unjustified entry", () => {
    const outcome = applySuppressions([finding("a")], [suppression({ justification: "" })], now);
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.rejected[0].problems).toEqual(["missing-justification"]);
  });

  it("supports directory prefixes but not partial file names", () => {
    const prefix = suppression({ path: "contracts/legacy/" });
    const outcome = applySuppressions(
      [finding("a", undefined, "contracts/legacy/Old.sol"), finding("b", undefined, "contracts/legacy2/New.sol")],
      [prefix],
      now,
    );
    expect(outcome.kept.map((item) => item.id)).toEqual(["b"]);
  });

  it("is deterministic for the same inputs and clock", () => {
    const run = () => applySuppressions([finding("a"), finding("b")], [suppression()], now);
    expect(run()).toEqual(run());
  });
});
