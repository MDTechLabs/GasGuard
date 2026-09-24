/**
 * Issue #914 — Detect Redundant Soroban Events
 *
 * Tracks emitted events within the same execution path, compares topics and
 * payloads, detects duplicate emissions, and suggests safe consolidation.
 */

import {
  maskNonCode,
  extractFunctions,
  createLineResolver,
  extractArgs,
  splitArgs,
  normalizeExpr,
  blockStackAt,
  onExclusiveBranches,
  isInLoop,
  isInBranch,
} from '../common/source-utils';

export interface RedundantEventEmission {
  functionName: string;
  line: number;
  topics: string;
  payload: string;
  fingerprint: string;
  inLoop: boolean;
  inBranch: boolean;
}

export interface RedundantEventFinding {
  ruleId: 'soroban-redundant-event';
  severity: 'medium' | 'low';
  line: number;
  functionName: string;
  topics: string;
  firstLine: number;
  message: string;
  suggestion: string;
}

export interface RedundantEventReport {
  emissions: RedundantEventEmission[];
  findings: RedundantEventFinding[];
  metrics: {
    totalEmissions: number;
    duplicateEmissions: number;
    affectedFunctions: number;
  };
  summary: string;
}

const PUBLISH_RE = /env\s*\.\s*events\s*\(\s*\)\s*\.\s*publish\s*\(/g;

function fingerprintOf(topics: string, payload: string): string {
  return `${normalizeExpr(topics)}::${normalizeExpr(payload)}`;
}

/**
 * Analyze Soroban contract source for duplicate event emissions (#914).
 *
 * Two emissions are duplicates when they share structurally equal topics and
 * payload within the same function on a non-exclusive execution path.
 */
export function analyzeRedundantEvents(source: string): RedundantEventReport {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);
  const emissions: RedundantEventEmission[] = [];
  const findings: RedundantEventFinding[] = [];

  for (const fn of functions) {
    const fnBodyMasked = masked.slice(fn.bodyStart, fn.bodyEnd);
    const re = new RegExp(PUBLISH_RE.source, 'g');

    interface Site extends RedundantEventEmission {
      offset: number;
      stack: ReturnType<typeof blockStackAt>;
    }
    const sites: Site[] = [];

    let m: RegExpExecArray | null;
    while ((m = re.exec(fnBodyMasked)) !== null) {
      const matchOffset = fn.bodyStart + m.index;
      const openParen = matchOffset + m[0].length - 1;
      const argsText = extractArgs(masked, source, openParen).text;
      const args = splitArgs(argsText);
      if (args.length < 2) continue;

      const topics = args[0];
      const payload = args.slice(1).join(', ');
      const stack = blockStackAt(masked, fn.bodyStart, matchOffset);

      sites.push({
        functionName: fn.name,
        line: lineOf(matchOffset),
        topics: normalizeExpr(topics),
        payload: normalizeExpr(payload),
        fingerprint: fingerprintOf(topics, payload),
        inLoop: isInLoop(stack),
        inBranch: isInBranch(stack),
        offset: matchOffset,
        stack,
      });
    }

    emissions.push(...sites);

    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        const first = sites[i];
        const second = sites[j];
        if (first.fingerprint !== second.fingerprint) continue;
        if (onExclusiveBranches(first.stack, second.stack)) continue;

        const inLoop = second.inLoop || first.inLoop;
        findings.push({
          ruleId: 'soroban-redundant-event',
          severity: inLoop ? 'medium' : 'low',
          line: second.line,
          functionName: fn.name,
          topics: second.topics,
          firstLine: first.line,
          message:
            `Duplicate event emission in '${fn.name}' at line ${second.line} ` +
            `repeats topics and payload from line ${first.line}.`,
          suggestion: inLoop
            ? `Hoist the event emission for '${second.topics}' out of the loop or emit once after the loop.`
            : `Remove the redundant publish call at line ${second.line} or hoist the event out of the branch.`,
        });
      }
    }
  }

  const affected = new Set(findings.map((f) => f.functionName)).size;
  const summary =
    findings.length === 0
      ? `Analyzed ${emissions.length} event emission(s). No duplicate emissions detected.`
      : `Analyzed ${emissions.length} event emission(s). Found ${findings.length} duplicate emission(s) in ${affected} function(s).`;

  return {
    emissions,
    findings,
    metrics: {
      totalEmissions: emissions.length,
      duplicateEmissions: findings.length,
      affectedFunctions: affected,
    },
    summary,
  };
}

export class RedundantEventAnalyzer {
  public static readonly RULE_ID = 'soroban-redundant-event';

  public analyze(sourceCode: string): RedundantEventFinding[] {
    return analyzeRedundantEvents(sourceCode).findings;
  }

  public analyzeWithReport(sourceCode: string): RedundantEventReport {
    return analyzeRedundantEvents(sourceCode);
  }
}
