/**
 * Analyzer Coverage Reporter Tests
 *
 * Comprehensive tests covering normal, boundary, and failure scenarios.
 */

import { CoverageReporter } from "./coverage-reporter";
import {
  CoverageReportData,
  CoverageReportOptions,
  CoverageThreshold,
} from "./types";
import { CoverageMetrics } from "../../analysis/coverage/coverage-analyzer";
import * as fs from "fs";
import * as path from "path";

describe("CoverageReporter", () => {
  let reporter: CoverageReporter;
  let mockCoverageData: CoverageReportData;
  let testOutputDir: string;

  beforeEach(() => {
    reporter = new CoverageReporter();
    testOutputDir = path.join(__dirname, "__test_output__");

    mockCoverageData = {
      projectName: "TestProject",
      version: "1.0.0",
      timestamp: new Date("2024-01-01T00:00:00.000Z"),
      coverage: {
        totalNodes: 100,
        analyzedNodes: 85,
        coveragePercent: 85,
        uncoveredPatterns: ["Pattern1", "Pattern2"],
      },
      filesCovered: 10,
      totalFiles: 12,
      analysisTimeMs: 1500,
    };
  });

  afterEach(() => {
    // Clean up test output directory
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  describe("generate", () => {
    describe("text format", () => {
      it("should generate text report with default options", () => {
        const result = reporter.generate(mockCoverageData, { format: "text" });

        expect(result).toContain("Analyzer Coverage Report");
        expect(result).toContain("TestProject");
        expect(result).toContain("1.0.0");
        expect(result).toContain("Total Nodes:    100");
        expect(result).toContain("Analyzed Nodes: 85");
        expect(result).toContain("Coverage:       85%");
      });

      it("should show PASS status when threshold is met", () => {
        const result = reporter.generate(mockCoverageData, {
          format: "text",
          thresholdPercent: 80,
        });

        expect(result).toContain("✓ PASS");
      });

      it("should show FAIL status when threshold is not met", () => {
        const result = reporter.generate(mockCoverageData, {
          format: "text",
          thresholdPercent: 90,
        });

        expect(result).toContain("✗ FAIL");
      });

      it("should include uncovered patterns when enabled", () => {
        const result = reporter.generate(mockCoverageData, {
          format: "text",
          includeUncoveredDetails: true,
        });

        expect(result).toContain("Uncovered Patterns");
        expect(result).toContain("Pattern1");
        expect(result).toContain("Pattern2");
      });

      it("should exclude uncovered patterns when disabled", () => {
        const result = reporter.generate(mockCoverageData, {
          format: "text",
          includeUncoveredDetails: false,
        });

        expect(result).not.toContain("Uncovered Patterns");
      });

      it("should include rule breakdown when enabled", () => {
        const dataWithRules: CoverageReportData = {
          ...mockCoverageData,
          rulesCoverage: [
            {
              ruleId: "R001",
              ruleName: "Test Rule",
              nodesAnalyzed: 50,
              nodeTypes: ["Function", "Variable"],
              filesAffected: ["file1.ts", "file2.ts"],
            },
          ],
        };

        const result = reporter.generate(dataWithRules, {
          format: "text",
          includeRuleBreakdown: true,
        });

        expect(result).toContain("Rule Coverage Breakdown");
        expect(result).toContain("R001");
        expect(result).toContain("Test Rule");
        expect(result).toContain("Nodes Analyzed: 50");
      });
    });

    describe("json format", () => {
      it("should generate valid JSON report", () => {
        const result = reporter.generate(mockCoverageData, { format: "json" });
        const parsed = JSON.parse(result);

        expect(parsed.projectName).toBe("TestProject");
        expect(parsed.version).toBe("1.0.0");
        expect(parsed.coverage.totalNodes).toBe(100);
        expect(parsed.coverage.coveragePercent).toBe(85);
      });

      it("should include all data fields in JSON", () => {
        const result = reporter.generate(mockCoverageData, { format: "json" });
        const parsed = JSON.parse(result);

        expect(parsed).toHaveProperty("projectName");
        expect(parsed).toHaveProperty("version");
        expect(parsed).toHaveProperty("timestamp");
        expect(parsed).toHaveProperty("coverage");
        expect(parsed).toHaveProperty("filesCovered");
        expect(parsed).toHaveProperty("totalFiles");
        expect(parsed).toHaveProperty("analysisTimeMs");
      });
    });

    describe("html format", () => {
      it("should generate valid HTML report", () => {
        const result = reporter.generate(mockCoverageData, { format: "html" });

        expect(result).toContain("<!DOCTYPE html>");
        expect(result).toContain("Analyzer Coverage Report");
        expect(result).toContain("TestProject");
        expect(result).toContain("v1.0.0");
      });

      it("should include coverage bar in HTML", () => {
        const result = reporter.generate(mockCoverageData, { format: "html" });

        expect(result).toContain("coverage-bar");
        expect(result).toContain("coverage-fill");
        expect(result).toContain("85%");
      });

      it("should show pass status in HTML when threshold is met", () => {
        const result = reporter.generate(mockCoverageData, {
          format: "html",
          thresholdPercent: 80,
        });

        expect(result).toContain("status pass");
        expect(result).toContain("✓ PASS");
      });

      it("should show fail status in HTML when threshold is not met", () => {
        const result = reporter.generate(mockCoverageData, {
          format: "html",
          thresholdPercent: 90,
        });

        expect(result).toContain("status fail");
        expect(result).toContain("✗ FAIL");
      });

      it("should escape HTML special characters", () => {
        const dataWithSpecialChars: CoverageReportData = {
          ...mockCoverageData,
          coverage: {
            ...mockCoverageData.coverage,
            uncoveredPatterns: [
              '<script>alert("XSS")</script>',
              "Pattern & More",
            ],
          },
        };

        const result = reporter.generate(dataWithSpecialChars, {
          format: "html",
          includeUncoveredDetails: true,
        });

        expect(result).toContain("&lt;script&gt;");
        expect(result).toContain("&amp;");
        expect(result).not.toContain('<script>alert("XSS")</script>');
      });
    });

    describe("markdown format", () => {
      it("should generate valid Markdown report", () => {
        const result = reporter.generate(mockCoverageData, {
          format: "markdown",
        });

        expect(result).toContain("# 📊 Analyzer Coverage Report");
        expect(result).toContain("**Project:** TestProject");
        expect(result).toContain("**Version:** 1.0.0");
        expect(result).toContain("## Coverage Summary");
      });

      it("should include table in Markdown", () => {
        const result = reporter.generate(mockCoverageData, {
          format: "markdown",
        });

        expect(result).toContain("| Metric | Value |");
        expect(result).toContain("|--------|-------|");
        expect(result).toContain("| Total Nodes | 100 |");
        expect(result).toContain("| Coverage | **85%** |");
      });

      it("should show pass emoji in Markdown when threshold is met", () => {
        const result = reporter.generate(mockCoverageData, {
          format: "markdown",
          thresholdPercent: 80,
        });

        expect(result).toContain("✅ PASS");
      });

      it("should show fail emoji in Markdown when threshold is not met", () => {
        const result = reporter.generate(mockCoverageData, {
          format: "markdown",
          thresholdPercent: 90,
        });

        expect(result).toContain("❌ FAIL");
      });
    });
  });

  describe("saveReport", () => {
    it("should save text report to file", async () => {
      const outputPath = path.join(testOutputDir, "coverage-report.txt");

      const result = await reporter.saveReport(mockCoverageData, outputPath, {
        format: "text",
      });

      expect(result.success).toBe(true);
      expect(result.reportPath).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, "utf8");
      expect(content).toContain("Analyzer Coverage Report");
    });

    it("should create directory if it does not exist", async () => {
      const outputPath = path.join(
        testOutputDir,
        "nested",
        "dir",
        "report.txt",
      );

      await reporter.saveReport(mockCoverageData, outputPath);

      expect(fs.existsSync(outputPath)).toBe(true);
    });

    it("should return correct threshold status", async () => {
      const outputPath = path.join(testOutputDir, "report.txt");

      const result = await reporter.saveReport(mockCoverageData, outputPath, {
        thresholdPercent: 80,
      });

      expect(result.thresholdMet).toBe(true);

      const result2 = await reporter.saveReport(mockCoverageData, outputPath, {
        thresholdPercent: 90,
      });

      expect(result2.thresholdMet).toBe(false);
    });

    it("should return coverage percent in result", async () => {
      const outputPath = path.join(testOutputDir, "report.txt");

      const result = await reporter.saveReport(mockCoverageData, outputPath);

      expect(result.coveragePercent).toBe(85);
    });

    it("should include summary in result", async () => {
      const outputPath = path.join(testOutputDir, "report.txt");

      const result = await reporter.saveReport(mockCoverageData, outputPath);

      expect(result.summary).toContain("Coverage: 85%");
      expect(result.summary).toContain("85/100 nodes");
      expect(result.summary).toContain("2 uncovered patterns");
    });
  });

  describe("checkThreshold", () => {
    it("should return true when coverage meets threshold", () => {
      const metrics: CoverageMetrics = {
        totalNodes: 100,
        analyzedNodes: 85,
        coveragePercent: 85,
        uncoveredPatterns: [],
      };

      const threshold: CoverageThreshold = {
        minCoveragePercent: 80,
        failOnThreshold: true,
      };

      const result = reporter.checkThreshold(metrics, threshold);
      expect(result).toBe(true);
    });

    it("should return false when coverage does not meet threshold", () => {
      const metrics: CoverageMetrics = {
        totalNodes: 100,
        analyzedNodes: 75,
        coveragePercent: 75,
        uncoveredPatterns: [],
      };

      const threshold: CoverageThreshold = {
        minCoveragePercent: 80,
        failOnThreshold: true,
      };

      const result = reporter.checkThreshold(metrics, threshold);
      expect(result).toBe(false);
    });

    it("should handle exact threshold match", () => {
      const metrics: CoverageMetrics = {
        totalNodes: 100,
        analyzedNodes: 80,
        coveragePercent: 80,
        uncoveredPatterns: [],
      };

      const threshold: CoverageThreshold = {
        minCoveragePercent: 80,
        failOnThreshold: true,
      };

      const result = reporter.checkThreshold(metrics, threshold);
      expect(result).toBe(true);
    });
  });

  describe("createReportData", () => {
    it("should create valid report data", () => {
      const coverage: CoverageMetrics = {
        totalNodes: 50,
        analyzedNodes: 40,
        coveragePercent: 80,
        uncoveredPatterns: ["Pattern1"],
      };

      const data = reporter.createReportData(
        "MyProject",
        "2.0.0",
        coverage,
        5,
        10,
        2000,
      );

      expect(data.projectName).toBe("MyProject");
      expect(data.version).toBe("2.0.0");
      expect(data.coverage).toBe(coverage);
      expect(data.filesCovered).toBe(5);
      expect(data.totalFiles).toBe(10);
      expect(data.analysisTimeMs).toBe(2000);
      expect(data.timestamp).toBeInstanceOf(Date);
    });

    it("should set current timestamp", () => {
      const coverage: CoverageMetrics = {
        totalNodes: 10,
        analyzedNodes: 10,
        coveragePercent: 100,
        uncoveredPatterns: [],
      };

      const before = new Date();
      const data = reporter.createReportData(
        "Test",
        "1.0",
        coverage,
        1,
        1,
        100,
      );
      const after = new Date();

      expect(data.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(data.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe("boundary cases", () => {
    it("should handle 0% coverage", () => {
      const zeroCoverageData: CoverageReportData = {
        ...mockCoverageData,
        coverage: {
          totalNodes: 100,
          analyzedNodes: 0,
          coveragePercent: 0,
          uncoveredPatterns: ["All patterns"],
        },
      };

      const result = reporter.generate(zeroCoverageData, { format: "text" });

      expect(result).toContain("Coverage:       0%");
      expect(result).toContain("Analyzed Nodes: 0");
    });

    it("should handle 100% coverage", () => {
      const fullCoverageData: CoverageReportData = {
        ...mockCoverageData,
        coverage: {
          totalNodes: 100,
          analyzedNodes: 100,
          coveragePercent: 100,
          uncoveredPatterns: [],
        },
      };

      const result = reporter.generate(fullCoverageData, { format: "text" });

      expect(result).toContain("Coverage:       100%");
      expect(result).toContain("Analyzed Nodes: 100");
    });

    it("should handle empty uncovered patterns", () => {
      const noUncoveredData: CoverageReportData = {
        ...mockCoverageData,
        coverage: {
          ...mockCoverageData.coverage,
          uncoveredPatterns: [],
        },
      };

      const result = reporter.generate(noUncoveredData, {
        format: "text",
        includeUncoveredDetails: true,
      });

      // When there are no uncovered patterns, the section should not appear
      expect(result).not.toContain("Uncovered Patterns");
      expect(result).toContain("Analyzer Coverage Report");
    });

    it("should handle large number of uncovered patterns", () => {
      const manyPatternsData: CoverageReportData = {
        ...mockCoverageData,
        coverage: {
          ...mockCoverageData.coverage,
          uncoveredPatterns: Array.from(
            { length: 100 },
            (_, i) => `Pattern${i}`,
          ),
        },
      };

      const result = reporter.generate(manyPatternsData, {
        format: "text",
        includeUncoveredDetails: true,
      });

      expect(result).toContain("Uncovered Patterns (100)");
      expect(result).toContain("Pattern0");
      expect(result).toContain("Pattern99");
    });

    it("should handle zero nodes", () => {
      const zeroNodesData: CoverageReportData = {
        ...mockCoverageData,
        coverage: {
          totalNodes: 0,
          analyzedNodes: 0,
          coveragePercent: 100,
          uncoveredPatterns: [],
        },
      };

      const result = reporter.generate(zeroNodesData, { format: "text" });

      expect(result).toContain("Total Nodes:    0");
      expect(result).toContain("Analyzed Nodes: 0");
    });

    it("should handle very long project names", () => {
      const longNameData: CoverageReportData = {
        ...mockCoverageData,
        projectName: "A".repeat(200),
      };

      const result = reporter.generate(longNameData, { format: "text" });

      expect(result).toContain("A".repeat(200));
    });

    it("should handle special characters in project name", () => {
      const specialCharsData: CoverageReportData = {
        ...mockCoverageData,
        projectName: "Test-Project_v2.0 (beta)",
      };

      const result = reporter.generate(specialCharsData, { format: "text" });

      expect(result).toContain("Test-Project_v2.0 (beta)");
    });
  });

  describe("failure scenarios", () => {
    it("should handle missing optional fields gracefully", () => {
      const minimalData: CoverageReportData = {
        projectName: "Test",
        version: "1.0",
        timestamp: new Date(),
        coverage: {
          totalNodes: 10,
          analyzedNodes: 5,
          coveragePercent: 50,
          uncoveredPatterns: [],
        },
        filesCovered: 1,
        totalFiles: 2,
        analysisTimeMs: 100,
      };

      const result = reporter.generate(minimalData, {
        format: "text",
        includeRuleBreakdown: true,
      });

      expect(result).toBeDefined();
      expect(result).not.toContain("Rule Coverage Breakdown");
    });

    it("should handle invalid threshold values", () => {
      const result1 = reporter.generate(mockCoverageData, {
        format: "text",
        thresholdPercent: -10,
      });

      expect(result1).toBeDefined();

      const result2 = reporter.generate(mockCoverageData, {
        format: "text",
        thresholdPercent: 150,
      });

      expect(result2).toBeDefined();
    });

    it("should throw error when saving to invalid path", async () => {
      const invalidPath = "/invalid/path/that/does/not/exist/report.txt";

      // This should not throw but create the directory
      await expect(
        reporter.saveReport(mockCoverageData, invalidPath),
      ).rejects.toThrow();
    });

    it("should handle undefined options", () => {
      const result = reporter.generate(mockCoverageData);

      expect(result).toBeDefined();
      expect(result).toContain("Analyzer Coverage Report");
    });

    it("should handle empty options object", () => {
      const result = reporter.generate(mockCoverageData, {});

      expect(result).toBeDefined();
      expect(result).toContain("Analyzer Coverage Report");
    });

    it("should handle null values in coverage data gracefully", () => {
      // TypeScript should prevent this, but testing runtime behavior
      const dataWithNulls = {
        ...mockCoverageData,
        rulesCoverage: undefined,
      };

      const result = reporter.generate(dataWithNulls, {
        format: "text",
        includeRuleBreakdown: true,
      });

      expect(result).toBeDefined();
    });
  });

  describe("integration scenarios", () => {
    it("should generate multiple formats for same data", () => {
      const formats: Array<"text" | "json" | "html" | "markdown"> = [
        "text",
        "json",
        "html",
        "markdown",
      ];

      formats.forEach((format) => {
        const result = reporter.generate(mockCoverageData, { format });

        expect(result).toBeDefined();
        expect(result.length).toBeGreaterThan(0);
      });
    });

    it("should maintain data consistency across formats", () => {
      const textResult = reporter.generate(mockCoverageData, {
        format: "text",
      });
      const jsonResult = reporter.generate(mockCoverageData, {
        format: "json",
      });

      expect(textResult).toContain("85%");

      const parsed = JSON.parse(jsonResult);
      expect(parsed.coverage.coveragePercent).toBe(85);
    });

    it("should support chaining create and save", async () => {
      const coverage: CoverageMetrics = {
        totalNodes: 100,
        analyzedNodes: 90,
        coveragePercent: 90,
        uncoveredPatterns: [],
      };

      const data = reporter.createReportData(
        "ChainTest",
        "1.0",
        coverage,
        10,
        10,
        500,
      );

      const outputPath = path.join(testOutputDir, "chain-report.txt");
      const result = await reporter.saveReport(data, outputPath);

      expect(result.success).toBe(true);
      expect(result.coveragePercent).toBe(90);
      expect(fs.existsSync(outputPath)).toBe(true);
    });
  });
});
