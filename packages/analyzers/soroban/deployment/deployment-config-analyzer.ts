/**
 * Issue #927 — Soroban Deployment Configuration Analyzer
 *
 * Parses Soroban deployment configuration (invoke.soroban / project.toml /
 * deploy config), validates that the settings it declares are supported and
 * well-formed, and reports both unknown/invalid settings and configuration
 * that is required for a correct deployment but missing.
 *
 * Incorrect deployment settings can produce inefficient or unreliable
 * contract releases — a contract deployed against the wrong network, without
 * an RPC endpoint, or without an owner that any future upgrade checks — so
 * this analyzer flags them at configuration time rather than at deploy time.
 */

export type DeploymentSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface DeploymentConfigSetting {
  key: string;
  value: string;
  section: string;
  line: number;
}

export interface DeploymentConfigFinding {
  ruleId: string;
  severity: DeploymentSeverity;
  title: string;
  /** Config source the finding relates to (e.g. `invoke.soroban`). */
  source: string;
  key?: string;
  message: string;
  suggestion: string;
  line?: number;
}

export interface DeploymentConfigReport {
  findings: DeploymentConfigFinding[];
  /** Parsed key/value settings, in file order. */
  parsedSettings: DeploymentConfigSetting[];
  network?: string;
  rpcUrl?: string;
  owner?: string;
  /** Required keys that were not present in the configuration. */
  missingRequired: string[];
  /** True when no critical or high-severity finding was raised. */
  valid: boolean;
}

/** Networks a Soroban deployment may legitimately target. */
const KNOWN_NETWORKS = new Set([
  'mainnet',
  'public',
  'pubnet',
  'testnet',
  'futurenet',
  'standalone',
  'local',
  'development',
]);

const PRODUCTION_NETWORKS = new Set(['mainnet', 'public', 'pubnet']);

/** Deployment settings this analyzer understands, per canonical key. */
const SUPPORTED_KEYS = new Set([
  'network',
  'rpc_url',
  'rpc',
  'horizon_url',
  'owner',
  'admin',
  'account',
  'source',
  'deployer',
  'secret_key',
  'wasm',
  'wasm_hash',
  'contract',
  'contract_id',
  'salt',
  'fee',
  'max_fee',
  'fee_rate',
  'fee_percentage',
  'timeout',
]);

/** Keys that must resolve to a number. */
const NUMERIC_KEYS = new Set(['fee', 'max_fee', 'fee_rate', 'fee_percentage', 'timeout']);

/** Keys that must resolve to an HTTP(S) URL. */
const URL_KEYS = new Set(['rpc_url', 'rpc', 'horizon_url']);

const STELLAR_PUBKEY = /^[A-Z2-7]{56}$/;

interface TomlBucket {
  lines: number[];
  values: Map<string, { value: string; line: number }>;
}

/** Extremely tolerant line-oriented TOML bucketter for deployment config. */
function bucketSections(content: string): {
  sections: Map<string, TomlBucket>;
  root: TomlBucket;
} {
  const sections = new Map<string, TomlBucket>();
  const root: TomlBucket = { lines: [], values: new Map() };
  let current: string | null = null;

  const ensure = (name: string): TomlBucket => {
    if (!sections.has(name)) {
      sections.set(name, { lines: [], values: new Map() });
    }
    return sections.get(name)!;
  };

  content.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (line.startsWith('#')) return;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = header[1];
      ensure(current);
      return;
    }
    const kv = /^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) return;
    const entry = { value: kv[2].trim(), line: idx + 1 };
    if (current) {
      const sec = ensure(current);
      sec.lines.push(idx + 1);
      sec.values.set(kv[1], entry);
    } else {
      root.lines.push(idx + 1);
      root.values.set(kv[1], entry);
    }
  });

  return { sections, root };
}

function valueOf(values: Map<string, { value: string; line: number }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of values) {
    out.set(k, stripQuotes(v.value));
  }
  return out;
}

function stripQuotes(raw: string): string {
  const s = raw.trim();
  const m = s.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (m) return m[1];
  return s;
}

/**
 * Parse deployment configuration and validate its settings.
 *
 * @param configuration Deployment config text (invoke.soroban, project.toml,
 *   or a deploy config fragment). May contain `[section]` blocks or a flat set
 *   of root-level keys.
 * @param source A human-readable label for the config source, used in findings.
 */
