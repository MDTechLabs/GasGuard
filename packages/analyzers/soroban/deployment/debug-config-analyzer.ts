/**
 * Soroban Debug Configuration Analyzer
 *
 * Detects development-oriented build configuration that should not ship in a
 * production Soroban contract build. Debug builds produce larger, slower
 * artifacts that do not reflect production expectations: they retain debuginfo,
 * disable optimisations, unwind on panic, and often rely on debug assertions.
 *
 * The analyzer is lexically driven so it can run on raw `Cargo.toml`,
 * `.cargo/config.toml`, `project.toml` (invoke.soroban) and, optionally, the
 * contract Rust source. It reports each risky setting as a finding with a
 * severity and an actionable suggestion.
 */

export type DebugSeverity = 'high' | 'medium' | 'low' | 'info';

export interface DebugConfigFinding {
  ruleId: string;
  severity: DebugSeverity;
  title: string;
  /** Config file the finding was found in (e.g. `Cargo.toml`). */
  source: string;
  message: string;
  suggestion: string;
  line?: number;
  key?: string;
}

export interface DebugConfigOptions {
  /** Treat a missing `[profile.release]` block as a warning (default true). */
  requireProductionProfile?: boolean;
  /** Treat `panic = "unwind"` in a production build as a warning (default true). */
  warnOnUnwind?: boolean;
}

export interface DebugConfigReport {
  findings: DebugConfigFinding[];
  /** True when the current configuration is a release/production build context. */
  productionContext: boolean;
  /** Configuration profile currently active, best effort. */
  activeProfile: string;
}

interface CargoSection {
  lines: number[];
  values: Map<string, { value: string; line: number }>;
}

/** Which file the finding originates from. */
type ConfigFile = 'Cargo.toml' | '.cargo/config.toml' | 'project.toml' | 'source';

/** Extremely tolerant line-oriented TOML section bucketter. */
function bucketSections(content: string): Map<string, CargoSection> {
  const sections = new Map<string, CargoSection>();
  let current = '';

  const ensure = (name: string) => {
    if (!sections.has(name)) {
      sections.set(name, { lines: [], values: new Map() });
    }
    return sections.get(name)!;
  };

  const lines = content.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (line.startsWith('#')) return;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = header[1];
      ensure(current);
      return;
    }
    const kv = /^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (kv && current) {
      const section = ensure(current);
      section.lines.push(idx + 1);
      section.values.set(kv[1], { value: kv[2], line: idx + 1 });
    } else if (kv) {
      // Key-value outside any section (e.g. `project.toml`: network = "testnet")
      const section = ensure('__root');
      section.lines.push(idx + 1);
      section.values.set(kv[1], { value: kv[2], line: idx + 1 });
    }
  });

  return sections;
}

function lineOffset(content: string, needle: string): number | undefined {
  const lines = content.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.includes(needle));
  return idx === -1 ? undefined : idx + 1;
}

