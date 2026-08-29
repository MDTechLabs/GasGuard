import {
  SorobanAutoFixEngine,
  cacheRepeatedCallProvider,
  unusedStateVariableProvider,
  type FixRequest,
} from '../safe-auto-fix';

const SOURCE = [
  '#[contract]',
  'pub struct Counter;',
  '#[contractimpl]',
  'impl Counter {',
  '    pub fn add(env: Env, x: u64) -> u64 {',
  '        unused: u64,',
  '        x + 1',
  '    }',
  '}',
].join('\n');

function req(partial: Partial<FixRequest>): FixRequest {
  return {
    ruleId: 'soroban-unused-state-variables',
    line: 6,
    originalLine: SOURCE.split('\n')[5],
    confidence: 0.8,
    ...partial,
  };
}

describe('SorobanAutoFixEngine (#790)', () => {
  it('registers providers keyed by rule id', () => {
    const engine = new SorobanAutoFixEngine();
    engine.registerProvider(unusedStateVariableProvider);
    expect(engine.getProvider('soroban-unused-state-variables')).toBe(unusedStateVariableProvider);
    expect(engine.getProvider('soroban-unused-state-variables').ruleIds.length).toBeGreaterThan(0);
  });

  it('returns no-op provider for unregistered rules', () => {
    const engine = new SorobanAutoFixEngine();
    expect(engine.getProvider('nope').isApplicable('x', undefined)).toBe(false);
  });

  it('applies an applicable fix', () => {
    const engine = new SorobanAutoFixEngine();
    engine.registerProvider(unusedStateVariableProvider);
    engine.setMinConfidence(0.5);
    const plan = engine.planFixes(SOURCE, [req({})]);
    expect(plan.applied).toHaveLength(1);
    expect(plan.applied[0]!.replacementLine).toContain('GasGuard auto-fix');
    expect(plan.previews).toHaveLength(1);
  });

  it('skips fixes below the confidence threshold', () => {
    const engine = new SorobanAutoFixEngine();
    engine.registerProvider(unusedStateVariableProvider);
    const plan = engine.planFixes(SOURCE, [req({ confidence: 0.2 })], { confidenceThreshold: 0.7 });
    expect(plan.applied).toHaveLength(0);
    expect(plan.skipped.some((s) => s.reason.includes('threshold'))).toBe(true);
  });

  it('supports dry-run mode producing previews without applying', () => {
    const engine = new SorobanAutoFixEngine();
    engine.registerProvider(unusedStateVariableProvider);
    const plan = engine.planFixes(SOURCE, [req({})], { dryRun: true });
    expect(plan.dryRun).toBe(true);
    expect(plan.applied).toHaveLength(0);
    expect(plan.previews).toHaveLength(1);
  });

  it('builds a unified diff in previews', () => {
    const engine = new SorobanAutoFixEngine();
    engine.registerProvider(unusedStateVariableProvider);
    const plan = engine.planFixes(SOURCE, [req({})], { dryRun: true });
    const preview = plan.previews[0]!;
    expect(preview.diff).toContain('--- a/contract.rs');
    expect(preview.diff).toContain('+++ b/contract.rs');
    expect(preview.diff).toContain('@@ -6,1 +6,1 @@'.replace('-6,1', '-6,1'));
  });

  it('skips lines without an applicable provider', () => {
    const engine = new SorobanAutoFixEngine();
    engine.registerProvider(unusedStateVariableProvider);
    // Line already commented out => inapplicable
    const commented = SOURCE.replace('        unused: u64,', '        // unused: u64,');
    const plan = engine.planFixes(commented, [req({ line: 6 })]);
    expect(plan.applied).toHaveLength(0);
  });

  it('handles the cache-repeated-call provider', () => {
    const engine = new SorobanAutoFixEngine();
    engine.registerProvider(cacheRepeatedCallProvider);
    engine.setMinConfidence(0.5);
    const callsReq: FixRequest = {
      ruleId: 'soroban-call-frequency',
      line: 2,
      originalLine: '        let bal = self.balance_of(to.clone());',
      confidence: 0.8,
    };
    const source = ['fn x() {', '        let bal = self.balance_of(to.clone());', '}'].join('\n');
    const plan = engine.planFixes(source, [callsReq]);
    expect(plan.applied).toHaveLength(1);
    expect(plan.applied[0]!.replacementLine).toContain('consider caching');
  });
});