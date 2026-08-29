/**
 * Soroban Rule Conflict Resolver
 * 
 * Detects and resolves conflicts between Soroban smart contract analysis rules
 */

import {
  SorobanConflictInfo,
  SorobanRuleCategory,
  SorobanRuleMetadata,
  SorobanConflictResolution,
  SorobanConflictSummary,
} from './types';
import { ConflictDetector } from '../../analysis/conflicts/conflict-detector';
import { ConflictType, ConflictSeverity, ResolutionStrategy, ConflictInfo } from '../../analysis/conflicts/types';
import { Suggestion } from '../../analysis/context/context-aware-suggestions';

/** Rule violation information */
export interface RuleViolation {
  ruleId: string;
  message: string;
  location?: {
    file?: string;
    line?: number;
    column?: number;
  };
}

export class SorobanConflictResolver {
  private conflictDetector: ConflictDetector;
  private ruleMetadata: Map<string, SorobanRuleMetadata> = new Map();

  constructor() {
    this.conflictDetector = new ConflictDetector();
    this.initializeRuleMetadata();
  }

  /**
   * Detect conflicts specific to Soroban rules
   */
  detectSorobanConflicts(
    violations: RuleViolation[],
    suggestions: Suggestion[]
  ): SorobanConflictInfo[] {
    const baseConflicts = this.conflictDetector.detectConflicts(violations, suggestions);
    const sorobanConflicts: SorobanConflictInfo[] = [];

    for (const conflict of baseConflicts.conflicts) {
      const rule1Id = conflict.involvedRules[0];
      const rule2Id = conflict.involvedRules[1];

      const metadata1 = this.getRuleMetadata(rule1Id);
      const metadata2 = this.getRuleMetadata(rule2Id);

      const sorobanConflict: SorobanConflictInfo = {
        ...conflict,
        category1: metadata1?.category || SorobanRuleCategory.SECURITY,
        category2: metadata2?.category || SorobanRuleCategory.SECURITY,
        priorityScore: this.calculatePriorityScore(conflict, metadata1, metadata2),
        autoResolvable: this.isAutoResolvable(conflict, metadata1, metadata2),
      };

      sorobanConflicts.push(sorobanConflict);
    }

    // Add Soroban-specific conflict checks
    sorobanConflicts.push(...this.detectSorobanSpecificConflicts(violations, suggestions));

    return sorobanConflicts;
  }

  /**
   * Resolve a Soroban conflict using appropriate strategy
   */
  resolveConflict(conflict: SorobanConflictInfo): SorobanConflictResolution {
    const strategy = this.determineResolutionStrategy(conflict);

    let preferredRule: string | undefined;
    let mergedSuggestion: string | undefined;
    let explanation: string;

    switch (strategy) {
      case ResolutionStrategy.PREFER_FIRST:
        preferredRule = conflict.involvedRules[0];
        explanation = `Preferred ${conflict.involvedRules[0]} over ${conflict.involvedRules[1]} due to higher priority.`;
        break;

      case ResolutionStrategy.PREFER_SECOND:
        preferredRule = conflict.involvedRules[1];
        explanation = `Preferred ${conflict.involvedRules[1]} over ${conflict.involvedRules[0]} due to higher priority.`;
        break;

      case ResolutionStrategy.MERGE_IF_COMPATIBLE:
        mergedSuggestion = this.mergeSuggestions(conflict);
        explanation = mergedSuggestion
          ? 'Successfully merged conflicting suggestions.'
          : 'Suggestions could not be merged automatically.';
        break;

      case ResolutionStrategy.APPLY_BOTH:
        explanation = 'Both suggestions can be applied without conflict.';
        break;

      case ResolutionStrategy.REQUIRE_USER_INPUT:
      default:
        explanation = 'This conflict requires manual review and user decision.';
        break;
    }

    return {
      conflict,
      strategy,
      preferredRule,
      mergedSuggestion,
      explanation,
    };
  }

