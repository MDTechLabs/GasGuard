/**
 * Finding Adapters
 *
 * Convert each upstream analyzer's native output format into a
 * `NormalizedFinding` so the risk scorer stays decoupled from analyzer
 * internals.
 */

import { NormalizedFinding, RiskSeverity, FindingCategory } from './types';

// ─── Storage analyzer ──────────────────────────────────────────────────────

import type { StorageFinding } from '../storage/storage-analyzer';

export function adaptStorageFinding(f: StorageFinding): NormalizedFinding {
  return {
    ruleId: f.ruleId,
    severity: mapSeverity(f.severity),
    message: f.message,
    category: 'resource',
    estimatedGasCost: undefined,
  };
}

// ─── CPU cost estimator ────────────────────────────────────────────────────

import type { CpuCostFinding } from '../resources/cpu/cpu-cost-estimator';

export function adaptCpuFinding(f: CpuCostFinding): NormalizedFinding {
  return {
    ruleId: f.ruleId,
    severity: mapSeverity(f.severity),
    message: f.message,
    category: categorizeByRuleId(f.ruleId, 'resource'),
    estimatedGasCost: f.estimatedCpuCost,
  };
}

// ─── Memory cost estimator ─────────────────────────────────────────────────

import type { MemoryCostFinding } from '../resources/memory/memory-cost-estimator';

export function adaptMemoryFinding(f: MemoryCostFinding): NormalizedFinding {
  return {
    ruleId: f.ruleId,
    severity: mapSeverity(f.severity),
    message: f.message,
    category: 'resource',
    estimatedGasCost: f.estimatedMemoryCost,
  };
}

// ─── WASM inspector (deployment) ───────────────────────────────────────────

import type { WasmInefficiencyFinding } from '../../../rules/soroban/src/analyzer/wasm-inspector';

export function adaptWasmFinding(f: WasmInefficiencyFinding): NormalizedFinding {
  return {
    ruleId: f.id,
    severity: mapSeverity(f.severity),
    message: f.message,
    category: 'deployment',
  };
}

// ─── Authorization analyzer (security) ────────────────────────────────────

import type { AuthFinding } from '../../../rules/soroban/src/authorization/authorization-analyzer';

export function adaptAuthFinding(f: AuthFinding): NormalizedFinding {
  return {
    ruleId: f.rule,
    severity: mapSeverity(f.severity),
    message: f.message,
    category: 'security',
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const SEVERITY_MAP: Record<string, RiskSeverity> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  info: 'info',
  information: 'info',
};

function mapSeverity(raw: string): RiskSeverity {
  return SEVERITY_MAP[raw.toLowerCase()] ?? 'info';
}

/**
 * Heuristic category assignment when a ruleId gives a clue.
 * Falls back to `defaultCategory`.
 */
function categorizeByRuleId(ruleId: string, defaultCategory: FindingCategory): FindingCategory {
  const id = ruleId.toLowerCase();
  if (id.includes('auth') || id.includes('access') || id.includes('reentrancy')) return 'security';
  if (id.includes('wasm') || id.includes('stack') || id.includes('host-import')) return 'deployment';
  if (id.includes('stor') || id.includes('memory') || id.includes('cpu')) return 'resource';
  if (id.includes('optim') || id.includes('redundant') || id.includes('loop')) return 'optimization';
  return defaultCategory;
}
