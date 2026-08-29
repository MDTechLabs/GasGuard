/**
 * Detect Excessive Soroban Event Topics
 * Flags events whose topic lists exceed the recommended count or contain
 * oversized payload types, both of which inflate execution costs.
 */

export interface ExcessiveEventTopicsResult {
  detected: boolean;
  violations: EventViolation[];
  message: string;
  suggestion: string;
}

export interface EventViolation {
  topicCount: number;
  hasLargePayload: boolean;
  snippet: string;
}

// Soroban recommends no more than 4 topics per event
const MAX_TOPICS = 4;

// Topics embedding large types cost more execution/storage
const LARGE_PAYLOAD_PATTERN = /\b(?:Bytes|BytesN|String|Vec|Map)\b/;

// Locates the opening paren of every publish() call
const PUBLISH_CALL = /env\.events\(\)\.publish\s*\(/g;

// Extract the inner content of the first balanced (...) starting at `pos`
function extractBalanced(code: string, pos: number): string | null {
  // Advance past optional whitespace to find '('
  while (pos < code.length && code[pos] !== '(') pos++;
  if (pos >= code.length) return null;
  pos++; // skip '('
  let depth = 1;
  const start = pos;
  while (pos < code.length) {
    if (code[pos] === '(') depth++;
    else if (code[pos] === ')') {
      depth--;
      if (depth === 0) return code.slice(start, pos);
    }
    pos++;
  }
  return null;
}

function countTopics(topicList: string): number {
  if (topicList.trim() === '') return 0;
  let depth = 0;
  let count = 1;
  for (const ch of topicList) {
    if (ch === '(' || ch === '<') depth++;
    else if (ch === ')' || ch === '>') depth--;
    else if (ch === ',' && depth === 0) count++;
  }
  return count;
}

export function detectExcessiveEventTopics(code: string): ExcessiveEventTopicsResult {
  const violations: EventViolation[] = [];

  for (const match of code.matchAll(PUBLISH_CALL)) {
    // Position just after the opening '(' of publish(; extractBalanced will
    // advance to the next '(' which is the start of the topics tuple.
    const afterOpen = (match.index ?? 0) + match[0].length;

    // First argument to publish() is the topics tuple: (topic1, topic2, ...)
    const topicsTuple = extractBalanced(code, afterOpen);
    if (topicsTuple === null) continue;

    const topicCount = countTopics(topicsTuple);
    const hasLargePayload = LARGE_PAYLOAD_PATTERN.test(topicsTuple);

    if (topicCount > MAX_TOPICS || hasLargePayload) {
      violations.push({
        topicCount,
        hasLargePayload,
        snippet: match[0].slice(0, 80),
      });
    }
  }

  if (violations.length === 0) {
    return {
      detected: false,
      violations: [],
      message: 'No excessive event topics detected.',
      suggestion: '',
    };
  }

  const reasons: string[] = [];
  if (violations.some((v) => v.topicCount > MAX_TOPICS))
    reasons.push(`topic count exceeds ${MAX_TOPICS}`);
  if (violations.some((v) => v.hasLargePayload))
    reasons.push('topics contain large payload types (Bytes, String, Vec, Map)');

  return {
    detected: true,
    violations,
    message: `Excessive event topics in ${violations.length} event(s): ${reasons.join('; ')}.`,
    suggestion: `Limit topics to ${MAX_TOPICS} or fewer and avoid embedding Bytes, String, Vec, or Map directly in topics — move bulk data to the event data argument instead.`,
  };
}
