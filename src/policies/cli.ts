/**
 * `policy validate` command.
 *
 * Human-readable output and JSON reports go to stdout. Operational logs go
 * to stderr as one JSON object per line and never include the policy body.
 */

import { randomUUID } from "crypto";

import { formatPolicyReportJson, formatPolicyReportText } from "./format";
import { LoadedPolicy, PolicyLoadError, loadPolicyFile } from "./load";
import {
  PolicyCommandReport,
  PolicyIssue,
  PolicyValidationResult,
} from "./types";
import { validatePolicy } from "./validate";

export interface PolicyCliIo {
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  now?: () => number;
  load?: (filePath: string) => LoadedPolicy;
  correlationId?: string;
}

export interface ParsedPolicyArgs {
  help: boolean;
  file?: string;
  format: "text" | "json";
  strict: boolean;
  error?: string;
}

const HELP = `Validate a GasGuard policy document.

Usage:
  policy-validate <file> [--format text|json] [--strict]
  gasguard policy validate <file> [--format text|json] [--strict]

Options:
  --format <text|json>   Report format (default: text)
  --strict               Treat warnings as errors
  -h, --help             Show this help

Exit codes:
  0  The policy is valid
  1  The policy failed schema or strict-mode checks
  2  The file could not be read, or the arguments are invalid

JSON is the only accepted file format. See docs/POLICY_VALIDATION.md.
`;

export function parsePolicyValidateArgs(argv: string[]): ParsedPolicyArgs {
  const result: ParsedPolicyArgs = {
    help: false,
    format: "text",
    strict: false,
  };
  const positional: string[] = [];
  let skippedCommand = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      result.help = true;
      continue;
    }
    if (token === "--strict") {
      result.strict = true;
      continue;
    }
    if (token === "--format") {
      const value = argv[index + 1];
      if (value === undefined) {
        result.error = "--format requires a value of text or json";
        return result;
      }
      index += 1;
      if (!assignFormat(result, value)) {
        return result;
      }
      continue;
    }
    if (token.startsWith("--format=")) {
      if (!assignFormat(result, token.slice("--format=".length))) {
        return result;
      }
      continue;
    }
    if (token.startsWith("-")) {
      result.error = `Unknown option "${token}"`;
      return result;
    }
    if (token === "validate" && !skippedCommand && positional.length === 0) {
      skippedCommand = true;
      continue;
    }
    positional.push(token);
  }

  if (result.help) {
    return result;
  }
  if (positional.length === 0) {
    result.error = "A policy file path is required";
    return result;
  }
  if (positional.length > 1) {
    result.error = "Only one policy file may be validated at a time";
    return result;
  }
  result.file = positional[0];
  return result;
}

