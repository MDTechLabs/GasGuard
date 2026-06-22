import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { StellarEnterpriseReporter } from "./stellar-enterprise-reporter";

describe("StellarEnterpriseReporter", () => {
  const reporter = new StellarEnterpriseReporter();

  const findings = [
    {
      ruleId: "stellar-network-validation",
      filePath: "contracts/payment.soroban",
      line: 18,
      message:
        "Contract should validate the active Stellar network before execution.",
      confidence: 0.96,
    },
    {
      ruleId: "stellar-access-control",
      filePath: "contracts/payment.soroban",
      line: 44,
      message: "Privileged call is missing a role check.",
      confidence: 0.84,
    },
    {
      ruleId: "stellar-event-traceability",
      filePath: "contracts/audit.soroban",
      line: 12,
      message: "Important state change is not emitted as an event.",
      confidence: 0.72,
    },
  ];

  it("creates a structured enterprise report", () => {
    const report = reporter.createReport(findings, {
      projectName: "GasGuard",
      scanPath: "/workspace/contracts",
      version: "2.4.0",
      generatedBy: "Enterprise Pipeline",
      frameworks: ["Stellar", "SOC 2"],
    });

    expect(report.metadata.projectName).toBe("GasGuard");
    expect(report.metadata.version).toBe("2.4.0");
    expect(report.summary.totalFindings).toBe(3);
    expect(report.summary.totalFiles).toBe(2);
    expect(report.summary.uniqueRules).toBe(3);
    expect(report.compliance.controls.length).toBeGreaterThan(0);
    expect(report.findings[0].severity).toBe("critical");
    expect(report.findings[0].category).toBe("networking");
    expect(report.exportFormats).toEqual(["json", "csv", "markdown"]);
  });

  it("exports json, csv, and markdown formats successfully", () => {
    const report = reporter.createReport(findings, {
      projectName: "GasGuard",
      scanPath: "/workspace/contracts",
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gasguard-enterprise-"));
    const jsonPath = path.join(dir, "report.json");
    const csvPath = path.join(dir, "report.csv");
    const markdownPath = path.join(dir, "report.md");

    expect(reporter.exportReport(report, jsonPath)).toBe(jsonPath);
    expect(reporter.exportReport(report, csvPath)).toBe(csvPath);
    expect(reporter.exportReport(report, markdownPath)).toBe(markdownPath);

    const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    expect(json.metadata.projectName).toBe("GasGuard");
    expect(json.summary.totalFindings).toBe(3);

    const csv = fs.readFileSync(csvPath, "utf8");
    expect(csv).toContain("ruleId,filePath,line,confidence,severity");
    expect(csv).toContain("stellar-network-validation");

    const markdown = fs.readFileSync(markdownPath, "utf8");
    expect(markdown).toContain("# GasGuard Enterprise Stellar Report");
    expect(markdown).toContain("## Compliance Summary");
    expect(markdown).toContain("Overall compliance: **FAIL**");
  });

  it("infers export format from the file extension", () => {
    expect(reporter.inferFormat("report.csv")).toBe("csv");
    expect(reporter.inferFormat("report.md")).toBe("markdown");
    expect(reporter.inferFormat("report.markdown")).toBe("markdown");
    expect(reporter.inferFormat("report.json")).toBe("json");
  });
});
