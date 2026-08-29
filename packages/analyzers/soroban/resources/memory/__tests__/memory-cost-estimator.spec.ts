import { estimateMemoryCost } from '../memory-cost-estimator';

describe('estimateMemoryCost', () => {
  it('returns no findings for a simple contract with no memory-heavy patterns', () => {
    const source = `pub fn add(a: i128, b: i128) -> i128 { a + b }`;
    const report = estimateMemoryCost(source);
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toContain('No high-memory patterns');
  });

  it('detects large Vec::with_capacity allocation', () => {
    const source = `let v = Vec::with_capacity(1000);`;
    const report = estimateMemoryCost(source);
    const finding = report.findings.find((f) => f.patternId === 'large-vec-allocation');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('high');
  });

  it('detects nested collection pattern', () => {
    const source = `let data: Vec<Vec<i128>> = Vec::new();`;
    const report = estimateMemoryCost(source);
    expect(report.findings.some((f) => f.patternId === 'nested-collection')).toBe(true);
  });

  it('detects .collect() materialisation', () => {
    const source = `let result: Vec<_> = items.iter().map(|x| x * 2).collect();`;
    const report = estimateMemoryCost(source);
    expect(report.findings.some((f) => f.patternId === 'collect-iterator')).toBe(true);
  });

  it('ranks patterns by total estimated memory', () => {
    const source = [
      `let v = Vec::with_capacity(500);`,
      `let w = Vec::with_capacity(200);`,
      `let s = String::from("hello");`,
    ].join('\n');
    const report = estimateMemoryCost(source);
    expect(report.rankedPatterns[0].patternId).toBe('large-vec-allocation');
  });
});