export function runPolicyValidateCli(
  argv: string[],
  io: PolicyCliIo = {},
): number {
  const stdout = io.stdout ?? ((chunk: string) => process.stdout.write(chunk));
  const stderr = io.stderr ?? ((chunk: string) => process.stderr.write(chunk));
  const now = io.now ?? Date.now;
  const load = io.load ?? loadPolicyFile;
  const correlationId = io.correlationId ?? `pol_${randomUUID()}`;

  const parsed = parsePolicyValidateArgs(argv);
  if (parsed.help) {
    stdout(HELP);
    return 0;
  }
  if (parsed.error || parsed.file === undefined) {
    stderr(
      logLine({
        level: "error",
        event: "policy.validate.error",
        correlationId,
        message: parsed.error ?? "A policy file path is required",
        code: "INVALID_ARGUMENTS",
      }),
    );
    stdout(
      parsed.format === "json"
        ? `${JSON.stringify(
            {
              valid: false,
              errors: [
                {
                  path: "(args)",
                  message: parsed.error ?? "A policy file path is required",
                  code: "INVALID_ARGUMENTS",
                },
              ],
            },
            null,
            2,
          )}\n`
        : `${parsed.error ?? "A policy file path is required"}\n${HELP}`,
    );
    return 2;
  }

  const started = now();
  stderr(
    logLine({
      level: "info",
      event: "policy.validate.start",
      correlationId,
      message: "Validating policy file",
      file: parsed.file,
      strict: parsed.strict,
    }),
  );

  try {
    const loaded = load(parsed.file);
    const validated = applyStrict(validatePolicy(loaded.raw), parsed.strict);
    const durationMs = Math.max(0, now() - started);
    const report = toReport(
      parsed.file,
      validated,
      parsed.strict,
      durationMs,
      correlationId,
      loaded.bytesRead,
    );
    stdout(
      parsed.format === "json"
        ? formatPolicyReportJson(report)
        : formatPolicyReportText(report),
    );
    stderr(
      logLine({
        level: report.valid ? "info" : "error",
        event: "policy.validate.complete",
        correlationId,
        message: report.valid
          ? "Policy validation passed"
          : "Policy validation failed",
        file: parsed.file,
        outcome: report.metrics.outcome,
        errorCount: report.metrics.errorCount,
        warningCount: report.metrics.warningCount,
        durationMs,
        strict: parsed.strict,
      }),
    );
    return report.valid ? 0 : 1;
  } catch (error) {
    const durationMs = Math.max(0, now() - started);
    const known = error instanceof PolicyLoadError;
    const code = known ? error.code : "INTERNAL_ERROR";
    const message = known
      ? error.message
      : "Policy validation failed unexpectedly";
    const report = failureReport(
      parsed.file,
      code,
      message,
      parsed.strict,
      durationMs,
      correlationId,
    );
    stdout(
      parsed.format === "json"
        ? formatPolicyReportJson(report)
        : formatPolicyReportText(report),
    );
    stderr(
      logLine({
        level: "error",
        event: "policy.validate.error",
        correlationId,
        message,
        file: parsed.file,
        code,
        durationMs,
        strict: parsed.strict,
        detail:
          !known && process.env.GASGUARD_POLICY_DEBUG === "1"
            ? (error as Error).message
            : undefined,
      }),
    );
    return 2;
  }
}

function applyStrict(
  result: PolicyValidationResult,
  strict: boolean,
): PolicyValidationResult {
  if (!strict || result.warnings.length === 0) {
    return result;
  }
  const errors = result.errors.concat(
    result.warnings.map((warning) => ({
      ...warning,
      message: `${warning.message} (promoted by --strict)`,
    })),
  );
  return {
    ...result,
    valid: false,
    errors,
    policy: undefined,
  };
}

function toReport(
  file: string,
  result: PolicyValidationResult,
  strict: boolean,
  durationMs: number,
  correlationId: string,
  bytesRead: number,
): PolicyCommandReport {
  return {
    valid: result.valid,
    file,
    errors: result.errors,
    warnings: result.warnings,
    defaultsApplied: result.defaultsApplied,
    policy: result.policy,
    correlationId,
    metrics: {
      outcome: result.valid ? "pass" : "fail",
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
      durationMs,
      strict,
      bytesRead,
    },
  };
}

function failureReport(
  file: string,
  code: string,
  message: string,
  strict: boolean,
  durationMs: number,
  correlationId: string,
): PolicyCommandReport {
  const errors: PolicyIssue[] = [{ path: "(file)", message, code }];
  return {
    valid: false,
    file,
    errors,
    warnings: [],
    defaultsApplied: [],
    correlationId,
    metrics: {
      outcome: "fail",
      errorCount: 1,
      warningCount: 0,
      durationMs,
      strict,
    },
  };
}

function assignFormat(result: ParsedPolicyArgs, value: string): boolean {
  if (value !== "text" && value !== "json") {
    result.error = `Unknown format "${value}". Use text or json`;
    return false;
  }
  result.format = value;
  return true;
}

function logLine(entry: Record<string, unknown>): string {
  return `${JSON.stringify({
    timestamp: new Date().toISOString(),
    component: "policy.validate",
    ...entry,
  })}\n`;
}
