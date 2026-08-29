/**
 * Rule family: soroban-debug-config-* (#928)
 *
 * Thin Soroban rules over the deployment debug-config analyzer so the
 * detection is surfaced through the GasGuard Soroban rule namespace.
 */
import {
  analyzeDebugConfig,
  detectDebugConfiguration,
  DebugConfigFinding,
  DebugConfigOptions,
  DebugConfigReport,
} from '../../../../analyzers/soroban/deployment/debug-config-analyzer';

export type { DebugConfigFinding, DebugConfigOptions, DebugConfigReport };

/** Return the debug-configuration findings for a build configuration. */
export function detectDebugConfigurationFindings(
  configuration: string,
  source?: string,
  options?: DebugConfigOptions,
): DebugConfigFinding[] {
  return detectDebugConfiguration(configuration, source, options).findings;
}

/** Full report, including production context and active profile. */
export function analyzeSorobanDebugConfig(
  configuration: string,
  source?: string,
  options?: DebugConfigOptions,
): DebugConfigReport {
  return analyzeDebugConfig(configuration, source, options);
}