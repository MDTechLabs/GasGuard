/**
 * Rule: soroban-duplicate-signature-verification (#899)
 * Detects duplicate identical signature verifications in Soroban contracts.
 */
import {
  analyzeDuplicateSignatures,
  DuplicateSignatureFinding,
} from '../../../../analyzers/soroban/dataflow/duplicate-signature-analyzer';

export interface DuplicateSignatureRuleFinding {
  ruleId: 'soroban-duplicate-signature-verification';
  line: number;
  message: string;
  suggestion: string;
  severity: 'high' | 'medium';
}

export function detectDuplicateSignatureVerifications(
  source: string,
): DuplicateSignatureRuleFinding[] {
  const findings = analyzeDuplicateSignatures(source);
  return findings.map((f) => ({
    ruleId: 'soroban-duplicate-signature-verification' as const,
    line: f.line,
    message: f.message,
    suggestion: f.suggestion,
    severity: f.severity,
  }));
}
