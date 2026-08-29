/**
 * Testing helpers for optimization regression checks (#806).
 */
export {
  checkRegression,
  checkOptimizationRegression,
  collectFindings,
  applyPatchPreview,
} from '../../autofix/regression/optimization-regression-checker';

export type { RegressionResult, NormalizedFinding } from '../../autofix/regression/optimization-regression-checker';
