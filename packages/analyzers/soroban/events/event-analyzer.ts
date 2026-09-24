/**
 * Soroban Event Analyzer (Issue #913)
 *
 * Analyzes event emission patterns in Soroban contract source:
 *  - detects event emissions (typed `XxxEvent { ... }.publish(&env)` and
 *    raw `env.events().publish((topics...), data)` calls),
 *  - extracts event topics,
 *  - tracks emission frequency per function and per topic,
 *  - estimates the resource impact of event-related ledger writes.
 */

import {
  maskNonCode,
  createLineResolver,
  extractFunctions,
  extractArgs,
  splitArgs,
  normalizeExpr,
} from '../common/source-utils';

export type EventSeverity = 'medium' | 'low' | 'info';

export interface DetectedEventEmission {
  /** Line of the emission site. */
  line: number;
  /** Enclosing function name. */
  functionName: string;
  /** Event topic: struct name for typed events, symbol for raw publishes. */
  topic: string;
  /** How the event was emitted. */
  style: 'typed_event' | 'raw_publish';
  /** Topic tuple entries for raw publishes (empty for typed events). */
  rawTopics: string[];
  /** Number of payload fields carried by the event. */
  fieldCount: number;
  /** Rough serialized payload size estimate in characters. */
  payloadSizeChars: number;
}

export interface EventAnalyzerFinding {
  rule: string;
  line: number;
  functionName: string;
  topic: string;
  message: string;
  suggestion: string;
  severity: EventSeverity;
}

export interface EventAnalysisReport {
  events: DetectedEventEmission[];
  findings: EventAnalyzerFinding[];
  summary: string;
  metrics: {
    totalEmissions: number;
    uniqueTopics: number;
    /** Estimated relative cost units across all emissions. */
    estimatedResourceUnits: number;
    functionsWithExcessiveEvents: number;
  };
}

/** Emissions allowed per function before frequency is flagged. */
const MAX_EMISSIONS_PER_FUNCTION = 5;
/** Rough per-emission base cost (ledger key + metadata overhead). */
const BASE_EMISSION_COST = 40;
/** Cost per payload character (topics + data serialized to ledger). */
const PER_CHAR_COST = 1;

export function analyzeEventEmissions(source: string): EventAnalysisReport {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);

  const events: DetectedEventEmission[] = [];

  const typedRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\{([^{}]*)\}\s*\.\s*publish\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = typedRe.exec(masked)) !== null) {
    const topic = m[1];
    if (/^env$|^events$/.test(topic)) continue; // raw publish handled below
    const fields = splitArgs(m[2]);
    const fn = functions.find((f) => f.bodyStart <= m!.index && m!.index <= f.bodyEnd);
    events.push({
      line: lineOf(m.index),
      functionName: fn?.name ?? '<unknown>',
      topic,
      style: 'typed_event',
      rawTopics: [],
      fieldCount: fields.length,
      payloadSizeChars: fields.join(',').length,
    });
  }

  const rawRe = /publish\s*\(/g;
  while ((m = rawRe.exec(masked)) !== null) {
    const receiver = rawReceiver(masked, m.index);
    if (!/events\s*\(\s*\)/.test(receiver)) continue;
    const openParen = m.index + m[0].length - 1;
    const { text } = extractArgs(masked, source, openParen);
    const parts = splitArgs(text);
    if (parts.length === 0) continue;

    // Raw publishes take a topic tuple first: ((sym, ...), data).
    const first = parts[0];
    const topicTuple = first.match(/^\((.*)\)$/);
    if (!topicTuple) continue;
    const topics = topicTuple[1]
      .split(',')
      .map((t) => normalizeExpr(t))
      .filter((t) => t.length > 0);
    const topic = topics.length > 0 ? topics[0] : '<no-topic>';
    const payload = parts.slice(1).join(', ');
    const fn = functions.find((f) => f.bodyStart <= m!.index && m!.index <= f.bodyEnd);
    events.push({
      line: lineOf(m.index),
      functionName: fn?.name ?? '<unknown>',
      topic,
      style: 'raw_publish',
      rawTopics: topics,
      fieldCount: parts.length - 1,
      payloadSizeChars: payload.length,
    });
  }

  // ── Frequency + resource accounting ───────────────────────────────────────
  const perFunction = new Map<string, DetectedEventEmission[]>();
  for (const ev of events) {
    const list = perFunction.get(ev.functionName) ?? [];
    list.push(ev);
    perFunction.set(ev.functionName, list);
  }

  const findings: EventAnalyzerFinding[] = [];
  for (const [fn, evs] of perFunction.entries()) {
    if (evs.length > MAX_EMISSIONS_PER_FUNCTION) {
      findings.push({
        rule: 'soroban-excessive-events',
        line: evs[0].line,
        functionName: fn,
        topic: evs[0].topic,
        message: `Function '${fn}' emits ${evs.length} events; batch or consolidate event payloads where possible.`,
        suggestion:
          'Emit a single structured event (or one event per logical outcome) instead of per-item emissions inside loops.',
        severity: 'medium',
      });
    }
  }

  for (const ev of events) {
    if (ev.style === 'raw_publish' && ev.rawTopics.length === 0) {
      findings.push({
        rule: 'soroban-event-topic-missing',
        line: ev.line,
        functionName: ev.functionName,
        topic: ev.topic,
        message: `Raw event emission at line ${ev.line} has no topic — indexers cannot attribute it reliably.`,
        suggestion:
          'Provide at least one topic symbol, or prefer a typed #[contractevent] struct for observability.',
        severity: 'low',
      });
    }
  }

  return {
    events,
    findings,
    summary:
      findings.length === 0
        ? `Event emissions look well-structured (${events.length} emission(s), ${perFunction.size} function(s)).`
        : `Found ${findings.length} event-pattern issue(s) across ${perFunction.size} function(s).`,
    metrics: {
      totalEmissions: events.length,
      uniqueTopics: new Set(events.map((e) => e.topic)).size,
      estimatedResourceUnits: computeEstimatedUnits(events),
      functionsWithExcessiveEvents: findings.filter(
        (f) => f.rule === 'soroban-excessive-events',
      ).length,
    },
  };
}

function estimateUnitsFor(ev: DetectedEventEmission): number {
  return BASE_EMISSION_COST + PER_CHAR_COST * (ev.topic.length + ev.payloadSizeChars);
}

/** Total estimated resource units across all emissions. */
function computeEstimatedUnits(events: DetectedEventEmission[]): number {
  return events.reduce((acc, ev) => acc + estimateUnitsFor(ev), 0);
}

/** Topic-tuple receiver for raw publishes. */
function rawReceiver(masked: string, dotIndex: number): string {
  let depth = 0;
  let i = dotIndex - 1;
  const parts: string[] = [];
  let current = '';

  while (i >= 0) {
    const ch = masked[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) break;
      depth--;
    }
    if (depth === 0 && !/[A-Za-z0-9_.()&\s]/.test(ch)) break;
    if (ch === '.' && depth === 0) {
      parts.unshift(current);
      current = '';
    } else {
      current = ch + current;
    }
    i--;
  }
  if (current) parts.unshift(current);
  return parts.join('.');
}

export class EventEmissionAnalyzer {
  public static readonly RULE_ID = 'soroban-event-emissions';

  analyze(source: string): EventAnalysisReport {
    return analyzeEventEmissions(source);
  }
}
