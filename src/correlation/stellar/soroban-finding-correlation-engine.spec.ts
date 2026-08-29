import { Finding, Severity } from "@engine/core";
import { SorobanFindingCorrelationEngine } from "./soroban-finding-correlation-engine";

function finding(overrides: Partial<Finding> & { ruleId: string; message: string }): Finding {
  return {
    ruleId: overrides.ruleId,
    message: overrides.message,
    severity: overrides.severity ?? Severity.MEDIUM,
    location: {
      file: overrides.location?.file ?? "contracts/payment/src/lib.rs",
      startLine: overrides.location?.startLine ?? 12,
      endLine: overrides.location?.endLine ?? 12,
    },
    metadata: overrides.metadata,
    estimatedGasSavings: overrides.estimatedGasSavings,
    suggestedFix: overrides.suggestedFix,
  };
}

describe("SorobanFindingCorrelationEngine", () => {
  const engine = new SorobanFindingCorrelationEngine();

  it("groups findings that share an explicit root cause id", () => {
    const report = engine.createReport([
      finding({
        ruleId: "stellar-access-control",
        message: "Missing admin authorization before token mint",
        severity: Severity.HIGH,
        location: { file: "contracts/token/src/admin.rs", startLine: 20, endLine: 20 },
        metadata: { rootCauseId: "admin-auth-missing", functionName: "mint" },
      }),
      finding({
        ruleId: "stellar-event-traceability",
        message: "Mint path does not emit an audit event",
        severity: Severity.MEDIUM,
        location: { file: "contracts/token/src/admin.rs", startLine: 34, endLine: 34 },
        metadata: { rootCauseId: "admin-auth-missing", functionName: "mint" },
      }),
    ]);

    expect(report.summary.totalFindings).toBe(2);
    expect(report.summary.correlatedGroups).toBe(1);
    expect(report.groups[0].findingCount).toBe(2);
    expect(report.groups[0].highestSeverity).toBe(Severity.HIGH);
    expect(report.groups[0].sharedSignals).toEqual(
      expect.arrayContaining(["rootCauseId:admin-auth-missing", "function:mint"]),
    );
  });

  it("correlates same-function Soroban findings without explicit metadata keys", () => {
    const report = engine.createReport([
      finding({
        ruleId: "stellar-storage-write",
        message: "Repeated storage write increases ledger cost",
        location: { file: "contracts/vault/src/lib.rs", startLine: 48, endLine: 48 },
        metadata: { functionName: "deposit" },
      }),
      finding({
        ruleId: "stellar-event-traceability",
        message: "Deposit flow misses an event for the same state mutation",
        location: { file: "contracts/vault/src/lib.rs", startLine: 55, endLine: 55 },
        metadata: { functionName: "deposit" },
      }),
      finding({
        ruleId: "stellar-network-validation",
        message: "Network passphrase should be validated before execution",
        location: { file: "contracts/oracle/src/lib.rs", startLine: 10, endLine: 10 },
        metadata: { functionName: "initialize" },
      }),
    ]);

    expect(report.summary.correlatedGroups).toBe(1);
    expect(report.summary.standaloneFindings).toBe(1);
    expect(report.groups[0].affectedFiles).toEqual(["contracts/vault/src/lib.rs"]);
    expect(report.groups[0].ruleIds).toEqual([
      "stellar-event-traceability",
      "stellar-storage-write",
    ]);
  });

  it("renders a concise markdown report for review artifacts", () => {
    const report = engine.createReport([
      finding({
        ruleId: "stellar-access-control",
        message: "Missing signer check before upgrade",
        severity: Severity.CRITICAL,
        metadata: { rootCauseId: "upgrade-auth", functionName: "upgrade" },
      }),
      finding({
        ruleId: "stellar-event-traceability",
        message: "Upgrade flow has no audit event",
        metadata: { rootCauseId: "upgrade-auth", functionName: "upgrade" },
      }),
    ]);

    const markdown = engine.renderMarkdown(report);

    expect(markdown).toContain("# Soroban Finding Correlation Report");
    expect(markdown).toContain("upgrade-auth");
    expect(markdown).toContain("stellar-access-control");
    expect(markdown).toContain("Fix the shared root cause once");
  });
});
