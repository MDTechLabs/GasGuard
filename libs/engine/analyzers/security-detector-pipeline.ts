/**
 * Registry and runner that plugs the solidity-lite based security detectors into the
 * Solidity analyzer pipeline.
 *
 * Every detector is registered with its rule definition and a runner that takes one source
 * string and returns a `RuleResult`. The analyzer calls `runSecurityDetectors` once per file and
 * receives normalized `Finding`s plus any non-fatal errors. Detectors only ever see source text:
 * nothing here reads project configuration, executes scripts or touches the network, and a
 * detector that throws is reported as an error without failing the rest of the analysis.
 */
import { Finding, Rule, Severity } from '../core/analyzer-interface';
import { toNormalizedFindings } from '../../../rules/security/lib/normalize';
import { RuleResult } from '../../../rules/security/lib/solidity-lite';
import { detectCrossContractReentrancy, RULE_ID as XCONTRACT_REENTRANCY } from '../../../rules/security/external-calls/detect-cross-contract-reentrancy';

export interface SecurityDetector {
  rule: Rule;
  /** Documentation page slug under docs/rules. */
  docsSlug: string;
  /** The source is handed over as a one-entry project so findings carry the real file path. */
  run(code: string, filePath: string): RuleResult;
}

export const SECURITY_DETECTORS: SecurityDetector[] = [
  {
    docsSlug: 'solidity-call-safety',
    run: (code, file) => detectCrossContractReentrancy([{ path: file, content: code }]),
    rule: {
      id: XCONTRACT_REENTRANCY,
      name: 'Cross-Contract Reentrancy Through Shared Accounting',
      description:
        'Detects external interactions that precede updates to asset or liability state that another contract reads or mutates.',
      severity: Severity.HIGH,
      category: 'security',
      enabled: true,
      tags: ['security', 'reentrancy', 'cross-contract', 'accounting'],
      documentationUrl: 'https://docs.gasguard.dev/rules/solidity-call-safety',
    },
  },
];

export const SECURITY_DETECTOR_RULES: Rule[] = SECURITY_DETECTORS.map((d) => d.rule);

export interface SecurityPipelineHooks {
  isEnabled(ruleId: string): boolean;
  /** Configured severity override for the rule, if any. */
  severityOverride(ruleId: string): Severity | undefined;
}

export function runSecurityDetectors(
  code: string,
  filePath: string,
  hooks: SecurityPipelineHooks,
): { findings: Finding[]; errors: Array<{ file: string; message: string; error?: Error }> } {
  const findings: Finding[] = [];
  const errors: Array<{ file: string; message: string; error?: Error }> = [];
  for (const detector of SECURITY_DETECTORS) {
    if (!hooks.isEnabled(detector.rule.id)) continue;
    try {
      const result = detector.run(code, filePath);
      for (const d of result.diagnostics) {
        if (d.level === 'error') errors.push({ file: filePath, message: `${detector.rule.id}: ${d.message}` });
      }
      const override = hooks.severityOverride(detector.rule.id);
      for (const f of toNormalizedFindings(result, { file: filePath, docsSlug: detector.docsSlug })) {
        findings.push(override ? { ...f, severity: override } : f);
      }
    } catch (error) {
      errors.push({
        file: filePath,
        message: `${detector.rule.id}: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error : undefined,
      });
    }
  }
  return { findings, errors };
}
