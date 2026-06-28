/**
 * Soroban Finding Deduplication Engine
 *
 * Detects duplicate findings across analysis stages and merges related
 * findings using configurable strategies. Supports exact match,
 * normalized match, fuzzy match, and same-location strategies.
 */

import { Finding, Severity } from '@engine/core';

import {
  DedupKey,
  DedupStrategy,
  FindingGroup,
  DedupConfig,
  DedupResult,
} from './types';

const DEFAULT_CONFIG: Required<DedupConfig> = {
  strategies: [
    DedupStrategy.EXACT_MATCH,
    DedupStrategy.NORMALIZED_MATCH,
    DedupStrategy.SAME_LOCATION,
  ],
  fuzzyThreshold: 0.85,
  normalizeWhitespace: true,
  ignoreCase: true,
  ignoreLineNumbers: false,
  maxGroupSize: 10,
};

export class DeduplicationEngine {
  private config: Required<DedupConfig>;

  constructor(config?: Partial<DedupConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      strategies: config?.strategies ?? DEFAULT_CONFIG.strategies,
    };
  }

  /**
   * Deduplicate an array of findings, returning a DedupResult with
   * groups of duplicates and the final merged list.
   */
  deduplicate(findings: Finding[]): DedupResult {
    if (findings.length === 0) {
      return {
        originalCount: 0,
        uniqueCount: 0,
        duplicateCount: 0,
        groups: [],
        mergedFindings: [],
      };
    }

    const groups = this.buildGroups(findings);
    const mergedFindings = this.mergeGroups(groups, findings);

    return {
      originalCount: findings.length,
      uniqueCount: mergedFindings.length,
      duplicateCount: findings.length - mergedFindings.length,
      groups,
      mergedFindings,
    };
  }

  /**
   * Deduplicate findings asynchronously.
   */
  async deduplicateAsync(findings: Finding[]): Promise<DedupResult> {
    return this.deduplicate(findings);
  }

  /**
   * Build groups of duplicate findings using the configured strategies.
   */
  private buildGroups(findings: Finding[]): FindingGroup[] {
    const groups: FindingGroup[] = [];
    const visited = new Set<number>();

    for (let i = 0; i < findings.length; i++) {
      if (visited.has(i)) continue;

      const group: Finding[] = [findings[i]];
      visited.add(i);

      for (let j = i + 1; j < findings.length; j++) {
        if (visited.has(j)) continue;
        if (this.areDuplicates(findings[i], findings[j])) {
          group.push(findings[j]);
          visited.add(j);

          if (group.length >= this.config.maxGroupSize) {
            break;
          }
        }
      }

      if (group.length > 1) {
        const strategy = this.determineStrategy(group);
        const canonical = this.selectCanonical(group);
        const duplicates = group.filter((f) => f !== canonical);

        groups.push({
          groupId: `group-${groups.length + 1}`,
          canonical,
          duplicates,
          strategy,
          mergeTimestamp: Date.now(),
        });
      }
    }

    return groups;
  }

  /**
   * Determine if two findings are duplicates using the configured strategies.
   */
  private areDuplicates(a: Finding, b: Finding): boolean {
    for (const strategy of this.config.strategies) {
      switch (strategy) {
        case DedupStrategy.EXACT_MATCH:
          if (this.isExactMatch(a, b)) return true;
          break;
        case DedupStrategy.NORMALIZED_MATCH:
          if (this.isNormalizedMatch(a, b)) return true;
          break;
        case DedupStrategy.FUZZY_MATCH:
          if (this.isFuzzyMatch(a, b)) return true;
          break;
        case DedupStrategy.SAME_LOCATION:
          if (this.isSameLocation(a, b)) return true;
          break;
      }
    }
    return false;
  }

  /**
   * Exact match: two findings are duplicates if every field is identical.
   */
  private isExactMatch(a: Finding, b: Finding): boolean {
    return (
      a.ruleId === b.ruleId &&
      a.message === b.message &&
      a.severity === b.severity &&
      a.location.file === b.location.file &&
      a.location.startLine === b.location.startLine &&
      a.location.endLine === b.location.endLine
    );
  }

  /**
   * Normalized match: compare findings after normalizing whitespace and case.
   */
  private isNormalizedMatch(a: Finding, b: Finding): boolean {
    const normalize = (s: string): string => {
      let result = s;
      if (this.config.normalizeWhitespace) {
        result = result.replace(/\s+/g, ' ').trim();
      }
      if (this.config.ignoreCase) {
        result = result.toLowerCase();
      }
      return result;
    };

    const messageMatch = normalize(a.message) === normalize(b.message);
    const ruleMatch = a.ruleId === b.ruleId;
    const fileMatch = a.location.file === b.location.file;

    if (!this.config.ignoreLineNumbers) {
      return (
        messageMatch &&
        ruleMatch &&
        fileMatch &&
        a.location.startLine === b.location.startLine
      );
    }

    return messageMatch && ruleMatch && fileMatch;
  }

  /**
   * Fuzzy match: use a simple string similarity heuristic.
   */
  private isFuzzyMatch(a: Finding, b: Finding): boolean {
    if (a.ruleId !== b.ruleId) return false;
    if (a.severity !== b.severity) return false;

    const similarity = this.stringSimilarity(a.message, b.message);
    return similarity >= (this.config.fuzzyThreshold ?? 0.85);
  }

  /**
   * Same-location match: findings at the same file and line range, regardless
   * of rule or message.
   */
  private isSameLocation(a: Finding, b: Finding): boolean {
    return (
      a.location.file === b.location.file &&
      a.location.startLine === b.location.startLine &&
      a.location.endLine === b.location.endLine
    );
  }

  /**
   * Simple Levenshtein-based string similarity as a ratio [0, 1].
   */
  private stringSimilarity(a: string, b: string): number {
    const s1 = a.toLowerCase();
    const s2 = b.toLowerCase();
    const len = Math.max(s1.length, s2.length);
    if (len === 0) return 1.0;

    const distance = this.levenshteinDistance(s1, s2);
    return 1.0 - distance / len;
  }

  /**
   * Compute Levenshtein distance between two strings.
   */
  private levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () =>
      Array(n + 1).fill(0),
    );

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost,
        );
      }
    }

    return dp[m][n];
  }

  /**
   * Determine which strategy was used for a group (prefer the most specific).
   */
  private determineStrategy(group: Finding[]): DedupStrategy {
    if (group.length < 2) return DedupStrategy.EXACT_MATCH;

    for (const strategy of [
      DedupStrategy.EXACT_MATCH,
      DedupStrategy.NORMALIZED_MATCH,
      DedupStrategy.FUZZY_MATCH,
      DedupStrategy.SAME_LOCATION,
    ]) {
      let allMatch = true;
      for (let i = 1; i < group.length; i++) {
        if (!this.areDuplicateByStrategy(group[0], group[i], strategy)) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) return strategy;
    }

    return DedupStrategy.SAME_LOCATION;
  }

  /**
   * Check if two findings match using a specific strategy.
   */
  private areDuplicateByStrategy(
    a: Finding,
    b: Finding,
    strategy: DedupStrategy,
  ): boolean {
    switch (strategy) {
      case DedupStrategy.EXACT_MATCH:
        return this.isExactMatch(a, b);
      case DedupStrategy.NORMALIZED_MATCH:
        return this.isNormalizedMatch(a, b);
      case DedupStrategy.FUZZY_MATCH:
        return this.isFuzzyMatch(a, b);
      case DedupStrategy.SAME_LOCATION:
        return this.isSameLocation(a, b);
      default:
        return false;
    }
  }

  /**
   * Select the canonical (best) finding from a group. Prefers the most
   * severe, then the one with the most detail.
   */
  private selectCanonical(group: Finding[]): Finding {
    return group.reduce((best, current) => {
      const severityOrder: Record<string, number> = {
        [Severity.CRITICAL]: 5,
        [Severity.HIGH]: 4,
        [Severity.MEDIUM]: 3,
        [Severity.LOW]: 2,
        [Severity.INFO]: 1,
      };

      const bestScore = severityOrder[best.severity] ?? 0;
      const currentScore = severityOrder[current.severity] ?? 0;

      if (currentScore > bestScore) return current;
      if (currentScore < bestScore) return best;

      // Prefer findings with more metadata
      const bestMeta = best.metadata ? Object.keys(best.metadata).length : 0;
      const currentMeta = current.metadata
        ? Object.keys(current.metadata).length
        : 0;

      return currentMeta > bestMeta ? current : best;
    });
  }

  /**
   * Merge finding groups into a single flat list of canonical findings,
   * including non-duplicate findings that did not form any group.
   */
  private mergeGroups(groups: FindingGroup[], originalFindings: Finding[]): Finding[] {
    const merged: Finding[] = [];
    const groupedIndices = new Set<number>();

    // Track indices of findings that belong to any group
    for (const group of groups) {
      // Find the index of the canonical finding
      const canonicalIdx = originalFindings.indexOf(group.canonical);
      if (canonicalIdx >= 0) {
        groupedIndices.add(canonicalIdx);
      }
      for (const dup of group.duplicates) {
        const dupIdx = originalFindings.indexOf(dup);
        if (dupIdx >= 0) {
          groupedIndices.add(dupIdx);
        }
      }

      const enhanced = this.enhanceCanonical(group);
      merged.push(enhanced);
    }

    // Add non-duplicate findings that are not in any group
    for (let i = 0; i < originalFindings.length; i++) {
      if (!groupedIndices.has(i)) {
        merged.push(originalFindings[i]);
      }
    }

    return merged;
  }

  /**
   * Enhance a canonical finding with metadata from its duplicates.
   */
  private enhanceCanonical(group: FindingGroup): Finding {
    const { canonical, duplicates } = group;

    if (duplicates.length === 0) return canonical;

    const allMessages = [
      canonical.message,
      ...duplicates.map((d) => d.message),
    ];
    const mergedMessage = this.mergeMessages(allMessages);

    const mergedMetadata: Record<string, unknown> = {
      ...(canonical.metadata ?? {}),
      dedupGroupId: group.groupId,
      dedupStrategy: group.strategy,
      dedupCount: 1 + duplicates.length,
      dedupTimestamps: [group.mergeTimestamp],
      deduplicationMerged: true,
    };

    // Collect unique metadata from duplicates
    for (const dup of duplicates) {
      if (dup.metadata) {
        for (const [key, value] of Object.entries(dup.metadata)) {
          if (!(key in mergedMetadata)) {
            mergedMetadata[key] = value;
          }
        }
      }
      if (dup.estimatedGasSavings !== undefined) {
        mergedMetadata.additionalGasSavings = dup.estimatedGasSavings;
      }
    }

    return {
      ...canonical,
      message: mergedMessage,
      metadata: mergedMetadata,
    };
  }

  /**
   * Merge multiple messages into a single canonical message.
   */
  private mergeMessages(messages: string[]): string {
    if (messages.length <= 1) return messages[0] ?? '';

    const unique = [...new Set(messages)];
    if (unique.length === 1) return unique[0];

    return `${unique[0]} (also detected in ${unique.length - 1} related form(s): "${unique.slice(1).join('", "')}")`;
  }

  /**
   * Build a DedupKey from a finding for external comparison.
   */
  buildDedupKey(finding: Finding): DedupKey {
    return {
      ruleId: finding.ruleId,
      normalizedMessage: this.normalizeForDedupKey(finding.message),
      startLine: finding.location.startLine,
      endLine: finding.location.endLine,
      file: finding.location.file,
    };
  }

  /**
   * Normalize a message string for use in a DedupKey.
   */
  private normalizeForDedupKey(message: string): string {
    let normalized = message;
    if (this.config.normalizeWhitespace) {
      normalized = normalized.replace(/\s+/g, ' ').trim();
    }
    if (this.config.ignoreCase) {
      normalized = normalized.toLowerCase();
    }
    return normalized;
  }
}
