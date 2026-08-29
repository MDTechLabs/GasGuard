import { describe, expect, it } from '@jest/globals';
import { StellarEvolutionTracker } from './evolution-tracker';

describe('StellarEvolutionTracker', () => {
  it('tracks version changes from changelog entries in source', () => {
    const source = `## [1.1.0] - 2026-06-01
- Added: transfer function for token operations
- Modified: balance_of to use new storage pattern

## [1.0.0] - 2026-01-15
- Added: initial token contract implementation
`;

    const tracker = new StellarEvolutionTracker(source, 'token.rs');
    const report = tracker.track();

    expect(report.versions.length).toBeGreaterThanOrEqual(2);
    expect(report.versions.some(v => v.version === '1.1.0')).toBe(true);
    expect(report.snapshots.length).toBeGreaterThanOrEqual(1);
  });

  it('generates a default snapshot when no changelog exists', () => {
    const source = '#[contract]\npub struct Simple;\n\n#[contractimpl]\nimpl Simple {\n    pub fn greet() -> u64 { 42 }\n}';

    const tracker = new StellarEvolutionTracker(source, 'simple.rs');
    const report = tracker.track();

    expect(report.versions.length).toBe(1);
    expect(report.versions[0].version).toBe('0.1.0');
    expect(report.snapshots.length).toBe(1);
  });

  it('determines complexity trend correctly', () => {
    const source = 'fn a() { if true { } } fn b() { }';
    const tracker = new StellarEvolutionTracker(source, 'test.rs');
    const report = tracker.track();

    expect(report.currentComplexity).toBeGreaterThan(0);
    expect(['increasing', 'stable', 'decreasing']).toContain(report.complexityTrend);
  });
});
