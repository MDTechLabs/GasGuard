/**
 * Rule family: soroban-mutable-upgrade-config-* (#926)
 *
 * Thin Soroban rule over the storage analyzer for mutable upgrade
 * configuration, surfaced through the Soroban rule namespace.
 */
import {
  analyzeMutableUpgradeConfig,
  detectMutableUpgradeConfigWrites,
  MutableUpgradeConfigAnalyzer,
  MutableUpgradeConfigFinding,
  MutableUpgradeConfigReport,
  MutableUpgradeConfigWrite,
} from '../../../../analyzers/soroban/storage/mutable-upgrade-config-analyzer';

export type {
  MutableUpgradeConfigFinding,
  MutableUpgradeConfigReport,
  MutableUpgradeConfigWrite,
};

/** Return findings for unsafe writes to upgrade-configuration storage keys. */
export function detectMutableUpgradeConfigFindings(
  source: string,
): MutableUpgradeConfigFinding[] {
  return analyzeMutableUpgradeConfig(source).findings;
}

/** Track every write to upgrade-configuration keys and its authorization. */
export function detectUpgradeConfigWrites(source: string): MutableUpgradeConfigWrite[] {
  return detectMutableUpgradeConfigWrites(source);
}

export { MutableUpgradeConfigAnalyzer };