/**
 * Soroban TTL Analyzer (issue #885)
 *
 * Lexical analysis of TTL configuration and expiration patterns in Soroban
 * (Rust) contracts. The analyzer:
 *
 *  1. Detects TTL-related storage operations (`set` / `extend_ttl`) and the
 *     storage tier they target (`persistent` / `instance` / `temporary`).
 *  2. Identifies persistent entries that are written but never TTL-extended,
 *     reusing the storage-level analyzer so both code paths agree (#886).
 *  3. Detects unusually short `extend_to` values, and extension calls whose
 *     `threshold`/`extend_to` pair can never actually extend anything.
 *  4. Emits actionable findings with a file line, key, message and concrete
 *     remediation.
 *
 * The analyzer is lexical rather than AST-based (matching the rest of the
 * Soroban analyzers) and reuses the shared masking/offset helpers so comments
 * and string literals cannot produce false positives.
 */

import {
  maskNonCode,
  createLineResolver,
  extractFunctions,
  extractArgs,
  splitArgs,
  receiverBefore,
  blockStackAt,
  isInLoop,
} from '../common/source-utils';
import {
  analyzeMissingTtlExtensions,
  analyzeExcessiveTtlExtensions,
} from '../storage/ttl-analyzer';
import type {
  ShortTtlOptions,
  SorobanTtlAnalysisResult,
  TtlAnalysisMetrics,
  TtlFinding,
  TtlOperation,
  TtlStorageTier,
} from './types';

/**
 * Soroban closes a ledger roughly every 5 seconds, so one day is 86_400 / 5
 * ledgers. These constants make the "unusually short" thresholds explicit and
 * easy to keep in one place.
 */
export const SOROBAN_LEDGER_CLOSE_SECONDS = 5;
export const SOROBAN_LEDGERS_PER_DAY = 17_280;
/** Recommended minimum TTL (30 days) — close to the network maximum. */
export const SOROBAN_RECOMMENDED_MIN_TTL_LEDGERS = 30 * SOROBAN_LEDGERS_PER_DAY;
/** Hard floor: anything below one day is flagged as critical. */
export const SOROBAN_ABSOLUTE_MIN_TTL_LEDGERS = SOROBAN_LEDGERS_PER_DAY;

const SHORT_TTL_RULE_ID = 'soroban-short-ttl';

function tierFromReceiver(receiver: string): TtlStorageTier | null {
  if (/persistent\s*\(\s*\)/.test(receiver)) return 'persistent';
  if (/temporary\s*\(\s*\)/.test(receiver)) return 'temporary';
  if (/instance\s*\(\s*\)/.test(receiver)) return 'instance';
  return null;
}

/**
 * Resolve an `extend_ttl` argument to a ledger count when it is a literal.
 * Named constants and non-trivial expressions return `null` — the analyzer
 * refuses to guess a value it cannot evaluate.
 */
export function parseLedgerLiteral(arg: string): number | null {
  const compact = arg.replace(/[_\s]+/g, '');
  if (compact.length === 0) return null;

  const literal = compact.match(/^(\d+)(?:u(?:8|16|32|64|128)|i(?:8|16|32|64|128))?$/);
  if (literal) return Number(literal[1]);

  // Simple products of literals, e.g. `30 * 24 * 12`.
  const factors = compact.split('*');
  if (factors.length > 1 && factors.length <= 4 && factors.every((f) => /^\d+$/.test(f))) {
    return factors.reduce((acc, f) => acc * Number(f), 1);
  }

  return null;
}

/** Human-readable description of a ledger span (approximate). */
export function describeLedgers(ledgers: number): string {
  const seconds = ledgers * SOROBAN_LEDGER_CLOSE_SECONDS;
  const days = seconds / 86_400;
  if (days >= 1) return `${Math.round(days * 10) / 10} days`;
  const hours = seconds / 3_600;
  if (hours >= 1) return `${Math.round(hours * 10) / 10} hours`;
  return `${Math.round((seconds / 60) * 10) / 10} minutes`;
}

