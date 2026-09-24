/**
 * Issue #294 — Detect Nested Loop Gas Risks
 *
 * Scans Solidity source for loops nested inside other loops, records the
 * nesting depth of each loop, and estimates the gas risk:
 *
 *   depth 1 → none   (flat loop)
 *   depth 2 → medium (quadratic work)
 *   depth 3 → high   (cubic — easily blows past block gas limits)
 *   depth 4+ → critical
 *
 * The scan is lexical: comments and string literals are masked out, loop
 * heads (`for`, `while`, `do`) are detected per statement and nesting depth
 * is tracked with an explicit loop-frame stack so sibling loops (and
 * `do { … } while (…) ;` tails) do not confuse the depth count.
 */

export interface NestedLoopFinding {
  /** 1-based line of the loop head. */
  line: number;
  /** Loop type: for | while | do. */
  loopType: string;
  /** Nesting depth of this loop (1 = flat loop, 2 = inside one loop, …). */
  depth: number;
  /** Estimated gas risk for the loop at this depth. */
  risk: 'none' | 'medium' | 'high' | 'critical';
  description: string;
  recommendation: string;
}

export interface NestedLoopGasResult {
  detected: boolean;
  loops: NestedLoopFinding[];
  message: string;
  suggestion: string;
}

/** Mask comments and string literals, preserving offsets and line breaks. */
function maskCommentsAndStrings(code: string): string {
  const out = code.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  while (i < code.length) {
    const two = code.slice(i, i + 2);
    if (two === '//') {
      const end = code.indexOf('\n', i);
      blank(i, end === -1 ? code.length : end);
      i = end === -1 ? code.length : end;
      continue;
    }
    if (two === '/*') {
      const end = code.indexOf('*/', i + 2);
      blank(i, end === -1 ? code.length : end + 2);
      i = end === -1 ? code.length : end + 2;
      continue;
    }
    if (code[i] === '"') {
      let k = i + 1;
      while (k < code.length) {
        if (code[k] === '\\') k++;
        else if (code[k] === '"') break;
        k++;
      }
      blank(i, Math.min(k + 1, code.length));
      i = k + 1;
      continue;
    }
    i++;
  }

  return out.join('');
}

function riskForDepth(depth: number): NestedLoopFinding['risk'] {
  if (depth >= 4) return 'critical';
  if (depth === 3) return 'high';
  if (depth === 2) return 'medium';
  return 'none';
}

function descriptionFor(depth: number, loopType: string): string {
  return `Nested ${loopType} loop at nesting depth ${depth}. Each additional nesting level multiplies the iteration count, pushing gas usage towards the block gas limit.`;
}

function recommendationFor(depth: number): string {
  if (depth >= 3) {
    return 'Restructure to flat iterations (chunking, pagination, or per-item entry points); 3+ nesting levels are very likely to exceed the block gas limit.';
  }
  return 'Flatten the nesting or cap the iteration counts — nested loops scale gas usage multiplicatively.';
}

function riskRank(risk: NestedLoopFinding['risk']): number {
  switch (risk) {
    case 'critical':
      return 3;
    case 'high':
      return 2;
    case 'medium':
      return 1;
    default:
      return 0;
  }
}

