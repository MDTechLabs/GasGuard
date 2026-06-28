/**
 * Soroban Rule Documentation Generator — Types (Issue #483)
 *
 * Generates documentation directly from rule definitions so the docs cannot
 * drift from the rules themselves. Input is the canonical knowledge-base rule
 * metadata (`KBRule`); output is a set of Markdown pages.
 */

import { KBRule } from '../../../knowledge-base/stellar/types';

export { KBRule };

/** A rule after parsing/validation, with a stable doc slug attached. */
export interface ParsedRule extends KBRule {
  /** URL/file-safe identifier derived from the rule id (used as the page name). */
  slug: string;
}

/** A problem found while parsing rule metadata. The offending rule is skipped. */
export interface ParseIssue {
  /** Rule id when known, else a positional marker like `#3`. */
  ruleRef: string;
  message: string;
  code: string;
}

/** Result of parsing a raw rule list. */
export interface ParseResult {
  rules: ParsedRule[];
  issues: ParseIssue[];
}

/** A generated documentation file. */
export interface GeneratedDoc {
  /** Relative path, e.g. `index.md` or `rules/stellar-network-validation.md`. */
  path: string;
  content: string;
}

/** Options controlling documentation generation. */
export interface DocGeneratorOptions {
  /** Title for the index page. Defaults to "Soroban Analysis Rules". */
  title?: string;
  /** Directory (relative) the per-rule pages are written under. Default: `rules`. */
  pagesDir?: string;
  /** Whether to include the index/landing page. Default: true. */
  includeIndex?: boolean;
}
