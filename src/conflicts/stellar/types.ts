/**
 * Soroban Conflict Resolver Types
 * 
 * Defines data structures for detecting and resolving conflicts in Soroban smart contract analysis
 */

import { ConflictInfo, ConflictType, ConflictSeverity, ResolutionStrategy } from '../../analysis/conflicts/types';

// Re-export types for convenience
export { ConflictType, ConflictSeverity, ResolutionStrategy } from '../../analysis/conflicts/types';

/** Soroban-specific rule categories */
export enum SorobanRuleCategory {
  /** Access control and authorization rules */
  ACCESS_CONTROL = 'ACCESS_CONTROL',
  /** Gas optimization rules */
  OPTIMIZATION = 'OPTIMIZATION',
  /** Security vulnerability rules */
  SECURITY = 'SECURITY',
  /** Cross-contract interaction rules */
  CROSS_CONTRACT = 'CROSS_CONTRACT',
  /** Event emission rules */
  EVENTS = 'EVENTS',
  /** Upgradeability rules */
  UPGRADEABILITY = 'UPGRADEABILITY',
}

/** Soroban-specific conflict information */
export interface SorobanConflictInfo extends ConflictInfo {
  /** Category of the first rule involved */
  category1: SorobanRuleCategory;
  /** Category of the second rule involved */
  category2: SorobanRuleCategory;
  /** Priority score for resolution */
  priorityScore: number;
  /** Whether the conflict can be auto-resolved */
  autoResolvable: boolean;
}

/** Soroban rule metadata */
export interface SorobanRuleMetadata {
  /** Rule identifier */
  ruleId: string;
  /** Rule category */
  category: SorobanRuleCategory;
  /** Default priority (higher = more important) */
  priority: number;
  /** Whether the rule is security-critical */
  securityCritical: boolean;
}

/** Conflict resolution result */
export interface SorobanConflictResolution {
  /** Original conflict */
  conflict: SorobanConflictInfo;
  /** Chosen resolution strategy */
  strategy: ResolutionStrategy;
  /** Which rule to prefer (if applicable) */
  preferredRule?: string;
  /** Merged suggestion (if applicable) */
  mergedSuggestion?: string;
  /** Explanation of the resolution */
  explanation: string;
}

/** Conflict summary for reporting */
export interface SorobanConflictSummary {
  /** Total number of conflicts detected */
  totalConflicts: number;
  /** Conflicts by category pair */
  conflictsByCategory: Record<string, number>;
  /** Conflicts by severity */
  conflictsBySeverity: Record<ConflictSeverity, number>;
  /** Auto-resolvable conflicts */
  autoResolvableCount: number;
  /** Conflicts requiring user input */
  requiresUserInputCount: number;
  /** Top priority conflicts */
  topPriorityConflicts: SorobanConflictInfo[];
}
