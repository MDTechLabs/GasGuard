import { GasGuardReviewCommentGenerator, CodeReviewFinding } from '../comment-generator';

describe('GasGuardReviewCommentGenerator', () => {
  let generator: GasGuardReviewCommentGenerator;

  beforeEach(() => {
    generator = new GasGuardReviewCommentGenerator();
  });

  it('should generate formatted review comments with source location and recommendations', () => {
    const finding: CodeReviewFinding = {
      ruleId: 'SOROBAN-STOR-01',
      severity: 'high',
      message: 'Frequent storage write detected inside a loop.',
      recommendation: 'Batch state modifications outside the loop.',
      confidenceScore: 0.95,
      location: {
        contractPath: 'contracts/vault.rs',
        line: 42,
      },
    };

    const comment = generator.generateComment(finding);

    expect(comment.path).toBe('contracts/vault.rs');
    expect(comment.line).toBe(42);
    expect(comment.body).toContain('SOROBAN-STOR-01');
    expect(comment.body).toContain('Batch state modifications outside the loop.');
    expect(comment.body).toContain('Confidence: 95%');
  });
});