/**
 * `gasguard scan` output handling.
 *
 * Adds `--format` (`text` | `json` | `sarif`) and `--output <file>` so scan
 * results can be emitted as human-readable text, raw JSON, or SARIF v2.1.0 for
 * ingestion by CI/CD pipelines and GitHub code scanning.
 */

import * as fs from "fs";

import { RuleMatch, toSarifString } from "../formatters/sarif-formatter";

export type ReportFormat = "text" | "json" | "sarif";

export const SUPPORTED_FORMATS: readonly ReportFormat[] = [
  "text",
  "json",
  "sarif",
];

export interface ScanReportOptions {
  format?: string;
  output?: string;
  toolVersion?: string;
}

export function isReportFormat(value: string): value is ReportFormat {
  return (SUPPORTED_FORMATS as readonly string[]).includes(value);
}

function formatText(matches: RuleMatch[]): string {
  if (matches.length === 0) {
    return "No gas issues found.\n";
  }
  const lines = matches.map(
    (match) =>
      `${match.file}:${match.line} [${match.severity}] ${match.ruleId} - ${match.message}`,
  );
  return `${lines.join("\n")}\n`;
}

/**
 * Render scan results in the requested format. Defaults to `text`.
 */
export function formatReport(
  matches: RuleMatch[],
  options: ScanReportOptions = {},
): string {
  const requested = options.format ?? "text";
  if (!isReportFormat(requested)) {
    throw new Error(
      `Unsupported --format "${requested}". Expected one of: ${SUPPORTED_FORMATS.join(", ")}.`,
    );
  }

  switch (requested) {
    case "json":
      return `${JSON.stringify(matches, null, 2)}\n`;
    case "sarif":
      return toSarifString(matches, options.toolVersion);
    case "text":
      return formatText(matches);
    default:
      return formatText(matches);
  }
}

/**
 * Produce the report and either write it to `options.output` or return it for
 * the caller to print to stdout.
 */
export function emitReport(
  matches: RuleMatch[],
  options: ScanReportOptions = {},
): string {
  const content = formatReport(matches, options);
  if (options.output) {
    fs.writeFileSync(options.output, content, "utf8");
  }
  return content;
}
