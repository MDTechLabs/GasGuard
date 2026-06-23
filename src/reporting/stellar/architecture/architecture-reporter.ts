/**
 * Soroban Architecture Reporter
 *
 * Generates human-readable architecture reports in multiple formats
 * (JSON, Markdown, HTML) from architecture analysis results.
 */

import * as fs from "fs";
import * as path from "path";
import { SorobanArchitectureSummary, ArchitectureReportOptions } from "./types";

/**
 * Reporter for Soroban contract architecture summaries
 */
export class SorobanArchitectureReporter {
  /**
   * Generate architecture report in specified format
   */
  generate(
    summary: SorobanArchitectureSummary,
    options: ArchitectureReportOptions = {},
  ): string {
    const format = options.format || "markdown";

    switch (format) {
      case "json":
        return this.generateJSON(summary);
      case "markdown":
        return this.generateMarkdown(summary, options);
      case "html":
        return this.generateHTML(summary, options);
      default:
        return this.generateMarkdown(summary, options);
    }
  }

  /**
   * Save report to file
   */
  async saveReport(
    summary: SorobanArchitectureSummary,
    options: ArchitectureReportOptions,
  ): Promise<string> {
    const report = this.generate(summary, options);
    const outputPath =
      options.outputPath ||
      `./architecture-report-${Date.now()}.${options.format || "md"}`;

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, report, "utf8");
    return outputPath;
  }

  /**
   * Generate JSON format report
   */
  private generateJSON(summary: SorobanArchitectureSummary): string {
    return JSON.stringify(summary, null, 2);
  }

  /**
   * Generate Markdown format report
   */
  private generateMarkdown(
    summary: SorobanArchitectureSummary,
    options: ArchitectureReportOptions,
  ): string {
    const {
      contractInfo,
      moduleStructure,
      functionInventory,
      storagePatterns,
      securityBoundaries,
      resourceProfile,
      dependencies,
      riskAssessment,
    } = summary;

    let md = `# Soroban Contract Architecture Report\n\n`;
    md += `**Generated:** ${summary.generatedAt.toISOString()}\n`;
    md += `**Version:** ${summary.version}\n\n`;

    if (options.projectName) {
      md += `**Project:** ${options.projectName}\n`;
    }
    if (options.contractVersion) {
      md += `**Contract Version:** ${options.contractVersion}\n`;
    }
    md += `\n---\n\n`;

    // Executive Summary
    md += `## 📋 Executive Summary\n\n`;
    md += `**Contract Name:** ${contractInfo.name}\n`;
    md += `**Type:** ${contractInfo.contractType}\n`;
    md += `**Complexity:** ${contractInfo.complexity.toUpperCase()}\n`;
    md += `**Lines of Code:** ${contractInfo.linesOfCode}\n`;
    md += `**Functions:** ${functionInventory.totalFunctions} (${functionInventory.publicFunctions.length} public, ${functionInventory.privateFunctions.length} private)\n`;
    md += `**Overall Efficiency:** ${resourceProfile.overallEfficiency.toUpperCase()}\n\n`;

    if (riskAssessment) {
      md += `**Risk Level:** ${riskAssessment.riskLevel.toUpperCase()} (Score: ${riskAssessment.overallScore})\n\n`;
    }

    // Contract Information
    md += `## 📦 Contract Information\n\n`;
    md += `| Property | Value |\n`;
    md += `|----------|-------|\n`;
    md += `| File Path | \`${contractInfo.filePath}\` |\n`;
    md += `| Contract Type | ${contractInfo.contractType} |\n`;
    md += `| Lines of Code | ${contractInfo.linesOfCode} |\n`;
    md += `| Complexity | ${contractInfo.complexity} |\n`;
    md += `| Has Tests | ${contractInfo.hasTests ? "✅" : "❌"} |\n`;
    md += `| Has Documentation | ${contractInfo.hasDocumentation ? "✅" : "❌"} |\n\n`;

    // Module Structure
    md += `## 🏗️ Module Structure\n\n`;
    md += `**Total Types:** ${moduleStructure.totalTypes}\n`;
    md += `**State Complexity:** ${moduleStructure.stateComplexity}\n\n`;

    if (moduleStructure.contractTypes.length > 0) {
      md += `### Contract Types\n\n`;
      for (const type of moduleStructure.contractTypes) {
        md += `#### ${type.name}\n\n`;
        md += `- **Fields:** ${type.fields.length}\n`;
        md += `- **Has Versioning:** ${type.hasVersioning ? "✅" : "❌"}\n`;
        md += `- **Has Pause State:** ${type.hasPauseState ? "✅" : "❌"}\n`;
        md += `- **Has Access Control:** ${type.hasAccessControl ? "✅" : "❌"}\n\n`;

        if (type.fields.length > 0) {
          md += `**Fields:**\n\n`;
          for (const field of type.fields) {
            md += `- \`${field.name}: ${field.fieldType}\`${field.isUnused ? " ⚠️ UNUSED" : ""}\n`;
          }
          md += `\n`;
        }
      }
    }

    // Function Inventory
    md += `## 🔧 Function Inventory\n\n`;
    md += `**Total Functions:** ${functionInventory.totalFunctions}\n`;
    md += `**Average Complexity:** ${functionInventory.averageComplexity.toFixed(2)}\n\n`;

    md += `### Function Categories\n\n`;
    md += `| Category | Count |\n`;
    md += `|----------|-------|\n`;
    md += `| Constructors | ${functionInventory.categorization.constructors} |\n`;
    md += `| Transfers | ${functionInventory.categorization.transfers} |\n`;
    md += `| Queries | ${functionInventory.categorization.queries} |\n`;
    md += `| Admin | ${functionInventory.categorization.admin} |\n`;
    md += `| Governance | ${functionInventory.categorization.governance} |\n`;
    md += `| Emergency | ${functionInventory.categorization.emergency} |\n`;
    md += `| Health Checks | ${functionInventory.categorization.healthChecks} |\n`;
    md += `| Utilities | ${functionInventory.categorization.utilities} |\n\n`;

    // Public Functions
    if (functionInventory.publicFunctions.length > 0) {
      md += `### Public Functions\n\n`;
      for (const func of functionInventory.publicFunctions) {
        md += `#### \`${func.name}()\`\n\n`;
        md += `- **Category:** ${func.category}\n`;
        md += `- **Security Level:** ${func.securityLevel.toUpperCase()}\n`;
        md += `- **Complexity:** ${func.complexity}\n`;
        md += `- **Error Handling:** ${func.hasErrorHandling ? "✅" : "❌"}\n`;
        md += `- **Auth Checks:** ${func.hasAuthChecks ? "✅" : "❌"}\n`;
        md += `- **Expiry Checks:** ${func.hasExpiryChecks ? "✅" : "❌"}\n`;
        if (func.estimatedGas) {
          md += `- **Estimated Gas:** ${func.estimatedGas.toLocaleString()} instructions\n`;
        }
        md += `\n`;
      }
    }

    // Storage Patterns
    md += `## 💾 Storage Patterns\n\n`;
    md += `**Total Reads:** ${storagePatterns.storageOperations.totalReads}\n`;
    md += `**Total Writes:** ${storagePatterns.storageOperations.totalWrites}\n`;
    md += `**Unique Keys:** ${storagePatterns.storageOperations.uniqueKeys}\n`;
    md += `**Avg Accesses/Function:** ${storagePatterns.storageOperations.averageAccessesPerFunction.toFixed(2)}\n\n`;

    if (storagePatterns.patterns.length > 0) {
      md += `### Detected Patterns\n\n`;
      for (const pattern of storagePatterns.patterns) {
        const emoji =
          pattern.severity === "critical"
            ? "🔴"
            : pattern.severity === "warning"
              ? "🟡"
              : "ℹ️";
        md += `${emoji} **${pattern.pattern}**: ${pattern.description}\n\n`;
      }
    }

    if (storagePatterns.optimizationOpportunities.length > 0) {
      md += `### Optimization Opportunities\n\n`;
      for (const opp of storagePatterns.optimizationOpportunities) {
        const priorityEmoji =
          opp.priority === "critical"
            ? "🔴"
            : opp.priority === "high"
              ? "🟠"
              : opp.priority === "medium"
                ? "🟡"
                : "🟢";
        md += `${priorityEmoji} **${opp.title}** (${opp.type})\n`;
        md += `- ${opp.description}\n`;
        md += `- **Estimated Savings:** ${opp.estimatedSavings}\n`;
        md += `- **Priority:** ${opp.priority}\n\n`;
      }
    }

    // Security Boundaries
    md += `## 🔒 Security Boundaries\n\n`;
    md += `| Feature | Status |\n`;
    md += `|---------|--------|\n`;
    md += `| Access Control | ${securityBoundaries.hasAccessControl ? "✅" : "❌"} |\n`;
    if (securityBoundaries.accessControlMechanism) {
      md += `| Access Control Type | ${securityBoundaries.accessControlMechanism} |\n`;
    }
    md += `| Pause Circuit | ${securityBoundaries.hasPauseCircuit ? "✅" : "❌"} |\n`;
    md += `| Emergency Mechanism | ${securityBoundaries.hasEmergencyMechanism ? "✅" : "❌"} |\n`;
    md += `| Rate Limiting | ${securityBoundaries.hasRateLimiting ? "✅" : "❌"} |\n\n`;

    if (securityBoundaries.adminFunctions.length > 0) {
      md += `**Admin Functions:** ${securityBoundaries.adminFunctions.join(", ")}\n\n`;
    }

    if (securityBoundaries.vulnerabilities.length > 0) {
      md += `### ⚠️ Vulnerability Indicators\n\n`;
      for (const vuln of securityBoundaries.vulnerabilities) {
        md += `#### ${vuln.type.toUpperCase()} (${vuln.severity})\n\n`;
        md += `**Description:** ${vuln.description}\n\n`;
        md += `**Affected Functions:** ${vuln.affectedFunctions.join(", ")}\n\n`;
        md += `**Recommendation:** ${vuln.recommendation}\n\n`;
      }
    }

    // Resource Profile
    md += `## 📊 Resource Profile\n\n`;
    md += `**Overall Efficiency:** ${resourceProfile.overallEfficiency.toUpperCase()}\n\n`;

    md += `### CPU Profile\n\n`;
    md += `- **Estimated Instructions:** ${resourceProfile.cpuProfile.estimatedInstructions.toLocaleString()}\n`;
    if (resourceProfile.cpuProfile.utilizationPercentage > 0) {
      md += `- **Utilization:** ${resourceProfile.cpuProfile.utilizationPercentage.toFixed(2)}%\n`;
    }
    md += `- **Optimization Potential:** ${resourceProfile.cpuProfile.optimizationPotential}\n`;
    if (resourceProfile.cpuProfile.complexFunctions.length > 0) {
      md += `- **Complex Functions:** ${resourceProfile.cpuProfile.complexFunctions.join(", ")}\n`;
    }
    md += `\n`;

    md += `### Memory Profile\n\n`;
    md += `- **Estimated Peak Memory:** ${(resourceProfile.memoryProfile.estimatedPeakMemory / 1024 / 1024).toFixed(2)} MB\n`;
    if (resourceProfile.memoryProfile.utilizationPercentage > 0) {
      md += `- **Utilization:** ${resourceProfile.memoryProfile.utilizationPercentage.toFixed(2)}%\n`;
    }
    md += `- **Optimization Potential:** ${resourceProfile.memoryProfile.optimizationPotential}\n\n`;

    md += `### Ledger Profile\n\n`;
    md += `- **Avg Reads/Function:** ${resourceProfile.ledgerProfile.averageReads.toFixed(2)}\n`;
    md += `- **Avg Writes/Function:** ${resourceProfile.ledgerProfile.averageWrites.toFixed(2)}\n`;
    md += `- **Storage Footprint:** ${resourceProfile.ledgerProfile.storageFootprint.toLocaleString()} bytes\n`;
    md += `- **Optimization Potential:** ${resourceProfile.ledgerProfile.optimizationPotential}\n\n`;

    if (resourceProfile.bottlenecks.length > 0) {
      md += `### Bottlenecks\n\n`;
      for (const bottleneck of resourceProfile.bottlenecks) {
        md += `- **${bottleneck.area.toUpperCase()}** (${bottleneck.impact} impact): ${bottleneck.description}\n`;
        md += `  - *Recommendation:* ${bottleneck.recommendation}\n`;
      }
      md += `\n`;
    }

    // Dependencies
    md += `## 🔗 Dependencies\n\n`;
    md += `**Complexity Score:** ${dependencies.complexityScore}\n`;
    md += `**External Contracts:** ${dependencies.externalContracts.length}\n`;
    md += `**Internal Dependencies:** ${dependencies.internalDependencies.length}\n\n`;

    if (dependencies.circularDependencies.length > 0) {
      md += `⚠️ **Circular Dependencies Detected:** ${dependencies.circularDependencies.join(", ")}\n\n`;
    }

    // Risk Assessment
    if (riskAssessment && options.includeRiskScore) {
      md += `## 🎯 Risk Assessment\n\n`;
      md += `**Overall Score:** ${riskAssessment.overallScore}\n`;
      md += `**Risk Level:** ${riskAssessment.riskLevel.toUpperCase()}\n`;
      md += `**Security Score:** ${riskAssessment.securityScore}\n`;
      md += `**Optimization Score:** ${riskAssessment.optimizationScore}\n`;
      md += `**Gas Score:** ${riskAssessment.gasScore}\n\n`;

      if (riskAssessment.recommendations.length > 0) {
        md += `### Recommendations\n\n`;
        for (const rec of riskAssessment.recommendations) {
          md += `- ${rec}\n`;
        }
        md += `\n`;
      }
    }

    // Findings
    if (
      summary.findings &&
      options.includeFindings &&
      summary.findings.length > 0
    ) {
      md += `## 🔍 Detailed Findings\n\n`;
      md += `**Total Issues:** ${summary.findings.length}\n\n`;

      const criticalFindings = summary.findings.filter(
        (f) => f.severity === "critical",
      );
      const highFindings = summary.findings.filter(
        (f) => f.severity === "high",
      );
      const mediumFindings = summary.findings.filter(
        (f) => f.severity === "medium",
      );

      if (criticalFindings.length > 0) {
        md += `### Critical Issues (${criticalFindings.length})\n\n`;
        for (const finding of criticalFindings.slice(0, 5)) {
          md += `- **${finding.ruleId}** at ${finding.location.file}:${finding.location.startLine}: ${finding.message}\n`;
        }
        md += `\n`;
      }

      if (highFindings.length > 0) {
        md += `### High Priority Issues (${highFindings.length})\n\n`;
        for (const finding of highFindings.slice(0, 5)) {
          md += `- **${finding.ruleId}** at ${finding.location.file}:${finding.location.startLine}: ${finding.message}\n`;
        }
        md += `\n`;
      }

      if (mediumFindings.length > 0) {
        md += `### Medium Priority Issues (${mediumFindings.length})\n\n`;
        for (const finding of mediumFindings.slice(0, 5)) {
          md += `- **${finding.ruleId}** at ${finding.location.file}:${finding.location.startLine}: ${finding.message}\n`;
        }
        md += `\n`;
      }
    }

    md += `---\n\n`;
    md += `*Report generated by GasGuard Architecture Analyzer v${summary.version}*\n`;

    return md;
  }

  /**
   * Generate HTML format report
   */
  private generateHTML(
    summary: SorobanArchitectureSummary,
    options: ArchitectureReportOptions,
  ): string {
    const markdown = this.generateMarkdown(summary, options);

    // Simple HTML wrapper (you can enhance this with a proper markdown-to-html converter)
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${summary.contractInfo.name} - Architecture Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
           max-width: 1200px; margin: 0 auto; padding: 20px; line-height: 1.6; }
    h1, h2, h3 { color: #2c3e50; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background-color: #f8f9fa; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
    pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
    .critical { color: #dc3545; }
    .high { color: #fd7e14; }
    .medium { color: #ffc107; }
    .low { color: #28a745; }
  </style>
</head>
<body>
  <pre>${markdown.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
</body>
</html>`;
  }
}
