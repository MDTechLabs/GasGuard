import { describe, it, expect } from "@jest/globals";
import { Finding, Severity } from "../../../../../libs/engine/core/analyzer-interface";
import { SorobanAuditSummaryGenerator } from "../audit-summary";

describe("SorobanAuditSummaryGenerator", () => {
  const generator = new SorobanAuditSummaryGenerator();

  const mockFindings: Finding[] = [
    {
      ruleId: "reentrancy",
      message: "Potential reentrancy vulnerability detected.",
      severity: Severity.CRITICAL,
      location: { file: "contract.rs", startLine: 12, endLine: 15 },
      suggestedFix: { description: "Use reentrancy guard or change call order" },
    },
    {
      ruleId: "unnecessary-storage-read",
      message: "Instance storage is read repeatedly inside loop.",
      severity: Severity.HIGH,
      location: { file: "contract.rs", startLine: 25, endLine: 28 },
      estimatedGasSavings: 5000,
      suggestedFix: { description: "Cache the value locally outside loop" },
    },
  ];

  it("should generate audit summary report with correct grouped findings", () => {
    const report = generator.generateSummary(mockFindings, "MyDApp", "VaultContract");

    expect(report.projectName).toBe("MyDApp");
    expect(report.contractName).toBe("VaultContract");
    expect(report.totalFindings).toBe(2);
    expect(report.severityCounts[Severity.CRITICAL]).toBe(1);
    expect(report.severityCounts[Severity.HIGH]).toBe(1);
    expect(report.severityCounts[Severity.MEDIUM]).toBe(0);
    expect(report.totalEstimatedGasSavings).toBe(5000);
    expect(report.groupedFindings[Severity.CRITICAL]).toHaveLength(1);
  });

  it("should format a nice markdown report", () => {
    const report = generator.generateSummary(mockFindings, "MyDApp", "VaultContract");
    const markdown = generator.formatMarkdown(report);

    expect(markdown).toContain("# Soroban Security Audit Summary: VaultContract");
    expect(markdown).toContain("**Project:** MyDApp");
    expect(markdown).toContain("🔴 CRITICAL (1)");
    expect(markdown).toContain("🟠 HIGH (1)");
    expect(markdown).toContain("**Estimated Savings:** 5000 units");
  });
});
