/**
 * Rule family: soroban-wasm-* (#929)
 *
 * Thin Soroban rule over the WASM artifact analyzer.
 */
import {
  analyzeWasmArtifact,
  inspectWasmArtifact,
  WasmArtifactAnalysis,
  WasmArtifactFinding,
  WasmArtifactMetadata,
} from '../../../../analyzers/soroban/wasm/wasm-artifact-analyzer';

export type { WasmArtifactAnalysis, WasmArtifactFinding, WasmArtifactMetadata };

/** Analyze a compiled WASM artifact. */
export function analyzeSorobanWasmArtifact(
  bytes: Uint8Array | Buffer,
): WasmArtifactAnalysis {
  return analyzeWasmArtifact(bytes);
}

/** Inspect only the metadata of a WASM artifact. */
export function inspectWasmArtifactMetadata(
  bytes: Uint8Array | Buffer,
): WasmArtifactMetadata {
  return inspectWasmArtifact(bytes);
}

/** Return WASM artifact findings for the rule engine. */
export function detectWasmArtifactFindings(
  bytes: Uint8Array | Buffer,
): WasmArtifactFinding[] {
  return analyzeWasmArtifact(bytes).findings;
}