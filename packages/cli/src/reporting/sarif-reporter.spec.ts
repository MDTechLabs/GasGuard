import { generateSarifReport } from "./sarif-reporter";
import { ScanResult } from "./sarif-reporter";
import * as fs from "fs-extra";
import * as path from "path";

describe("SARIF Reporter", () => {
  const mockScanResult: ScanResult = {
    timestamp: "2024-01-01T00:00:00.000Z",
    scanPath: "/test/path",
    totalFiles: 1,
    scannedFiles: 1,
    findings: [
      {
        file: "/test/path/contract.sol",
        line: 10,
        ruleId: "SOL-001",
        ruleName: "string-to-bytes32",
        severity: "high",
        message: "Use bytes32 instead of string for fixed-length data",
        suggestion: "Replace string with bytes32 to save gas",
        gasSavings: 5000,
        confidence: 0.9,
      },
    ],
    summary: {
      totalViolations: 1,
      bySeverity: {
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
        info: 0,
      },
      byRule: {
        "SOL-001": 1,
      },
      totalGasSavings: 5000,
    },
  };

  it("should generate a valid SARIF report", async () => {
    const outputPath = path.join(__dirname, "test-output.sarif.json");

    await generateSarifReport(mockScanResult, outputPath);

    // Verify file was created
    const fileExists = await fs.pathExists(outputPath);
    expect(fileExists).toBe(true);

    // Verify SARIF structure
    const report = await fs.readJson(outputPath);
    expect(report.version).toBe("2.1.0");
    expect(report.$schema).toBe(
      "https://json.schemastore.org/sarif-2.1.0.json",
    );
    expect(report.runs).toBeDefined();
    expect(report.runs.length).toBeGreaterThan(0);
    expect(report.runs[0].tool.driver.name).toBe("GasGuard");
    expect(report.runs[0].results).toBeDefined();
    expect(report.runs[0].results.length).toBe(1);

    // Verify result structure
    const result = report.runs[0].results[0];
    expect(result.ruleId).toBe("SOL-001");
    expect(result.level).toBe("error");
    expect(result.message.text).toBe(
      "Use bytes32 instead of string for fixed-length data",
    );
    expect(result.locations).toBeDefined();
    expect(result.locations.length).toBe(1);
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe(
      "/test/path/contract.sol",
    );
    expect(result.locations[0].physicalLocation.region.startLine).toBe(10);

    // Verify rule structure
    const rules = report.runs[0].tool.driver.rules;
    expect(rules).toBeDefined();
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0].id).toBe("SOL-001");
    expect(rules[0].shortDescription.text).toBeDefined();
    expect(rules[0].properties).toBeDefined();
    expect(rules[0].properties.category).toBe("solidity");

    // Cleanup
    await fs.remove(outputPath);
  });

  it("should handle empty findings", async () => {
    const emptyResult: ScanResult = {
      timestamp: "2024-01-01T00:00:00.000Z",
      scanPath: "/test/path",
      totalFiles: 0,
      scannedFiles: 0,
      findings: [],
      summary: {
        totalViolations: 0,
        bySeverity: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
        },
        byRule: {},
        totalGasSavings: 0,
      },
    };

    const outputPath = path.join(__dirname, "test-empty.sarif.json");

    await generateSarifReport(emptyResult, outputPath);

    const report = await fs.readJson(outputPath);
    expect(report.runs[0].results).toEqual([]);

    await fs.remove(outputPath);
  });

  it("should handle different severity levels", async () => {
    const multiSeverityResult: ScanResult = {
      ...mockScanResult,
      findings: [
        {
          file: "/test/path/contract.sol",
          line: 10,
          ruleId: "SOL-001",
          ruleName: "string-to-bytes32",
          severity: "critical",
          message: "Critical issue",
          gasSavings: 5000,
          confidence: 0.9,
        },
        {
          file: "/test/path/contract.sol",
          line: 20,
          ruleId: "SOL-002",
          ruleName: "uint256",
          severity: "warning",
          message: "Warning issue",
          gasSavings: 2100,
          confidence: 0.8,
        },
        {
          file: "/test/path/contract.sol",
          line: 30,
          ruleId: "SOL-003",
          ruleName: "calldata",
          severity: "info",
          message: "Info issue",
          gasSavings: 100,
          confidence: 0.7,
        },
      ],
      summary: {
        totalViolations: 3,
        bySeverity: {
          critical: 1,
          high: 0,
          medium: 0,
          low: 0,
          info: 1,
        },
        byRule: {
          "SOL-001": 1,
          "SOL-002": 1,
          "SOL-003": 1,
        },
        totalGasSavings: 7200,
      },
    };

    const outputPath = path.join(__dirname, "test-severity.sarif.json");

    await generateSarifReport(multiSeverityResult, outputPath);

    const report = await fs.readJson(outputPath);
    const results = report.runs[0].results;

    expect(results[0].level).toBe("error"); // critical -> error
    expect(results[1].level).toBe("warning"); // warning -> warning
    expect(results[2].level).toBe("note"); // info -> note

    await fs.remove(outputPath);
  });
});
