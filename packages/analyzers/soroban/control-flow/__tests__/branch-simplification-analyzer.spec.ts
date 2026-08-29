import { analyzeBranchSimplification } from '../branch-simplification-analyzer';

describe('analyzeBranchSimplification', () => {
  it('returns no findings for clean conditional logic', () => {
    const source = `if amount > 0 { do_transfer(amount); }`;
    const report = analyzeBranchSimplification(source);
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toContain('No redundant');
  });

  it('detects constant true condition', () => {
    const source = `if true { env.storage().set(&key, &val); }`;
    const report = analyzeBranchSimplification(source);
    expect(report.findings.some((f) => f.patternId === 'constant-true-condition')).toBe(true);
  });

  it('detects constant false condition as dead code', () => {
    const source = `if false { unreachable_code(); }`;
    const report = analyzeBranchSimplification(source);
    expect(report.findings.some((f) => f.patternId === 'constant-false-condition')).toBe(true);
  });

  it('detects tautological comparison', () => {
    const source = `if amount == amount { return; }`;
    const report = analyzeBranchSimplification(source);
    expect(report.findings.some((f) => f.patternId === 'tautological-comparison')).toBe(true);
  });

  it('detects negated equality', () => {
    const source = `if !(a == b) { panic!("mismatch"); }`;
    const report = analyzeBranchSimplification(source);
    expect(report.findings.some((f) => f.patternId === 'negated-equality')).toBe(true);
  });

  it('counts all findings in totalRedundantBranches', () => {
    const source = [
      `if true { x(); }`,
      `if false { y(); }`,
      `if !(a == b) { z(); }`,
    ].join('\n');
    const report = analyzeBranchSimplification(source);
    expect(report.totalRedundantBranches).toBe(report.findings.length);
  });
});
