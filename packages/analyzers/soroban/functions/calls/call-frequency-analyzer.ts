/**
 * Issue #802 — Soroban Function Call Frequency Analyzer
 *
 * Builds function→helper call relationships from Soroban (Rust) contract
 * source, counts repeated invocations, identifies hot call paths, and
 * emits optimization-candidate findings.
 */

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface CallEdge {
  /** Caller function name */
  caller: string;
  /** Callee / helper name */
  callee: string;
  /** Source line of the call site */
  line: number;
  /** Normalized argument fingerprint (for identical-call detection) */
  argsFingerprint: string;
}

export interface CallFrequencyEntry {
  caller: string;
  callee: string;
  /** Total times this caller invokes this callee */
  count: number;
  /** Distinct call-site lines */
  lines: number[];
  /** How many of those calls share identical arguments */
  identicalArgCount: number;
}

export interface HotCallPath {
  /** Ordered sequence of function names forming the hot path */
  path: string[];
  /** Aggregate invocation weight along the path */
  weight: number;
  /** Representative starting line */
  line: number;
}

export interface CallFrequencyFinding {
  ruleId: 'soroban-call-frequency';
  severity: Severity;
  line: number;
  message: string;
  suggestion: string;
  /** Caller → callee edge that triggered the finding */
  edge: { caller: string; callee: string; count: number };
}

export interface CallFrequencyReport {
  edges: CallEdge[];
  frequencies: CallFrequencyEntry[];
  hotPaths: HotCallPath[];
  findings: CallFrequencyFinding[];
  metrics: {
    totalCallSites: number;
    uniqueEdges: number;
    maxFrequency: number;
    hotPathCount: number;
  };
}

/** Minimum times a helper must be called from the same function to flag. */
const FREQUENCY_THRESHOLD = 3;
/** Minimum path weight to treat as a hot path. */
const HOT_PATH_WEIGHT_THRESHOLD = 4;

