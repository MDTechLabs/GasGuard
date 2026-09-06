/**
 * Issue #924 — Soroban Upgradeability Analyzer
 *
 * Detects upgrade-related mechanisms in Soroban (Rust) contracts and reports
 * the entry points through which contract behaviour can be replaced, together
 * with whether each entry point is protected by an authorization check.
 *
 * Uncontrolled upgrades let an actor swap the deployed behaviour for a
 * malicious or unintended implementation, which is a governance and security
 * risk. This analyzer is lexical (no AST): comments and string literals are
 * masked out via `common/source-utils` before the upgrade markers are matched.
 */

import {
  maskNonCode,
  createLineResolver,
  extractFunctions,
} from '../common/source-utils';

export type UpgradeSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type UpgradeMechanism =
  | 'wasm-replacement'
  | 'implementation-swap'
  | 'deployer'
  | 'migration'
  | 'version-switch';

/** A single place where an upgrade can be triggered from the contract code. */
export interface UpgradeEntryPoint {
  mechanism: UpgradeMechanism;
  /** Function that contains the upgrade trigger. */
  functionName: string;
  /** 1-based line of the `fn` keyword. */
  line: number;
  /** The matched trigger call/expression. */
  call: string;
  /** True when the enclosing function body contains an authorization check. */
  hasAuthorization: boolean;
  /** The authorization primitive detected, when present. */
  authorizedBy?: string;
}

export interface UpgradeabilityFinding {
  ruleId: string;
  severity: UpgradeSeverity;
  title: string;
  functionName: string;
  mechanism: UpgradeMechanism;
  message: string;
  suggestion: string;
  line?: number;
}

export interface UpgradeabilityReport {
  findings: UpgradeabilityFinding[];
  upgradeMechanisms: UpgradeMechanism[];
  entryPoints: UpgradeEntryPoint[];
  hasUpgradeablePaths: boolean;
}

interface MechanismMarker {
  mechanism: UpgradeMechanism;
  call: string;
  re: RegExp;
}

