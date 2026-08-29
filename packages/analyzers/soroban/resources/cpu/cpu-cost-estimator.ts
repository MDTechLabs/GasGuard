/**
 * Issue #808 — Soroban CPU Cost Estimator
 *
 * Estimates relative CPU resource consumption from Soroban contract source
 * patterns. Ranks expensive computational patterns and attaches estimates
 * to findings.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface CpuPattern {
  id: string;
  description: string;
  /** Regex (or multi-line) used to detect the pattern */
  pattern: RegExp;
  /** Relative CPU cost weight (0–100) */
  cpuWeight: number;
  severity: Severity;
  suggestion: string;
}

export interface CpuCostFinding {
  ruleId: string;
  severity: Severity;
  line: number;
  message: string;
  suggestion: string;
  /** Relative CPU estimate for this occurrence (0–100) */
  estimatedCpuCost: number;
  patternId: string;
}

export interface CpuCostReport {
  findings: CpuCostFinding[];
  /** Patterns ranked by aggregate estimated cost */
  rankedPatterns: Array<{
    patternId: string;
    description: string;
    occurrences: number;
    totalEstimatedCpu: number;
  }>;
  /** Aggregate relative CPU score (capped at 100) */
  totalEstimatedCpu: number;
  summary: string;
}

const CPU_PATTERNS: CpuPattern[] = [
  {
    id: 'unbounded-loop',
    description: 'Loop without an explicit upper bound',
    pattern: /\b(for|while|loop)\b(?![^{]*\b(take|limit|MAX_|max_))/,
    cpuWeight: 85,
    severity: 'high',
    suggestion:
      'Bound iterations with a fixed limit or early-exit condition to keep CPU instructions predictable.',
  },
  {
    id: 'nested-loop',
    description: 'Nested loop constructs',
    pattern: /\bfor\b[\s\S]{0,200}?\bfor\b/,
    cpuWeight: 90,
    severity: 'critical',
    suggestion:
      'Avoid nested loops over ledger data; pre-aggregate or index instead.',
  },
  {
    id: 'map-iteration',
    description: 'Full Map / Vec iteration',
    pattern: /\.iter\(\)|\.keys\(\)|\.values\(\)|\.into_iter\(\)/,
    cpuWeight: 55,
    severity: 'medium',
    suggestion:
      'Prefer keyed lookups over full collection scans inside contract entry points.',
  },
  {
    id: 'crypto-heavy',
    description: 'Cryptographic primitive invocation',
    pattern:
      /\b(keccak256|sha256|ed25519|secp256k1|bls12_381|verify_sig|recover)\b/i,
    cpuWeight: 70,
    severity: 'high',
    suggestion:
      'Batch signature verifications where possible; avoid re-verifying the same payload.',
  },
  {
    id: 'serialization',
    description: 'Serialize / deserialize operations',
    pattern: /\b(to_xdr|from_xdr|serialize|deserialize|to_bytes|from_bytes)\b/,
    cpuWeight: 40,
    severity: 'medium',
    suggestion:
      'Cache serialized forms when the same value is emitted multiple times in one invocation.',
  },
  {
    id: 'storage-in-loop',
    description: 'Storage read/write inside a loop body',
    pattern:
      /\b(for|while|loop)\b[\s\S]{0,300}?env\.storage\(\)\.(persistent|temporary|instance)\(\)/,
    cpuWeight: 95,
    severity: 'critical',
    suggestion:
      'Move storage operations outside loops; accumulate in memory and commit once.',
  },
  {
    id: 'cross-contract-invoke',
    description: 'Cross-contract invocation',
    pattern: /env\.invoke_contract\s*\(|Client::new\s*\(/,
    cpuWeight: 60,
    severity: 'high',
    suggestion:
      'Minimize cross-contract hops; batch arguments into a single invoke where feasible.',
  },
  {
    id: 'string-format',
    description: 'Dynamic string formatting',
    pattern: /\bformat!\s*\(|String::from\s*\(/,
    cpuWeight: 25,
    severity: 'low',
    suggestion:
      'Prefer static symbols / bytes over runtime string formatting in hot paths.',
  },
];

/**
 * Analyze source and produce CPU cost findings + ranked pattern report.
 */
export function estimateCpuCost(source: string): CpuCostReport {
  const findings: CpuCostFinding[] = [];
  const lines = source.split('\n');
  const occurrenceMap = new Map<
    string,
    { description: string; occurrences: number; totalEstimatedCpu: number }
  >();

  for (const cpuPattern of CPU_PATTERNS) {
    // Line-oriented scan for most patterns; whole-source for multi-line
    const isMultiLine =
      cpuPattern.id === 'nested-loop' || cpuPattern.id === 'storage-in-loop';

    if (isMultiLine) {
      const re = new RegExp(cpuPattern.pattern.source, 'g');
      let match: RegExpExecArray | null;
      while ((match = re.exec(source)) !== null) {
        const line = source.slice(0, match.index).split('\n').length;
        pushFinding(cpuPattern, line, findings, occurrenceMap);
      }
    } else {
      for (let i = 0; i < lines.length; i++) {
        if (cpuPattern.pattern.test(lines[i])) {
          pushFinding(cpuPattern, i + 1, findings, occurrenceMap);
        }
      }
    }
  }

  const rankedPatterns = Array.from(occurrenceMap.entries())
    .map(([patternId, v]) => ({
      patternId,
      description: v.description,
      occurrences: v.occurrences,
      totalEstimatedCpu: v.totalEstimatedCpu,
    }))
    .sort((a, b) => b.totalEstimatedCpu - a.totalEstimatedCpu);

  const totalEstimatedCpu = Math.min(
    100,
    rankedPatterns.reduce((s, p) => s + p.totalEstimatedCpu, 0) /
      Math.max(1, rankedPatterns.length || 1),
  );

  const top = rankedPatterns[0];
  const summary = top
    ? `Highest CPU pressure from '${top.patternId}' (${top.occurrences}×, est. ${top.totalEstimatedCpu}). Overall relative CPU score: ${Math.round(totalEstimatedCpu)}.`
    : 'No high-CPU patterns detected.';

  return { findings, rankedPatterns, totalEstimatedCpu, summary };
}

function pushFinding(
  cpuPattern: CpuPattern,
  line: number,
  findings: CpuCostFinding[],
  occurrenceMap: Map<
    string,
    { description: string; occurrences: number; totalEstimatedCpu: number }
  >,
): void {
  findings.push({
    ruleId: `soroban-cpu-${cpuPattern.id}`,
    severity: cpuPattern.severity,
    line,
    message: `${cpuPattern.description} detected (relative CPU weight ${cpuPattern.cpuWeight}).`,
    suggestion: cpuPattern.suggestion,
    estimatedCpuCost: cpuPattern.cpuWeight,
    patternId: cpuPattern.id,
  });

  const existing = occurrenceMap.get(cpuPattern.id) ?? {
    description: cpuPattern.description,
    occurrences: 0,
    totalEstimatedCpu: 0,
  };
  existing.occurrences += 1;
  existing.totalEstimatedCpu += cpuPattern.cpuWeight;
  occurrenceMap.set(cpuPattern.id, existing);
}
