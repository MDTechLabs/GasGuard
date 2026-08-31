/**
 * Issue #807 — Soroban Optimization Preview
 *
 * Produces proposed optimizations (findings, confidence, diffs, estimated
 * impact) without modifying source files.
 */

import { analyzeCallFrequency } from '../../analyzers/soroban/functions/calls/call-frequency-analyzer';
import { estimateCpuCost } from '../../analyzers/soroban/resources/cpu/cpu-cost-estimator';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ProposedDiff {
  /** Unified-diff style patch (preview only — not applied) */
  patch: string;
  /** File path the patch would apply to */
  filePath: string;
  /** Start line for the change */
  startLine: number;
  /** End line for the change */
  endLine: number;
}

export interface ResourceImpactSummary {
  cpu: number;
  memory: number;
  ledger: number;
  fees: number;
  summary: string;
}

export interface OptimizationProposal {
  id: string;
  ruleId: string;
  severity: Severity;
  title: string;
  description: string;
  /** 0–1 confidence that the fix is safe and beneficial */
  confidence: number;
  /** Alias kept for reporting/UI compatibility */
  confidenceScore: number;
  /** Original code being considered for change */
  originalCode: string;
  /** Proposed transformed code for preview */
  proposedCode: string;
  /** Estimated impact breakdown */
  estimatedImpact: ResourceImpactSummary;
  /** Expected resource impact shown to developers */
  expectedResourceImpact: ResourceImpactSummary;
  /** Proposed source diff (preview) */
  diff: ProposedDiff;
  line: number;
}

export interface OptimizationPreviewResult {
  proposals: OptimizationProposal[];
  sourceHash: string;
  generatedAt: string;
}

export interface PreviewFilter {
  /** Minimum severity to include */
  minSeverity?: Severity;
  /** Only include these rule IDs */
  ruleIds?: string[];
  /** Minimum confidence (0–1) */
  minConfidence?: number;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/**
 * Build optimization proposals from source analysis (no file writes).
 */
export function previewOptimizations(
  source: string,
  filePath = 'contract.rs',
  filter: PreviewFilter = {},
): OptimizationPreviewResult {
  const proposals: OptimizationProposal[] = [];

  // ── From call-frequency analyzer ──────────────────────────────────────────
  const freq = analyzeCallFrequency(source);
  for (const f of freq.findings) {
    const confidence =
      f.edge.count >= 8 ? 0.9 : f.edge.count >= 5 ? 0.75 : 0.6;
    const impact: ResourceImpactSummary = {
      cpu: Math.min(80, f.edge.count * 8),
      memory: 5,
      ledger: 10,
      fees: Math.min(60, f.edge.count * 5),
      summary: `Reducing ${f.edge.count} repeated calls may cut relative CPU by ~${Math.min(80, f.edge.count * 8)}%.`,
    };
    const previewCode = buildPreviewCode(
      source,
      f.line,
      `cache result of ${f.edge.callee}(...) across repeated calls`,
      'cache',
    );
    proposals.push({
      id: `opt-freq-${f.line}-${f.edge.callee}`,
      ruleId: f.ruleId,
      severity: f.severity,
      title: `Cache / batch repeated call to '${f.edge.callee}'`,
      description: f.message,
      confidence,
      confidenceScore: confidence,
      originalCode: previewCode.originalCode,
      proposedCode: previewCode.proposedCode,
      estimatedImpact: impact,
      expectedResourceImpact: impact,
      diff: buildCacheDiff(source, f.line, f.edge.callee, filePath),
      line: f.line,
    });
  }

  // ── From CPU cost estimator ───────────────────────────────────────────────
  const cpu = estimateCpuCost(source);
  for (const f of cpu.findings) {
    if (f.severity === 'low' || f.severity === 'info') continue;
    const confidence =
      f.severity === 'critical' ? 0.85 : f.severity === 'high' ? 0.7 : 0.55;
    const impact: ResourceImpactSummary = {
      cpu: f.estimatedCpuCost,
      memory: f.patternId === 'serialization' ? 20 : 5,
      ledger: f.patternId === 'storage-in-loop' ? 70 : 5,
      fees: Math.round(f.estimatedCpuCost * 0.6),
      summary: f.suggestion,
    };
    const previewCode = buildPreviewCode(
      source,
      f.line,
      f.suggestion,
      'generic',
    );
    proposals.push({
      id: `opt-cpu-${f.patternId}-${f.line}`,
      ruleId: f.ruleId,
      severity: f.severity,
      title: `Reduce CPU: ${f.patternId}`,
      description: f.message,
      confidence,
      confidenceScore: confidence,
      originalCode: previewCode.originalCode,
      proposedCode: previewCode.proposedCode,
      estimatedImpact: impact,
      expectedResourceImpact: impact,
      diff: buildGenericDiff(source, f.line, f.suggestion, filePath),
      line: f.line,
    });
  }

  const filtered = applyFilter(proposals, filter);

  return {
    proposals: filtered,
    sourceHash: simpleHash(source),
    generatedAt: new Date().toISOString(),
  };
}

function applyFilter(
  proposals: OptimizationProposal[],
  filter: PreviewFilter,
): OptimizationProposal[] {
  let result = proposals;

  if (filter.minSeverity) {
    const min = SEVERITY_RANK[filter.minSeverity];
    result = result.filter((p) => SEVERITY_RANK[p.severity] >= min);
  }
  if (filter.ruleIds?.length) {
    const set = new Set(filter.ruleIds);
    result = result.filter((p) => set.has(p.ruleId));
  }
  if (filter.minConfidence !== undefined) {
    result = result.filter((p) => p.confidence >= filter.minConfidence!);
  }

  return result.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );
}

function buildPreviewCode(
  source: string,
  line: number,
  suggestion: string,
  mode: 'cache' | 'generic',
): { originalCode: string; proposedCode: string } {
  const lines = source.split('\n');
  const originalCode = lines[line - 1] ?? '';
  const indent = originalCode.match(/^\s*/)?.[0] ?? '';

  const proposedCode =
    mode === 'cache'
      ? `${indent}// OPTIMIZE: ${suggestion}\n${originalCode}`
      : `${indent}// TODO(optimization): ${suggestion}\n${originalCode}`;

  return {
    originalCode,
    proposedCode,
  };
}

function buildCacheDiff(
  source: string,
  line: number,
  callee: string,
  filePath: string,
): ProposedDiff {
  const lines = source.split('\n');
  const original = lines[line - 1] ?? '';
  const indent = original.match(/^\s*/)?.[0] ?? '';

  return {
    filePath,
    startLine: line,
    endLine: line,
    patch: [
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      `@@ -${line},1 +${line},2 @@`,
      `-${original}`,
      `+${indent}// OPTIMIZE: cache result of ${callee}(...) across repeated calls`,
      `+${original}`,
    ].join('\n'),
  };
}

function buildGenericDiff(
  source: string,
  line: number,
  suggestion: string,
  filePath: string,
): ProposedDiff {
  const lines = source.split('\n');
  const original = lines[line - 1] ?? '';
  const indent = original.match(/^\s*/)?.[0] ?? '';

  return {
    filePath,
    startLine: line,
    endLine: line,
    patch: [
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      `@@ -${line},1 +${line},2 @@`,
      `-${original}`,
      `+${indent}// TODO(optimization): ${suggestion}`,
      `+${original}`,
    ].join('\n'),
  };
}

function simpleHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(16)}`;
}
