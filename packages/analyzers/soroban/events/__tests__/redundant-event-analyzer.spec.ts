import { analyzeRedundantEvents } from '../redundant-event-analyzer';

describe('Redundant Event Analyzer (#914)', () => {
  const DUPLICATE = `
    pub fn transfer(env: Env, from: Address, to: Address) {
        env.events().publish((symbol_short!("transfer"), from), to);
        env.events().publish((symbol_short!("transfer"), from), to);
    }
  `;

  const DISTINCT_PAYLOAD = `
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        env.events().publish((symbol_short!("transfer"), from), amount);
        env.events().publish((symbol_short!("transfer"), from), to);
    }
  `;

  const BRANCHED = `
    pub fn settle(env: Env, from: Address, to: Address) {
        if is_premium {
            env.events().publish((symbol_short!("transfer"), from), to);
        } else {
            env.events().publish((symbol_short!("transfer"), from), to);
        }
    }
  `;

  const LOOPED = `
    pub fn payout(env: Env, from: Address, to: Address) {
        for _ in 0..rounds {
            env.events().publish((symbol_short!("payout"), from), to);
        }
    }
  `;

  const CLEAN = `
    pub fn single(env: Env, from: Address, to: Address) {
        env.events().publish((symbol_short!("transfer"), from), to);
    }
  `;

  test('detects duplicate events with identical topics and payload', () => {
    const report = analyzeRedundantEvents(DUPLICATE);
    expect(report.emissions).toHaveLength(2);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].firstLine).toBeLessThan(report.findings[0].line);
    expect(report.findings[0].message).toMatch(/Duplicate event emission/);
  });

  test('does not flag emissions with different payloads', () => {
    const report = analyzeRedundantEvents(DISTINCT_PAYLOAD);
    expect(report.findings).toHaveLength(0);
  });

  test('does not flag duplicates on exclusive branches', () => {
    const report = analyzeRedundantEvents(BRANCHED);
    expect(report.findings).toHaveLength(0);
  });

  test('tracks emissions inside loops with loop flag', () => {
    const report = analyzeRedundantEvents(LOOPED);
    expect(report.emissions).toHaveLength(1);
    expect(report.emissions[0].inLoop).toBe(true);
  });

  test('generates safe consolidation suggestions', () => {
    const report = analyzeRedundantEvents(DUPLICATE);
    expect(report.findings[0].suggestion).toMatch(/Remove|Hoist/);
  });

  test('reports clean summary when no duplicates', () => {
    const report = analyzeRedundantEvents(CLEAN);
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toMatch(/No duplicate/);
  });

  test('is deterministic', () => {
    const r1 = analyzeRedundantEvents(DUPLICATE);
    const r2 = analyzeRedundantEvents(DUPLICATE);
    expect(r1.findings.length).toBe(r2.findings.length);
  });
});
