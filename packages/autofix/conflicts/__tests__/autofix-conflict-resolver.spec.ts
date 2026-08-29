import { resolveFixConflicts } from '../autofix-conflict-resolver';
import { FixInstruction } from '../../diff/optimization-diff-generator';

describe('resolveFixConflicts', () => {
  it('returns all fixes unchanged when there are no overlaps', () => {
    const fixes: FixInstruction[] = [
      { startLine: 1, endLine: 2, replacement: ['// a'], description: 'a' },
      { startLine: 5, endLine: 6, replacement: ['// b'], description: 'b' },
    ];
    const report = resolveFixConflicts(fixes);
    expect(report.resolvedFixes).toHaveLength(2);
    expect(report.conflictGroups).toHaveLength(0);
    expect(report.discardedFixes).toHaveLength(0);
  });

  it('detects overlapping fixes and keeps only the winner', () => {
    const fixes: FixInstruction[] = [
      { startLine: 3, endLine: 5, replacement: ['// short'], description: 'a' },
      { startLine: 4, endLine: 7, replacement: ['// longer fix', '// line 2'], description: 'b' },
    ];
    const report = resolveFixConflicts(fixes);
    expect(report.conflictGroups).toHaveLength(1);
    expect(report.discardedFixes).toHaveLength(1);
    expect(report.resolvedFixes).toHaveLength(1);
  });

  it('rejects the fix with fewer replacement lines in a conflict', () => {
    const loser: FixInstruction = { startLine: 2, endLine: 3, replacement: [], description: 'loser' };
    const winner: FixInstruction = { startLine: 2, endLine: 3, replacement: ['// winner', '// line2'], description: 'winner' };
    const report = resolveFixConflicts([loser, winner]);
    expect(report.discardedFixes).toContain(loser);
    expect(report.resolvedFixes).toContain(winner);
  });
});
