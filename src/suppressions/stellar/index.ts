/**
 * Soroban Rule Suppression Framework Module
 *
 * @see Issue #476 — Implement Soroban Rule Suppression Framework
 */

export { RuleSuppressionFramework, parseInlineSuppressions } from './rule-suppression-framework';

export type {
  SuppressionSource,
  InlineSuppression,
  ConfigSuppression,
  Suppression,
  Finding,
  SuppressionRecord,
  SuppressionFilterResult,
  SuppressionFrameworkConfig,
} from './types';
