/**
 * Soroban Rule Documentation Generator — Metadata Parser (Issue #483)
 *
 * Validates and normalises raw rule metadata before documentation is rendered.
 * Invalid rules are skipped and reported as issues (rather than throwing) so a
 * single malformed entry never blocks the whole doc build.
 */

import { KBRule, ParseIssue, ParseResult, ParsedRule } from './types';

const VALID_SEVERITIES: ReadonlyArray<KBRule['severity']> = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
];

const VALID_CATEGORIES: ReadonlyArray<KBRule['category']> = [
  'Security',
  'Optimization',
  'Upgradeability',
  'Quality',
];

/** Derive a file/URL-safe slug from a rule id. */
export function slugify(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Parse a raw rule list into validated, slugged rules plus a list of issues.
 *
 * Rules are de-duplicated by id (first occurrence wins) and the output is
 * sorted by category then name for stable, reviewable documentation.
 */
export function parseRules(input: readonly KBRule[]): ParseResult {
  const rules: ParsedRule[] = [];
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();

  input.forEach((rule, index) => {
    const ref = isNonEmptyString(rule?.id) ? rule.id : `#${index}`;
    const problems: ParseIssue[] = [];

    if (!isNonEmptyString(rule?.id)) {
      problems.push({ ruleRef: ref, message: 'Rule id is required', code: 'ID_REQUIRED' });
    }
    if (!isNonEmptyString(rule?.name)) {
      problems.push({ ruleRef: ref, message: 'Rule name is required', code: 'NAME_REQUIRED' });
    }
    if (!isNonEmptyString(rule?.description)) {
      problems.push({ ruleRef: ref, message: 'Rule description is required', code: 'DESCRIPTION_REQUIRED' });
    }
    if (!VALID_SEVERITIES.includes(rule?.severity)) {
      problems.push({ ruleRef: ref, message: `Invalid severity '${String(rule?.severity)}'`, code: 'SEVERITY_INVALID' });
    }
    if (!VALID_CATEGORIES.includes(rule?.category)) {
      problems.push({ ruleRef: ref, message: `Invalid category '${String(rule?.category)}'`, code: 'CATEGORY_INVALID' });
    }

    if (problems.length > 0) {
      issues.push(...problems);
      return;
    }
    if (seen.has(rule.id)) {
      issues.push({ ruleRef: ref, message: 'Duplicate rule id; later definition skipped', code: 'DUPLICATE_ID' });
      return;
    }
    seen.add(rule.id);

    rules.push({
      ...rule,
      tags: Array.isArray(rule.tags) ? rule.tags : [],
      slug: slugify(rule.id),
    });
  });

  rules.sort((a, b) =>
    a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category),
  );

  return { rules, issues };
}
