/**
 * Issue #916 — Implement Soroban Event Topic Consistency Rule
 *
 * Extracts event topics, compares related events, detects inconsistent
 * naming, and reports affected functions.
 */

import {
  maskNonCode,
  extractFunctions,
  createLineResolver,
  extractArgs,
  splitArgs,
  normalizeExpr,
} from '../common/source-utils';

export interface EventTopic {
  functionName: string;
  line: number;
  raw: string;
  name: string;
  convention: 'snake' | 'camel' | 'upper' | 'other';
}

export interface TopicInconsistencyFinding {
  ruleId: 'soroban-event-topic-consistency';
  severity: 'medium' | 'low';
  line: number;
  functionName: string;
  topic: string;
  relatedFunctions: string[];
  message: string;
  suggestion: string;
}

export interface EventTopicConsistencyReport {
  topics: EventTopic[];
  findings: TopicInconsistencyFinding[];
  metrics: {
    totalTopics: number;
    inconsistentGroups: number;
    affectedFunctions: number;
  };
  summary: string;
}

const PUBLISH_RE = /env\s*\.\s*events\s*\(\s*\)\s*\.\s*publish\s*\(/g;

function extractTopicName(topicsRaw: string): string {
  const short = topicsRaw.match(/symbol_short!\s*\(\s*"([^"]+)"\s*\)/);
  if (short) return short[1];
  const symbolNew = topicsRaw.match(/Symbol::(?:new|short)\s*\([^,]*,\s*"([^"]+)"\s*\)/);
  if (symbolNew) return symbolNew[1];
  const lit = topicsRaw.match(/"([^"]+)"/);
  if (lit) return lit[1];
  const first = splitArgs(topicsRaw.replace(/^\(/, '').replace(/\)$/, ''))[0] ?? topicsRaw;
  return normalizeExpr(first).replace(/^\(/, '').trim();
}

function detectConvention(name: string): EventTopic['convention'] {
  if (/^[A-Z0-9_]+$/.test(name)) return 'upper';
  if (/^[a-z]+(_[a-z0-9]+)+$/.test(name)) return 'snake';
  if (/^[a-z]+([A-Z][a-z0-9]*)+$/.test(name)) return 'camel';
  if (/^[a-z][a-z0-9]*$/.test(name)) return 'snake';
  return 'other';
}

function normalizeTopicKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Analyze Soroban contract source for event topic inconsistencies (#916).
 *
 * Related events are topics that normalize to the same key but are spelled
 * differently, or a contract that mixes naming conventions for topics.
 */
export function analyzeEventTopicConsistency(source: string): EventTopicConsistencyReport {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);
  const topics: EventTopic[] = [];

  for (const fn of functions) {
    const fnBodyMasked = masked.slice(fn.bodyStart, fn.bodyEnd);
    const re = new RegExp(PUBLISH_RE.source, 'g');

    let m: RegExpExecArray | null;
    while ((m = re.exec(fnBodyMasked)) !== null) {
      const matchOffset = fn.bodyStart + m.index;
      const openParen = matchOffset + m[0].length - 1;
      const argsText = extractArgs(masked, source, openParen).text;
      const args = splitArgs(argsText);
      if (args.length < 1) continue;

      const raw = args[0];
      const name = extractTopicName(raw);
      if (name.length === 0) continue;

      topics.push({
        functionName: fn.name,
        line: lineOf(matchOffset),
        raw: normalizeExpr(raw),
        name,
        convention: detectConvention(name),
      });
    }
  }

  const findings: TopicInconsistencyFinding[] = [];

  const byKey = new Map<string, EventTopic[]>();
  for (const t of topics) {
    const key = normalizeTopicKey(t.name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(t);
  }

  for (const [, group] of byKey) {
    const spellings = new Set(group.map((t) => t.name));
    if (spellings.size > 1) {
      for (const t of group) {
        const related = group.filter((g) => g !== t).map((g) => `${g.functionName}:${g.line}`);
        findings.push({
          ruleId: 'soroban-event-topic-consistency',
          severity: 'medium',
          line: t.line,
          functionName: t.functionName,
          topic: t.name,
          relatedFunctions: [...new Set(group.map((g) => g.functionName))],
          message:
            `Inconsistent event topic '${t.name}' in '${t.functionName}' at line ${t.line} ` +
            `has ${spellings.size} spelling variant(s): ${[...spellings].join(', ')}.`,
          suggestion:
            `Standardize the topic spelling to a single convention (e.g. snake_case) so indexers see one topic; ` +
            `related sites: ${related.join(', ')}.`,
        });
      }
    }
  }

  const conventions = new Set(topics.map((t) => t.convention).filter((c) => c !== 'other'));
  if (conventions.size > 1 && findings.length === 0 && topics.length > 1) {
    const conventionList = [...conventions].join(', ');
    for (const t of topics) {
      findings.push({
        ruleId: 'soroban-event-topic-consistency',
        severity: 'low',
        line: t.line,
        functionName: t.functionName,
        topic: t.name,
        relatedFunctions: [...new Set(topics.map((x) => x.functionName))],
        message:
          `Event topics mix naming conventions (${conventionList}); '${t.name}' in ` +
          `'${t.functionName}' uses ${t.convention}_case.`,
        suggestion:
          `Adopt one topic naming convention (snake_case recommended) across all events for consistent indexing.`,
      });
    }
  }

  const affected = new Set(findings.map((f) => f.functionName)).size;
  const groups = new Set(findings.map((f) => normalizeTopicKey(f.topic))).size;
  const summary =
    findings.length === 0
      ? `Analyzed ${topics.length} event topic(s). Topics are consistent.`
      : `Analyzed ${topics.length} event topic(s). Found ${groups} inconsistent group(s) affecting ${affected} function(s).`;

  return {
    topics,
    findings,
    metrics: {
      totalTopics: topics.length,
      inconsistentGroups: groups,
      affectedFunctions: affected,
    },
    summary,
  };
}

export class EventTopicConsistencyAnalyzer {
  public static readonly RULE_ID = 'soroban-event-topic-consistency';

  public analyze(sourceCode: string): TopicInconsistencyFinding[] {
    return analyzeEventTopicConsistency(sourceCode).findings;
  }

  public analyzeWithReport(sourceCode: string): EventTopicConsistencyReport {
    return analyzeEventTopicConsistency(sourceCode);
  }
}
