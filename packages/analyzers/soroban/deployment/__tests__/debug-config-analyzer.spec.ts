import { analyzeDebugConfig } from '../debug-config-analyzer';

const CARGO_WITH_DEV_AND_RELEASE = `
[package]
name = "cool-contract"
version = "0.1.0"

[profile.dev]
debug = true

[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
panic = "abort"
strip = "symbols"
debug = false
`;

const CARGO_WITH_DEBUG_RELEASE = `
[package]
name = "cool-contract"

[profile.release]
opt-level = 0
debug = true
panic = "unwind"
debug-assertions = true
`;

const CARGO_MINIMAL = `
[package]
name = "cool-contract"
`;

const CARGO_PRODUCTION = `
[package]
name = "cool-contract"

[profile.release]
opt-level = "s"
lto = true
panic = "abort"
strip = "symbols"
debug = false
`;

describe('SorobanDebugConfigAnalyzer (#928)', () => {
  it('flags a production context when [profile.release] is present', () => {
    const report = analyzeDebugConfig(CARGO_WITH_DEV_AND_RELEASE);
    expect(report.productionContext).toBe(true);
    expect(report.activeProfile).toBe('release');
  });

  it('does not flag an optimised release profile', () => {
    const report = analyzeDebugConfig(CARGO_PRODUCTION);
    const keys = report.findings.map((f) => f.key);
    expect(report.findings).toHaveLength(0);
    expect(keys).toEqual([]);
  });

  it('warns when [profile.release] is missing', () => {
    const report = analyzeDebugConfig(CARGO_MINIMAL);
    expect(report.productionContext).toBe(false);
    expect(report.findings.some((f) => f.key === 'profile.release')).toBe(true);
  });

  it('detects unoptimised debug settings in an explicit release profile', () => {
    const report = analyzeDebugConfig(CARGO_WITH_DEBUG_RELEASE);
    const keys = report.findings.map((f) => f.key);
    expect(keys).toContain('profile.release.opt-level');
    expect(keys).toContain('profile.release.debug');
    expect(keys).toContain('profile.release.panic');
    expect(keys).toContain('profile.release.debug-assertions');
    // opt-level = 0 and debug = true are high severity
    expect(
      report.findings
        .filter((f) => f.key === 'profile.release.opt-level' || f.key === 'profile.release.debug')
        .every((f) => f.severity === 'high'),
    ).toBe(true);
  });

  it('detects debug flags in .cargo/config.toml build section', () => {
    const config = `
[build]
debug = true
`;
    const report = analyzeDebugConfig(config);
    expect(report.findings.some((f) => f.key === 'build.debug')).toBe(true);
  });

  it('detects debug_assertions gated code in source', () => {
    const source = `
#[cfg(debug_assertions)]
fn debug_only_helper() { log("debug"); }
`;
    const report = analyzeDebugConfig('', source);
    expect(
      report.findings.some((f) => f.source === 'source' && f.title.includes('debug_assertions')),
    ).toBe(true);
  });
});