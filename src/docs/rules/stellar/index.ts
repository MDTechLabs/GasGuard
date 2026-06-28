/**
 * Soroban Rule Documentation Generator (Issue #483)
 *
 * Generates Markdown documentation directly from Soroban rule definitions so
 * the docs never drift from the rules.
 *
 * @example
 * ```ts
 * import { generateStellarRuleDocs } from 'src/docs/rules/stellar';
 *
 * for (const doc of generateStellarRuleDocs()) {
 *   // doc.path  -> 'index.md' | 'rules/<slug>.md'
 *   // doc.content -> Markdown
 *   writeFileSync(doc.path, doc.content);
 * }
 * ```
 */

import { RULES } from '../../../knowledge-base/stellar/rules-db';
import { generateDocs } from './rule-doc-generator';
import { DocGeneratorOptions, GeneratedDoc } from './types';

export * from './types';
export { slugify, parseRules } from './rule-metadata-parser';
export { renderRulePage, renderIndex, generateDocs } from './rule-doc-generator';

/**
 * Generate documentation for the project's built-in Soroban rule catalogue
 * (the knowledge-base `RULES`).
 */
export function generateStellarRuleDocs(
  options: DocGeneratorOptions = {},
): GeneratedDoc[] {
  return generateDocs(RULES, options);
}
