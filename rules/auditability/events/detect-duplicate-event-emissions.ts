export interface DuplicateEventEmissionResult {
  detected: boolean;
  violations: DuplicateEventEmissionViolation[];
  message: string;
  suggestion: string;
}

export interface DuplicateEventEmissionViolation {
  eventKey: string;
  count: number;
  firstLine: number;
  duplicateLines: number[];
  snippets: string[];
}

interface EventEmission {
  key: string;
  line: number;
  snippet: string;
}

interface ScanScope {
  code: string;
  startLine: number;
  lineStarts: number[];
}

const MAX_SNIPPET_LENGTH = 120;

export function detectDuplicateEventEmissions(code: string): DuplicateEventEmissionResult {
  const violations: DuplicateEventEmissionViolation[] = [];

  for (const scope of getScanScopes(code)) {
    const emissions = extractEventEmissions(scope);
    const grouped = groupByEventKey(emissions);

    for (const [eventKey, matches] of grouped) {
      if (matches.length < 2) continue;

      violations.push({
        eventKey,
        count: matches.length,
        firstLine: matches[0].line,
        duplicateLines: matches.slice(1).map((match) => match.line),
        snippets: matches.map((match) => match.snippet),
      });
    }
  }

  if (violations.length === 0) {
    return {
      detected: false,
      violations: [],
      message: 'No duplicate event emissions detected.',
      suggestion: '',
    };
  }

  return {
    detected: true,
    violations,
    message: `Duplicate event emissions detected in ${violations.length} event pattern(s).`,
    suggestion:
      'Consolidate repeated event emissions into one publish or emit call after the state change has completed.',
  };
}

