/**
 * Soroban WASM Size Analyzer
 *
 * Measures a compiled WASM artifact against configurable size thresholds and
 * assigns a severity plus optimization guidance. Large contract artifacts
 * increase deployment and upgrade/maintenance costs on Soroban (ledger entry
 * footprint, fee, and transaction size), so an enforced size budget is useful
 * before shipping.
 */

export type SizeSeverity = 'high' | 'medium' | 'low' | 'info';

export interface WasmSizeOptions {
  /** Warn when the artifact exceeds this many bytes. Default: 64 * 1024 (64 KiB). */
  warningThresholdBytes?: number;
  /** Flag a high-severity violation above this many bytes. Default: 128 * 1024. */
  criticalThresholdBytes?: number;
  /** A label for the artifact (e.g. a file path) used in the report. */
  name?: string;
}

export interface WasmSizeFinding {
  ruleId: string;
  severity: SizeSeverity;
  title: string;
  message: string;
  suggestion: string;
  metrics: {
    sizeBytes: number;
    sizeKib: number;
    warningThresholdBytes: number;
    criticalThresholdBytes: number;
  };
}

export interface WasmSizeReport {
  name: string;
  sizeBytes: number;
  sizeKib: number;
  withinBudget: boolean;
  thresholdBytes: number;
  findings: WasmSizeFinding[];
  recommendation?: string;
}

const DEFAULT_WARNING = 64 * 1024;
const DEFAULT_CRITICAL = 128 * 1024;

function kib(size: number): string {
  return `${(size / 1024).toFixed(2)} KiB`;
}

/**
 * Optimisation guidance that scales with how far past the budget the artifact is.
 */
function recommendation(sizeBytes: number, warning: number, critical: number): string | undefined {
  if (sizeBytes <= warning) {
    return 'Artifact is within the configured WASM size budget — no action required.';
  }
  if (sizeBytes <= critical) {
    return 'Trim the artifact: enable `opt-level = "s"`/`"z"`, `lto = true`, `codegen-units = 1`, `panic = "abort"` and `strip = "symbols"` in the release profile.';
  }
  return 'Artifact is critically oversized. Minimise static data, drop unused dependencies with feature trimming, consider `no_std`, and strip/dead-code-eliminate the binary (e.g. `wasm-opt -O3 --strip-debug`).';
}

/**
 * Evaluate WASM artifact size against thresholds.
 */
export function analyzeWasmSize(
  bytes: Uint8Array | Buffer,
  options?: WasmSizeOptions,
): WasmSizeReport {
  const warning = options?.warningThresholdBytes ?? DEFAULT_WARNING;
  const critical = options?.criticalThresholdBytes ?? DEFAULT_CRITICAL;
  const name = options?.name ?? 'contract.wasm';
  const sizeBytes = bytes.byteLength;
  const sizeKib = sizeBytes / 1024;
  const findings: WasmSizeFinding[] = [];
  const withinBudget = sizeBytes <= warning;

  if (!withinBudget) {
    const severity: SizeSeverity = sizeBytes > critical ? 'high' : 'medium';
    findings.push({
      ruleId: 'soroban-wasm-size',
      severity,
      title: 'Soroban WASM artifact over the size budget',
      message: `'${name}' is ${sizeBytes} bytes (${kib(sizeBytes)}), exceeding the warning threshold of ${warning} bytes (${kib(warning)})${sizeBytes > critical ? ` and the critical threshold of ${critical} bytes (${kib(critical)})` : ''}.`,
      suggestion: recommendation(sizeBytes, warning, critical) ?? '',
      metrics: {
        sizeBytes,
        sizeKib: Number(sizeKib.toFixed(2)),
        warningThresholdBytes: warning,
        criticalThresholdBytes: critical,
      },
    });
  }

  return {
    name,
    sizeBytes,
    sizeKib: Number(sizeKib.toFixed(2)),
    withinBudget,
    thresholdBytes: warning,
    findings,
    recommendation: recommendation(sizeBytes, warning, critical),
  };
}

/**
 * Rules-oriented entry point: return only size findings.
 */
export function detectWasmSizeFindings(
  bytes: Uint8Array | Buffer,
  options?: WasmSizeOptions,
): WasmSizeFinding[] {
  return analyzeWasmSize(bytes, options).findings;
}