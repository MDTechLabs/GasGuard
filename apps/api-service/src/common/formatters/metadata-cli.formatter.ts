/**
 * CLI Formatter for displaying finding metadata in a user-friendly way
 * Ensures consistent presentation across all CLI outputs
 */

import { FindingMetadata, ConfidenceLevel, SeverityLevel, ImpactEstimate } from '../interfaces/finding-metadata.interface';
import { FormattedViolation } from '../../analyzer/interfaces/analyzer.interface';

export class MetadataCliFormatter {
  /**
   * Format a complete finding with metadata for terminal display
   */
  static formatFindingWithMetadata(violation: FormattedViolation, includeEducational = true): string {
    let output = '';

    // Header with rule name and severity
    output += `\n${'═'.repeat(80)}\n`;
    output += `${violation.severityIcon} [${violation.ruleName.toUpperCase()}]\n`;
    output += `Description: ${violation.description}\n`;

    if (violation.metadata) {
      const metadata = violation.metadata;

      // Severity and Confidence
      output += `\nSeverity: ${this.formatSeverity(metadata.severity)} | Confidence: ${this.formatConfidence(metadata.confidence)} (${metadata.confidenceScore}%)\n`;

      // Impacts
      if (metadata.impacts && metadata.impacts.length > 0) {
        output += `\n📊 Impact Estimates:\n`;
        metadata.impacts.forEach((impact) => {
          const range = impact.range ? ` (${impact.range.min}-${impact.range.max})` : '';
          output += `  • ${impact.type.toUpperCase()}: ${impact.amount}${range} ${impact.unit}\n`;
          output += `    └─ ${impact.description}\n`;
        });
      }

      // Affected Aspects
      if (metadata.affectedAspects && metadata.affectedAspects.length > 0) {
        output += `\n🎯 Affected Aspects: ${metadata.affectedAspects.join(', ')}\n`;
      }

      // Mitigation
      if (metadata.mitigation) {
        output += `\n🔧 How to Fix:\n${this.wrapText(metadata.mitigation, 75)}\n`;
      }

      // Educational Links
      if (includeEducational && metadata.educationalLinks && metadata.educationalLinks.length > 0) {
        output += `\n📚 Learn More:\n`;
        metadata.educationalLinks.forEach((link) => {
          const source = link.source ? ` [${link.source}]` : '';
          output += `  • ${link.title}${source}\n`;
          output += `    ${link.url}\n`;
          if (link.description) {
            output += `    └─ ${link.description}\n`;
          }
        });
      }

      // Related Rules
      if (metadata.relatedRules && metadata.relatedRules.length > 0) {
        output += `\n🔗 Related Rules: ${metadata.relatedRules.join(', ')}\n`;
      }

      // Tags
      if (metadata.tags && metadata.tags.length > 0) {
        output += `\n🏷️  Tags: ${metadata.tags.join(', ')}\n`;
      }
    } else {
      output += `\nLocation: Line ${violation.lineNumber}, Column ${violation.columnNumber}\n`;
      output += `Suggestion: ${violation.suggestion}\n`;
    }

    output += `${'═'.repeat(80)}`;
    return output;
  }

  /**
   * Format a summary of all findings with severity breakdown
   */
  static formatSummaryWithMetadata(violations: FormattedViolation[]): string {
    const severityCounts = {
      [SeverityLevel.CRITICAL]: 0,
      [SeverityLevel.HIGH]: 0,
      [SeverityLevel.MEDIUM]: 0,
      [SeverityLevel.LOW]: 0,
      [SeverityLevel.INFO]: 0,
    };

    const impactsByType: Record<string, number> = {};
    let totalGasSavings = 0;
    let totalStorageSavings = 0;

    violations.forEach((v) => {
      if (v.metadata) {
        const severity = v.metadata.severity;
        if (severity in severityCounts) {
          severityCounts[severity]++;
        }

        // Aggregate impacts
        v.metadata.impacts?.forEach((impact) => {
          if (impact.type === 'gas') {
            totalGasSavings += impact.amount;
          } else if (impact.type === 'storage') {
            totalStorageSavings += impact.amount;
          }
          impactsByType[impact.type] = (impactsByType[impact.type] || 0) + impact.amount;
        });
      }
    });

    let summary = `\n${'═'.repeat(80)}\n`;
    summary += `📋 ANALYSIS SUMMARY\n`;
    summary += `${'═'.repeat(80)}\n`;
    summary += `Total Findings: ${violations.length}\n`;

    // Severity breakdown
    summary += `\nSeverity Breakdown:\n`;
    summary += `  🔴 Critical: ${severityCounts[SeverityLevel.CRITICAL]}\n`;
    summary += `  🟠 High:     ${severityCounts[SeverityLevel.HIGH]}\n`;
    summary += `  🟡 Medium:   ${severityCounts[SeverityLevel.MEDIUM]}\n`;
    summary += `  🟢 Low:      ${severityCounts[SeverityLevel.LOW]}\n`;
    summary += `  ℹ️  Info:     ${severityCounts[SeverityLevel.INFO]}\n`;

    // Impact summary
    if (Object.keys(impactsByType).length > 0) {
      summary += `\n💰 Estimated Impact:\n`;
      if (totalGasSavings > 0) {
        summary += `  ⛽ Gas Savings: ${totalGasSavings.toLocaleString()} gas\n`;
      }
      if (totalStorageSavings > 0) {
        summary += `  💾 Storage Savings: ${totalStorageSavings.toLocaleString()} bytes\n`;
      }
    }

    summary += `\n${'═'.repeat(80)}\n`;
    return summary;
  }

