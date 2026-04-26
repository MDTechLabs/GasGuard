/**
 * Heuristic-Based Pattern Detection (#237)
 * Detects gas issues using heuristics that combine multiple signals
 * beyond what static rules alone can catch.
 */

export interface HeuristicSignal {
  name: string;
  weight: number; // 0.0 – 1.0
  matched: boolean;
}

export interface HeuristicResult {
  patternName: string;
  score: number;       // weighted sum of matched signals
  threshold: number;
  detected: boolean;
  signals: HeuristicSignal[];
}

export interface HeuristicPattern {
  name: string;
  threshold: number;
  signals: Array<{
    name: string;
    weight: number;
    test: (code: string) => boolean;
  }>;
}

const DEFAULT_PATTERNS: HeuristicPattern[] = [
  {
    name: 'inefficient-loop',
    threshold: 0.6,
    signals: [
      {
        name: 'loop-keyword',
        weight: 0.4,
        test: (code) => /\b(for|while|loop)\b/.test(code),
      },
      {
        name: 'storage-read-in-loop',
        weight: 0.4,
        test: (code) => /\b(storage|env\.storage)\b/.test(code) && /\b(for|while)\b/.test(code),
      },
      {
        name: 'unbounded-iteration',
        weight: 0.2,
        test: (code) => /\.len\(\)|\.length/.test(code),
      },
    ],
  },
  {
    name: 'redundant-storage-write',
    threshold: 0.5,
    signals: [
      {
        name: 'repeated-assignment',
        weight: 0.5,
        test: (code) => {
          const assignments = code.match(/\w+\s*=\s*[^=]/g) ?? [];
          const keys = assignments.map((a) => a.split('=')[0].trim());
          return keys.length !== new Set(keys).size;
        },
      },
      {
        name: 'storage-keyword',
        weight: 0.5,
        test: (code) => /\b(storage|env\.storage|self\.\w+)\b/.test(code),
      },
    ],
  },
  {
    name: 'large-data-on-chain',
    threshold: 0.7,
    signals: [
      {
        name: 'string-type',
        weight: 0.4,
        test: (code) => /\bString\b|\bstring\b/.test(code),
      },
      {
        name: 'vec-of-bytes',
        weight: 0.3,
        test: (code) => /Vec<u8>|bytes/.test(code),
      },
      {
        name: 'large-literal',
        weight: 0.3,
        test: (code) => /"[^"]{64,}"/.test(code),
      },
    ],
  },
];

export class HeuristicEngine {
  private patterns: HeuristicPattern[];

  constructor(patterns: HeuristicPattern[] = DEFAULT_PATTERNS) {
    this.patterns = patterns;
  }

  /**
   * Run all heuristic patterns against a code snippet.
   */
  analyze(code: string): HeuristicResult[] {
    return this.patterns.map((pattern) => {
      const signals: HeuristicSignal[] = pattern.signals.map((s) => ({
        name: s.name,
        weight: s.weight,
        matched: s.test(code),
      }));

      const score = signals.reduce(
        (sum, s) => sum + (s.matched ? s.weight : 0),
        0,
      );

      return {
        patternName: pattern.name,
        score,
        threshold: pattern.threshold,
        detected: score >= pattern.threshold,
        signals,
      };
    });
  }

  /**
   * Return only the patterns that were detected.
   */
  detectIssues(code: string): HeuristicResult[] {
    return this.analyze(code).filter((r) => r.detected);
  }
}
