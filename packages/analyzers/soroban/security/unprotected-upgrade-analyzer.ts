/**
 * Issue #925 — Detect Unprotected Soroban Upgrade Functions (security analyzer)
 *
 * Identifies Soroban functions that can replace or migrate contract behaviour
 * and are not protected by an access-control check. Unauthorized upgrades can
 * swap the deployed implementation for a malicious one, so missing access
 * control here is a security (not merely a governance) issue.
 *
 * This analyzer is a focused security pass over the same upgrade triggers the
 * upgradeability analyzer tracks, but it reports per-function access-control
 * gaps with a security severity rather than a mechanism inventory.
 */

import { maskNonCode } from '../common/source-utils';

export type UpgradeSecuritySeverity = 'critical' | 'high' | 'medium';

export interface UnprotectedUpgradeFinding {
  line: number;
  ruleId: string;
  severity: UpgradeSecuritySeverity;
  functionName: string;
  /** The upgrade trigger/mechanism found in the function. */
  trigger: string;
  hasAuthorization: boolean;
  authorizedBy?: string;
  message: string;
  suggestion: string;
  location: { line: number; functionName: string };
}

/** Calls that can replace or migrate the deployed behaviour. */
const UPGRADE_TRIGGER =
  /update_current_contract_wasm\s*\(|\.set_code\s*\(|\.set_wasm\s*\(|set_wasm_hash\s*\(|set_implementation\s*\(|set_impl\s*\(|version_switch\s*\(|env\s*\.\s*deployer\s*\(|\.deploy_contract\s*\(/;

/** Function names that conventionally perform upgrades. */
const UPGRADE_FN_NAME =
  /\b(upgrade|update_wasm|set_wasm|set_code|set_implementation|migrate|release_contract|update_contract|redeploy|replace_contract)\b/i;

/** Access-control primitives that would protect an upgrade function. */
const ACCESS_CONTROL =
  /require_auth\s*\(|require_auth_for_args\s*\(|\.authenticate\s*\(|\b(admin|owner|admin_owner|governor|controller)\s*\.\s*require_auth\s*\(|\bonly_admin\s*\(|assert_admin\s*\(|check_admin\s*\(|ensure_admin\s*\(/;

/** Direct wasm replacement is treated as the most severe uncontrolled path. */
const DIRECT_REPLACEMENT =
  /update_current_contract_wasm\s*\(|\.set_code\s*\(|\.set_wasm\s*\(|set_wasm_hash\s*\(/;

function findUpgradeFunctions(source: string): Array<{ name: string; body: string; line: number }> {
  const masked = maskNonCode(source);
  const blocks: Array<{ name: string; body: string; line: number }> = [];
  const re = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(masked)) !== null) {
    // Rough body estimate: braces from the first '{' after the signature.
    const braceIdx = masked.indexOf('{', m.index);
    if (braceIdx === -1) continue;
    let depth = 0;
    let end = -1;
    for (let i = braceIdx; i < masked.length; i++) {
      if (masked[i] === '{') depth++;
      else if (masked[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    const line = masked.slice(0, m.index).split('\n').length;
    blocks.push({
      name: m[1],
      body: masked.slice(braceIdx, end + 1),
      line,
    });
  }
  return blocks;
}

/**
 * Detect upgrade functions that lack an access-control check.
 */
export function analyzeUnprotectedUpgrades(sourceCode: string): UnprotectedUpgradeFinding[] {
  const findings: UnprotectedUpgradeFinding[] = [];

  for (const fn of findUpgradeFunctions(sourceCode)) {
    const isUpgradeName = UPGRADE_FN_NAME.test(fn.name);
    const hasTrigger = UPGRADE_TRIGGER.test(fn.body);
    if (!isUpgradeName && !hasTrigger) continue;

    const hasAuth = ACCESS_CONTROL.test(fn.body);
    if (hasAuth) continue;

    const direct = DIRECT_REPLACEMENT.test(fn.body) || isUpgradeName;
    const trigger = hasTrigger ? 'upgrade trigger in body' : `fn name '${fn.name}'`;

    findings.push({
      line: fn.line,
      ruleId: 'soroban-unprotected-upgrade',
      severity: direct ? 'critical' : 'high',
      functionName: fn.name,
      trigger,
      hasAuthorization: false,
      message:
        `Upgrade function '${fn.name}' (${trigger}) has no access-control check, so an ` +
        `unauthorized caller could replace or migrate the deployed contract behaviour.`,
      suggestion:
        `Add an explicit authorization check at the start of '${fn.name}': ` +
        `\`{admin}.require_auth()\` for the privileged Address, or \`require_auth_for_args\`. ` +
        `Prefer a timelock or multi-sig admin for upgradeable contracts, and emit an upgrade event.`,
      location: { line: fn.line, functionName: fn.name },
    });
  }

  return findings.sort((a, b) => a.line - b.line);
}

export class UnprotectedUpgradeAnalyzer {
  public static readonly RULE_ID = 'soroban-unprotected-upgrade';

  analyze(sourceCode: string): UnprotectedUpgradeFinding[] {
    return analyzeUnprotectedUpgrades(sourceCode);
  }
}