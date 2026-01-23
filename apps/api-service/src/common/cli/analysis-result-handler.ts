/**
 * CLI Command Handler for displaying analysis results with structured metadata
 * Integrates with the analyzer service to provide rich, educational output
 */

import { MetadataCliFormatter, MetadataTableFormatter } from '../formatters/metadata-cli.formatter';
import { FormattedViolation } from '../../analyzer/interfaces/analyzer.interface';

export interface CliOutputOptions {
  format?: 'detailed' | 'table' | 'json'; // Output format
  includeEducational?: boolean; // Include educational links
  verbose?: boolean; // Detailed output
  outputPath?: string; // Path to save output
}

export class AnalysisResultCliHandler {
  /**
   * Display analysis results in the CLI with metadata
   */
  static displayResults(violations: FormattedViolation[], options: CliOutputOptions = {}): string {
    const {
      format = 'detailed',
      includeEducational = true,
      verbose = false,
    } = options;

    let output = '';

    // Add summary
    output += MetadataCliFormatter.formatSummaryWithMetadata(violations);

    if (violations.length === 0) {
      return output;
    }

    switch (format) {
      case 'table':
        output += '\n📊 Findings Overview:\n';
        output += MetadataTableFormatter.formatAsTable(violations);
        break;

      case 'json':
        output += '\n' + JSON.stringify(
          violations.map((v) => MetadataCliFormatter.toJSON(v)),
          null,
          2,
        );
        break;

      case 'detailed':
      default:
        violations.forEach((violation) => {
          output += MetadataCliFormatter.formatFindingWithMetadata(violation, includeEducational);
        });

        if (verbose) {
          output += this.appendVerboseMetadata(violations);
        }
    }

    return output;
  }

  /**
   * Display a single finding with full details
   */
  static displayFinding(violation: FormattedViolation, includeEducational = true): string {
    return MetadataCliFormatter.formatFindingWithMetadata(violation, includeEducational);
  }

  /**
   * Get metadata-based recommendations
   */
  static getRecommendations(violations: FormattedViolation[]): string[] {
    const recommendations: string[] = [];
    const ruleRecommendations = new Map<string, string>();

    violations.forEach((v) => {
      if (v.metadata && v.metadata.mitigation && !ruleRecommendations.has(v.ruleName)) {
        ruleRecommendations.set(v.ruleName, v.metadata.mitigation);
      }
    });

    // Prioritize by severity
    const bySeverity = {
      critical: [] as string[],
      high: [] as string[],
      medium: [] as string[],
      low: [] as string[],
      info: [] as string[],
    };

    violations.forEach((v) => {
      if (v.metadata && v.metadata.severity) {
        const severity = v.metadata.severity as keyof typeof bySeverity;
        if (severity in bySeverity && !bySeverity[severity].includes(v.ruleName)) {
          bySeverity[severity].push(v.ruleName);
        }
      }
    });

    // Collect recommendations in severity order
    Object.values(bySeverity).forEach((rules) => {
      rules.forEach((rule) => {
        const rec = ruleRecommendations.get(rule);
        if (rec) {
          recommendations.push(rec);
        }
      });
    });

    return recommendations;
  }

  /**
   * Export analysis results to JSON with full metadata
   */
  static exportToJson(violations: FormattedViolation[], pretty = true): string {
    const data = {
      timestamp: new Date().toISOString(),
      summary: {
        total: violations.length,
        critical: violations.filter((v) => v.metadata?.severity === 'critical').length,
        high: violations.filter((v) => v.metadata?.severity === 'high').length,
        medium: violations.filter((v) => v.metadata?.severity === 'medium').length,
        low: violations.filter((v) => v.metadata?.severity === 'low').length,
        info: violations.filter((v) => v.metadata?.severity === 'info').length,
      },
      findings: violations.map((v) => MetadataCliFormatter.toJSON(v)),
    };

    return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  }

  private static appendVerboseMetadata(violations: FormattedViolation[]): string {
    let output = '\n\n🔍 VERBOSE METADATA:\n';
    output += '═'.repeat(80) + '\n';

    violations.forEach((v, index) => {
      output += `\n[${index + 1}] ${v.ruleName}\n`;
      if (v.metadata) {
        output += `  Version: ${v.metadata.version}\n`;
        output += `  Created: ${v.metadata.createdAt}\n`;
        if (v.metadata.tags) {
          output += `  Tags: ${v.metadata.tags.join(', ')}\n`;
        }
        if (v.metadata.relatedRules) {
          output += `  Related: ${v.metadata.relatedRules.join(', ')}\n`;
        }
      }
    });

    output += '\n' + '═'.repeat(80) + '\n';
    return output;
  }
}
