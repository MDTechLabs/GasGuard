/**
 * Soroban Rule Suppression Framework
 *
 * Supports inline suppressions (code annotations) and configuration-based
 * suppressions. Records suppression reasons and excludes suppressed findings
 * from reports.
 *
 * @see Issue #476 — Implement Soroban Rule Suppression Framework
 */

import type {
  ConfigSuppression,
  Finding,
  InlineSuppression,
  Suppression,
  SuppressionFilterResult,
  SuppressionFrameworkConfig,
  SuppressionRecord,
} from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_ANNOTATION_PREFIX = 'gasguard-suppress:';

/**
 * Parse inline suppression annotations from a block of source text.
 *
 * Recognised formats (in single-line comments):
 *   // gasguard-suppress: GG001
 *   // gasguard-suppress: GG001 -- developer reason here
 *   // gasguard-suppress: GG001,GG002 -- multiple rules
 */
export function parseInlineSuppressions(
  source: string,
  filePath: string,
  annotationPrefix = DEFAULT_ANNOTATION_PREFIX,
): InlineSuppression[] {
  const results: InlineSuppression[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Look for single-line comment containing the annotation
    const commentIdx = line.indexOf('//');
    if (commentIdx === -1) continue;

    const comment = line.slice(commentIdx + 2).trim();
    if (!comment.toLowerCase().startsWith(annotationPrefix.toLowerCase())) continue;

    const rest = comment.slice(annotationPrefix.length).trim();
    // Split on "--" to separate rule IDs from reason
    const [rulesPart, ...reasonParts] = rest.split('--');
    const reason = reasonParts.join('--').trim() || 'No reason provided';
    const ruleIds = rulesPart
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    for (const ruleId of ruleIds) {
      results.push({
        source: 'inline',
        ruleId,
        filePath,
        line: i + 1,
        reason,
      });
    }
  }

  return results;
}

/**
 * Check if a file path matches a suppression scope glob.
 * Supports simple glob patterns using `*` and `**`.
 */
function matchesScope(filePath: string, scope: string): boolean {
  if (scope === 'global') return true;
  // Convert glob to regex: ** matches any path segment, * matches non-separator
  const pattern = scope
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials except * and ?
    .replace(/\*\*/g, '§GLOBSTAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/§GLOBSTAR§/g, '.*');
  return new RegExp(`^${pattern}$`).test(filePath);
}

// ─── Framework ────────────────────────────────────────────────────────────────

export class RuleSuppressionFramework {
  private readonly inlineSuppressions: InlineSuppression[] = [];
  private readonly configSuppressions: ConfigSuppression[] = [];
  private readonly annotationPrefix: string;
  private readonly warnOnSuppression: boolean;
  private readonly onSuppressed?: SuppressionFrameworkConfig['onSuppressed'];

  constructor(config: SuppressionFrameworkConfig = {}) {
    this.annotationPrefix = config.inlineAnnotationPrefix ?? DEFAULT_ANNOTATION_PREFIX;
    this.warnOnSuppression = config.warnOnSuppression ?? false;
    this.onSuppressed = config.onSuppressed;
  }

  // ─── Registration ─────────────────────────────────────────────────────────

  /**
   * Register inline suppressions parsed from a source file.
   */
  addInlineSuppressionsFromSource(source: string, filePath: string): void {
    const parsed = parseInlineSuppressions(source, filePath, this.annotationPrefix);
    this.inlineSuppressions.push(...parsed);
  }

  /**
   * Register inline suppressions directly (e.g. pre-parsed by a scanner).
   */
  addInlineSuppressions(suppressions: InlineSuppression[]): void {
    this.inlineSuppressions.push(...suppressions);
  }

  /**
   * Register configuration-based suppressions.
   * These are typically loaded from gasguard.config.json.
   */
  addConfigSuppressions(suppressions: ConfigSuppression[]): void {
    this.configSuppressions.push(...suppressions);
  }

  /**
   * Register a single configuration-based suppression.
   */
  addConfigSuppression(suppression: ConfigSuppression): void {
    this.configSuppressions.push(suppression);
  }

  // ─── Querying ─────────────────────────────────────────────────────────────

  /**
   * Return all registered suppressions (both inline and config).
   */
  getAllSuppressions(): Suppression[] {
    return [...this.inlineSuppressions, ...this.configSuppressions];
  }

  /**
   * Return all inline suppressions.
   */
  getInlineSuppressions(): InlineSuppression[] {
    return [...this.inlineSuppressions];
  }

  /**
   * Return all config suppressions.
   */
  getConfigSuppressions(): ConfigSuppression[] {
    return [...this.configSuppressions];
  }

  /**
   * Clear all registered suppressions.
   */
  clear(): void {
    this.inlineSuppressions.length = 0;
    this.configSuppressions.length = 0;
  }

  // ─── Matching ─────────────────────────────────────────────────────────────

  /**
   * Check if a finding is suppressed by any registered suppression.
   * Returns the matching suppression if found, or null.
   */
  findSuppression(finding: Finding): Suppression | null {
    // 1. Inline suppressions: must match ruleId and be in the same file
    //    (the annotation line must be at or immediately before the finding line)
    for (const s of this.inlineSuppressions) {
      if (s.ruleId === finding.ruleId && s.filePath === finding.filePath) {
        // Allow the annotation to appear on the line above or on the same line
        if (s.line === finding.line || s.line === finding.line - 1) {
          return s;
        }
      }
    }

    // 2. Config suppressions: match ruleId and scope
    for (const s of this.configSuppressions) {
      if (s.ruleId === finding.ruleId && matchesScope(finding.filePath, s.scope)) {
        return s;
      }
    }

    return null;
  }

  /**
   * Return true if a finding is suppressed.
   */
  isSuppressed(finding: Finding): boolean {
    return this.findSuppression(finding) !== null;
  }

  // ─── Filtering ────────────────────────────────────────────────────────────

  /**
   * Filter a list of findings through all registered suppressions.
   *
   * Returns a `SuppressionFilterResult` with:
   * - `active`: findings that are NOT suppressed (should appear in reports)
   * - `suppressed`: findings that were suppressed, with their suppression records
   */
  filter(findings: Finding[]): SuppressionFilterResult {
    const active: Finding[] = [];
    const suppressed: SuppressionRecord[] = [];
    const now = new Date().toISOString();

    for (const finding of findings) {
      const suppression = this.findSuppression(finding);
      if (suppression) {
        const record: SuppressionRecord = { finding, suppression, suppressedAt: now };
        suppressed.push(record);

        if (this.warnOnSuppression) {
          process.stderr.write(
            `[GasGuard] Suppressed ${finding.ruleId} at ${finding.filePath}:${finding.line}` +
              ` — reason: ${suppression.reason}\n`,
          );
        }

        this.onSuppressed?.(record);
      } else {
        active.push(finding);
      }
    }

    return { active, suppressed };
  }

  /**
   * Return only the active (non-suppressed) findings.
   */
  filterActive(findings: Finding[]): Finding[] {
    return this.filter(findings).active;
  }

  /**
   * Return only the suppressed findings with their records.
   */
  filterSuppressed(findings: Finding[]): SuppressionRecord[] {
    return this.filter(findings).suppressed;
  }
}
