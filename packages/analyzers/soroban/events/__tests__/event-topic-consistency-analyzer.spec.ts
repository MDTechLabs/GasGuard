import { analyzeEventTopicConsistency } from '../event-topic-consistency-analyzer';

describe('Event Topic Consistency Analyzer (#916)', () => {
  const CONSISTENT = `
    pub fn transfer(env: Env, from: Address, to: Address) {
        env.events().publish((symbol_short!("transfer"), from), to);
    }
    pub fn refund(env: Env, from: Address, to: Address) {
        env.events().publish((symbol_short!("transfer"), from), to);
    }
  `;

  const INCONSISTENT_CASE = `
    pub fn transfer(env: Env, from: Address, to: Address) {
        env.events().publish((symbol_short!("transfer"), from), to);
    }
    pub fn refund(env: Env, from: Address, to: Address) {
        env.events().publish((symbol_short!("Transfer"), from), to);
    }
  `;

  const MIXED_CONVENTION = `
    pub fn a(env: Env, from: Address) {
        env.events().publish((symbol_short!("transfer_token"), from), from);
    }
    pub fn b(env: Env, from: Address) {
        env.events().publish((symbol_short!("transferToken"), from), from);
    }
  `;

  const SINGLE = `
    pub fn single(env: Env, from: Address) {
        env.events().publish((symbol_short!("transfer"), from), from);
    }
  `;

  test('extracts event topics per function', () => {
    const report = analyzeEventTopicConsistency(CONSISTENT);
    expect(report.topics).toHaveLength(2);
    expect(report.topics[0].name).toBe('transfer');
    expect(report.topics[0].functionName).toBe('transfer');
  });

  test('compares related events with case variants', () => {
    const report = analyzeEventTopicConsistency(INCONSISTENT_CASE);
    expect(report.findings.length).toBeGreaterThanOrEqual(1);
    expect(report.findings[0].message).toMatch(/Inconsistent event topic/);
  });

  test('detects inconsistent naming conventions', () => {
    const report = analyzeEventTopicConsistency(MIXED_CONVENTION);
    expect(report.findings.length).toBeGreaterThanOrEqual(1);
  });

  test('reports affected functions', () => {
    const report = analyzeEventTopicConsistency(INCONSISTENT_CASE);
    expect(report.findings[0].relatedFunctions).toContain('transfer');
    expect(report.findings[0].relatedFunctions).toContain('refund');
    expect(report.metrics.affectedFunctions).toBeGreaterThanOrEqual(1);
  });

  test('reports clean summary when topics are consistent', () => {
    const report = analyzeEventTopicConsistency(SINGLE);
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toMatch(/consistent/);
  });

  test('is deterministic', () => {
    const r1 = analyzeEventTopicConsistency(INCONSISTENT_CASE);
    const r2 = analyzeEventTopicConsistency(INCONSISTENT_CASE);
    expect(r1.findings.length).toBe(r2.findings.length);
  });
});
