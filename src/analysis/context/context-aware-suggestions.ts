/**
 * Context-Aware Suggestions
 *
 * Analyzes surrounding code context to tailor optimization suggestions
 * rather than emitting generic fixes.
 */

export interface CodeContext {
  /** The file being analyzed */
  filePath: string;
  /** Language of the file */
  language: 'solidity' | 'rust' | 'vyper' | string;
  /** Imports present in the file */
  imports: string[];
  /** Contract or module names in scope */
  scopeNames: string[];
  /** Raw source snippet around the finding */
  surroundingCode: string;
}

export interface Suggestion {
  ruleId: string;
  message: string;
  /** Ready-to-paste replacement snippet, if applicable */
  snippet?: string;
  /** Link to documentation */
  docsUrl?: string;
}

/**
 * Enrich a generic suggestion with context-specific details.
 */
export function buildContextAwareSuggestion(
  ruleId: string,
  genericMessage: string,
  context: CodeContext,
  snippet?: string
): Suggestion {
  const contextHints: string[] = [];

  if (context.language === 'solidity' && context.imports.some((i) => i.includes('SafeMath'))) {
    contextHints.push('SafeMath detected — consider using Solidity 0.8+ built-in overflow checks instead.');
  }

  if (context.surroundingCode.includes('for') || context.surroundingCode.includes('while')) {
    contextHints.push('Loop detected — unbounded iterations can exhaust gas limits.');
  }

  if (context.surroundingCode.includes('storage')) {
    contextHints.push('Storage access detected — cache values in memory to reduce SLOAD costs.');
  }

  const message =
    contextHints.length > 0
      ? `${genericMessage} Context: ${contextHints.join(' ')}`
      : genericMessage;

  return {
    ruleId,
    message,
    snippet,
    docsUrl: `https://gasguard.dev/rules/${ruleId}`,
  };
}

/**
 * Generate context-aware suggestions for a list of rule findings.
 */
export function generateSuggestions(
  findings: Array<{ ruleId: string; message: string; snippet?: string }>,
  context: CodeContext
): Suggestion[] {
  return findings.map(({ ruleId, message, snippet }) =>
    buildContextAwareSuggestion(ruleId, message, context, snippet)
  );
}
