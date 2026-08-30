/**
 * Soroban Deployment Readiness Checker
 *
 * Aggregates security, resource and deployment-configuration signals into a
 * single pass/fail readiness assessment before a Soroban contract is deployed.
 *
 * The checker is deliberately composable: callers feed it the findings and
 * metrics gathered by the other Soroban analyzers (debug configuration, WASM
 * artifact/size, resource estimators, security findings) and it collapses them
 * into a small set of checks with an overall status.
 */

export type Severity = 'high' | 'medium' | 'low' | 'info';
export type CheckStatus = 'pass' | 'fail' | 'warn';
export type ReadinessStatus = 'pass' | 'fail' | 'warn';

export interface ReadinessFinding {
  id?: string;
  category: 'security' | 'resource' | 'deployment';
  severity: Severity;
  message: string;
}

export interface ResourceMetrics {
  /** Compiled WASM artifact size in bytes. */
  wasmSizeBytes?: number;
  /** Hard budget for WASM artifact size in bytes. */
  wasmSizeLimitBytes?: number;
  /** Initial linear-memory pages used by the contract. */
  memoryPages?: number;
  /** Maximum acceptable memory pages. */
  memoryPageLimit?: number;
  /** Estimated CPU cost in stroops. */
  cpuCostStroops?: number;
  /** Maximum acceptable CPU cost in stroops. */
  cpuCostLimitStroops?: number;
}

export interface DeploymentConfig {
  /** Target network: `mainnet`, `pubnet`, `testnet`, `standalone`, ... */
  network?: string;
  /** True when a production `[profile.release]` block exists. */
  hasReleaseProfile?: boolean;
  /** True when release is the active/assumed build profile. */
  productionBuild?: boolean;
  /** True when deployment/invoke configuration was provided. */
  hasDeploymentConfig?: boolean;
}

export interface SecurityStatus {
  /** Count of high/critical-severity findings. */
  criticalFindings?: number;
  /** True when a debug-oriented configuration was detected. */
  debugConfigPresent?: boolean;
}

export interface ReadinessOptions {
  model?: string;
  /** Fail the overall assessment when any critical (high) finding exists. */
  failOnCritical?: boolean;
}

export interface ReadinessCheck {
  name: string;
  status: CheckStatus;
  messages: string[];
}

export interface ReadinessResult {
  status: ReadinessStatus;
  model?: string;
  checks: ReadinessCheck[];
  passedChecks: number;
  totalChecks: number;
  failedChecks: number;
  summary: string;
  criticalFindings: number;
}

const MAINNET_NETWORKS = new Set(['mainnet', 'pubnet', 'public']);

/** True unless a network is explicitly a non-mainnet/test network. */
function isProductionNetwork(network?: string): boolean {
  if (!network) return false;
  const n = network.trim().toLowerCase();
  return MAINNET_NETWORKS.has(n) || n.includes('main') || n.includes('public');
}

/**
 * Evaluate the "resources" readiness check.
 */
export function evaluateResourceCheck(metrics: ResourceMetrics): ReadinessCheck {
  const messages: string[] = [];
  let status: CheckStatus = 'pass';

  if (metrics.wasmSizeBytes !== undefined && metrics.wasmSizeLimitBytes !== undefined) {
    if (metrics.wasmSizeBytes > metrics.wasmSizeLimitBytes) {
      status = 'fail';
      messages.push(
        `WASM artifact size ${metrics.wasmSizeBytes} bytes exceeds the ${metrics.wasmSizeLimitBytes}-byte limit.`,
      );
    } else {
      messages.push(`WASM artifact size ${metrics.wasmSizeBytes} bytes within the ${metrics.wasmSizeLimitBytes}-byte limit.`);
    }
  }

  if (metrics.memoryPages !== undefined && metrics.memoryPageLimit !== undefined) {
    if (metrics.memoryPages > metrics.memoryPageLimit) {
      status = 'fail';
      messages.push(`Contract uses ${metrics.memoryPages} memory pages (limit ${metrics.memoryPageLimit}).`);
    } else {
      messages.push(`Contract uses ${metrics.memoryPages} memory pages (limit ${metrics.memoryPageLimit}).`);
    }
  }

  if (metrics.cpuCostStroops !== undefined && metrics.cpuCostLimitStroops !== undefined) {
    if (metrics.cpuCostStroops > metrics.cpuCostLimitStroops) {
      status = 'fail';
      messages.push(`Estimated CPU cost ${metrics.cpuCostStroops} stroops exceeds limit ${metrics.cpuCostLimitStroops}.`);
    } else {
      messages.push(`Estimated CPU cost ${metrics.cpuCostStroops} stroops within limit ${metrics.cpuCostLimitStroops}.`);
    }
  }

  if (messages.length === 0) {
    status = 'warn';
    messages.push('No resource metrics provided — resource readiness could not be fully assessed.');
  }

  return { name: 'resources', status, messages };
}