function getScanScopes(code: string): ScanScope[] {
  const scopes: ScanScope[] = [];
  const sanitized = sanitizeCode(code);
  const rootLineStarts = buildLineStarts(code);
  const functionPattern =
    /\b(?:function\s+[A-Za-z_$][\w$]*|constructor|fallback|receive|(?:pub\s+)?fn\s+[A-Za-z_][\w]*)[^{]*\{/g;

  for (const match of sanitized.matchAll(functionPattern)) {
    const openBrace = (match.index ?? 0) + match[0].length - 1;
    const closeBrace = findMatching(sanitized, openBrace, '{', '}');
    if (closeBrace === -1) continue;

    scopes.push({
      code: code.slice(openBrace + 1, closeBrace),
      startLine: lineAt(openBrace + 1, rootLineStarts),
      lineStarts: buildLineStarts(code.slice(openBrace + 1, closeBrace)),
    });
  }

  return scopes.length > 0
    ? scopes
    : [{ code, startLine: 1, lineStarts: buildLineStarts(code) }];
}

function extractEventEmissions(scope: ScanScope): EventEmission[] {
  return [
    ...extractSolidityEmitCalls(scope),
    ...extractSorobanPublishCalls(scope),
    ...extractTypedSorobanPublishCalls(scope),
  ];
}

function extractSolidityEmitCalls(scope: ScanScope): EventEmission[] {
  const emissions: EventEmission[] = [];
  const sanitized = sanitizeCode(scope.code);
  const emitPattern = /\bemit\s+([A-Za-z_$][\w$]*)\s*\(/g;

  for (const match of sanitized.matchAll(emitPattern)) {
    const openParen = (match.index ?? 0) + match[0].lastIndexOf('(');
    const closeParen = findMatching(sanitized, openParen, '(', ')');
    if (closeParen === -1) continue;

    const eventName = match[1];
    const args = scope.code.slice(openParen + 1, closeParen);
    const source = scope.code.slice(match.index ?? 0, closeParen + 1);

    emissions.push({
      key: `solidity:${eventName}:${normalizeExpression(args)}`,
      line: scope.startLine + lineAt(match.index ?? 0, scope.lineStarts) - 1,
      snippet: toSnippet(source),
    });
  }

  return emissions;
}

function extractSorobanPublishCalls(scope: ScanScope): EventEmission[] {
  const emissions: EventEmission[] = [];
  const sanitized = sanitizeCode(scope.code);
  const publishPattern =
    /\b[A-Za-z_][A-Za-z0-9_]*\s*\.\s*events\s*\(\s*\)\s*\.\s*publish\s*\(/g;

  for (const match of sanitized.matchAll(publishPattern)) {
    const openParen = (match.index ?? 0) + match[0].lastIndexOf('(');
    const closeParen = findMatching(sanitized, openParen, '(', ')');
    if (closeParen === -1) continue;

    const args = scope.code.slice(openParen + 1, closeParen);
    const source = scope.code.slice(match.index ?? 0, closeParen + 1);

    emissions.push({
      key: `soroban-publish:${normalizeExpression(args)}`,
      line: scope.startLine + lineAt(match.index ?? 0, scope.lineStarts) - 1,
      snippet: toSnippet(source),
    });
  }

  return emissions;
}

function extractTypedSorobanPublishCalls(scope: ScanScope): EventEmission[] {
  const emissions: EventEmission[] = [];
  const sanitized = sanitizeCode(scope.code);
  const publishPattern = /\b([A-Z][A-Za-z0-9_]*)\s*\{/g;

  for (const match of sanitized.matchAll(publishPattern)) {
    const objectOpen = (match.index ?? 0) + match[0].lastIndexOf('{');
    const objectClose = findMatching(sanitized, objectOpen, '{', '}');
    if (objectClose === -1) continue;

    const afterObject = sanitized.slice(objectClose + 1);
    const publishMatch = afterObject.match(/^\s*\.\s*publish\s*\(/);
    if (!publishMatch) continue;

    const publishOpen = objectClose + 1 + publishMatch[0].lastIndexOf('(');
    const publishClose = findMatching(sanitized, publishOpen, '(', ')');
    if (publishClose === -1) continue;

    const eventName = match[1];
    const fields = scope.code.slice(objectOpen + 1, objectClose);
    const publishArgs = scope.code.slice(publishOpen + 1, publishClose);
    const source = scope.code.slice(match.index ?? 0, publishClose + 1);

    emissions.push({
      key: `soroban-typed:${eventName}:${normalizeExpression(fields)}:${normalizeExpression(publishArgs)}`,
      line: scope.startLine + lineAt(match.index ?? 0, scope.lineStarts) - 1,
      snippet: toSnippet(source),
    });
  }

  return emissions;
}

function groupByEventKey(emissions: EventEmission[]): Map<string, EventEmission[]> {
  const grouped = new Map<string, EventEmission[]>();

  for (const emission of emissions) {
    const existing = grouped.get(emission.key);
    if (existing) {
      existing.push(emission);
    } else {
      grouped.set(emission.key, [emission]);
    }
  }

  return grouped;
}

function sanitizeCode(code: string): string {
  let result = '';
  let i = 0;

  while (i < code.length) {
    const char = code[i];
    const next = code[i + 1];

    if (char === '/' && next === '/') {
      result += '  ';
      i += 2;
      while (i < code.length && code[i] !== '\n') {
        result += ' ';
        i++;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      result += '  ';
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        result += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < code.length) {
        result += '  ';
        i += 2;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      result += quote;
      i++;
      while (i < code.length) {
        if (code[i] === '\\') {
          result += '  ';
          i += 2;
          continue;
        }
        if (code[i] === quote) {
          result += quote;
          i++;
          break;
        }
        result += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

function findMatching(code: string, openIndex: number, open: string, close: string): number {
  let depth = 0;

  for (let i = openIndex; i < code.length; i++) {
    if (code[i] === open) depth++;
    if (code[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function normalizeExpression(expression: string): string {
  return stripComments(expression)
    .replace(/\s+/g, '')
    .replace(/,\)/g, ')')
    .trim();
}

function stripComments(code: string): string {
  let result = '';
  let i = 0;

  while (i < code.length) {
    const char = code[i];
    const next = code[i + 1];

    if (char === '/' && next === '/') {
      i += 2;
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
      if (i < code.length) i += 2;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      result += quote;
      i++;
      while (i < code.length) {
        result += code[i];
        if (code[i] === '\\') {
          i++;
          if (i < code.length) result += code[i];
        } else if (code[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

function buildLineStarts(code: string): number[] {
  const starts = [0];

  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') starts.push(i + 1);
  }

  return starts;
}

function lineAt(index: number, lineStarts: number[]): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= index) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return high + 1;
}

function toSnippet(source: string): string {
  const compact = source.replace(/\s+/g, ' ').trim();
  return compact.length > MAX_SNIPPET_LENGTH
    ? `${compact.slice(0, MAX_SNIPPET_LENGTH - 3)}...`
    : compact;
}