/** Detect every TTL-related storage operation in the source. */
export function detectTtlOperations(source: string): TtlOperation[] {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);
  const operations: TtlOperation[] = [];

  const callRe = /\.(set|extend_ttl)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(masked)) !== null) {
    const isExtend = match[1] === 'extend_ttl';
    const tier = tierFromReceiver(receiverBefore(masked, match.index));
    if (!tier) continue;

    const openParen = match.index + match[0].length - 1;
    const args = splitArgs(extractArgs(masked, source, openParen).text);
    if (args.length === 0) continue;

    const fn = functions.find((f) => f.bodyStart <= openParen && openParen <= f.bodyEnd);
    const stack = fn ? blockStackAt(masked, fn.bodyStart, openParen) : [];

    const operation: TtlOperation = {
      kind: isExtend ? 'extend_ttl' : 'write',
      key: args[0],
      tier,
      line: lineOf(match.index),
      functionName: fn?.name ?? '<unknown>',
      inLoop: isInLoop(stack),
    };

    if (isExtend) {
      operation.thresholdArg = args[1];
      operation.extendToArg = args[2];
    }

    operations.push(operation);
  }

  return operations;
}

/**
 * Flag `extend_ttl` calls whose configuration is unusually short or cannot
 * extend anything:
 *
 *  - `extend_to` below the absolute floor (default 1 day) — critical,
 *  - `extend_to` below the recommended minimum (default 30 days) — warning,
 *  - `threshold >= extend_to`, or a missing `extend_to` — ineffective call.
 */
export function analyzeShortTtlValues(
  source: string,
  options: ShortTtlOptions = {},
): TtlFinding[] {
  const recommendedMin = options.recommendedMinLedgers ?? SOROBAN_RECOMMENDED_MIN_TTL_LEDGERS;
  const absoluteMin = options.absoluteMinLedgers ?? SOROBAN_ABSOLUTE_MIN_TTL_LEDGERS;

  const findings: TtlFinding[] = [];

  for (const operation of detectTtlOperations(source)) {
    if (operation.kind !== 'extend_ttl') continue;

    const { key, functionName, line } = operation;
    const threshold =
      operation.thresholdArg !== undefined ? parseLedgerLiteral(operation.thresholdArg) : null;
    const extendTo =
      operation.extendToArg !== undefined ? parseLedgerLiteral(operation.extendToArg) : null;

    if (operation.extendToArg === undefined) {
      findings.push({
        ruleId: SHORT_TTL_RULE_ID,
        kind: 'invalid_extension_range',
        severity: 'high',
        line,
        key,
        functionName,
        message: `extend_ttl on '${key}' omits the extend_to argument, so the entry TTL is never actually extended.`,
        recommendation:
          `Call \`env.storage().persistent().extend_ttl(&${key}, THRESHOLD, EXTEND_TO)\` with ` +
          `EXTEND_TO >= ${recommendedMin} ledgers (~30 days).`,
      });
    } else if (extendTo !== null && extendTo < absoluteMin) {
      findings.push({
        ruleId: SHORT_TTL_RULE_ID,
        kind: 'short_extend_ttl',
        severity: 'high',
        line,
        key,
        functionName,
        message:
          `extend_ttl on '${key}' extends the TTL to only ${extendTo} ledgers ` +
          `(~${describeLedgers(extendTo)}), below the one-day floor of ${absoluteMin} ledgers. ` +
          `The entry can expire unexpectedly and become unavailable.`,
        recommendation:
          `Raise the extend_to value for '${key}' to at least ${recommendedMin} ledgers ` +
          `(~30 days), or move short-lived data to \`env.storage().temporary()\`.`,
      });
    } else if (extendTo !== null && extendTo < recommendedMin) {
      findings.push({
        ruleId: SHORT_TTL_RULE_ID,
        kind: 'short_extend_ttl',
        severity: 'medium',
        line,
        key,
        functionName,
        message:
          `extend_ttl on '${key}' extends the TTL to ${extendTo} ledgers ` +
          `(~${describeLedgers(extendTo)}), below the recommended ${recommendedMin} ledgers (~30 days).`,
        recommendation:
          `Extend '${key}' to at least ${recommendedMin} ledgers (~30 days), or document why a ` +
          `shorter TTL is intentional and add a maintenance entrypoint that keeps it fresh.`,
      });
    }

    if (threshold !== null && extendTo !== null && threshold >= extendTo) {
      findings.push({
        ruleId: SHORT_TTL_RULE_ID,
        kind: 'invalid_extension_range',
        severity: 'high',
        line,
        key,
        functionName,
        message:
          `extend_ttl on '${key}' uses threshold ${threshold} >= extend_to ${extendTo}; the ` +
          `extension never raises the remaining TTL and effectively does nothing.`,
        recommendation:
          `Set threshold below extend_to for '${key}' (for example threshold ${Math.floor(
            extendTo / 2,
          )} with extend_to ${extendTo}).`,
      });
    } else if (threshold !== null && threshold <= 0) {
      findings.push({
        ruleId: SHORT_TTL_RULE_ID,
        kind: 'invalid_extension_range',
        severity: 'high',
        line,
        key,
        functionName,
        message: `extend_ttl on '${key}' uses a non-positive threshold of ${threshold} ledgers.`,
        recommendation:
          `Use a positive threshold for '${key}' so the extension triggers before the entry expires.`,
      });
    }
  }

  return findings;
}

