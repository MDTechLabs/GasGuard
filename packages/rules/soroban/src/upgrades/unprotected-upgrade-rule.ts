/**
 * Rule family: soroban-unprotected-upgrade-* (#925)
 *
 * Thin Soroban rule over the security analyzer for unprotected upgrade
 * functions, surfaced through the Soroban rule namespace.
 */
import {
  analyzeUnprotectedUpgrades,
  UnprotectedUpgradeAnalyzer,
  UnprotectedUpgradeFinding,
  UpgradeSecuritySeverity,
} from '../../../../analyzers/soroban/security/unprotected-upgrade-analyzer';

export type { UnprotectedUpgradeFinding, UpgradeSecuritySeverity };

/** Return findings for upgrade functions missing an access-control check. */
export function detectUnprotectedUpgradeFunctions(
  sourceCode: string,
): UnprotectedUpgradeFinding[] {
  return analyzeUnprotectedUpgrades(sourceCode);
}

export { UnprotectedUpgradeAnalyzer };