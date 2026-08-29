import { describe, expect, it } from '@jest/globals';
import { StellarComplexityAnalyzer } from './complexity-analyzer';

describe('StellarComplexityAnalyzer', () => {
  it('calculates complexity for a simple function', () => {
    const source = `pub struct Simple;
pub fn greet() -> u64 { 42 }`;

    const analyzer = new StellarComplexityAnalyzer(source, 'simple.rs');
    const report = analyzer.analyze();

    expect(report.contractName).toBe('Simple');
    expect(report.functions.length).toBe(1);
    expect(report.functions[0].metrics.cyclomaticComplexity).toBe(1);
    expect(report.functions[0].riskLevel).toBe('low');
  });

  it('detects high complexity from branches and conditions', () => {
    const source = `pub fn complex(env: Env, x: u64) -> u64 {
    if x > 10 {
        if x > 20 {
            return x * 2;
        } else if x > 15 {
            return x * 3;
        }
        match env {
            a => 1,
            b => 2,
            c => 3,
        }
    }
    0
}`;

    const analyzer = new StellarComplexityAnalyzer(source, 'complex.rs');
    const report = analyzer.analyze();

    expect(report.functions[0].metrics.cyclomaticComplexity).toBeGreaterThan(3);
    expect(report.totalComplexity).toBeGreaterThan(0);
  });

  it('provides risk breakdown', () => {
    const source = `pub fn a() {}
pub fn b() { if true {} }
pub fn c() { if true { if false {} } match x { 1 => (), 2 => (), 3 => (), 4 => () } }`;

    const analyzer = new StellarComplexityAnalyzer(source, 'multi.rs');
    const report = analyzer.analyze();

    expect(report.functions.length).toBe(3);
    const totalRisk = report.riskBreakdown.low + report.riskBreakdown.medium + report.riskBreakdown.high + report.riskBreakdown.critical;
    expect(totalRisk).toBe(3);
  });
});
