/**
 * Converts the `RuleResult` produced by the solidity-lite based detectors into the analyzer
 * pipeline's normalized `Finding` shape (see libs/engine/core/analyzer-interface.ts).
 *
 * The conversion is lossless for review purposes: severity rationale, confidence evidence,
 * structured details, diagnostics and analysis limitations travel in `metadata`.
 */
import { Finding, Severity as PipelineSeverity } from '../../../libs/engine/core/analyzer-interface';
import { RuleResult, Severity } from './solidity-lite';

const SEVERITY_MAP: Record<Severity, PipelineSeverity> = {
  critical: PipelineSeverity.CRITICAL,
  high: PipelineSeverity.HIGH,
  medium: PipelineSeverity.MEDIUM,
  low: PipelineSeverity.LOW,
};

export const DOCS_BASE_URL = 'https://docs.gasguard.dev/rules';

export interface NormalizeOptions {
  /** Used for findings that do not carry their own `file`. */
  file: string;
  /** Documentation page slug; defaults to the rule id. */
  docsSlug?: string;
}

export function toNormalizedFindings(result: RuleResult, options: NormalizeOptions): Finding[] {
  const docs = `${DOCS_BASE_URL}/${options.docsSlug ?? result.ruleId}`;
  return result.findings.map((f) => ({
    ruleId: f.ruleId,
    message: f.message,
    severity: SEVERITY_MAP[f.severity],
    location: { file: f.file ?? options.file, startLine: f.line, endLine: f.line, startColumn: f.column },
    suggestedFix: { description: f.remediation, documentationUrl: docs },
    metadata: {
      kind: f.kind,
      confidence: f.confidence,
      contract: f.contract,
      function: f.function,
      severityRationale: f.severityRationale,
      confidenceEvidence: f.confidenceEvidence,
      details: f.details,
      diagnostics: result.diagnostics,
      limitations: result.limitations ?? [],
      notes: result.notes ?? [],
    },
  }));
}
