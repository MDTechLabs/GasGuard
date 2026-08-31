/**
 * Rule: soroban-unchecked-auth-parameter (#897)
 * Detects authentication inputs used without sufficient validation.
 */

import {
  analyzeUncheckedAuthParameters,
  UncheckedAuthParameterAnalyzer,
} from '../../../analyzers/soroban/security/unchecked-auth-parameter-analyzer';
import type {
  UncheckedAuthParamFinding,
  UncheckedAuthParamReport,
} from '../../../analyzers/soroban/security/unchecked-auth-parameter-analyzer';

export interface UncheckedAuthRuleFinding {
  ruleId: 'soroban-unchecked-auth-parameter';
  rule: 'A4-unchecked-auth-param';
  severity: 'critical' | 'high' | 'medium' | 'low';
  line: number;
  functionName: string;
  parameterName: string;
  message: string;
  suggestion: string;
  location: {
    line: number;
    functionName: string;
    column?: number;
  };
  details: {
    functionName: string;
    parameterName: string;
    issueType: 'missing_validation' | 'checked_after_use';
    privilegedUseLine: number;
    validationLine?: number;
    privilegedAction: string;
  };
}

export interface UncheckedAuthRuleReport {
  findings: UncheckedAuthRuleFinding[];
  summary: string;
  metrics: {
    totalAuthParameters: number;
    uncheckedParameters: number;
    misorderedChecks: number;
    validatedParameters: number;
  };
}

/**
 * Detect unchecked authentication parameters in Soroban smart contract source code.
 */
export function detectUncheckedAuthParameters(source: string): UncheckedAuthRuleReport {
  const analysis: UncheckedAuthParamReport = analyzeUncheckedAuthParameters(source);
  return convertToRuleReport(analysis);
}

/**
 * Convert analyzer report to rule report format.
 */
function convertToRuleReport(analysis: UncheckedAuthParamReport): UncheckedAuthRuleReport {
  const findings: UncheckedAuthRuleFinding[] = analysis.findings.map((finding) => ({
    ruleId: 'soroban-unchecked-auth-parameter' as const,
    rule: 'A4-unchecked-auth-param' as const,
    severity: finding.severity,
    line: finding.line,
    functionName: finding.functionName,
    parameterName: finding.parameterName,
    message: finding.message,
    suggestion: finding.suggestion,
    location: finding.location,
    details: finding.details,
  }));

  const unchecked = analysis.metrics.uncheckedParameters;
  const misordered = analysis.metrics.misorderedChecks;
  const summary =
    unchecked === 0 && misordered === 0
      ? 'All authentication parameters are properly validated before privileged use.'
      : `Found ${unchecked} unchecked authentication parameter(s) and ${misordered} misordered check(s).`;

  return {
    findings,
    summary,
    metrics: analysis.metrics,
  };
}

export class UncheckedAuthParameterRule {
  public static readonly RULE_ID = 'soroban-unchecked-auth-parameter';

  public evaluate(sourceCode: string): UncheckedAuthRuleReport {
    return detectUncheckedAuthParameters(sourceCode);
  }
}
