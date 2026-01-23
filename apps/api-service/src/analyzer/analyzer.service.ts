import { Injectable } from '@nestjs/common';
import { ScannerService } from '../scanner/scanner.service';
import { RuleViolation } from '../scanner/interfaces/scanner.interface';
import {
  AnalysisReport,
  StorageSavings,
  FormattedViolation,
} from './interfaces/analyzer.interface';
import { FindingMetadataFactory } from '../common/factories/finding-metadata.factory';

@Injectable()
export class AnalyzerService {
  constructor(private readonly scannerService: ScannerService) {}

  async analyzeCode(code: string, source: string): Promise<AnalysisReport> {
    const scanResult = await this.scannerService.scanContent(code, source);
    const formattedViolations = this.formatViolations(scanResult.violations);
    const storageSavings = this.calculateStorageSavingsFromViolations(scanResult.violations);

    return {
      source,
      analysisTime: new Date().toISOString(),
      violations: formattedViolations,
      summary: this.generateSummary(scanResult.violations),
      storageSavings,
      recommendations: this.generateRecommendations(scanResult.violations),
    };
  }

  async calculateStorageSavings(code: string): Promise<StorageSavings> {
    const scanResult = await this.scannerService.scanContent(code, 'storage-analysis');
    return this.calculateStorageSavingsFromViolations(scanResult.violations);
  }

  private formatViolations(violations: RuleViolation[]): FormattedViolation[] {
    return violations.map((violation) => {
      const formatted: FormattedViolation = {
        ...violation,
        severityIcon: this.getSeverityIcon(violation.severity),
        formattedMessage: this.formatViolationMessage(violation),
      };

      // Attach structured metadata if not already present
      if (!formatted.metadata) {
        try {
          formatted.metadata = FindingMetadataFactory.createForRule(violation.ruleName);
        } catch (error) {
          // Gracefully fall back if metadata not available for this rule
          if (typeof console !== 'undefined' && console.warn) {
            console.warn(`No metadata configuration found for rule: ${violation.ruleName}`);
          }
        }
      }

      return formatted;
    });
  }

  private getSeverityIcon(severity: string): string {
    switch (severity) {
      case 'error':
        return '🚨';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      default:
        return '📝';
    }
  }

  private formatViolationMessage(violation: RuleViolation): string {
    return `[${violation.severity.toUpperCase()}] Line ${violation.lineNumber}: ${violation.description}`;
  }

  private generateSummary(violations: RuleViolation[]): string {
    if (violations.length === 0) {
      return '✅ No violations found! Your contract is optimized.';
    }

    const errors = violations.filter((v) => v.severity === 'error').length;
    const warnings = violations.filter((v) => v.severity === 'warning').length;
    const info = violations.filter((v) => v.severity === 'info').length;

    return `Scan Summary: ${violations.length} total violations (${errors} errors, ${warnings} warnings, ${info} info)`;
  }

  private calculateStorageSavingsFromViolations(violations: RuleViolation[]): StorageSavings {
    let unusedVariables = 0;
    let estimatedSavingsKb = 0;

    for (const violation of violations) {
      if (violation.ruleName === 'unused-state-variables') {
        unusedVariables++;
        estimatedSavingsKb += 2.5;
      }
    }

    return {
      unusedVariables,
      estimatedSavingsKb,
      monthlyLedgerRentSavings: estimatedSavingsKb * 0.001,
    };
  }

  private generateRecommendations(violations: RuleViolation[]): string[] {
    const recommendations: string[] = [];
    const unusedVars = violations.filter(
      (v) => v.ruleName === 'unused-state-variables',
    ).length;

    if (unusedVars > 0) {
      recommendations.push(
        `Remove ${unusedVars} unused state variables to reduce storage costs`,
      );
      recommendations.push(
        'Consider using more efficient data types where possible',
      );
      recommendations.push(
        'Implement lazy loading patterns for rarely accessed data',
      );
    }

    if (violations.length === 0) {
      recommendations.push(
        'Your contract looks good! Consider regular audits to maintain code quality.',
      );
    }

    return recommendations;
  }
}
