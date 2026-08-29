export type SorobanSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SorobanFindingLike {
  ruleId: string;
  severity?: SorobanSeverity;
  message?: string;
  suggestion?: string;
}

export interface SorobanSuggestion {
  ruleId: string;
  severity: SorobanSeverity;
  recommendation: string;
  rationale: string;
  expectedImpact: string;
}

export class SorobanSuggestionEngine {
  public suggest(findings: SorobanFindingLike[]): SorobanSuggestion[] {
    return findings.map((finding) => getSorobanSuggestionForFinding(finding));
  }
}

export function getSorobanSuggestionForFinding(
  finding: SorobanFindingLike,
): SorobanSuggestion {
  const severity = finding.severity ?? 'medium';
  const ruleSpecific = getRuleSpecificSuggestion(finding, severity);

  return {
    ruleId: finding.ruleId,
    severity,
    recommendation: ruleSpecific.recommendation,
    rationale: ruleSpecific.rationale,
    expectedImpact: ruleSpecific.expectedImpact,
  };
}

function getRuleSpecificSuggestion(
  finding: SorobanFindingLike,
  severity: SorobanSeverity,
): Omit<SorobanSuggestion, 'ruleId' | 'severity'> {
  const message = finding.message ?? '';

  switch (finding.ruleId) {
    case 'soroban-call-frequency': {
      return {
        recommendation:
          finding.suggestion?.includes('cache') || message.includes('helper')
            ? "cache the repeated helper result or batch the equivalent calls so the hot path avoids redundant host invocations."
            : "inline or memoize repeated helper calls and batch equivalent work in the hot path.",
        rationale:
          'Repeated helper calls in a hot path amplify CPU and fee usage; eliminating redundant invocations reduces execution cost without changing behavior.',
        expectedImpact: 'Expected impact: ~20-30% reduction in per-call CPU and fee overhead.',
      };
    }

    case 'soroban-storage-rent': {
      return {
        recommendation:
          'Use temporary storage for short-lived keys and reserve instance storage for durable state, with TTL extension only where required.',
        rationale:
          'Short-lived state stored persistently increases ledger rent and storage churn; moving ephemeral data to temporary storage reduces ongoing rent pressure.',
        expectedImpact: 'Expected impact: ~30-40% reduction in rent and ledger storage growth.',
      };
    }

    case 'soroban-redundant-call': {
      return {
        recommendation:
          'Memoize repeated call results in local variables or precompute shared values before entering the loop.',
        rationale:
          'Repeated external or intra-contract calls add repeated serialization and host overhead; caching removes duplication in the critical path.',
        expectedImpact: 'Expected impact: ~15-25% reduction in CPU cost for the affected function.',
      };
    }

    case 'soroban-unbounded-loop': {
      return {
        recommendation:
          'Bound the loop, hoist stable state reads, and reduce storage access inside the iteration body.',
        rationale:
          'Loops with repeated storage or host interactions can quickly dominate execution time and fees; limiting work inside the loop improves throughput and predictability.',
        expectedImpact: 'Expected impact: ~25-40% reduction in fee pressure for large iterations.',
      };
    }

    default: {
      const genericImpact =
        severity === 'high' || severity === 'critical'
          ? 'Expected impact: ~20-40% lower runtime and fee cost in the affected path.'
          : 'Expected impact: ~10-20% lower runtime and fee cost in the affected path.';

      return {
        recommendation:
          'Refactor the hot path to reduce repeated storage reads, host calls, or expensive conversions while preserving semantics.',
        rationale:
          'The finding points to a repeated cost pattern; the most reliable remediation is to remove redundant work and keep the computation closer to local state.',
        expectedImpact: genericImpact,
      };
    }
  }
}
