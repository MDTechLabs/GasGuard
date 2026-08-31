import {
  handleOptimizationPreview,
  OptimizationController,
} from '../../../src/api/optimization/optimization.controller';
import { previewOptimizations } from '../../../packages/autofix/soroban/optimization-preview';

const SOURCE = `
pub fn transfer(env: Env, to: Address, amount: i128) {
    self.require_auth();
    self.require_auth();
    self.require_auth();
    self.require_auth();
    for item in items.iter() {
        env.storage().persistent().set(&item, &amount);
    }
}
`;

describe('Optimization Preview API (#807)', () => {
  it('returns proposals with confidence, diff, and estimated impact', () => {
    const result = handleOptimizationPreview({ source: SOURCE });

    expect(result.count).toBeGreaterThan(0);
    expect(result.proposals.length).toBe(result.count);
    expect(result.sourceHash).toBeTruthy();
    expect(result.generatedAt).toBeTruthy();

    for (const p of result.proposals) {
      expect(p.confidence).toBeGreaterThanOrEqual(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
      expect(p.confidenceScore).toBe(p.confidence);
      expect(p.originalCode).toBeTruthy();
      expect(p.proposedCode).toBeTruthy();
      expect(p.diff.patch).toContain('---');
      expect(p.diff.filePath).toBeTruthy();
      expect(p.expectedResourceImpact).toEqual(
        expect.objectContaining({
          cpu: expect.any(Number),
          memory: expect.any(Number),
          ledger: expect.any(Number),
          fees: expect.any(Number),
          summary: expect.any(String),
        }),
      );
      expect(p.estimatedImpact).toEqual(p.expectedResourceImpact);
    }
  });

  it('supports filtering by minSeverity', () => {
    const all = handleOptimizationPreview({ source: SOURCE });
    const highOnly = handleOptimizationPreview({
      source: SOURCE,
      minSeverity: 'high',
    });
    expect(highOnly.count).toBeLessThanOrEqual(all.count);
    for (const p of highOnly.proposals) {
      expect(['critical', 'high']).toContain(p.severity);
    }
  });

  it('supports filtering by minConfidence', () => {
    const result = handleOptimizationPreview({
      source: SOURCE,
      minConfidence: 0.95,
    });
    for (const p of result.proposals) {
      expect(p.confidence).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('rejects missing source', () => {
    expect(() => handleOptimizationPreview({ source: '' } as any)).toThrow(
      /source/i,
    );
  });

  it('controller facade delegates to handler', () => {
    const ctrl = new OptimizationController();
    const result = ctrl.preview({ source: SOURCE, filePath: 'token.rs' });
    expect(result.count).toBeGreaterThanOrEqual(0);
    if (result.proposals[0]) {
      expect(result.proposals[0].diff.filePath).toBe('token.rs');
    }
  });

  it('previewOptimizations is pure (does not mutate input)', () => {
    const copy = SOURCE.slice();
    previewOptimizations(SOURCE, 'c.rs');
    expect(SOURCE).toBe(copy);
  });
});
