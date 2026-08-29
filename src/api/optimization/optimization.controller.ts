/**
 * Issue #807 — Soroban Optimization Preview API
 *
 * POST /api/optimization/preview
 * Body: { source: string, filePath?: string, minSeverity?: string, ruleIds?: string[], minConfidence?: number }
 * Returns proposed optimizations with confidence, diffs, and estimated impact.
 */

import {
  previewOptimizations,
  OptimizationPreviewResult,
  PreviewFilter,
  Severity,
} from '../../../packages/autofix/soroban/optimization-preview';

export interface PreviewRequestBody {
  source: string;
  filePath?: string;
  minSeverity?: Severity;
  ruleIds?: string[];
  minConfidence?: number;
}

export interface PreviewResponse extends OptimizationPreviewResult {
  count: number;
}

/**
 * Pure handler — framework-agnostic so it can be wired into NestJS or Express.
 */
export function handleOptimizationPreview(
  body: PreviewRequestBody,
): PreviewResponse {
  if (!body?.source || typeof body.source !== 'string') {
    throw new Error('Request body must include a non-empty "source" string');
  }

  const filter: PreviewFilter = {
    minSeverity: body.minSeverity,
    ruleIds: body.ruleIds,
    minConfidence: body.minConfidence,
  };

  const result = previewOptimizations(
    body.source,
    body.filePath ?? 'contract.rs',
    filter,
  );

  return {
    ...result,
    count: result.proposals.length,
  };
}

/**
 * Lightweight NestJS-style controller facade (optional integration point).
 */
export class OptimizationController {
  preview(body: PreviewRequestBody): PreviewResponse {
    return handleOptimizationPreview(body);
  }
}
