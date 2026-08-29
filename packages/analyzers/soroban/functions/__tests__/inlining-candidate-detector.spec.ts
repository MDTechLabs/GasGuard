import { detectInliningCandidates } from '../inlining-candidate-detector';

const SOURCE_WITH_CANDIDATES = `
fn compute_fee(amount: i128) -> i128 {
    amount / 100
}

pub fn transfer(env: Env, amount: i128) -> i128 {
    let fee = compute_fee(amount);
    let net = amount - compute_fee(amount);
    let check = compute_fee(net);
    net - check
}
`;

describe('detectInliningCandidates', () => {
  it('returns no candidates for a contract with only large or pub functions', () => {
    const source = `pub fn large(env: Env) -> i128 {\n${Array(10).fill('    let x = 1;').join('\n')}\n    x\n}`;
    const report = detectInliningCandidates(source);
    expect(report.candidates).toHaveLength(0);
  });

  it('detects a small private function called multiple times', () => {
    const report = detectInliningCandidates(SOURCE_WITH_CANDIDATES);
    const candidate = report.candidates.find((c) => c.functionName === 'compute_fee');
    expect(candidate).toBeDefined();
    expect(candidate!.callCount).toBeGreaterThanOrEqual(2);
  });

  it('does not flag public functions as inlining candidates', () => {
    const report = detectInliningCandidates(SOURCE_WITH_CANDIDATES);
    expect(report.candidates.every((c) => c.functionName !== 'transfer')).toBe(true);
  });

  it('sorts candidates by confidence descending', () => {
    const report = detectInliningCandidates(SOURCE_WITH_CANDIDATES);
    for (let i = 1; i < report.candidates.length; i++) {
      expect(report.candidates[i - 1].confidence).toBeGreaterThanOrEqual(
        report.candidates[i].confidence,
      );
    }
  });

  it('includes a human-readable summary', () => {
    const report = detectInliningCandidates(SOURCE_WITH_CANDIDATES);
    expect(report.summary).toMatch(/candidate|No inlining/);
  });
});
