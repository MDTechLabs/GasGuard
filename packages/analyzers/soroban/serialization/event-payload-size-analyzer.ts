/**
 * Issue #915 — Detect Oversized Soroban Event Payloads
 *
 * Analyzes event payload types, estimates payload size, detects large
 * structures, and generates optimization guidance.
 */

import {
  maskNonCode,
  extractFunctions,
  createLineResolver,
  extractArgs,
  splitArgs,
  normalizeExpr,
} from '../common/source-utils';

export interface EventPayloadSize {
  functionName: string;
  line: number;
  topics: string;
  payload: string;
  payloadKind: string;
  estimatedSize: number;
  fieldCount: number;
}

export interface OversizedPayloadFinding {
  ruleId: 'soroban-oversized-event-payload';
  severity: 'high' | 'medium';
  line: number;
  functionName: string;
  topics: string;
  estimatedSize: number;
  threshold: number;
  message: string;
  suggestion: string;
}

export interface EventPayloadSizeReport {
  payloads: EventPayloadSize[];
  findings: OversizedPayloadFinding[];
  metrics: {
    totalPayloads: number;
    oversizedPayloads: number;
    maxEstimatedSize: number;
  };
  summary: string;
}

export const DEFAULT_MAX_EVENT_PAYLOAD_SIZE = 256;
export const LARGE_FIELD_THRESHOLD = 5;

const PUBLISH_RE = /env\s*\.\s*events\s*\(\s*\)\s*\.\s*publish\s*\(/g;

function classifyPayloadKind(payload: string): string {
  const p = payload.trim();
  if (/^vec!\s*\[/.test(p) || /Vec\s*</.test(p)) return 'vec';
  if (/^Map\s*</.test(p) || /map!\s*\(/.test(p)) return 'map';
  if (/^[A-Z][A-Za-z0-9_]*\s*\{/.test(p)) return 'struct-literal';
  if (/^\(.*\)$/.test(p)) return 'tuple';
  if (/^".*"$/.test(p)) return 'string';
  if (/^\d+$/.test(p)) return 'integer';
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p)) return 'identifier';
  return 'expression';
}

function countTopLevelFields(payload: string): number {
  const parts = splitArgs(payload);
  if (parts.length <= 1) {
    const structFields = payload.match(/[A-Za-z_][A-Za-z0-9_]*\s*:/g);
    if (structFields) return structFields.length;
    return parts.length;
  }
  return parts.length;
}

function estimatePayloadSize(payload: string, fieldCount: number): number {
  return payload.trim().length + fieldCount * 32;
}

export interface EventPayloadSizeOptions {
  maxSize?: number;
  maxFields?: number;
}

/**
 * Analyze Soroban contract source for oversized event payloads (#915).
 */
export function analyzeEventPayloadSizes(
  source: string,
  options?: EventPayloadSizeOptions,
): EventPayloadSizeReport {
  const threshold = options?.maxSize ?? DEFAULT_MAX_EVENT_PAYLOAD_SIZE;
  const maxFields = options?.maxFields ?? LARGE_FIELD_THRESHOLD;
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);
  const payloads: EventPayloadSize[] = [];
  const findings: OversizedPayloadFinding[] = [];

  for (const fn of functions) {
    const fnBodyMasked = masked.slice(fn.bodyStart, fn.bodyEnd);
    const re = new RegExp(PUBLISH_RE.source, 'g');

    let m: RegExpExecArray | null;
    while ((m = re.exec(fnBodyMasked)) !== null) {
      const matchOffset = fn.bodyStart + m.index;
      const openParen = matchOffset + m[0].length - 1;
      const argsText = extractArgs(masked, source, openParen).text;
      const args = splitArgs(argsText);
      if (args.length < 2) continue;

      const topics = normalizeExpr(args[0]);
      const payload = args.slice(1).join(', ');
      const fieldCount = countTopLevelFields(payload);
      const estimatedSize = estimatePayloadSize(payload, fieldCount);

      payloads.push({
        functionName: fn.name,
        line: lineOf(matchOffset),
        topics,
        payload: normalizeExpr(payload),
        payloadKind: classifyPayloadKind(payload),
        estimatedSize,
        fieldCount,
      });

      const isOversized = estimatedSize > threshold || fieldCount >= maxFields;
      if (isOversized) {
        const severity = estimatedSize > threshold * 2 ? 'high' : 'medium';
        findings.push({
          ruleId: 'soroban-oversized-event-payload',
          severity,
          line: lineOf(matchOffset),
          functionName: fn.name,
          topics,
          estimatedSize,
          threshold,
          message:
            `Oversized event payload in '${fn.name}' at line ${lineOf(matchOffset)} ` +
            `(estimated ${estimatedSize} bytes > ${threshold} bytes, ${fieldCount} field(s)).`,
          suggestion:
            `Emit a compact event payload (identifier or hash) for '${topics}' instead of the full structure; ` +
            `store large data off-event or split into smaller fields.`,
        });
      }
    }
  }

  const maxEstimatedSize = payloads.reduce((max, p) => Math.max(max, p.estimatedSize), 0);
  const summary =
    findings.length === 0
      ? `Analyzed ${payloads.length} event payload(s). No oversized payloads detected.`
      : `Analyzed ${payloads.length} event payload(s). Found ${findings.length} oversized payload(s).`;

  return {
    payloads,
    findings,
    metrics: {
      totalPayloads: payloads.length,
      oversizedPayloads: findings.length,
      maxEstimatedSize,
    },
    summary,
  };
}

export class EventPayloadSizeAnalyzer {
  public static readonly RULE_ID = 'soroban-oversized-event-payload';

  public analyze(sourceCode: string, options?: EventPayloadSizeOptions): OversizedPayloadFinding[] {
    return analyzeEventPayloadSizes(sourceCode, options).findings;
  }

  public analyzeWithReport(sourceCode: string, options?: EventPayloadSizeOptions): EventPayloadSizeReport {
    return analyzeEventPayloadSizes(sourceCode, options);
  }
}