function boolValue(raw: string): boolean | undefined {
  const v = raw.replace(/["']/g, '').toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

function pushSectionFinding(
  findings: DebugConfigFinding[],
  sections: Map<string, CargoSection>,
  section: string,
  key: string,
  file: ConfigFile,
  title: string,
  message: string,
  suggestion: string,
  severity: DebugSeverity,
): void {
  const sec = sections.get(section);
  const info = sec?.values.get(key);
  findings.push({
    ruleId: 'soroban-debug-config',
    severity,
    title,
    source: file,
    message,
    suggestion,
    line: info?.line ?? sec?.lines[0],
    key: `${section}.${key}`,
  });
}

/**
 * Scan configuration sources for debug-oriented build settings.
 *
 * @param configuration The concatenated build configuration text: the
 *   `Cargo.toml` and/or `.cargo/config.toml` (`project.toml` sections are also
 *   understood because Soroban invoke config is TOML).
 * @param source An optional Rust contract source used to detect
 *   `#[cfg(debug_assertions)]` gates that should not reach production.
 */
export function analyzeDebugConfig(
  configuration: string,
  source?: string,
  options?: DebugConfigOptions,
): DebugConfigReport {
  const findings: DebugConfigFinding[] = [];
  const opts = {
    requireProductionProfile: options?.requireProductionProfile ?? true,
    warnOnUnwind: options?.warnOnUnwind ?? true,
  };

  const sections = bucketSections(configuration);

  // --- [profile.dev] / debug = true -------------------------------------------------
  const devProfile = sections.get('profile.dev');
  if (devProfile) {
    findings.push({
      ruleId: 'soroban-debug-config',
      severity: devProfile.values.has('inherits') ? 'low' : 'medium',
      title: 'Development profile present in Cargo.toml',
      source: 'Cargo.toml',
      message:
        'A `[profile.dev]` block was detected. Development builds are unoptimised and unsuitable for production contract deployment.',
      suggestion:
        'Ensure release builds are used for deployment (`cargo build --release` / `soroban contract build --release`).',
      line: devProfile.lines[0],
      key: 'profile.dev',
    });
  }

  const devDebug = devProfile?.values.get('debug');
  if (devDebug && boolValue(devDebug.value) !== false) {
    pushSectionFinding(
      findings,
      sections,
      'profile.dev',
      'debug',
      'Cargo.toml',
      'Debug info enabled for dev profile',
      `Dev profile keeps debuginfo (debug = ${devDebug.value}).`,
      'Disable for release: use `debug = "line-tables-only"` or remove in favour of minimal release debuginfo.',
      'low',
    );
  }

  // --- [profile.release] must exist for production context --------------------------
  const releaseProfile = sections.get('profile.release');
  const productionContext = Boolean(releaseProfile);

  if (!releaseProfile && opts.requireProductionProfile) {
    findings.push({
      ruleId: 'soroban-debug-config',
      severity: 'medium',
      title: 'Missing production release profile',
      source: 'Cargo.toml',
      message:
        'No `[profile.release]` block was found, so release builds fall back to Cargo defaults which may retain debuginfo and suboptimal settings.',
      suggestion:
        'Add a `[profile.release]` block with `opt-level = "s"`, `lto = true`, `codegen-units = 1`, `panic = "abort"`, `strip = "symbols"` and `debug = false`.',
      key: 'profile.release',
    });
  }

  if (releaseProfile) {
    // opt-level
    const opt = releaseProfile.values.get('opt-level');
    if (opt && /^["']?0["']?/.test(opt.value)) {
      pushSectionFinding(
        findings,
        sections,
        'profile.release',
        'opt-level',
        'Cargo.toml',
        'Release optimisations disabled',
        `Release profile sets opt-level = ${opt.value}, producing an unoptimised artifact.`,
        'Use `opt-level = "s"` (smallest) or `opt-level = "z"` for near-identical size to "s" with maximum speed, e.g. `opt-level = "s"`.',
        'high',
      );
    }
    // debug
    const debug = releaseProfile.values.get('debug');
    if (debug && boolValue(debug.value)) {
      pushSectionFinding(
        findings,
        sections,
        'profile.release',
        'debug',
        'Cargo.toml',
        'Debug info retained in release build',
        `Release profile sets debug = ${debug.value}, retaining full debuginfo in the deployed contract.`,
        'Set `debug = false` (or `strip = "symbols"`) to reduce artifact size and hide internals.',
        'high',
      );
    }
    // strip
    const strip = releaseProfile.values.get('strip');
    if (strip && /none/i.test(strip.value)) {
      pushSectionFinding(
        findings,
        sections,
        'profile.release',
        'strip',
        'Cargo.toml',
        'Symbols not stripped in release build',
        `Release profile sets strip = ${strip.value}, shipping a larger artifact.`,
        'Set `strip = "symbols"` or `strip = "debuginfo"` to drop symbol/debug tables.',
        'medium',
      );
    }
    // panic unwind
    if (opts.warnOnUnwind) {
      const panic = releaseProfile.values.get('panic');
      if (panic && /unwind/i.test(panic.value)) {
        pushSectionFinding(
          findings,
          sections,
          'profile.release',
          'panic',
          'Cargo.toml',
          'Panic strategy set to unwind',
          `Release profile uses panic = ${panic.value}; unwinding inflates code size and reduces determinism.`,
          'Use `panic = "abort"` for smaller, more deterministic Soroban binaries.',
          'medium',
        );
      }
    }
    // debug-assertions
    const da = releaseProfile.values.get('debug-assertions');
    if (da && boolValue(da.value)) {
      pushSectionFinding(
        findings,
        sections,
        'profile.release',
        'debug-assertions',
        'Cargo.toml',
        'Debug assertions enabled in release build',
        `Release profile sets debug-assertions = ${da.value}, keeping runtime checks that are absent from production expectations.`,
        'Remove `debug-assertions = true` or set it to `false` for release.',
        'medium',
      );
    }
  }

  // --- .cargo/config.toml ------------------------------------------------------------
  const buildSection = sections.get('build');
  const buildDebug = buildSection?.values.get('debug');
  if (buildDebug && boolValue(buildDebug.value)) {
    pushSectionFinding(
      findings,
      sections,
      'build',
      'debug',
      '.cargo/config.toml',
      'Build-level debug flag enabled',
      `The build configuration sets debug = ${buildDebug.value}, forcing debug builds for every invocation.`,
      'Remove the `[build] debug = true` flag or force `--release` for deployments.',
      'high',
    );
  }
  const rustflags = buildSection?.values.get('rustflags');
  if (rustflags && /debuginfo\s*=\s*2|-C\s+debuginfo=2|debug-assertions/.test(rustflags.value)) {
    pushSectionFinding(
      findings,
      sections,
      'build',
      'rustflags',
      '.cargo/config.toml',
      'Debug RUSTFLAGS present in build config',
      `RUSTFLAGS ${rustflags.value} enable debuginfo/debug assertions at build time.`,
      'Remove the debug flags from rustflags for production builds.',
      'high',
    );
  }

  // --- .cargo/config alias for `soroban contract build` without --release ------------
  const alias = sections.get('alias');
  const sorobanBuild = alias?.values.get('soroban-contract-build') ?? alias?.values.get('sb');
  if (sorobanBuild && /build/.test(sorobanBuild.value) && !/--release/.test(sorobanBuild.value)) {
    pushSectionFinding(
      findings,
      sections,
      'alias',
      'soroban-contract-build',
      '.cargo/config.toml',
      'Contract build alias omits --release',
      `The 'soroban contract build' alias (${sorobanBuild.value}) does not pass --release.`,
      'Append `--release` to the build alias so deployments compile optimised artifacts.',
      'medium',
    );
  }

  // --- project.toml (invoke.soroban / soroban config): non-mainnet networks ----------
  const rootSection = sections.get('__root') ?? sections.get('project.network');
  const networkRaw =
    (rootSection?.values.get('network')?.value ?? '') as string | undefined;
  const network = networkRaw?.replace(/["']/g, '').toLowerCase(); // eslint-disable-line @typescript-eslint/no-unused-vars
  if (network && network !== 'mainnet' && network !== 'pubnet') {
    findings.push({
      ruleId: 'soroban-debug-config',
      severity: 'info',
      title: 'Deployment targets a non-mainnet network',
      source: 'project.toml',
      message: `Project configuration targets the '${network}' network, which is development/test oriented.`,
      suggestion: 'Confirm testnet/standalone usage is intentional; deployments to mainnet must use the mainnet invoke config.',
      key: 'network',
    });
  }

  // --- Rust source debug assertions --------------------------------------------------
  if (source) {
    const linesToCheck = source.split(/\r?\n/);
    linesToCheck.forEach((raw, idx) => {
      if (/#\[cfg\(\s*debug_assertions\s*\)\]/.test(raw)) {
        findings.push({
          ruleId: 'soroban-debug-config',
          severity: 'medium',
          title: 'Debug-only code gated on debug_assertions',
          source: 'source',
          message:
            'Contract source contains `#[cfg(debug_assertions)]` code that will remain active in debug builds and could behave differently from production.',
          suggestion:
            'Move debug-only helpers behind a feature flag (e.g. `feature = "test_utils"`) so release builds are deterministic.',
          line: idx + 1,
        });
      }
    });
  }

  return {
    findings: findings.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity)),
    productionContext,
    activeProfile: releaseProfile ? 'release' : devProfile ? 'dev' : 'unknown',
  };
}

/**
 * Convenience wrapper focused on a full production-context summary.
 */
export function detectDebugConfiguration(
  configuration: string,
  source?: string,
  options?: DebugConfigOptions,
): DebugConfigReport {
  return analyzeDebugConfig(configuration, source, options);
}