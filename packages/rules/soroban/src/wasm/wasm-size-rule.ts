/**
 * Rule family: soroban-wasm-size-* (#930)
 *
 * Thin Soroban rule over the WASM size analyzer, with a configurable size
 * budget so CI can enforce artifact-size limits.
 */
import {
  analyzeWasmSize,
  detectWasmSizeFindings,
  WasmSizeFinding,
  WasmSizeOptions,
  WasmSizeReport,
} from '../../../../analyzers/soroban/wasm/wasm-size-analyzer';

export type { WasmSizeFinding, WasmSizeOptions, WasmSizeReport };

/** Full size report against configurable thresholds. */
export function analyzeSorobanWasmSize(
  bytes: Uint8Array | Buffer,
  options?: WasmSizeOptions,
): WasmSizeReport {
  return analyzeWasmSize(bytes, options);
}

/** Over-size findings only, for the rule engine. */
export function detectWasmSizeFindingsRule(
  bytes: Uint8Array | Buffer,
  options?: WasmSizeOptions,
): WasmSizeFinding[] {
  return detectWasmSizeFindings(bytes, options);
}