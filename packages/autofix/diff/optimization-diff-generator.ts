/**
 * Issue #803 — Soroban Optimization Diff Generator
 *
 * Generates before/after unified diffs for proposed optimizations,
 * preserving original source and supporting multiple fixes.
 */

export interface DiffHunk {
  startLine: number;
  endLine: number;
  originalLines: string[];
  proposedLines: string[];
}

export interface OptimizationDiff {
  filePath: string;
  originalSource: string;
  proposedSource: string;
  hunks: DiffHunk[];
  /** Unified-diff format patch string */
  patch: string;
}

export interface FixInstruction {
  /** 1-based start line to replace */
  startLine: number;
  /** 1-based end line to replace (inclusive) */
  endLine: number;
  /** Replacement lines (empty = deletion) */
  replacement: string[];
  description: string;
}

/**
 * Generate a unified diff for one or more fix instructions against source.
 * Original source is never modified.
 */
export function generateOptimizationDiff(
  source: string,
  filePath: string,
  fixes: FixInstruction[],
): OptimizationDiff {
  const originalLines = source.split('\n');
  const proposed = applyFixes(originalLines, fixes);
  const proposedSource = proposed.join('\n');
  const hunks = buildHunks(originalLines, proposed, fixes);
  const patch = buildPatch(filePath, hunks);

  return { filePath, originalSource: source, proposedSource, hunks, patch };
}

function applyFixes(lines: string[], fixes: FixInstruction[]): string[] {
  // Sort fixes in reverse order so line offsets stay valid
  const sorted = [...fixes].sort((a, b) => b.startLine - a.startLine);
  const result = [...lines];
  for (const fix of sorted) {
    const start = Math.max(0, fix.startLine - 1);
    const deleteCount = fix.endLine - fix.startLine + 1;
    result.splice(start, deleteCount, ...fix.replacement);
  }
  return result;
}

function buildHunks(
  original: string[],
  proposed: string[],
  fixes: FixInstruction[],
): DiffHunk[] {
  return fixes.map((fix) => ({
    startLine: fix.startLine,
    endLine: fix.endLine,
    originalLines: original.slice(fix.startLine - 1, fix.endLine),
    proposedLines: fix.replacement,
  }));
}

function buildPatch(filePath: string, hunks: DiffHunk[]): string {
  const parts: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  for (const hunk of hunks) {
    const origCount = hunk.originalLines.length;
    const newCount = hunk.proposedLines.length;
    parts.push(
      `@@ -${hunk.startLine},${origCount} +${hunk.startLine},${newCount} @@`,
    );
    for (const line of hunk.originalLines) parts.push(`-${line}`);
    for (const line of hunk.proposedLines) parts.push(`+${line}`);
  }
  return parts.join('\n');
}
