/**
 * Soroban Rule Documentation Generator — Markdown renderer (Issue #483)
 *
 * Turns parsed rule metadata into Markdown documentation pages: one page per
 * rule plus a grouped index. Because the content is derived directly from the
 * rule definitions, the docs stay in sync with the rules by construction.
 */

import { parseRules } from './rule-metadata-parser';
import {
  DocGeneratorOptions,
  GeneratedDoc,
  KBRule,
  ParsedRule,
} from './types';

const SEVERITY_BADGE: Record<KBRule['severity'], string> = {
  critical: '🔴 Critical',
  high: '🟠 High',
  medium: '🟡 Medium',
  low: '🔵 Low',
  info: '⚪ Info',
};

const DEFAULT_TITLE = 'Soroban Analysis Rules';
const DEFAULT_PAGES_DIR = 'rules';

function severityLabel(severity: KBRule['severity']): string {
  return SEVERITY_BADGE[severity] ?? severity;
}

/** Render the Markdown page for a single rule. */
export function renderRulePage(rule: ParsedRule): string {
  const lines: string[] = [];

  lines.push(`# ${rule.name}`);
  lines.push('');
  lines.push(`> **Rule ID:** \`${rule.id}\``);
  lines.push('>');
  lines.push(`> **Severity:** ${severityLabel(rule.severity)} &nbsp;•&nbsp; **Category:** ${rule.category}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(rule.description);
  lines.push('');
  lines.push('## Why it matters');
  lines.push('');
  lines.push(rule.explanation);
  lines.push('');
  lines.push('## Remediation');
  lines.push('');
  // Multi-line remediation is almost always a code snippet; fence it as Rust.
  if (rule.remediation.includes('\n') || /[;{}()]/.test(rule.remediation)) {
    lines.push('```rust');
    lines.push(rule.remediation);
    lines.push('```');
  } else {
    lines.push(rule.remediation);
  }
  lines.push('');

  if (rule.tags.length > 0) {
    lines.push('## Tags');
    lines.push('');
    lines.push(rule.tags.map((t) => `\`${t}\``).join(' '));
    lines.push('');
  }

  if (rule.documentationUrl) {
    lines.push('## References');
    lines.push('');
    lines.push(`- [Additional documentation](${rule.documentationUrl})`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('_This page is generated from the rule definition. Do not edit by hand._');
  lines.push('');

  return lines.join('\n');
}

/** Render the index page listing all rules grouped by category. */
export function renderIndex(
  rules: ParsedRule[],
  options: DocGeneratorOptions = {},
): string {
  const title = options.title ?? DEFAULT_TITLE;
  const pagesDir = options.pagesDir ?? DEFAULT_PAGES_DIR;
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`${rules.length} rule${rules.length === 1 ? '' : 's'}, generated from rule definitions.`);
  lines.push('');

  const categories = [...new Set(rules.map((r) => r.category))].sort();
  for (const category of categories) {
    const inCategory = rules.filter((r) => r.category === category);
    lines.push(`## ${category}`);
    lines.push('');
    lines.push('| Rule | Severity | Description |');
    lines.push('| --- | --- | --- |');
    for (const rule of inCategory) {
      const link = `[${rule.name}](${pagesDir}/${rule.slug}.md)`;
      lines.push(`| ${link} | ${severityLabel(rule.severity)} | ${rule.description} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('_This index is generated from the rule definitions. Do not edit by hand._');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate all documentation pages from raw rule metadata.
 *
 * Returns the index page (unless disabled) followed by one page per valid
 * rule. Invalid rules are skipped; inspect `parseRules(...).issues` separately
 * if you need to surface them.
 */
export function generateDocs(
  rawRules: readonly KBRule[],
  options: DocGeneratorOptions = {},
): GeneratedDoc[] {
  const pagesDir = options.pagesDir ?? DEFAULT_PAGES_DIR;
  const includeIndex = options.includeIndex ?? true;
  const { rules } = parseRules(rawRules);

  const docs: GeneratedDoc[] = [];
  if (includeIndex) {
    docs.push({ path: 'index.md', content: renderIndex(rules, options) });
  }
  for (const rule of rules) {
    docs.push({ path: `${pagesDir}/${rule.slug}.md`, content: renderRulePage(rule) });
  }
  return docs;
}