/** Upgrade trigger markers matched inside function bodies. */
const MECHANISM_MARKERS: MechanismMarker[] = [
  {
    mechanism: 'wasm-replacement',
    call: 'env.update_current_contract_wasm(...)',
    re: /update_current_contract_wasm\s*\(|update_current_contract_wasm_from_contract\s*\(|set_current_wasm\s*\(/,
  },
  {
    mechanism: 'wasm-replacement',
    call: '.set_code(...) / .set_wasm(...) / set_wasm_hash(...)',
    re: /\.set_code\s*\(|\.set_wasm\s*\(|set_wasm_hash\s*\(/,
  },
  {
    mechanism: 'implementation-swap',
    call: 'set_implementation(...)',
    re: /\bset_implementation\s*\(|set_impl\s*\(|set_target\s*\(/,
  },
  {
    mechanism: 'deployer',
    call: 'env.deployer().deploy_contract(...)',
    re: /deployer\s*\(\s*\)\s*\.\s*deploy_contract\s*\(|Deployer\s*::\s*new\s*\(|soroban_sdk\s*::\s*deploy|env\s*\.\s*deployer\s*\(/,
  },
  {
    mechanism: 'version-switch',
    call: 'version_switch(...) / forward(...)',
    re: /\bversion_switch\s*\(|\bforward\s*\(|\bset_version\s*\(/,
  },
  {
    mechanism: 'migration',
    call: 'migrate(...)',
    re: /\bmigrate\s*\(|\bmigration\s*\(/,
  },
];

interface AuthPattern {
  name: string;
  re: RegExp;
}

/** Authorization primitives recognised as protecting an upgrade entry point. */
const AUTH_PATTERNS: AuthPattern[] = [
  { name: 'require_auth', re: /\brequire_auth\s*\(/ },
  { name: 'require_auth_for_args', re: /require_auth_for_args\s*\(/ },
  { name: 'admin/owner/controller.require_auth', re: /\b(admin|owner|admin_owner|governor|controller|keeper)\s*\.\s*require_auth\s*\(/ },
  { name: 'only_admin/assert_admin', re: /\bonly_admin\s*\(|assert_admin\s*\(|check_admin\s*\(|ensure_admin\s*\(/ },
];

/** Convenience function names that are commonly attached to upgrade entry points. */
const UPGRADE_FN_HINTS =
  /\b(upgrade|update_wasm|set_wasm|set_code|set_implementation|migrate|release|update_contract|refresh_contract|redeploy|replace_contract)\b/i;

function findAuthorization(body: string): { has: boolean; by?: string } {
  for (const auth of AUTH_PATTERNS) {
    if (auth.re.test(body)) {
      return { has: true, by: auth.name };
    }
  }
  return { has: false };
}

/**
 * Detect the upgrade mechanisms reachable from each function in a Soroban
 * source file.
 */
export function detectUpgradeMechanisms(source: string): UpgradeEntryPoint[] {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);
  const entryPoints: UpgradeEntryPoint[] = [];

  for (const fn of functions) {
    const body = masked.slice(fn.bodyStart, fn.bodyEnd);
    const auth = findAuthorization(body);
    let matchedMarker = false;

    for (const marker of MECHANISM_MARKERS) {
      marker.re.lastIndex = 0;
      const m = marker.re.exec(body);
      if (m) {
        matchedMarker = true;
        const offset = fn.bodyStart + m.index;
        entryPoints.push({
          mechanism: marker.mechanism,
          functionName: fn.name,
          line: lineOf(offset),
          call: marker.call,
          hasAuthorization: auth.has,
          authorizedBy: auth.by,
        });
      }
    }

    // A function explicitly named as an upgrade entry point is an entry point
    // even when the trigger is delegated (e.g. reads the target from storage).
    // Skip the name-based entry point when a concrete trigger already matched,
    // to avoid emitting the function twice with different mechanisms.
    if (!matchedMarker && UPGRADE_FN_HINTS.test(fn.name)) {
      entryPoints.push({
        mechanism: 'migration',
        functionName: fn.name,
        line: fn.line,
        call: `fn ${fn.name}`,
        hasAuthorization: auth.has,
        authorizedBy: auth.by,
      });
    }
  }

  // Deduplicate identical (function, line, call) entry points.
  const seen = new Set<string>();
  return entryPoints.filter((ep) => {
    const key = `${ep.functionName}:${ep.line}:${ep.call}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.line - b.line);
}

/**
 * Analyze upgradeability of a Soroban contract. Returns findings about
 * uncontrolled upgrade paths plus the tracked entry points.
 */
export function analyzeUpgradeability(source: string): UpgradeabilityReport {
  const entryPoints = detectUpgradeMechanisms(source);
  const findings: UpgradeabilityFinding[] = [];
  const mechanisms = new Set<UpgradeMechanism>();

  for (const ep of entryPoints) {
    mechanisms.add(ep.mechanism);
    if (!ep.hasAuthorization) {
      findings.push({
        ruleId: 'soroban-upgradeability',
        severity: 'critical',
        title: 'Uncontrolled upgrade entry point',
        functionName: ep.functionName,
        mechanism: ep.mechanism,
        line: ep.line,
        message:
          `Upgrade entry point '${ep.functionName}' (${ep.call}) can be triggered without ` +
          `an authorization check, so any caller can replace the deployed behaviour.`,
        suggestion:
          `Guard the entry point with an admin/owner check: add \`admin.require_auth()\` ` +
          `(or \`require_auth_for_args\`) at the start of '${ep.functionName}', and consider ` +
          `adding a timelock or multi-sig before upgradeable state can be mutated.`,
      });
    }
  }

  if (entryPoints.length > 0) {
    const protectedCount = entryPoints.filter((ep) => ep.hasAuthorization).length;
    findings.push({
      ruleId: 'soroban-upgradeability',
      severity: 'medium',
      title: 'Contract is upgradeable',
      functionName: entryPoints[0].functionName,
      mechanism: entryPoints[0].mechanism,
      message:
        `Contract exposes ${entryPoints.length} upgradeable path(s) (` +
        `${[...mechanisms].join(', ')}); ${protectedCount} of them carry an authorization ` +
        `check. Upgradeability itself is not a vulnerability but it concentrates risk.`,
      suggestion:
        `Document each upgrade path and who can trigger it. Prefer a timelocked ` +
        `admin (e.g. Stellar governance or a multi-sig) over a single admin key, and ` +
        `emit an event on every upgrade for auditability.`,
    });
  }

  if (mechanisms.size > 1) {
    findings.push({
      ruleId: 'soroban-upgradeability',
      severity: 'low',
      title: 'Multiple upgrade mechanisms present',
      functionName: entryPoints[0].functionName,
      mechanism: entryPoints[0].mechanism,
      message:
        `Multiple upgrade mechanisms (${[...mechanisms].join(', ')}) were detected. ` +
        `Several ways to replace contract code increase the attack surface and make ` +
        `governance harder to reason about.`,
      suggestion:
        `Consolidate upgrade paths behind a single guarded entry point backed by one ` +
        `authorized admin/storage-controlled target.`,
    });
  }

  const report = {
    findings: findings.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity)),
    upgradeMechanisms: [...mechanisms] as UpgradeMechanism[],
    entryPoints,
    hasUpgradeablePaths: entryPoints.length > 0,
  };
  return report;
}

export class UpgradeabilityAnalyzer {
  public static readonly RULE_ID = 'soroban-upgradeability';

  analyze(source: string): UpgradeabilityReport {
    return analyzeUpgradeability(source);
  }
}