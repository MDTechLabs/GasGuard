/**
 * Soroban Rule Impact Scoring Module
 *
 * Exports the impact scorer and related types for assigning
 * impact scores to findings beyond severity.
 */

export { ImpactScorer } from './impact-scorer';
export { ImpactCategory } from './types';
export type {
  ImpactScore,
  ImpactFactor,
  ImpactReport,
  ImpactScoringConfig,
} from './types';
