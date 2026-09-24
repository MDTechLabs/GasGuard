import {
  detectMissingTtlExtensions,
  MissingTtlExtensionRule,
} from '../ttl/missing-ttl-extension.rule';
import {
  detectExcessiveTtlExtensions,
  ExcessiveTtlExtensionRule,
} from '../ttl/excessive-ttl-extension.rule';

const CONTRACT = `
pub fn write_config(env: Env, value: u32) {
    env.storage().persistent().set(&DataKey::Config, &value);
}

pub fn bump_config(env: Env) {
    env.storage().persistent().extend_ttl(&DataKey::Config, 100, 200);
}

pub fn write_user(env: Env, user: Address, score: u64) {
    env.storage().temporary().set(&user, &score);
}

pub fn write_session(env: Env, session: Symbol, payload: Bytes) {
    env.storage().persistent().set(&session, &payload);
}

pub fn double_extend(env: Env, user: Address) {
    env.storage().persistent().extend_ttl(&user, 100, 200);
    env.storage().persistent().extend_ttl(&user, 100, 200);
}

pub fn looped_extend(env: Env, users: Vec<Address>) {
    for user in users.iter() {
        env.storage().persistent().extend_ttl(&user, 100, 300);
    }
}
`;

describe('Soroban TTL rules (#886, #887)', () => {
  const missingRule = new MissingTtlExtensionRule();
  const excessiveRule = new ExcessiveTtlExtensionRule();

  it('flags persistent entries written but never TTL-extended (#886)', () => {
    const report = missingRuleReport(CONTRACT);
    expect(report.findings.length).toBeGreaterThanOrEqual(1);

    const keys = report.findings.map((f) => f.key);
    expect(keys).toContain('session');
    // DataKey::Config receives an extension in `bump_config` — not flagged.
    expect(keys).not.toContain('DataKey::Config');
    expect(report.summary).toMatch(/without any TTL extension/i);
  });

  it('excludes intentionally temporary state (#886)', () => {
    const report = missingRuleReport(CONTRACT);
    // `user` is written via env.storage().temporary() — must not be flagged.
    for (const finding of report.findings) {
      expect(finding.key).not.toBe('user');
    }
    expect(report.metrics.temporaryEntriesExcluded).toBe(1);
  });

  it('does not flag entries that do receive an extension (#886)', () => {
    const report = missingRuleReport(`
pub fn touch(env: Env) {
    env.storage().persistent().set(&DataKey::A, &1u32);
    env.storage().persistent().extend_ttl(&DataKey::A, 100, 200);
}
`);
    expect(report.findings).toHaveLength(0);
    expect(report.metrics.extendedEntries).toBe(1);
  });

  it('reports extended + unextended counts in metrics (#886)', () => {
    const report = missingRuleReport(CONTRACT);
    expect(report.metrics.persistentEntries).toBeGreaterThanOrEqual(3);
    expect(report.metrics.extendedEntries).toBeGreaterThanOrEqual(2);
    expect(report.metrics.unextendedEntries).toBeGreaterThanOrEqual(1);
  });

  it('detects repeated extensions of the same key in one function (#887)', () => {
    const report = excessiveRuleReport(CONTRACT);
    const repeated = report.findings.filter((f) => f.kind === 'repeated_in_function');
    expect(repeated.length).toBeGreaterThanOrEqual(1);
    expect(repeated.some((f) => f.key === 'user' && f.functionName === 'double_extend')).toBe(
      true,
    );
  });

  it('identifies redundant extensions with identical arguments (#887)', () => {
    const report = excessiveRuleReport(CONTRACT);
    const redundant = report.findings.filter((f) => f.kind === 'redundant_same_args');
    expect(redundant.length).toBeGreaterThanOrEqual(1);
    expect(redundant[0].message).toMatch(/Redundant extend_ttl/i);
  });

  it('flags extend_ttl executed inside loops (#887)', () => {
    const report = excessiveRuleReport(CONTRACT);
    const looped = report.findings.filter((f) => f.kind === 'extension_in_loop');
    expect(looped.length).toBeGreaterThanOrEqual(1);
    expect(looped[0].message).toMatch(/inside a loop/i);
    expect(report.metrics.extensionsInLoops).toBeGreaterThanOrEqual(1);
  });

  it('is clean for well-formed contracts (#887)', () => {
    const report = excessiveRuleReport(`
pub fn healthy(env: Env) {
    env.storage().persistent().set(&DataKey::X, &1u32);
    env.storage().persistent().extend_ttl(&DataKey::X, 100, 200);
}
`);
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toMatch(/No excessive/i);
  });

  it('exposes rule ids through the rule classes', () => {
    expect(new MissingTtlExtensionRule().evaluate(CONTRACT).ruleId).toBe(
      'soroban-missing-ttl-extension',
    );
    expect(new ExcessiveTtlExtensionRule().evaluate(CONTRACT).ruleId).toBe(
      'soroban-excessive-ttl-extension',
    );
  });
});

function missingRuleReport(src: string) {
  return detectMissingTtlExtensions(src);
}

function excessiveRuleReport(src: string) {
  return detectExcessiveTtlExtensions(src);
}
