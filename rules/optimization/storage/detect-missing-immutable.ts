/**
 * Detect Missing Immutable Variables
 *
 * Detects state variables that are only assigned in the constructor and could
 * benefit from the `immutable` keyword, reducing storage gas costs.
 */

export interface MissingImmutableVariable {
  name: string;
  line: number;
  type: string;
  reason: string;
}

export interface MissingImmutableResult {
  detected: boolean;
  variables: MissingImmutableVariable[];
  message: string;
  suggestion: string;
}

interface StateVariable {
  name: string;
  type: string;
  line: number;
  isImmutable: boolean;
}

function stripComments(code: string): string {
  return code
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractStateVariables(code: string): StateVariable[] {
  const variables: StateVariable[] = [];
  const lines = code.split('\n');

  const stateVarPattern = /^\s*(public|private|internal|external)?\s*(constant\s+)?(immutable\s+)?(uint\d*|int\d*|address|bool|string|bytes\d*|bytes|mapping\s*\([^)]+\)\s*\w+)[^\;]*\s+([A-Za-z_$][\w$]*)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^(function|event|modifier|constructor|struct|enum)\s/.test(trimmed)) {
      break;
    }

    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
      continue;
    }

    const match = line.match(stateVarPattern);
    if (match) {
      const isImmutable = match[3] !== undefined;
      variables.push({
        name: match[4],
        type: match[4],
        line: i + 1,
        isImmutable,
      });
    }
  }

  return variables;
}

function findConstructor(code: string): { startLine: number; endLine: number; body: string } | null {
  const lines = code.split('\n');
  const constructorPattern = /^\s*(constructor)\s*\([^)]*\)\s*(?:public\s*)?\{/;

  for (let i = 0; i < lines.length; i++) {
    if (constructorPattern.test(lines[i])) {
      let braceDepth = 0;
      const bodyLines: string[] = [];
      let bodyStarted = false;

      for (let j = i; j < lines.length; j++) {
        const line = lines[j];
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;

        if (opens > 0) bodyStarted = true;
        if (bodyStarted) bodyLines.push(line);
        braceDepth += opens - closes;

        if (bodyStarted && braceDepth === 0) {
          return {
            startLine: i + 1,
            endLine: j + 1,
            body: bodyLines.slice(1, -1).join('\n'),
          };
        }
      }
    }
  }

  return null;
}

function extractConstructorAssignments(body: string): Set<string> {
  const assignments = new Set<string>();

  const assignmentPatterns = [
    /^\s*([A-Za-z_$][\w$]*)\s*=\s*/,
    /^\s*([A-Za-z_$][\w$]*)\[([^\]]+)\]\s*=\s*/,
  ];

  const lines = body.split('\n');
  for (const line of lines) {
    for (const pattern of assignmentPatterns) {
      const match = line.match(pattern);
      if (match) {
        assignments.add(match[1]);
      }
    }
  }

  return assignments;
}

export function detectMissingImmutable(code: string): MissingImmutableResult {
  const strippedCode = stripComments(code);
  const stateVariables = extractStateVariables(strippedCode);
  const constructor = findConstructor(strippedCode);

  if (!constructor) {
    return {
      detected: false,
      variables: [],
      message: 'No constructor found in contract.',
      suggestion: '',
    };
  }

  const constructorAssignments = extractConstructorAssignments(constructor.body);
  const immutableCandidates: MissingImmutableVariable[] = [];

  for (const variable of stateVariables) {
    if (variable.isImmutable) continue;

    const inConstructor = constructorAssignments.has(variable.name);

    const usedOutsideConstructor = new RegExp(
      `(?<!constructor\\s*\\()\\b${variable.name}\\b`
    ).test(strippedCode);

    if (inConstructor && !usedOutsideConstructor) {
      immutableCandidates.push({
        name: variable.name,
        line: variable.line,
        type: variable.type,
        reason: 'Assigned in constructor and never modified afterward. Consider marking as immutable.',
      });
    }
  }

  if (immutableCandidates.length === 0) {
    return {
      detected: false,
      variables: [],
      message: 'No missing immutable variable opportunities detected.',
      suggestion: '',
    };
  }

  return {
    detected: true,
    variables: immutableCandidates,
    message: `${immutableCandidates.length} variable(s) could be marked as immutable: ${immutableCandidates.map(v => v.name).join(', ')}.`,
    suggestion: 'Add the `immutable` keyword to variables assigned only in the constructor to save gas on storage writes.',
  };
}