  /**
   * Generate a summary of all Soroban conflicts
   */
  generateConflictSummary(conflicts: SorobanConflictInfo[]): SorobanConflictSummary {
    const conflictsByCategory: Record<string, number> = {};
    const conflictsBySeverity: Record<ConflictSeverity, number> = {
      [ConflictSeverity.LOW]: 0,
      [ConflictSeverity.MEDIUM]: 0,
      [ConflictSeverity.HIGH]: 0,
    };

    let autoResolvableCount = 0;
    let requiresUserInputCount = 0;

    for (const conflict of conflicts) {
      const categoryKey = `${conflict.category1}_${conflict.category2}`;
      conflictsByCategory[categoryKey] = (conflictsByCategory[categoryKey] || 0) + 1;
      conflictsBySeverity[conflict.severity]++;

      if (conflict.autoResolvable) {
        autoResolvableCount++;
      } else {
        requiresUserInputCount++;
      }
    }

    // Sort conflicts by priority score
    const sortedConflicts = [...conflicts].sort((a, b) => b.priorityScore - a.priorityScore);
    const topPriorityConflicts = sortedConflicts.slice(0, 5);

    return {
      totalConflicts: conflicts.length,
      conflictsByCategory,
      conflictsBySeverity,
      autoResolvableCount,
      requiresUserInputCount,
      topPriorityConflicts,
    };
  }

  /**
   * Detect Soroban-specific conflicts beyond the base detector
   */
  private detectSorobanSpecificConflicts(
    violations: RuleViolation[],
    suggestions: Suggestion[]
  ): SorobanConflictInfo[] {
    const conflicts: SorobanConflictInfo[] = [];

    // Check for access control vs optimization conflicts
    conflicts.push(...this.checkAccessControlOptimizationConflicts(violations, suggestions));

    // Check for unsafe operation vs optimization conflicts
    conflicts.push(...this.checkUnsafeOperationOptimizationConflicts(violations, suggestions));

    // Check for event emission conflicts
    conflicts.push(...this.checkEventEmissionConflicts(violations, suggestions));

    return conflicts;
  }

