/**
 * Formats GasGuard diagnostics into a Markdown summary suitable for posting as
 * a GitHub Pull Request comment. Produces a GitHub-flavored Markdown table and
 * an aggregate of the potential gas savings across the changeset.
 */

export interface GasDiagnostic {
  file: string;
  line: number;
  rule: string;
  /** Estimated gas saved if the suggested fix is applied. */
  gasImpact: number;
  suggestedFix: string;
}

/** Number of rows beyond which the table is wrapped in a collapsible block. */
export const COLLAPSE_THRESHOLD = 10;

/** Sum the potential gas savings across all diagnostics. */
export function calculateTotalSavings(diagnostics: GasDiagnostic[]): number {
  return diagnostics.reduce(
    (total, diagnostic) => total + diagnostic.gasImpact,
    0,
  );
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function formatRow(diagnostic: GasDiagnostic): string {
  return `| ${escapeCell(diagnostic.file)} | ${diagnostic.line} | ${escapeCell(
    diagnostic.rule,
  )} | ${diagnostic.gasImpact} | ${escapeCell(diagnostic.suggestedFix)} |`;
}

/**
 * Build the Markdown PR comment. When there are no diagnostics a short success
 * message is returned instead of an empty table.
 */
export function formatPrComment(diagnostics: GasDiagnostic[]): string {
  const total = calculateTotalSavings(diagnostics);

  if (diagnostics.length === 0) {
    return "## ⛽ GasGuard Report\n\n✅ No gas issues detected.";
  }

  const header = "| File | Line | Rule | Gas Impact | Suggested Fix |";
  const divider = "| --- | ---: | --- | ---: | --- |";
  const rows = diagnostics.map(formatRow).join("\n");
  const table = [header, divider, rows].join("\n");

  const summary = [
    "## ⛽ GasGuard Report",
    "",
    `Found **${diagnostics.length}** potential optimization${
      diagnostics.length === 1 ? "" : "s"
    }, with an estimated **${total}** gas in total savings.`,
    "",
  ].join("\n");

  if (diagnostics.length > COLLAPSE_THRESHOLD) {
    return [
      summary,
      "<details>",
      `<summary>Show all ${diagnostics.length} findings</summary>`,
      "",
      table,
      "",
      "</details>",
    ].join("\n");
  }

  return `${summary}${table}\n`;
}