/** Build an offset → 1-based line resolver. */
function buildLineResolver(source: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return (offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Skip a parenthesized group starting at the `(` at `from`; returns the end. */
function skipParens(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    else if (masked[i] === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return masked.length;
}

/**
 * Precise scan: track loop nesting with an explicit stack of loop frames.
 * Each frame records the brace depth at which its body opened; when a `}`
 * drops the brace depth back to that level, the frame is closed.
 */
function scanLoopNests(masked: string): NestedLoopFinding[] {
  const lineOf = buildLineResolver(masked);
  const findings: NestedLoopFinding[] = [];

  type LoopFrame = { bodyStartBraceDepth: number };
  const stack: LoopFrame[] = [];

  let braceDepth = 0;
  let i = 0;

  while (i < masked.length) {
    const ch = masked[i];

    if (ch === '\n') {
      i++;
      continue;
    }
    if (ch === '{') {
      braceDepth++;
      i++;
      continue;
    }
    if (ch === '}') {
      // Close any loop frame whose body ends at this brace.
      while (
        stack.length > 0 &&
        stack[stack.length - 1].bodyStartBraceDepth === braceDepth
      ) {
        stack.pop();
      }
      braceDepth--;
      i++;
      continue;
    }

    const two = masked.slice(i, i + 2);
    if (two === '//') {
      const end = masked.indexOf('\n', i);
      i = end === -1 ? masked.length : end;
      continue;
    }
    if (two === '/*') {
      const end = masked.indexOf('*/', i + 2);
      i = end === -1 ? masked.length : end + 2;
      continue;
    }
    if (ch === '"') {
      let k = i + 1;
      while (k < masked.length && masked[k] !== '"') {
        if (masked[k] === '\\') k++;
        k++;
      }
      i = k + 1;
      continue;
    }

    if (ch === 'f' || ch === 'w' || ch === 'd') {
      const m = masked.slice(i, i + 7).match(/\b(for|while|do)\b/);
      if (!m || m.index !== 0) {
        i++;
        continue;
      }

      const type = m[1];
      const depth = stack.length + 1;

      const finding: NestedLoopFinding = {
        line: lineOf(i),
        loopType: type,
        depth,
        risk: riskForDepth(depth),
        description: descriptionFor(depth, type),
        recommendation: recommendationFor(depth),
      };
      if (depth >= 2) findings.push(finding);

      // Walk past the loop head to its body `{`.
      let k = i + m[0].length;
      // Skip whitespace before the condition parentheses.
      while (k < masked.length && /\s/.test(masked[k])) k++;

      if (masked[k] === '(') {
        const afterParens = skipParens(masked, k);
        // `while (cond);` — statement with no body: either a do-while tail
        // or an empty while. Either way it does not open a new frame.
        let j = afterParens;
        while (j < masked.length && /\s/.test(masked[j])) j++;
        if (masked[j] === ';') {
          i = j + 1;
          continue;
        }
        if (masked[j] === '{') {
          // Body opens right after the parens: `{` handled by the brace
          // branch with the frame already pushed.
          stack.push({ bodyStartBraceDepth: braceDepth + 1 });
          i = j; // the `{` is consumed by the brace branch next
          continue;
        }
        // `while (cond) single-statement-body;` — no braces: the body is
        // one statement, so the loop cannot contain a nested loop block.
        i = afterParens;
        continue;
      }

      // `do { … }` — body follows directly.
      if (masked[k] === '{') {
        stack.push({ bodyStartBraceDepth: braceDepth + 1 });
        i = k; // the `{` is consumed by the brace branch next
        continue;
      }

      i += m[0].length;
      continue;
    }

    i++;
  }

  return findings;
}

/**
 * Detect nested loops in Solidity source and estimate their gas risk.
 */
export function detectNestedLoopGasRisks(code: string): NestedLoopGasResult {
  const allLoops = scanLoopNests(maskCommentsAndStrings(code));
  const nested = allLoops.filter((f) => f.depth >= 2);

  if (nested.length === 0) {
    return {
      detected: false,
      loops: allLoops,
      message: 'No nested loop structures detected.',
      suggestion: '',
    };
  }

  const worst = nested.reduce((a, b) => (riskRank(b.risk) > riskRank(a.risk) ? b : a));

  return {
    detected: true,
    loops: nested,
    message: `Detected ${nested.length} nested loop structure(s) up to depth ${Math.max(
      ...nested.map((f) => f.depth),
    )} (worst risk: '${worst.risk}').`,
    suggestion:
      'Reduce nesting depth or bound inner iterations: nested loops multiply gas usage per level and can exceed the block gas limit.',
  };
}
