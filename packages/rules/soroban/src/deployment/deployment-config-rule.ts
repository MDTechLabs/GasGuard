/**
 * Rule family: soroban-deployment-config-* (#927)
 *
 * Thin Soroban rule over the deployment configuration analyzer so detection
 * is surfaced through the GasGuard Soroban rule namespace.
 */
import {
  analyzeDeploymentConfig,
  detectDeploymentConfigFindings,
  DeploymentConfigFinding,
  DeploymentConfigReport,
  DeploymentConfigSetting,
  DeploymentSeverity,
} from '../../../../analyzers/soroban/deployment/deployment-config-analyzer';

export type {
  DeploymentConfigFinding,
  DeploymentConfigReport,
  DeploymentConfigSetting,
  DeploymentSeverity,
};

/** Return the deployment-configuration findings for a deploy config. */
export function detectDeploymentConfigurationFindings(
  configuration: string,
  source?: string,
): DeploymentConfigFinding[] {
  return detectDeploymentConfigFindings(configuration, source);
}

/** Full report, including parsed settings and missing-required keys. */
export function analyzeSorobanDeploymentConfig(
  configuration: string,
  source?: string,
): DeploymentConfigReport {
  return analyzeDeploymentConfig(configuration, source);
}