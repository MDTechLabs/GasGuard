/**
 * Issue #801 — Soroban Function Inlining Candidate Detector
 *
 * Identifies small, frequently-called helper functions that may benefit
 * from inlining. Considers function complexity (body line count) and
 * call frequency to generate candidate recommendations.
 */

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface InliningCandidate {
  functionName: string;
  /** Approximate body line count */
  bodyLines: number;
  /** Number of call sites detected */
  callCount: number;
  /** 0–1 confidence that inlining is beneficial */
  confidence: number;
  severity: Severity;
  suggestion: string;
  /** Line where the function is defined */
  definitionLine: number;
}

export interface InliningReport {
  candidates: InliningCandidate[];
  summary: string;
}

/** Functions with bodies at most this many lines are inlining candidates. */
const MAX_INLINE_BODY_LINES = 5;
/** Functions called at least this many times are flagged. */
const MIN_CALL_COUNT = 2;

/**
 * Detect function inlining candidates in Soroban Rust source.
 */
export function detectInliningCandidates(source: string): InliningReport {
  const lines = source.split('\n');
  const functions = extractFunctions(lines);
  const candidates: InliningCandidate[] = [];

  for (const fn of functions) {
    if (fn.bodyLines > MAX_INLINE_BODY_LINES) continue;

    const callCount = countCalls(source, fn.name);
    if (callCount < MIN_CALL_COUNT) continue;

    // Skip public entry points — inlining pub fn changes the ABI
    if (fn.isPublic) continue;

    const confidence = computeConfidence(fn.bodyLines, callCount);
    const severity: Severity =
      confidence >= 0.85 ? 'high' : confidence >= 0.65 ? 'medium' : 'low';

    candidates.push({
      functionName: fn.name,
      bodyLines: fn.bodyLines,
      callCount,
      confidence,
      severity,
      suggestion: `'${fn.name}' has a ${fn.bodyLines}-line body called ${callCount}× — consider inlining or annotating with \`#[inline]\`.`,
      definitionLine: fn.definitionLine,
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  const summary = candidates.length > 0
    ? `${candidates.length} inlining candidate(s) found. Top candidate: '${candidates[0].functionName}' (${candidates[0].callCount} calls, ${candidates[0].bodyLines} lines).`
    : 'No inlining candidates detected.';

  return { candidates, summary };
}

interface FunctionInfo {
  name: string;
  definitionLine: number;
  bodyLines: number;
  isPublic: boolean;
}

function extractFunctions(lines: string[]): FunctionInfo[] {
  const results: FunctionInfo[] = [];
  const fnDef = /^\s*(pub\s+)?fn\s+(\w+)\s*[(<]/;

  for (let i = 0; i < lines.length; i++) {
    const m = fnDef.exec(lines[i]);
    if (!m) continue;

    const name = m[2];
    const isPublic = !!m[1];

    // Find the opening brace
    let braceDepth = 0;
    let bodyStart = -1;
    let bodyEnd = -1;

    for (let j = i; j < Math.min(i + 200, lines.length); j++) {
      for (const ch of lines[j]) {
        if (ch === '{') { braceDepth++; if (bodyStart === -1) bodyStart = j; }
        if (ch === '}') { braceDepth--; if (braceDepth === 0 && bodyStart !== -1) { bodyEnd = j; break; } }
      }
      if (bodyEnd !== -1) break;
    }

    if (bodyStart !== -1 && bodyEnd !== -1) {
      results.push({
        name,
        definitionLine: i + 1,
        bodyLines: bodyEnd - bodyStart,
        isPublic,
      });
    }
  }

  return results;
}

function countCalls(source: string, name: string): number {
  // Match call sites: name( but not fn name(
  const callRe = new RegExp(`(?<!fn\\s{0,10})\\b${name}\\s*\\(`, 'g');
  return (source.match(callRe) ?? []).length;
}

function computeConfidence(bodyLines: number, callCount: number): number {
  // Shorter body + more calls = higher confidence
  const bodySore = Math.max(0, 1 - bodyLines / (MAX_INLINE_BODY_LINES + 1));
  const callScore = Math.min(1, callCount / 10);
  return Math.round((bodySore * 0.4 + callScore * 0.6) * 100) / 100;
}
