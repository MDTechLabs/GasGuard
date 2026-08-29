/**
 * Soroban Contract Pattern Library Module
 *
 * Exports the pattern library and related types for recognizing
 * and matching contract patterns in Soroban contracts.
 */

export { ContractPatternLibrary } from './contract-pattern-library';
export {
  PatternCategory,
  PatternSeverity,
} from './types';
export type {
  ContractPattern,
  PatternDetectionLogic,
  PatternMatch,
  PatternLookupOptions,
  ASTNodeMatcher,
  CustomMatcher,
  PatternCondition,
} from './types';