  /**
   * Format metadata for JSON output
   */
  static toJSON(violation: FormattedViolation): Record<string, any> {
    return {
      ruleName: violation.ruleName,
      severity: violation.metadata?.severity,
      confidence: {
        level: violation.metadata?.confidence,
        score: violation.metadata?.confidenceScore,
      },
      location: {
        line: violation.lineNumber,
        column: violation.columnNumber,
      },
      impacts: violation.metadata?.impacts,
      mitigation: violation.metadata?.mitigation,
      educationalLinks: violation.metadata?.educationalLinks,
      affectedAspects: violation.metadata?.affectedAspects,
      tags: violation.metadata?.tags,
    };
  }

  /**
   * Format severity with color codes (for terminal)
   */
  private static formatSeverity(severity: SeverityLevel): string {
    const severityMap: Record<SeverityLevel, string> = {
      [SeverityLevel.CRITICAL]: '🔴 CRITICAL',
      [SeverityLevel.HIGH]: '🟠 HIGH',
      [SeverityLevel.MEDIUM]: '🟡 MEDIUM',
      [SeverityLevel.LOW]: '🟢 LOW',
      [SeverityLevel.INFO]: 'ℹ️  INFO',
    };
    return severityMap[severity] || severity;
  }

  /**
   * Format confidence with visual indicator
   */
  private static formatConfidence(confidence: ConfidenceLevel): string {
    const confidenceMap: Record<ConfidenceLevel, string> = {
      [ConfidenceLevel.CRITICAL]: '✓✓✓ CRITICAL',
      [ConfidenceLevel.HIGH]: '✓✓ HIGH',
      [ConfidenceLevel.MEDIUM]: '✓ MEDIUM',
      [ConfidenceLevel.LOW]: '◐ LOW',
      [ConfidenceLevel.UNCERTAIN]: '? UNCERTAIN',
    };
    return confidenceMap[confidence] || confidence;
  }

  /**
   * Wrap text to specified width
   */
  private static wrapText(text: string, width: number): string {
    const lines: string[] = [];
    let currentLine = '';

    text.split(' ').forEach((word) => {
      if ((currentLine + word).length > width) {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = currentLine ? `${currentLine} ${word}` : word;
      }
    });

    if (currentLine) lines.push(currentLine);
    return lines.map((line) => `  ${line}`).join('\n');
  }
}

/**
 * Table formatter for displaying findings in a table format
 */
export class MetadataTableFormatter {
  /**
   * Format violations as a compact table
   */
  static formatAsTable(violations: FormattedViolation[]): string {
    if (violations.length === 0) {
      return '✅ No violations found!\n';
    }

    const headers = ['Rule', 'Severity', 'Confidence', 'Line', 'Gas Impact', 'Storage Impact'];
    const rows = violations.map((v) => [
      v.ruleName.substring(0, 30),
      this.getSeverityEmoji(v.metadata?.severity),
      `${v.metadata?.confidenceScore ?? 0}%`,
      v.lineNumber.toString(),
      this.formatImpactValue(v.metadata?.impacts, 'gas'),
      this.formatImpactValue(v.metadata?.impacts, 'storage'),
    ]);

    return this.renderTable(headers, rows);
  }

  private static getSeverityEmoji(severity?: SeverityLevel): string {
    if (!severity) return '?';
    const map: Record<SeverityLevel, string> = {
      [SeverityLevel.CRITICAL]: '🔴',
      [SeverityLevel.HIGH]: '🟠',
      [SeverityLevel.MEDIUM]: '🟡',
      [SeverityLevel.LOW]: '🟢',
      [SeverityLevel.INFO]: 'ℹ️',
    };
    return map[severity] || '?';
  }

  private static formatImpactValue(impacts: ImpactEstimate[] | undefined, type: string): string {
    if (!impacts) return '-';
    const impact = impacts.find((i) => i.type === type);
    if (!impact) return '-';
    return `${impact.amount}${impact.unit}`;
  }

  private static renderTable(headers: string[], rows: string[][]): string {
    const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));

    let table = '';
    // Header
    table += headers.map((h, i) => h.padEnd(colWidths[i])).join(' │ ') + '\n';
    table += colWidths.map((w) => '─'.repeat(w)).join('─┼─') + '\n';

    // Rows
    rows.forEach((row) => {
      table += row.map((cell, i) => cell.padEnd(colWidths[i])).join(' │ ') + '\n';
    });

    return table;
  }
}