/**
 * Soroban TTL analyzer — combines operation detection, missing-extension
 * detection (#886), excessive-extension detection (#887) and short/invalid
 * TTL value detection (#885) into a single actionable report.
 */
export class SorobanTtlAnalyzer {
  public static readonly RULE_ID = 'soroban-ttl-analyzer';

  public analyze(source: string, options: ShortTtlOptions = {}): SorobanTtlAnalysisResult {
    const operations = detectTtlOperations(source);
    const missing = analyzeMissingTtlExtensions(source);
    const excessive = analyzeExcessiveTtlExtensions(source);
    const shortTtl = analyzeShortTtlValues(source, options);

    const findings: TtlFinding[] = [
      ...missing.findings.map(
        (finding): TtlFinding => ({
          ruleId: 'soroban-missing-ttl-extension',
          kind: 'missing_extension',
          severity: finding.severity,
          line: finding.line,
          key: finding.key,
          functionName: finding.functionName,
          message: finding.message,
          recommendation: finding.suggestion,
        }),
      ),
      ...excessive.findings.map(
        (finding): TtlFinding => ({
          ruleId: 'soroban-excessive-ttl-extension',
          kind: 'excessive_extension',
          severity: finding.severity,
          line: finding.line,
          key: finding.key,
          functionName: finding.functionName,
          message: finding.message,
          recommendation: finding.suggestion,
        }),
      ),
      ...shortTtl,
    ];

    const writes = operations.filter((op) => op.kind === 'write').length;
    const extensions = operations.filter((op) => op.kind === 'extend_ttl').length;

    const metrics: TtlAnalysisMetrics = {
      totalOperations: operations.length,
      writes,
      extensions,
      persistentEntries: missing.metrics.persistentEntries,
      extendedEntries: missing.metrics.extendedEntries,
      unextendedEntries: missing.metrics.unextendedEntries,
      shortTtlValues: shortTtl.filter((f) => f.kind === 'short_extend_ttl').length,
      invalidRanges: shortTtl.filter((f) => f.kind === 'invalid_extension_range').length,
      extensionsInLoops: excessive.metrics.extensionsInLoops,
    };

    const summary =
      findings.length === 0
        ? `No TTL risks detected across ${operations.length} storage operation(s).`
        : `Found ${findings.length} TTL issue(s) across ${operations.length} storage operation(s).`;

    return { operations, findings, metrics, summary };
  }
}

/** Convenience wrapper around {@link SorobanTtlAnalyzer}. */
export function analyzeTtl(
  source: string,
  options: ShortTtlOptions = {},
): SorobanTtlAnalysisResult {
  return new SorobanTtlAnalyzer().analyze(source, options);
}
