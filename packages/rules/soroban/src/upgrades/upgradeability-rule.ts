/**
 * Rule family: soroban-upgradeability-* (#924)
 *
 * Thin Soroban rule over the upgradeability analyzer so detection is surfaced
 * through the GasGuard Soroban rule namespace.
 */
import {
  analyzeUpgradeability,
  detectUpgradeMechanisms,
  UpgradeabilityAnalyzer,
  UpgradeabilityFinding,
  UpgradeabilityReport,
  UpgradeEntryPoint,
  UpgradeMechanism,
  UpgradeSeverity,
} from '../../../../analyzers/soroban/upgrades/upgradeability-analyzer';

export type {
  UpgradeabilityFinding,
  UpgradeabilityReport,
  UpgradeEntryPoint,
  UpgradeMechanism,
  UpgradeSeverity,
};

/** Return the upgradeability findings for a Soroban source file. */
export function detectUpgradeabilityFindings(source: string): UpgradeabilityFinding[] {
  return analyzeUpgradeability(source).findings;
}

/** Return the upgrade entry points tracked by the analyzer. */
export function detectUpgradeEntryPoints(source: string): UpgradeEntryPoint[] {
  return detectUpgradeMechanisms(source);
}

/** Full report, including the tracked entry points and mechanisms. */
export function analyzeSorobanUpgradeability(source: string): UpgradeabilityReport {
  return analyzeUpgradeability(source);
}

export { UpgradeabilityAnalyzer };