/**
 * Evaluate the "deployment configuration" readiness check.
 */
export function evaluateDeploymentCheck(config: DeploymentConfig): ReadinessCheck {
  const messages: string[] = [];
  let status: CheckStatus = 'pass';

  if (config.productionBuild === false || (config.productionBuild === undefined && config.hasReleaseProfile === false)) {
    status = 'warn';
    messages.push('Not building with a production (release) profile — debug/unoptimised builds should not be deployed.');
  } else {
    messages.push('Production build profile is in use.');
  }

  if (!config.network) {
    status = 'warn';
    messages.push('Deployment network was not specified.');
  } else if (isProductionNetwork(config.network)) {
    messages.push(`Deployment targets the production network '${config.network}'.`);
  } else {
    status = 'warn';
    messages.push(`Deployment targets the non-production network '${config.network}' — verify the intent before shipping.`);
  }

  if (config.hasDeploymentConfig === false) {
    status = 'fail';
    messages.push('No deployment configuration supplied — readiness cannot be guaranteed.');
  }

  if (!config.hasReleaseProfile && config.hasDeploymentConfig !== false) {
    status = 'warn';
    messages.push('No `[profile.release]` block found in Cargo.toml.');
  }

  return { name: 'deployment', status, messages };
}

/**
 * Evaluate the "security" readiness check.
 */
export function evaluateSecurityCheck(security: SecurityStatus): ReadinessCheck {
  const messages: string[] = [];
  let status: CheckStatus = 'pass';
  const critical = security.criticalFindings ?? 0;

  if (critical > 0) {
    status = 'fail';
    messages.push(`${critical} critical/high-severity finding(s) remain unresolved.`);
  } else {
    messages.push('No unresolved critical findings.');
  }

  if (security.debugConfigPresent) {
    status = status === 'fail' ? 'fail' : 'warn';
    messages.push('Debug-oriented build configuration was detected.');
  }

  return { name: 'security', status, messages };
}

/**
 * Produce the full readiness assessment.
 */
export function assessReadiness(
  inputs: {
    findings?: ReadinessFinding[];
    resourceMetrics?: ResourceMetrics;
    deploymentConfig?: DeploymentConfig;
    securityStatus?: SecurityStatus;
  },
  options?: ReadinessOptions,
): ReadinessResult {
  const findings = inputs.findings ?? [];
  const resourceMetrics = inputs.resourceMetrics ?? {};
  const deploymentConfig = inputs.deploymentConfig ?? {};
  const securityStatus = inputs.securityStatus ?? {};

  const criticalFromFindings = findings.filter((f) => f.severity === 'high').length;
  const criticalCount = Math.max(securityStatus.criticalFindings ?? 0, criticalFromFindings);

  const secStatus: SecurityStatus = {
    criticalFindings: criticalCount,
    debugConfigPresent:
      securityStatus.debugConfigPresent ??
      findings.some((f) => f.category === 'deployment' && f.severity === 'high'),
  };

  const opts = { failOnCritical: options?.failOnCritical ?? true, model: options?.model };

  const checks = [
    evaluateResourceCheck(resourceMetrics),
    evaluateDeploymentCheck(deploymentConfig),
    evaluateSecurityCheck(secStatus),
  ];

  // A single critical finding fails the security check when configured to.
  if (opts.failOnCritical && criticalCount > 0) {
    const sec = checks.find((c) => c.name === 'security');
    if (sec) sec.status = 'fail';
  }

  const failed = checks.filter((c) => c.status === 'fail');
  const warned = checks.filter((c) => c.status === 'warn');

  let status: ReadinessStatus = 'pass';
  if (failed.length > 0) status = 'fail';
  else if (warned.length > 0) status = 'warn';

  const summary =
    status === 'pass'
      ? 'Ready for deployment — all readiness checks pass.'
      : status === 'warn'
        ? 'Conditionally ready for deployment — resolve the warnings below before shipping.'
        : `Not ready for deployment — ${failed.length} of ${checks.length} readiness check(s) failed.`;

  return {
    status,
    model: opts.model,
    checks,
    passedChecks: checks.filter((c) => c.status === 'pass').length,
    totalChecks: checks.length,
    failedChecks: failed.length,
    summary,
    criticalFindings: criticalCount,
  };
}