const FN_DECL = /(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*[<(]/;
/** Internal helper / method invocation patterns common in Soroban Rust. */
const CALL_PATTERNS: RegExp[] = [
  // self.helper(...) or Self::helper(...)
  /(?:self\.|Self::)([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
  // bare helper calls inside the same module: helper_name(
  /(?<![.\w:])([a-z_][A-Za-z0-9_]*)\s*\(/g,
];

/**
 * Extract call edges from Soroban Rust source.
 */
export function extractCallEdges(source: string): CallEdge[] {
  const edges: CallEdge[] = [];
  const lines = source.split('\n');
  let currentFn = '<module>';

  // Keywords / builtins to ignore as callees
  const IGNORE = new Set([
    'if', 'for', 'while', 'match', 'loop', 'return', 'break', 'continue',
    'let', 'mut', 'ref', 'as', 'in', 'where', 'impl', 'struct', 'enum',
    'mod', 'use', 'pub', 'fn', 'async', 'await', 'Ok', 'Err', 'Some', 'None',
    'vec', 'format', 'panic', 'assert', 'assert_eq', 'assert_ne',
    'println', 'eprintln', 'print', 'eprint', 'dbg',
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fnMatch = line.match(FN_DECL);
    if (fnMatch) {
      currentFn = fnMatch[1];
    }

    for (const pattern of CALL_PATTERNS) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(line)) !== null) {
        const callee = m[1];
        if (IGNORE.has(callee) || callee === currentFn) continue;

        // Capture args fingerprint between this '(' and matching ')'
        const openIdx = m.index + m[0].length - 1;
        const argsRaw = extractArgs(line, openIdx);
        edges.push({
          caller: currentFn,
          callee,
          line: i + 1,
          argsFingerprint: normalizeArgs(argsRaw),
        });
      }
    }
  }

  return edges;
}

function extractArgs(line: string, openParenIdx: number): string {
  let depth = 0;
  let end = openParenIdx;
  for (let i = openParenIdx; i < line.length; i++) {
    if (line[i] === '(') depth++;
    else if (line[i] === ')') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  return line.slice(openParenIdx + 1, end);
}

function normalizeArgs(args: string): string {
  return args.replace(/\s+/g, ' ').trim();
}

/**
 * Aggregate edges into frequency entries.
 */
export function buildFrequencies(edges: CallEdge[]): CallFrequencyEntry[] {
  const map = new Map<string, CallFrequencyEntry>();

  for (const e of edges) {
    const key = `${e.caller}→${e.callee}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        caller: e.caller,
        callee: e.callee,
        count: 0,
        lines: [],
        identicalArgCount: 0,
      };
      map.set(key, entry);
    }
    entry.count += 1;
    if (!entry.lines.includes(e.line)) entry.lines.push(e.line);
  }

  // Count identical-arg repetitions per edge
  const argCounts = new Map<string, number>();
  for (const e of edges) {
    const k = `${e.caller}→${e.callee}::${e.argsFingerprint}`;
    argCounts.set(k, (argCounts.get(k) ?? 0) + 1);
  }
  for (const entry of map.values()) {
    let maxIdent = 0;
    for (const [k, c] of argCounts) {
      if (k.startsWith(`${entry.caller}→${entry.callee}::`) && c > maxIdent) {
        maxIdent = c;
      }
    }
    entry.identicalArgCount = maxIdent;
  }

  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/**
 * Identify hot call paths (caller chains with high aggregate weight).
 * Simple 2-hop paths: A→B where B is also a frequent caller.
 */
export function identifyHotPaths(
  frequencies: CallFrequencyEntry[],
): HotCallPath[] {
  const byCaller = new Map<string, CallFrequencyEntry[]>();
  for (const f of frequencies) {
    const list = byCaller.get(f.caller) ?? [];
    list.push(f);
    byCaller.set(f.caller, list);
  }

  const paths: HotCallPath[] = [];

  for (const f of frequencies) {
    if (f.count < FREQUENCY_THRESHOLD) continue;
    // Single-hop hot edge
    paths.push({
      path: [f.caller, f.callee],
      weight: f.count,
      line: f.lines[0] ?? 0,
    });

    // 2-hop: if callee is itself a frequent caller
    const downstream = byCaller.get(f.callee) ?? [];
    for (const d of downstream) {
      if (d.count < 2) continue;
      const weight = f.count + d.count;
      if (weight >= HOT_PATH_WEIGHT_THRESHOLD) {
        paths.push({
          path: [f.caller, f.callee, d.callee],
          weight,
          line: f.lines[0] ?? 0,
        });
      }
    }
  }

  return paths.sort((a, b) => b.weight - a.weight);
}

/**
 * Generate optimization-candidate findings from frequency data.
 */
export function generateFindings(
  frequencies: CallFrequencyEntry[],
): CallFrequencyFinding[] {
  const findings: CallFrequencyFinding[] = [];

  for (const f of frequencies) {
    if (f.count < FREQUENCY_THRESHOLD) continue;

    const severity: Severity =
      f.count >= 8 ? 'high' : f.count >= 5 ? 'medium' : 'low';

    findings.push({
      ruleId: 'soroban-call-frequency',
      severity,
      line: f.lines[0] ?? 0,
      message: `Function '${f.caller}' invokes helper '${f.callee}' ${f.count} times (lines: ${f.lines.join(', ')}).`,
      suggestion:
        f.identicalArgCount >= FREQUENCY_THRESHOLD
          ? `Cache the result of '${f.callee}' when arguments are identical, or refactor into a single batched call.`
          : `Consider inlining, memoizing, or batching repeated calls to '${f.callee}' from '${f.caller}'.`,
      edge: { caller: f.caller, callee: f.callee, count: f.count },
    });
  }

  return findings;
}

/**
 * Full analysis entry point.
 */
export function analyzeCallFrequency(source: string): CallFrequencyReport {
  const edges = extractCallEdges(source);
  const frequencies = buildFrequencies(edges);
  const hotPaths = identifyHotPaths(frequencies);
  const findings = generateFindings(frequencies);

  const maxFrequency =
    frequencies.length > 0 ? frequencies[0].count : 0;

  return {
    edges,
    frequencies,
    hotPaths,
    findings,
    metrics: {
      totalCallSites: edges.length,
      uniqueEdges: frequencies.length,
      maxFrequency,
      hotPathCount: hotPaths.length,
    },
  };
}
