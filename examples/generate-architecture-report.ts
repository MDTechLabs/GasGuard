/**
 * Example: Generate Architecture Report for Soroban Contract
 *
 * This example demonstrates how to use the Soroban Architecture Analyzer
 * and Reporter to generate comprehensive architecture summaries.
 */

import * as fs from "fs";
import * as path from "path";
import {
  SorobanArchitectureAnalyzer,
  SorobanArchitectureReporter,
} from "../src/reporting/stellar/architecture";

async function main() {
  // Path to the demo Soroban contract
  const contractPath = path.join(__dirname, "soroban_demo_contract.rs");

  console.log("🔍 Analyzing Soroban contract...");
  console.log(`📄 Contract: ${contractPath}\n`);

  // Read the contract source
  const contractSource = fs.readFileSync(contractPath, "utf8");

  // Create analyzer instance
  const analyzer = new SorobanArchitectureAnalyzer(
    contractSource,
    contractPath,
  );

  // Generate architecture summary
  console.log("⚙️  Running analysis...");
  const summary = analyzer.analyze();

  console.log("✅ Analysis complete!\n");

  // Display summary statistics
  console.log("📊 Summary Statistics:");
  console.log(`   Contract: ${summary.contractInfo.name}`);
  console.log(`   Type: ${summary.contractInfo.contractType}`);
  console.log(`   Complexity: ${summary.contractInfo.complexity}`);
  console.log(`   Lines of Code: ${summary.contractInfo.linesOfCode}`);
  console.log(
    `   Functions: ${summary.functionInventory.totalFunctions} (${summary.functionInventory.publicFunctions.length} public)`,
  );
  console.log(
    `   Overall Efficiency: ${summary.resourceProfile.overallEfficiency}\n`,
  );

  // Display security findings
  if (summary.securityBoundaries.vulnerabilities.length > 0) {
    console.log("⚠️  Security Vulnerabilities Detected:");
    for (const vuln of summary.securityBoundaries.vulnerabilities) {
      console.log(`   - ${vuln.type} (${vuln.severity}): ${vuln.description}`);
    }
    console.log();
  }

  // Display optimization opportunities
  if (summary.storagePatterns.optimizationOpportunities.length > 0) {
    console.log("💡 Optimization Opportunities:");
    for (const opp of summary.storagePatterns.optimizationOpportunities) {
      console.log(`   - ${opp.title}: ${opp.estimatedSavings}`);
    }
    console.log();
  }

  // Create reporter instance
  const reporter = new SorobanArchitectureReporter();

  // Generate Markdown report
  console.log("📝 Generating Markdown report...");
  const markdownPath = await reporter.saveReport(summary, {
    format: "markdown",
    outputPath: "./reports/architecture-report.md",
    projectName: "GasGuard Demo",
    contractVersion: "1.0.0",
  });
  console.log(`   ✅ Saved to: ${markdownPath}`);

  // Generate JSON report
  console.log("📝 Generating JSON report...");
  const jsonPath = await reporter.saveReport(summary, {
    format: "json",
    outputPath: "./reports/architecture-report.json",
  });
  console.log(`   ✅ Saved to: ${jsonPath}`);

  // Generate HTML report
  console.log("📝 Generating HTML report...");
  const htmlPath = await reporter.saveReport(summary, {
    format: "html",
    outputPath: "./reports/architecture-report.html",
    projectName: "GasGuard Demo",
    contractVersion: "1.0.0",
  });
  console.log(`   ✅ Saved to: ${htmlPath}\n`);

  console.log("🎉 All reports generated successfully!");
  console.log("\nReport locations:");
  console.log(`   - Markdown: ${markdownPath}`);
  console.log(`   - JSON: ${jsonPath}`);
  console.log(`   - HTML: ${htmlPath}`);
}

// Run the example
main().catch((error) => {
  console.error("❌ Error generating reports:", error);
  process.exit(1);
});