export function analyzeDeploymentConfig(
  configuration: string,
  source = 'invoke.soroban',
): DeploymentConfigReport {
  const { sections, root } = bucketSections(configuration);
  const settings: DeploymentConfigSetting[] = [];
  const findings: DeploymentConfigFinding[] = [];
  const missing: string[] = [];

  // Merge root keys with the most common deployment sections, preferring
  // section-scoped values over root duplicates.
  const merged = new Map<string, { value: string; section: string; line: number }>();
  const mergeInto = (values: Map<string, { value: string; line: number }>, section: string) => {
    const normalized = valueOf(values);
    for (const [key, value] of normalized) {
      merged.set(key, { value, section, line: values.get(key)!.line });
      settings.push({ key, value, section, line: values.get(key)!.line });
    }
  };

  mergeInto(root.values, '__root');
  for (const [name, bucket] of sections) {
    mergeInto(bucket.values, name);
  }

  const warnUnknown = (key: string, value: string, line?: number) => {
    findings.push({
      ruleId: 'soroban-deployment-config',
      severity: 'low',
      title: 'Unsupported deployment setting',
      source,
      key,
      line,
      message:
        `Deployment configuration contains '${key}' = '${value}', which is not a ` +
        `recognized deployment setting. It may be a typo or an unsupported option that ` +
        `will be silently ignored.`,
      suggestion:
        `Remove '${key}' or rename it to a supported key (${[...SUPPORTED_KEYS].join(', ')}).`,
    });
  };

  const pushMissing = (key: string, severity: DeploymentSeverity, why: string, suggestion: string) => {
    missing.push(key);
    findings.push({
      ruleId: 'soroban-deployment-config',
      severity,
      title: `Missing deployment configuration: ${key}`,
      source,
      key,
      message: `Deployment configuration does not declare '${key}'. ${why}`,
      suggestion,
    });
  };

  const pushInvalid = (
    key: string,
    value: string,
    severity: DeploymentSeverity,
    why: string,
    line?: number,
  ) => {
    findings.push({
      ruleId: 'soroban-deployment-config',
      severity,
      title: `Invalid deployment setting: ${key}`,
      source,
      key,
      line,
      message: `Deployment setting '${key}' = '${value}' is invalid. ${why}`,
      suggestion: `Set '${key}' to a supported, well-formed value before deploying.`,
    });
  };

  // Feed the merged settings through the supported/validation gates.
  for (const [key, { value, line }] of merged) {
    if (!SUPPORTED_KEYS.has(key)) {
      warnUnknown(key, value, line);
      continue;
    }
    if (NUMERIC_KEYS.has(key)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        pushInvalid(key, value, 'medium', `expected a non-negative number, got '${value}'.`, line);
      }
      continue;
    }
    if (URL_KEYS.has(key)) {
      if (!/^https?:\/\//i.test(value)) {
        pushInvalid(key, value, 'high', `expected an http(s) URL, got '${value}'.`, line);
      }
    }
  }

  // Resolve the canonical read-mostly values.
  const pick = (keys: string[]): string | undefined => {
    for (const k of keys) {
      if (merged.has(k)) return merged.get(k)!.value;
    }
    return undefined;
  };
  const pickEntry = (keys: string[]): { key: string; value: string; line: number } | undefined => {
    for (const k of keys) {
      if (merged.has(k)) return { key: k, ...merged.get(k)! };
    }
    return undefined;
  };
  const network = stripQuotes(pick(['network']) ?? '');
  const rpcUrl = pick(['rpc_url', 'rpc']);
  const ownerEntry = pickEntry(['owner', 'admin', 'account', 'source', 'deployer']);
  const owner = ownerEntry?.value;
  const wasmHash = pick(['wasm_hash', 'wasm', 'contract', 'contract_id']);

  const productionTarget = network ? PRODUCTION_NETWORKS.has(network.toLowerCase()) : false;

  // Missing-required detection.
  if (!network) {
    pushMissing(
      'network',
      'critical',
      'Without a target network the deployment may end up on the wrong network.',
      `Set 'network' to one of: ${[...KNOWN_NETWORKS].join(', ')}.`,
    );
  } else if (!KNOWN_NETWORKS.has(network.toLowerCase())) {
    pushInvalid(
      'network',
      network,
      'high',
      `expected one of ${[...KNOWN_NETWORKS].join(', ')}, got '${network}'.`,
      merged.get('network')!.line,
    );
  }

  if (!rpcUrl) {
    pushMissing(
      'rpc_url',
      productionTarget ? 'critical' : 'medium',
      productionTarget
        ? 'Production deployments without a pinned RPC endpoint cannot be verified or reproduced reliably.'
        : 'A fallback/default RPC endpoint may be used, which is not reproducible.',
      `Set 'rpc_url' to the network's RPC endpoint, e.g. https://rpc.stellar.org.`,
    );
  }

  if (!owner) {
    pushMissing(
      'owner',
      productionTarget ? 'high' : 'low',
      productionTarget
        ? 'No deploy owner/source account is declared, so post-deployment upgrades are unanchored.'
        : 'No deploy owner/source account is declared.',
      `Set 'owner' (or 'admin'/'account'/'source') to the deploying Stellar public key.`,
    );
  } else {
    const m = owner.trim().match(/^[GACST][0-9A-Z]{55}$/);
    if (!m && ownerEntry) {
      findings.push({
        ruleId: 'soroban-deployment-config',
        severity: 'medium',
        title: 'Owner does not look like a Stellar public key',
        source,
        key: ownerEntry.key,
        line: ownerEntry.line,
        message:
          `Deployment owner '${owner}' is not a 56-character Stellar public key (G/C/S...).`,
        suggestion:
          'Use the deploying account public key (starts with G for the account address, or C for a contract address).',
      });
    }
  }

  if (!wasmHash) {
    findings.push({
      ruleId: 'soroban-deployment-config',
      severity: 'info',
      title: 'No deploy artifact specified',
      source,
      key: 'wasm',
      message:
        'No build artifact (wasm/wasm_hash/contract_id) is declared, so this configuration cannot pin which contract is deployed.',
      suggestion:
        "Declare 'wasm' (path to the built .wasm, e.g. target/wasm32-unknown-unknown/release/contract.wasm) or 'wasm_hash' for a reproducible, pinned deployment.",
    });
  }

  const criticalFindings = findings.filter((f) => f.severity === 'critical' || f.severity === 'high');

  return {
    findings: findings.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity)),
    parsedSettings: settings,
    network: network || undefined,
    rpcUrl,
    owner,
    missingRequired: missing,
    valid: criticalFindings.length === 0,
  };
}

/**
 * Convenience wrapper that reports only the findings.
 */
export function detectDeploymentConfigFindings(
  configuration: string,
  source?: string,
): DeploymentConfigFinding[] {
  return analyzeDeploymentConfig(configuration, source).findings;
}