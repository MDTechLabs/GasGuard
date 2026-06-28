import { describe, it, expect } from "@jest/globals";
import { FindingOwnershipAssigner } from "./ownership-assigner";
import { Finding, Severity } from "@engine/core";

const makeFinding = (overrides: Partial<Finding> = {}): Finding => ({
  ruleId: "stellar-storage-001",
  message: "Inefficient storage access",
  severity: Severity.MEDIUM,
  location: { file: "contracts/token/main.rs", startLine: 10, endLine: 12 },
  ...overrides,
});

describe("FindingOwnershipAssigner", () => {
  it("assigns finding to owner via ruleId prefix", () => {
    const assigner = new FindingOwnershipAssigner([
      { id: "r1", name: "Storage Team", owner: "storage-team", ruleIdPrefix: "stellar-storage-" },
    ]);

    const report = assigner.assign([makeFinding()]);

    expect(report.assignments).toHaveLength(1);
    expect(report.assignments[0]?.owner).toBe("storage-team");
    expect(report.unassigned).toHaveLength(0);
  });

  it("assigns finding to owner via file pattern", () => {
    const assigner = new FindingOwnershipAssigner([
      { id: "r1", name: "Token Team", owner: "token-team", filePattern: "contracts/token/**" },
    ]);

    const report = assigner.assign([makeFinding()]);

    expect(report.assignments[0]?.owner).toBe("token-team");
  });

  it("assigns finding to owner via severity filter", () => {
    const assigner = new FindingOwnershipAssigner([
      { id: "r1", name: "Critical Handler", owner: "security-team", severities: [Severity.CRITICAL, Severity.HIGH] },
    ]);

    const critical = makeFinding({ severity: Severity.CRITICAL });
    const medium = makeFinding({ severity: Severity.MEDIUM });
    const report = assigner.assign([critical, medium]);

    expect(report.assignments).toHaveLength(1);
    expect(report.assignments[0]?.owner).toBe("security-team");
    expect(report.unassigned).toHaveLength(1);
  });

  it("puts unmatched findings in unassigned list", () => {
    const assigner = new FindingOwnershipAssigner([]);
    const report = assigner.assign([makeFinding()]);

    expect(report.unassigned).toHaveLength(1);
    expect(report.assignments).toHaveLength(0);
  });

  it("builds ownerBreakdown correctly", () => {
    const assigner = new FindingOwnershipAssigner([
      { id: "r1", name: "Storage Team", owner: "storage-team", ruleIdPrefix: "stellar-storage-" },
    ]);

    const report = assigner.assign([makeFinding(), makeFinding()]);

    expect(report.ownerBreakdown["storage-team"]).toBe(2);
  });

  it("assignOne returns null when no rule matches", () => {
    const assigner = new FindingOwnershipAssigner([]);
    expect(assigner.assignOne(makeFinding())).toBeNull();
  });

  it("addRule registers a new rule that is applied", () => {
    const assigner = new FindingOwnershipAssigner([]);
    assigner.addRule({ id: "r1", name: "Ops", owner: "ops-team", ruleIdPrefix: "stellar-" });

    const result = assigner.assignOne(makeFinding());
    expect(result?.owner).toBe("ops-team");
  });

  it("uses first matching rule (rule priority)", () => {
    const assigner = new FindingOwnershipAssigner([
      { id: "r1", name: "First", owner: "first-team", ruleIdPrefix: "stellar-" },
      { id: "r2", name: "Second", owner: "second-team", ruleIdPrefix: "stellar-storage-" },
    ]);

    const result = assigner.assignOne(makeFinding());
    expect(result?.owner).toBe("first-team");
    expect(result?.matchedRule).toBe("r1");
  });

  it("reports total count including unassigned", () => {
    const assigner = new FindingOwnershipAssigner([]);
    const report = assigner.assign([makeFinding(), makeFinding()]);
    expect(report.total).toBe(2);
  });
});
