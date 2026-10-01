/**
 * Example Usage of Analyzer Coverage Reporting
 *
 * This file demonstrates how to use the coverage reporting feature.
 */

import { CoverageReporter } from "./coverage-reporter";
import { RuleCoverageAnalyzer } from "../../analysis/coverage";

/**
 * Example 1: Basic Usage
 */
async function basicExample() {
  console.log("=== Example 1: Basic Usage ===\n");

  // Create analyzer and perform analysis
  const analyzer = new RuleCoverageAnalyzer();

  // Simulate AST analysis
  const mockAst = {
    type: "Program",
    id: "root",
    children: [
      { type: "Function", id: "fn1", children: [] },
      { type: "Variable", id: "var1", children: [] },
      { type: "CallExpression", id: "call1", children: [] },
    ],
  };

  analyzer.registerAst(mockAst);
  analyzer.markAnalyzed("fn1");
  analyzer.markAnalyzed("var1");
  analyzer.reportUncovered("CallExpression");

  // Get coverage metrics
  const metrics = analyzer.getMetrics();

  // Create reporter and generate report
  const reporter = new CoverageReporter();
  const reportData = reporter.createReportData(
    "ExampleProject",
    "1.0.0",
    metrics,
    3,
    5,
    250,
  );

  // Generate text report
  const textReport = reporter.generate(reportData, { format: "text" });
  console.log(textReport);
}

/**
 * Example 2: Generate Multiple Formats
 */
async function multipleFormatsExample() {
  console.log("\n=== Example 2: Multiple Formats ===\n");

  const analyzer = new RuleCoverageAnalyzer();
  const reporter = new CoverageReporter();

  // Simulate analysis
  const metrics = {
    totalNodes: 100,
    analyzedNodes: 85,
    coveragePercent: 85,
    uncoveredPatterns: ["Pattern1", "Pattern2"],
  };

  const reportData = reporter.createReportData(
    "MultiFormatExample",
    "2.0.0",
    metrics,
    10,
    12,
    1500,
  );

  // Generate JSON for API consumption
  const jsonReport = reporter.generate(reportData, { format: "json" });
  console.log("JSON Report (truncated):");
  console.log(jsonReport.substring(0, 200) + "...\n");

  // Generate Markdown for documentation
  const mdReport = reporter.generate(reportData, { format: "markdown" });
  console.log("Markdown Report (first 300 chars):");
  console.log(mdReport.substring(0, 300) + "...\n");
}

/**
 * Example 3: Threshold Checking for CI/CD
 */
async function thresholdCheckExample() {
  console.log("\n=== Example 3: Threshold Checking ===\n");

  const reporter = new CoverageReporter();

  // Scenario 1: Coverage meets threshold
  const goodMetrics = {
    totalNodes: 100,
    analyzedNodes: 90,
    coveragePercent: 90,
    uncoveredPatterns: [],
  };

  const threshold = {
    minCoveragePercent: 85,
    failOnThreshold: true,
  };

  const meetsThreshold = reporter.checkThreshold(goodMetrics, threshold);
  console.log(
    `Coverage 90% >= Threshold 85%: ${meetsThreshold ? "PASS ✓" : "FAIL ✗"}`,
  );

  // Scenario 2: Coverage below threshold
  const poorMetrics = {
    totalNodes: 100,
    analyzedNodes: 70,
    coveragePercent: 70,
    uncoveredPatterns: ["Pattern1", "Pattern2", "Pattern3"],
  };

  const failsThreshold = reporter.checkThreshold(poorMetrics, threshold);
  console.log(
    `Coverage 70% >= Threshold 85%: ${failsThreshold ? "PASS ✓" : "FAIL ✗"}`,
  );
}

/**
 * Example 4: Save Report to File
 */
