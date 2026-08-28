/**
 * Issue #809 — Soroban Memory Cost Estimator
 *
 * Estimates relative memory resource consumption from Soroban (Rust)
 * contract source patterns. Detects large allocations, temporary
 * structures, and high-memory operations.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface MemoryPattern {
  id: string;
  description: string;
  pattern: RegExp;
  /** Relative memory weight (0–100) */
  memoryWeight: number;
  severity: Severity;
  suggestion: string;
}

export interface MemoryFinding {
  ruleId: string;
  severity: Severity;
  line: number;
  message: string;
  suggestion: string;
  estimatedMemoryCost: number;
  patternId: string;
}

export interface MemoryCostReport {
  findings: MemoryFinding[];
  rankedPatterns: Array<{
    patternId: string;
    description: string;
    occurrences: number;
    totalEstimatedMemory: number;
  }>;
  totalEstimatedMemory: number;
  summary: string;
}

const MEMORY_PATTERNS: MemoryPattern[] = [
  {
    id: 'large-vec-allocation',
    description: 'Large Vec allocation',
    pattern: /Vec::with_capacity\s*\(\s*(\d{3,})\s*\)/,
    memoryWeight: 80,
    severity: 'high',
    suggestion: 'Avoid pre-allocating large Vecs; use iterators or bounded structures instead.',
  },
  {
    id: 'unbounded-string',
    description: 'Unbounded String allocation',
    pattern: /String::from\s*\(|String::new\s*\(|\.to_string\s*\(/,
    memoryWeight: 35,
    severity: 'medium',
    suggestion: 'Prefer Bytes or Symbol for short identifiers; avoid heap strings in hot paths.',
  },
  {
    id: 'nested-collection',
    description: 'Nested collection (Vec<Vec<_>> or Map<_, Vec<_>>)',
    pattern: /Vec\s*<\s*Vec\s*<|Map\s*<[^>]+,\s*Vec\s*</,
    memoryWeight: 75,
    severity: 'high',
    suggestion: 'Flatten nested collections to reduce heap fragmentation and serialization cost.',
  },
  {
    id: 'clone-in-loop',
    description: '.clone() inside a loop',
    pattern: /\b(for|while|loop)\b[\s\S]{0,200}?\.clone\s*\(\s*\)/,
    memoryWeight: 65,
    severity: 'high',
    suggestion: 'Avoid cloning inside loops; take references or restructure to clone once outside.',
  },
  {
    id: 'box-allocation',
    description: 'Heap Box allocation',
    pattern: /Box::new\s*\(/,
    memoryWeight: 40,
    severity: 'medium',
    suggestion: 'Prefer stack-allocated values; Box<T> adds indirection and heap pressure.',
  },
  {
    id: 'collect-iterator',
    description: '.collect() materialising a full iterator into a collection',
    pattern: /\.collect::<|\.collect\s*\(\s*\)/,
    memoryWeight: 50,
    severity: 'medium',
    suggestion: 'Stream-process iterator results instead of collecting into a temporary collection where possible.',
  },
  {
    id: 'large-struct-stack',
    description: 'Large struct defined inline (many fields)',
    pattern: /struct\s+\w+\s*\{(?:[^}]*,){10,}/,
    memoryWeight: 55,
    severity: 'medium',
    suggestion: 'Split large structs or box heavy fields to keep stack frames small.',
  },
];

export function estimateMemoryCost(source: string): MemoryCostReport {
  const findings: MemoryFinding[] = [];
  const lines = source.split('\n');
  const occurrenceMap = new Map<
    string,
    { description: string; occurrences: number; totalEstimatedMemory: number }
  >();

  for (const mp of MEMORY_PATTERNS) {
    const isMultiLine = mp.id === 'clone-in-loop' || mp.id === 'large-struct-stack';

    if (isMultiLine) {
      const re = new RegExp(mp.pattern.source, 'gs');
      let match: RegExpExecArray | null;
      while ((match = re.exec(source)) !== null) {
        const line = source.slice(0, match.index).split('\n').length;
        pushFinding(mp, line, findings, occurrenceMap);
      }
    } else {
      for (let i = 0; i < lines.length; i++) {
        if (mp.pattern.test(lines[i])) {
          pushFinding(mp, i + 1, findings, occurrenceMap);
        }
      }
    }
  }

  const rankedPatterns = Array.from(occurrenceMap.entries())
    .map(([patternId, v]) => ({ patternId, description: v.description, occurrences: v.occurrences, totalEstimatedMemory: v.totalEstimatedMemory }))
    .sort((a, b) => b.totalEstimatedMemory - a.totalEstimatedMemory);

  const totalEstimatedMemory = Math.min(
    100,
    rankedPatterns.reduce((s, p) => s + p.totalEstimatedMemory, 0) / Math.max(1, rankedPatterns.length),
  );

  const top = rankedPatterns[0];
  const summary = top
    ? `Highest memory pressure from '${top.patternId}' (${top.occurrences}×, est. ${top.totalEstimatedMemory}). Overall relative memory score: ${Math.round(totalEstimatedMemory)}.`
    : 'No high-memory patterns detected.';

  return { findings, rankedPatterns, totalEstimatedMemory, summary };
}

function pushFinding(
  mp: MemoryPattern,
  line: number,
  findings: MemoryFinding[],
  map: Map<string, { description: string; occurrences: number; totalEstimatedMemory: number }>,
): void {
  findings.push({
    ruleId: `soroban-memory-${mp.id}`,
    severity: mp.severity,
    line,
    message: `${mp.description} detected (relative memory weight ${mp.memoryWeight}).`,
    suggestion: mp.suggestion,
    estimatedMemoryCost: mp.memoryWeight,
    patternId: mp.id,
  });
  const existing = map.get(mp.id) ?? { description: mp.description, occurrences: 0, totalEstimatedMemory: 0 };
  existing.occurrences += 1;
  existing.totalEstimatedMemory += mp.memoryWeight;
  map.set(mp.id, existing);
}
