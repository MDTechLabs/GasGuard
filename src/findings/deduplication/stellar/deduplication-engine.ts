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

const SEVERITY_RANK: Record<string, number> = {
  [Severity.CRITICAL]: 5,
  [Severity.HIGH]: 4,
  [Severity.MEDIUM]: 3,
  [Severity.LOW]: 2,
  [Severity.INFO]: 1,
};

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
  private readonly config: Required<DedupConfig>;

  constructor(config?: Partial<DedupConfig>) {
    const rawStrategies = config?.strategies ?? DEFAULT_CONFIG.strategies;
    const uniqueStrategies = [...new Set(rawStrategies)];
    const threshold = config?.fuzzyThreshold ?? DEFAULT_CONFIG.fuzzyThreshold;

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      strategies: uniqueStrategies,
      fuzzyThreshold: Math.min(1, Math.max(0, threshold)),
      maxGroupSize: Math.max(2, config?.maxGroupSize ?? DEFAULT_CONFIG.maxGroupSize),
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
      if (this.areDuplicateByStrategy(a, b, strategy)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Exact match: two findings are duplicates if core identity and location fields match.
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
    const messageMatch = this.normalizeText(a.message) === this.normalizeText(b.message);
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
   * Fuzzy match: evaluate message similarity for findings with matching rule and severity.
   */
  private isFuzzyMatch(a: Finding, b: Finding): boolean {
    if (a.ruleId !== b.ruleId) return false;
    if (a.severity !== b.severity) return false;

    const similarity = this.stringSimilarity(a.message, b.message);
    return similarity >= this.config.fuzzyThreshold;
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
   * Normalized Levenshtein-based string similarity in [0, 1].
   */
  private stringSimilarity(a: string, b: string): number {
    const s1 = a.toLowerCase();
    const s2 = b.toLowerCase();
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;

    const distance = this.levenshteinDistance(s1, s2);
    return Math.max(0, 1.0 - distance / maxLen);
  }

  /**
   * Compute Levenshtein distance using O(min(m, n)) space.
   */
  private levenshteinDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Ensure `shorter` is along the DP row so memory stays minimal
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    const m = shorter.length;
    const n = longer.length;

    let prev = new Array<number>(m + 1);
    let curr = new Array<number>(m + 1);

    for (let i = 0; i <= m; i++) {
      prev[i] = i;
    }

    for (let j = 1; j <= n; j++) {
      curr[0] = j;
      const bChar = longer.charCodeAt(j - 1);

      for (let i = 1; i <= m; i++) {
        const cost = shorter.charCodeAt(i - 1) === bChar ? 0 : 1;
        const insertion = prev[i] + 1;
        const deletion = curr[i - 1] + 1;
        const substitution = prev[i - 1] + cost;
        curr[i] = Math.min(insertion, deletion, substitution);
      }

      [prev, curr] = [curr, prev];
    }

    return prev[m];
  }

  /**
   * Determine which strategy was used for a group (preferring the most specific).
   */
  private determineStrategy(group: Finding[]): DedupStrategy {
    if (group.length < 2) return DedupStrategy.EXACT_MATCH;

    const specificityOrder: DedupStrategy[] = [
      DedupStrategy.EXACT_MATCH,
      DedupStrategy.NORMALIZED_MATCH,
      DedupStrategy.FUZZY_MATCH,
      DedupStrategy.SAME_LOCATION,
    ];

    for (const strategy of specificityOrder) {
      const allMatch = group
        .slice(1)
        .every((item) => this.areDuplicateByStrategy(group[0], item, strategy));

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
   * Select the canonical (best) finding from a group. Prefers higher
   * severity, then richer metadata.
   */
  private selectCanonical(group: Finding[]): Finding {
    return group.reduce((best, current) => {
      const bestSeverity = SEVERITY_RANK[best.severity] ?? 0;
      const currentSeverity = SEVERITY_RANK[current.severity] ?? 0;

      if (currentSeverity !== bestSeverity) {
        return currentSeverity > bestSeverity ? current : best;
      }

      const bestMetaCount = best.metadata ? Object.keys(best.metadata).length : 0;
      const currentMetaCount = current.metadata
        ? Object.keys(current.metadata).length
        : 0;

      return currentMetaCount > bestMetaCount ? current : best;
    });
  }

  /**
   * Merge finding groups into a flat list of canonical findings while
   * preserving original relative order for ungrouped findings.
   */
  private mergeGroups(groups: FindingGroup[], originalFindings: Finding[]): Finding[] {
    const groupedFindings = new Set<Finding>();
    const groupByCanonical = new Map<Finding, FindingGroup>();

    for (const group of groups) {
      groupedFindings.add(group.canonical);
      groupByCanonical.set(group.canonical, group);
      for (const dup of group.duplicates) {
        groupedFindings.add(dup);
      }
    }

    const merged: Finding[] = [];
    for (const finding of originalFindings) {
      const matchingGroup = groupByCanonical.get(finding);
      if (matchingGroup) {
        merged.push(this.enhanceCanonical(matchingGroup));
      } else if (!groupedFindings.has(finding)) {
        merged.push(finding);
      }
    }

    return merged;
  }

  /**
   * Enhance a canonical finding with merged messages and metadata from duplicates.
   */
  private enhanceCanonical(group: FindingGroup): Finding {
    const { canonical, duplicates } = group;

    if (duplicates.length === 0) return canonical;

    const mergedMessage = this.mergeMessages([
      canonical.message,
      ...duplicates.map((d) => d.message),
    ]);

    const mergedMetadata: Record<string, unknown> = {
      ...(canonical.metadata ?? {}),
      dedupGroupId: group.groupId,
      dedupStrategy: group.strategy,
      dedupCount: 1 + duplicates.length,
      dedupTimestamps: [group.mergeTimestamp],
      deduplicationMerged: true,
    };

    const additionalGasSavings: number[] = [];

    for (const dup of duplicates) {
      if (dup.metadata) {
        for (const [key, value] of Object.entries(dup.metadata)) {
          if (!(key in mergedMetadata)) {
            mergedMetadata[key] = value;
          }
        }
      }
      if (dup.estimatedGasSavings !== undefined) {
        additionalGasSavings.push(dup.estimatedGasSavings);
      }
    }

    if (additionalGasSavings.length > 0) {
      mergedMetadata.additionalGasSavings =
        additionalGasSavings.length === 1
          ? additionalGasSavings[0]
          : additionalGasSavings;
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
      normalizedMessage: this.normalizeText(finding.message),
      startLine: finding.location.startLine,
      endLine: finding.location.endLine,
      file: finding.location.file,
    };
  }

  /**
   * Normalize text according to whitespace and case settings.
   */
  private normalizeText(text: string): string {
    let normalized = text;
    if (this.config.normalizeWhitespace) {
      normalized = normalized.replace(/\s+/g, ' ').trim();
    }
    if (this.config.ignoreCase) {
      normalized = normalized.toLowerCase();
    }
    return normalized;
  }
}