import { Finding, Severity } from '@engine/core';
import { DeduplicationEngine } from './deduplication-engine';
import { DedupStrategy, DedupResult } from './types';

describe('DeduplicationEngine', () => {
  const baseFinding: Finding = {
    ruleId: 'soroban-reentrancy',
    message: 'Potential reentrancy vulnerability in transfer function',
    severity: Severity.CRITICAL,
    location: {
      file: 'contracts/token.sol',
      startLine: 42,
      endLine: 45,
    },
  };

  function makeFinding(overrides: Partial<Finding> = {}): Finding {
    return { ...baseFinding, ...overrides };
  }

  describe('deduplicate', () => {
    it('should return empty result for empty input', () => {
      const engine = new DeduplicationEngine();
      const result = engine.deduplicate([]);
      expect(result.originalCount).toBe(0);
      expect(result.uniqueCount).toBe(0);
      expect(result.mergedFindings).toHaveLength(0);
    });

    it('should keep unique findings as-is', () => {
      const findings = [
        makeFinding({ ruleId: 'rule-1', message: 'Finding A', location: { file: 'a.rs', startLine: 1, endLine: 1 } }),
        makeFinding({ ruleId: 'rule-2', message: 'Finding B', location: { file: 'b.rs', startLine: 2, endLine: 2 } }),
        makeFinding({ ruleId: 'rule-3', message: 'Finding C', location: { file: 'c.rs', startLine: 3, endLine: 3 } }),
      ];
      const engine = new DeduplicationEngine({
        strategies: [DedupStrategy.EXACT_MATCH, DedupStrategy.NORMALIZED_MATCH, DedupStrategy.FUZZY_MATCH],
      });
      const result = engine.deduplicate(findings);
      expect(result.originalCount).toBe(3);
      expect(result.uniqueCount).toBe(3);
      expect(result.groups).toHaveLength(0);
    });

    it('should detect exact duplicate findings', () => {
      const findings = [makeFinding(), makeFinding()];
      const engine = new DeduplicationEngine();
      const result = engine.deduplicate(findings);
      expect(result.originalCount).toBe(2);
      expect(result.uniqueCount).toBe(1);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].strategy).toBe(DedupStrategy.EXACT_MATCH);
    });

    it('should detect normalized match duplicates', () => {
      const findings = [
        makeFinding({ message: 'Potential reentrancy  vulnerability' }),
        makeFinding({ message: 'Potential reentrancy vulnerability' }),
      ];
      const engine = new DeduplicationEngine({
        strategies: [DedupStrategy.NORMALIZED_MATCH],
      });
      const result = engine.deduplicate(findings);
      expect(result.originalCount).toBe(2);
      expect(result.uniqueCount).toBe(1);
    });

    it('should detect same-location duplicates', () => {
      const findings = [
        makeFinding({ ruleId: 'rule-a', message: 'First rule' }),
        makeFinding({ ruleId: 'rule-b', message: 'Second rule' }),
      ];
      const engine = new DeduplicationEngine({
        strategies: [DedupStrategy.SAME_LOCATION],
      });
      const result = engine.deduplicate(findings);
      expect(result.originalCount).toBe(2);
      expect(result.uniqueCount).toBe(1);
    });

    it('should detect fuzzy match duplicates above threshold', () => {
      const findings = [
        makeFinding({
          message: 'Potential reentrancy vulnerability in transfer',
        }),
        makeFinding({
          message: 'Potential re-entrancy vulnerability in transfer',
        }),
      ];
      const engine = new DeduplicationEngine({
        strategies: [DedupStrategy.FUZZY_MATCH],
        fuzzyThreshold: 0.7,
      });
      const result = engine.deduplicate(findings);
      expect(result.originalCount).toBe(2);
      expect(result.uniqueCount).toBe(1);
    });

    it('should not merge findings with low fuzzy similarity', () => {
      const findings = [
        makeFinding({ message: 'Critical security issue in token contract', location: { file: 'c.sol', startLine: 1, endLine: 1 } }),
        makeFinding({ message: 'Gas optimization suggestion for loop', location: { file: 'c.sol', startLine: 2, endLine: 2 } }),
      ];
      const engine = new DeduplicationEngine({
        strategies: [DedupStrategy.FUZZY_MATCH],
        fuzzyThreshold: 0.9,
      });
      const result = engine.deduplicate(findings);
      expect(result.uniqueCount).toBe(2);
      expect(result.groups).toHaveLength(0);
    });
  });

  describe('selectCanonical', () => {
    it('should favor the most severe finding as canonical', () => {
      const findings = [
        makeFinding({ severity: Severity.HIGH }),
        makeFinding({ severity: Severity.CRITICAL }),
      ];
      const engine = new DeduplicationEngine();
      const result = engine.deduplicate(findings);
      expect(result.mergedFindings[0].severity).toBe(Severity.CRITICAL);
    });

    it('should use the finding with more metadata when severities match', () => {
      const findings = [
        makeFinding({
          severity: Severity.HIGH,
          metadata: { extra: 'info' },
        }),
        makeFinding({ severity: Severity.HIGH }),
      ];
      const engine = new DeduplicationEngine();
      const result = engine.deduplicate(findings);
      expect(result.mergedFindings[0].metadata?.extra).toBe('info');
    });
  });

  describe('buildDedupKey', () => {
    it('should build a dedup key for a finding', () => {
      const engine = new DeduplicationEngine();
      const key = engine.buildDedupKey(baseFinding);
      expect(key.ruleId).toBe('soroban-reentrancy');
      expect(key.file).toBe('contracts/token.sol');
      expect(key.startLine).toBe(42);
    });
  });

  describe('deduplicateAsync', () => {
    it('should deduplicate findings asynchronously', async () => {
      const findings = [makeFinding(), makeFinding()];
      const engine = new DeduplicationEngine();
      const result = await engine.deduplicateAsync(findings);
      expect(result.originalCount).toBe(2);
      expect(result.uniqueCount).toBe(1);
    });
  });
});