  /**
   * Check for conflicts between access control and optimization rules
   */
  private checkAccessControlOptimizationConflicts(
    violations: RuleViolation[],
    suggestions: Suggestion[]
  ): SorobanConflictInfo[] {
    const conflicts: SorobanConflictInfo[] = [];

    const accessControlViolations = violations.filter((v) =>
      v.ruleId.includes('access-control') || v.ruleId.includes('missing-access-control')
    );

    const optimizationViolations = violations.filter((v) =>
      v.ruleId.includes('optimization') || v.ruleId.includes('inefficient')
    );

    for (const acViolation of accessControlViolations) {
      for (const optViolation of optimizationViolations) {
        if (this.isSameLocation(acViolation, optViolation)) {
          conflicts.push({
            conflictType: ConflictType.CONTRADICTORY_OPTIMIZATION,
            severity: ConflictSeverity.HIGH,
            description: 'Access control rule conflicts with optimization suggestion',
            involvedRules: [acViolation.ruleId, optViolation.ruleId],
            violations: [acViolation, optViolation],
            conflictingSuggestions: [
              suggestions[violations.indexOf(acViolation)],
              suggestions[violations.indexOf(optViolation)],
            ].filter(Boolean) as Suggestion[],
            location: acViolation.location,
            resolutionSuggestion: 'Prioritize access control over optimization',
            category1: SorobanRuleCategory.ACCESS_CONTROL,
            category2: SorobanRuleCategory.OPTIMIZATION,
            priorityScore: 100,
            autoResolvable: true,
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Check for conflicts between unsafe operations and optimization rules
   */
  private checkUnsafeOperationOptimizationConflicts(
    violations: RuleViolation[],
    suggestions: Suggestion[]
  ): SorobanConflictInfo[] {
    const conflicts: SorobanConflictInfo[] = [];

    const unsafeViolations = violations.filter((v) =>
      v.ruleId.includes('unsafe') || v.ruleId.includes('unsafe-operations')
    );

    const optimizationViolations = violations.filter((v) =>
      v.ruleId.includes('optimization') || v.ruleId.includes('inefficient')
    );

    for (const unsafeViolation of unsafeViolations) {
      for (const optViolation of optimizationViolations) {
        if (this.isSameLocation(unsafeViolation, optViolation)) {
          conflicts.push({
            conflictType: ConflictType.CONTRADICTORY_OPTIMIZATION,
            severity: ConflictSeverity.HIGH,
            description: 'Unsafe operation fix conflicts with optimization suggestion',
            involvedRules: [unsafeViolation.ruleId, optViolation.ruleId],
            violations: [unsafeViolation, optViolation],
            conflictingSuggestions: [
              suggestions[violations.indexOf(unsafeViolation)],
              suggestions[violations.indexOf(optViolation)],
            ].filter(Boolean) as Suggestion[],
            location: unsafeViolation.location,
            resolutionSuggestion: 'Prioritize safety over optimization',
            category1: SorobanRuleCategory.SECURITY,
            category2: SorobanRuleCategory.OPTIMIZATION,
            priorityScore: 95,
            autoResolvable: true,
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Check for event emission conflicts
   */
  private checkEventEmissionConflicts(
    violations: RuleViolation[],
    suggestions: Suggestion[]
  ): SorobanConflictInfo[] {
    const conflicts: SorobanConflictInfo[] = [];

    const eventViolations = violations.filter((v) => v.ruleId.includes('event'));

    for (let i = 0; i < eventViolations.length; i++) {
      for (let j = i + 1; j < eventViolations.length; j++) {
        const v1 = eventViolations[i];
        const v2 = eventViolations[j];

        if (this.isSameLocation(v1, v2)) {
          conflicts.push({
            conflictType: ConflictType.OVERLAPPING_MODIFICATION,
            severity: ConflictSeverity.MEDIUM,
            description: 'Multiple event-related rules suggest modifications at the same location',
            involvedRules: [v1.ruleId, v2.ruleId],
            violations: [v1, v2],
            conflictingSuggestions: [
              suggestions[violations.indexOf(v1)],
              suggestions[violations.indexOf(v2)],
            ].filter(Boolean) as Suggestion[],
            location: v1.location,
            resolutionSuggestion: 'Review which event optimization is most appropriate',
            category1: SorobanRuleCategory.EVENTS,
            category2: SorobanRuleCategory.EVENTS,
            priorityScore: 70,
            autoResolvable: false,
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Calculate priority score for a conflict
   */
  private calculatePriorityScore(
    conflict: ConflictInfo,
    metadata1?: SorobanRuleMetadata,
    metadata2?: SorobanRuleMetadata
  ): number {
    let score = 0;

    // Base score from severity
    switch (conflict.severity) {
      case ConflictSeverity.HIGH:
        score += 50;
        break;
      case ConflictSeverity.MEDIUM:
        score += 30;
        break;
      case ConflictSeverity.LOW:
        score += 10;
        break;
    }

    // Add priority from rule metadata
    if (metadata1?.securityCritical || metadata2?.securityCritical) {
      score += 40;
    }

    score += (metadata1?.priority || 50) / 2;
    score += (metadata2?.priority || 50) / 2;

    return Math.min(score, 100);
  }

  /**
   * Determine if a conflict can be auto-resolved
   */
  private isAutoResolvable(
    conflict: ConflictInfo,
    metadata1?: SorobanRuleMetadata,
    metadata2?: SorobanRuleMetadata
  ): boolean {
    // Security-critical conflicts can be auto-resolved by preferring security
    if (metadata1?.securityCritical && !metadata2?.securityCritical) {
      return true;
    }
    if (!metadata1?.securityCritical && metadata2?.securityCritical) {
      return true;
    }

    // High severity conflicts with clear resolution strategies
    if (conflict.severity === ConflictSeverity.HIGH) {
      const strategy = this.conflictDetector.getResolutionStrategy(conflict);
      return (
        strategy === ResolutionStrategy.PREFER_FIRST ||
        strategy === ResolutionStrategy.PREFER_SECOND
      );
    }

    return false;
  }

  /**
   * Determine the best resolution strategy for a conflict
   */
  private determineResolutionStrategy(conflict: SorobanConflictInfo): ResolutionStrategy {
    // If auto-resolvable, use the appropriate strategy
    if (conflict.autoResolvable) {
      const metadata1 = this.getRuleMetadata(conflict.involvedRules[0]);
      const metadata2 = this.getRuleMetadata(conflict.involvedRules[1]);

      if (metadata1?.securityCritical && !metadata2?.securityCritical) {
        return ResolutionStrategy.PREFER_FIRST;
      }
      if (!metadata1?.securityCritical && metadata2?.securityCritical) {
        return ResolutionStrategy.PREFER_SECOND;
      }

      if (metadata1 && metadata2 && metadata1.priority > metadata2.priority) {
        return ResolutionStrategy.PREFER_FIRST;
      }
      if (metadata1 && metadata2 && metadata2.priority > metadata1.priority) {
        return ResolutionStrategy.PREFER_SECOND;
      }
    }

    // Use the base detector's strategy
    return this.conflictDetector.getResolutionStrategy(conflict);
  }

  /**
   * Attempt to merge conflicting suggestions
   */
  private mergeSuggestions(conflict: SorobanConflictInfo): string | undefined {
    if (conflict.conflictingSuggestions.length < 2) {
      return undefined;
    }

    const s1 = conflict.conflictingSuggestions[0];
    const s2 = conflict.conflictingSuggestions[1];

    // If suggestions are similar, combine them
    if (s1.message === s2.message) {
      return s1.message;
    }

    // For optimization conflicts, try to create a combined message
    if (conflict.category1 === SorobanRuleCategory.OPTIMIZATION &&
        conflict.category2 === SorobanRuleCategory.OPTIMIZATION) {
      return `Consider both optimizations: ${s1.message} and ${s2.message}`;
    }

    return undefined;
  }

  /**
   * Get metadata for a rule
   */
  private getRuleMetadata(ruleId: string): SorobanRuleMetadata | undefined {
    return this.ruleMetadata.get(ruleId);
  }

  /**
   * Initialize rule metadata for Soroban rules
   */
  private initializeRuleMetadata(): void {
    // Access control rules
    this.ruleMetadata.set('detect-missing-access-control', {
      ruleId: 'detect-missing-access-control',
      category: SorobanRuleCategory.ACCESS_CONTROL,
      priority: 90,
      securityCritical: true,
    });
    this.ruleMetadata.set('detect-weak-role-hierarchies', {
      ruleId: 'detect-weak-role-hierarchies',
      category: SorobanRuleCategory.ACCESS_CONTROL,
      priority: 85,
      securityCritical: true,
    });

    // Optimization rules
    this.ruleMetadata.set('detect-inefficient-symbol-usage', {
      ruleId: 'detect-inefficient-symbol-usage',
      category: SorobanRuleCategory.OPTIMIZATION,
      priority: 60,
      securityCritical: false,
    });
    this.ruleMetadata.set('detect-inefficient-loop', {
      ruleId: 'detect-inefficient-loop',
      category: SorobanRuleCategory.OPTIMIZATION,
      priority: 55,
      securityCritical: false,
    });

    // Security rules
    this.ruleMetadata.set('detect-unsafe-operations', {
      ruleId: 'detect-unsafe-operations',
      category: SorobanRuleCategory.SECURITY,
      priority: 95,
      securityCritical: true,
    });
    this.ruleMetadata.set('detect-inconsistent-visibility', {
      ruleId: 'detect-inconsistent-visibility',
      category: SorobanRuleCategory.SECURITY,
      priority: 80,
      securityCritical: true,
    });

    // Cross-contract rules
    this.ruleMetadata.set('detect-unsafe-cross-contract-invocation', {
      ruleId: 'detect-unsafe-cross-contract-invocation',
      category: SorobanRuleCategory.CROSS_CONTRACT,
      priority: 90,
      securityCritical: true,
    });

    // Event rules
    this.ruleMetadata.set('detect-excessive-event-topics', {
      ruleId: 'detect-excessive-event-topics',
      category: SorobanRuleCategory.EVENTS,
      priority: 50,
      securityCritical: false,
    });

    // Upgradeability rules
    this.ruleMetadata.set('detect-missing-upgrade-guards', {
      ruleId: 'detect-missing-upgrade-guards',
      category: SorobanRuleCategory.UPGRADEABILITY,
      priority: 85,
      securityCritical: true,
    });
  }

  /**
   * Check if two violations are at the same location
   */
  private isSameLocation(v1: RuleViolation, v2: RuleViolation): boolean {
    return (
      v1.location?.file === v2.location?.file &&
      v1.location?.line === v2.location?.line &&
      v1.location?.column === v2.location?.column
    );
  }
}
