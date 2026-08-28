/**
 * Issue #805 — Soroban Auto-Fix Conflict Resolver
 *
 * Detects overlapping fix instructions, groups conflicting sets,
 * prioritizes compatible fixes, and rejects unsafe combinations.
 */

import { FixInstruction } from '../diff/optimization-diff-generator';

export interface ConflictGroup {
  fixes: FixInstruction[];
  /** The single fix selected as the winner after prioritization */
  winner: FixInstruction | null;
  reason: string;
}

export interface ConflictResolutionReport {
  /** Fixes that are safe to apply (non-conflicting + winners) */
  resolvedFixes: FixInstruction[];
  /** Groups where conflicts were detected */
  conflictGroups: ConflictGroup[];
  /** Fixes discarded due to losing conflict resolution */
  discardedFixes: FixInstruction[];
}

/**
 * Resolve conflicts among a set of fix instructions.
 * Returns the maximal set of non-overlapping fixes to apply.
 */
export function resolveFixConflicts(
  fixes: FixInstruction[],
): ConflictResolutionReport {
  const conflictGroups: ConflictGroup[] = [];
  const discardedFixes: FixInstruction[] = [];
  const used = new Set<FixInstruction>();

  // Build conflict groups
  const remaining = [...fixes];
  while (remaining.length > 0) {
    const current = remaining.shift()!;
    if (used.has(current)) continue;

    const group: FixInstruction[] = [current];
    for (let i = remaining.length - 1; i >= 0; i--) {
      const candidate = remaining[i];
      if (overlaps(current, candidate)) {
        group.push(candidate);
        remaining.splice(i, 1);
      }
    }

    if (group.length > 1) {
      const winner = pickWinner(group);
      conflictGroups.push({
        fixes: group,
        winner,
        reason: `${group.length} fixes overlap on lines ${rangeStr(group)}; selected fix with widest replacement scope.`,
      });
      for (const f of group) {
        if (f !== winner) {
          discardedFixes.push(f);
          used.add(f);
        }
      }
      if (winner) used.add(winner);
    } else {
      used.add(current);
    }
  }

  const resolvedFixes = fixes.filter(
    (f) => !discardedFixes.includes(f),
  );

  return { resolvedFixes, conflictGroups, discardedFixes };
}

function overlaps(a: FixInstruction, b: FixInstruction): boolean {
  return a.startLine <= b.endLine && a.endLine >= b.startLine;
}

/** Prefer the fix with the larger replacement (more context preserved). */
function pickWinner(group: FixInstruction[]): FixInstruction {
  return group.reduce((best, current) =>
    current.replacement.length >= best.replacement.length ? current : best,
  );
}

function rangeStr(group: FixInstruction[]): string {
  const min = Math.min(...group.map((f) => f.startLine));
  const max = Math.max(...group.map((f) => f.endLine));
  return `${min}-${max}`;
}