async function saveReportExample() {
  console.log("\n=== Example 4: Save Report to File ===\n");

  const reporter = new CoverageReporter();

  const metrics = {
    totalNodes: 150,
    analyzedNodes: 135,
    coveragePercent: 90,
    uncoveredPatterns: ["UncoveredPattern1"],
  };

  const reportData = reporter.createReportData(
    "SaveReportExample",
    "1.5.0",
    metrics,
    20,
    25,
    3000,
  );

  // Save as HTML with full details
  const result = await reporter.saveReport(
    reportData,
    "./reports/coverage-report.html",
    {
      format: "html",
      includeUncoveredDetails: true,
      thresholdPercent: 85,
    },
  );

  console.log("Report saved successfully!");
  console.log(`Path: ${result.reportPath}`);
  console.log(`Coverage: ${result.coveragePercent}%`);
  console.log(`Threshold Met: ${result.thresholdMet}`);
  console.log(`Summary: ${result.summary}`);
}

/**
 * Example 5: Rule Breakdown
 */
async function ruleBreakdownExample() {
  console.log("\n=== Example 5: Rule Breakdown ===\n");

  const reporter = new CoverageReporter();

  const reportData = {
    projectName: "RuleBreakdownExample",
    version: "3.0.0",
    timestamp: new Date(),
    coverage: {
      totalNodes: 200,
      analyzedNodes: 180,
      coveragePercent: 90,
      uncoveredPatterns: [],
    },
    filesCovered: 15,
    totalFiles: 20,
    analysisTimeMs: 4500,
    rulesCoverage: [
      {
        ruleId: "R001",
        ruleName: "Inefficient Storage Pattern",
        nodesAnalyzed: 75,
        nodeTypes: ["StorageCall", "StorageWrite"],
        filesAffected: ["contract1.rs", "contract2.rs", "lib.rs"],
      },
      {
        ruleId: "R002",
        ruleName: "Redundant Computation",
        nodesAnalyzed: 50,
        nodeTypes: ["Function", "Loop"],
        filesAffected: ["utils.rs", "math.rs"],
      },
      {
        ruleId: "R003",
        ruleName: "Unoptimized Loop",
        nodesAnalyzed: 55,
        nodeTypes: ["ForLoop", "WhileLoop"],
        filesAffected: ["iterator.rs", "processor.rs"],
      },
    ],
  };

  const report = reporter.generate(reportData, {
    format: "text",
    includeRuleBreakdown: true,
  });

  console.log(report);
}

/**
 * Example 6: CI/CD Integration
 */
async function cicdIntegrationExample() {
  console.log("\n=== Example 6: CI/CD Integration ===\n");

  const reporter = new CoverageReporter();

  const metrics = {
    totalNodes: 300,
    analyzedNodes: 240,
    coveragePercent: 80,
    uncoveredPatterns: ["Pattern1", "Pattern2"],
  };

  const reportData = reporter.createReportData(
    "CI-CD-Project",
    "1.0.0",
    metrics,
    30,
    35,
    5000,
  );

  // Generate JSON for CI/CD tools
  const result = await reporter.saveReport(
    reportData,
    "./reports/coverage.json",
    {
      format: "json",
      thresholdPercent: 75,
    },
  );

  console.log("CI/CD Integration Result:");
  console.log(`- Report saved: ${result.reportPath}`);
  console.log(`- Coverage: ${result.coveragePercent}%`);
  console.log(
    `- Threshold (75%): ${result.thresholdMet ? "PASSED ✓" : "FAILED ✗"}`,
  );

  if (!result.thresholdMet) {
    console.error("ERROR: Coverage below threshold! Build should fail.");
    // In real CI/CD: process.exit(1);
  } else {
    console.log("SUCCESS: Coverage meets requirements. Build can proceed.");
  }
}

/**
 * Run all examples
 */
async function runAllExamples() {
  try {
    await basicExample();
    await multipleFormatsExample();
    await thresholdCheckExample();
    // Skip file operations in example run
    // await saveReportExample();
    await ruleBreakdownExample();
    await cicdIntegrationExample();

    console.log("\n=== All Examples Completed Successfully ===");
  } catch (error) {
    console.error("Example execution failed:", error);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runAllExamples();
}

export {
  basicExample,
  multipleFormatsExample,
  thresholdCheckExample,
  saveReportExample,
  ruleBreakdownExample,
  cicdIntegrationExample,
};
