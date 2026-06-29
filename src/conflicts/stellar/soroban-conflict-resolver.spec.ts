/**
 * Soroban Conflict Resolver Tests
 * 
 * Tests for detecting and resolving Soroban-specific rule conflicts
 */

import { SorobanConflictResolver } from './soroban-conflict-resolver';
import { SorobanRuleCategory, ConflictSeverity, ConflictType } from './types';
import { RuleViolation } from '../../analysis/pipeline/types';
import { Suggestion } from '../../analysis/context/context-aware-suggestions';

describe('SorobanConflictResolver', () => {
  let resolver: SorobanConflictResolver;

  beforeEach(() => {
    resolver = new SorobanConflictResolver();
  });

  describe('detectSorobanConflicts', () => {
    it('should detect access control vs optimization conflicts', () => {
      const violations: RuleViolation[] = [
        {
          ruleId: 'detect-missing-access-control',
          type: 'security',
          severity: 'high',
          message: 'Privileged function lacks access control',
          location: { file: 'contract.rs', line: 10, column: 0 },
        },
        {
          ruleId: 'detect-inefficient-symbol-usage',
          type: 'optimization',
          severity: 'medium',
          message: 'Symbol constructed multiple times',
          location: { file: 'contract.rs', line: 10, column: 0 },
        },
      ];

      const suggestions: Suggestion[] = [
        {
          ruleId: 'detect-missing-access-control',
          message: 'Add require_auth() check',
        },
        {
          ruleId: 'detect-inefficient-symbol-usage',
          message: 'Use static symbol reference',
        },
      ];

      const conflicts = resolver.detectSorobanConflicts(violations, suggestions);

      expect(conflicts.length).toBeGreaterThan(0);
      const accessControlConflict = conflicts.find(
        (c) =>
          c.category1 === SorobanRuleCategory.ACCESS_CONTROL &&
          c.category2 === SorobanRuleCategory.OPTIMIZATION
      );
      expect(accessControlConflict).toBeDefined();
      expect(accessControlConflict?.severity).toBe(ConflictSeverity.HIGH);
      expect(accessControlConflict?.autoResolvable).toBe(true);
    });

    it('should detect unsafe operation vs optimization conflicts', () => {
      const violations: RuleViolation[] = [
        {
          ruleId: 'detect-unsafe-operations',
          type: 'security',
          severity: 'critical',
          message: 'Unsafe block detected',
          location: { file: 'contract.rs', line: 20, column: 0 },
        },
        {
          ruleId: 'detect-inefficient-loop',
          type: 'optimization',
          severity: 'medium',
          message: 'Inefficient loop detected',
          location: { file: 'contract.rs', line: 20, column: 0 },
        },
      ];

      const suggestions: Suggestion[] = [
        {
          ruleId: 'detect-unsafe-operations',
          message: 'Remove unsafe block',
        },
        {
          ruleId: 'detect-inefficient-loop',
          message: 'Optimize loop structure',
        },
      ];

      const conflicts = resolver.detectSorobanConflicts(violations, suggestions);

      expect(conflicts.length).toBeGreaterThan(0);
      const unsafeConflict = conflicts.find(
        (c) =>
          c.category1 === SorobanRuleCategory.SECURITY &&
          c.category2 === SorobanRuleCategory.OPTIMIZATION
      );
      expect(unsafeConflict).toBeDefined();
      expect(unsafeConflict?.severity).toBe(ConflictSeverity.HIGH);
    });

    it('should detect event emission conflicts', () => {
      const violations: RuleViolation[] = [
        {
          ruleId: 'detect-excessive-event-topics',
          type: 'events',
          severity: 'warning',
          message: 'Too many event topics',
          location: { file: 'contract.rs', line: 30, column: 0 },
        },
        {
          ruleId: 'detect-excessive-event-topics',
          type: 'events',
          severity: 'warning',
          message: 'Event topics exceed limit',
          location: { file: 'contract.rs', line: 30, column: 0 },
        },
      ];

      const suggestions: Suggestion[] = [
        {
          ruleId: 'detect-excessive-event-topics',
          message: 'Reduce event topics',
        },
        {
          ruleId: 'detect-excessive-event-topics',
          message: 'Consolidate event data',
        },
      ];

      const conflicts = resolver.detectSorobanConflicts(violations, suggestions);

      const eventConflict = conflicts.find(
        (c) =>
          c.category1 === SorobanRuleCategory.EVENTS &&
          c.category2 === SorobanRuleCategory.EVENTS
      );
      expect(eventConflict).toBeDefined();
      expect(eventConflict?.conflictType).toBe(ConflictType.OVERLAPPING_MODIFICATION);
    });

    it('should return empty array when no conflicts exist', () => {
      const violations: RuleViolation[] = [
        {
          ruleId: 'detect-missing-access-control',
          type: 'security',
          severity: 'high',
          message: 'Privileged function lacks access control',
          location: { file: 'contract.rs', line: 10, column: 0 },
        },
      ];

      const suggestions: Suggestion[] = [
        {
          ruleId: 'detect-missing-access-control',
          message: 'Add require_auth() check',
        },
      ];

      const conflicts = resolver.detectSorobanConflicts(violations, suggestions);

      // Should not have Soroban-specific conflicts
      const sorobanConflicts = conflicts.filter(
        (c) => c.category1 !== SorobanRuleCategory.SECURITY || c.category2 !== SorobanRuleCategory.SECURITY
      );
      expect(sorobanConflicts.length).toBe(0);
    });
  });

  describe('resolveConflict', () => {
    it('should prefer security-critical rules over optimization', () => {
      const conflict = {
        conflictType: ConflictType.CONTRADICTORY_OPTIMIZATION,
        severity: ConflictSeverity.HIGH,
        description: 'Access control conflicts with optimization',
        involvedRules: ['detect-missing-access-control', 'detect-inefficient-symbol-usage'],
        violations: [],
        conflictingSuggestions: [],
        location: { file: 'contract.rs', line: 10 },
        resolutionSuggestion: 'Prioritize access control',
        category1: SorobanRuleCategory.ACCESS_CONTROL,
        category2: SorobanRuleCategory.OPTIMIZATION,
        priorityScore: 100,
        autoResolvable: true,
      };

      const resolution = resolver.resolveConflict(conflict);

      expect(resolution.strategy).toBeDefined();
      expect(resolution.explanation).toContain('priority');
    });

    it('should require user input for non-auto-resolvable conflicts', () => {
      const conflict = {
        conflictType: ConflictType.OVERLAPPING_MODIFICATION,
        severity: ConflictSeverity.MEDIUM,
        description: 'Multiple event modifications',
        involvedRules: ['detect-excessive-event-topics', 'detect-excessive-event-topics'],
        violations: [],
        conflictingSuggestions: [],
        location: { file: 'contract.rs', line: 30 },
        resolutionSuggestion: 'Review event optimizations',
        category1: SorobanRuleCategory.EVENTS,
        category2: SorobanRuleCategory.EVENTS,
        priorityScore: 70,
        autoResolvable: false,
      };

      const resolution = resolver.resolveConflict(conflict);

      expect(resolution.explanation).toContain('manual review');
    });

    it('should attempt to merge compatible suggestions', () => {
      const conflict = {
        conflictType: ConflictType.CONTRADICTORY_OPTIMIZATION,
        severity: ConflictSeverity.MEDIUM,
        description: 'Multiple optimizations',
        involvedRules: ['detect-inefficient-symbol-usage', 'detect-inefficient-loop'],
        violations: [],
        conflictingSuggestions: [
          { ruleId: 'detect-inefficient-symbol-usage', message: 'Use static symbol' },
          { ruleId: 'detect-inefficient-loop', message: 'Optimize loop' },
        ],
        location: { file: 'contract.rs', line: 15 },
        resolutionSuggestion: 'Apply both optimizations',
        category1: SorobanRuleCategory.OPTIMIZATION,
        category2: SorobanRuleCategory.OPTIMIZATION,
        priorityScore: 60,
        autoResolvable: false,
      };

      const resolution = resolver.resolveConflict(conflict);

      expect(resolution.mergedSuggestion).toBeDefined();
      expect(resolution.mergedSuggestion).toContain('both optimizations');
    });
  });

  describe('generateConflictSummary', () => {
    it('should generate comprehensive conflict summary', () => {
      const conflicts = [
        {
          conflictType: ConflictType.CONTRADICTORY_OPTIMIZATION,
          severity: ConflictSeverity.HIGH,
          description: 'Access control vs optimization',
          involvedRules: ['detect-missing-access-control', 'detect-inefficient-symbol-usage'],
          violations: [],
          conflictingSuggestions: [],
          location: { file: 'contract.rs', line: 10 },
          resolutionSuggestion: 'Prioritize security',
          category1: SorobanRuleCategory.ACCESS_CONTROL,
          category2: SorobanRuleCategory.OPTIMIZATION,
          priorityScore: 100,
          autoResolvable: true,
        },
        {
          conflictType: ConflictType.OVERLAPPING_MODIFICATION,
          severity: ConflictSeverity.MEDIUM,
          description: 'Event modification conflict',
          involvedRules: ['detect-excessive-event-topics', 'detect-excessive-event-topics'],
          violations: [],
          conflictingSuggestions: [],
          location: { file: 'contract.rs', line: 20 },
          resolutionSuggestion: 'Review events',
          category1: SorobanRuleCategory.EVENTS,
          category2: SorobanRuleCategory.EVENTS,
          priorityScore: 70,
          autoResolvable: false,
        },
      ];

      const summary = resolver.generateConflictSummary(conflicts);

      expect(summary.totalConflicts).toBe(2);
      expect(summary.autoResolvableCount).toBe(1);
      expect(summary.requiresUserInputCount).toBe(1);
      expect(summary.conflictsBySeverity[ConflictSeverity.HIGH]).toBe(1);
      expect(summary.conflictsBySeverity[ConflictSeverity.MEDIUM]).toBe(1);
      expect(summary.topPriorityConflicts.length).toBe(2);
      expect(summary.topPriorityConflicts[0].priorityScore).toBeGreaterThanOrEqual(
        summary.topPriorityConflicts[1].priorityScore
      );
    });

    it('should handle empty conflict list', () => {
      const summary = resolver.generateConflictSummary([]);

      expect(summary.totalConflicts).toBe(0);
      expect(summary.autoResolvableCount).toBe(0);
      expect(summary.requiresUserInputCount).toBe(0);
      expect(summary.topPriorityConflicts.length).toBe(0);
    });
  });

  describe('priority scoring', () => {
    it('should assign higher priority to security-critical conflicts', () => {
      const violations: RuleViolation[] = [
        {
          ruleId: 'detect-unsafe-operations',
          type: 'security',
          severity: 'critical',
          message: 'Unsafe operation',
          location: { file: 'contract.rs', line: 10, column: 0 },
        },
        {
          ruleId: 'detect-inefficient-symbol-usage',
          type: 'optimization',
          severity: 'medium',
          message: 'Inefficient symbol usage',
          location: { file: 'contract.rs', line: 10, column: 0 },
        },
      ];

      const suggestions: Suggestion[] = [
        { ruleId: 'detect-unsafe-operations', message: 'Fix unsafe operation' },
        { ruleId: 'detect-inefficient-symbol-usage', message: 'Optimize symbol usage' },
      ];

      const conflicts = resolver.detectSorobanConflicts(violations, suggestions);
      const securityConflict = conflicts.find(
        (c) =>
          c.category1 === SorobanRuleCategory.SECURITY &&
          c.category2 === SorobanRuleCategory.OPTIMIZATION
      );

      expect(securityConflict?.priorityScore).toBeGreaterThan(80);
    });
  });
});
