
/**
 * @title Detect Unnecessary Constructor Storage Writes
 * @notice Identifies state variables that are assigned values multiple times within the constructor.
 * @dev Redundant assignments increase deployment gas costs. This rule helps optimize gas usage by flagging unnecessary storage writes.
 */

export interface UnnecessaryWrite {
  variableName: string;
  line: number;
  reason: string;
}

export interface UnnecessaryConstructorWriteResult {
  detected: boolean;
  superfluousWrites: UnnecessaryWrite[];
  message: string;
  suggestion: string;
}

function stripComments(code: string): string {
  return code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
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

export function detectUnnecessaryConstructorStorageWrites(code: string): UnnecessaryConstructorWriteResult {
  const strippedCode = stripComments(code);
  const constructor = findConstructor(strippedCode);

  if (!constructor) {
    return {
      detected: false,
      superfluousWrites: [],
      message: 'No constructor found.',
      suggestion: '',
    };
  }

  const assignments = new Map<string, number[]>();
  const lines = constructor.body.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const assignmentMatch = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
    if (assignmentMatch) {
      const varName = assignmentMatch[1];
      if (!assignments.has(varName)) {
        assignments.set(varName, []);
      }
      assignments.get(varName)!.push(constructor.startLine + i);
    }
  }

  const superfluousWrites: UnnecessaryWrite[] = [];
  for (const [variableName, lineNumbers] of assignments.entries()) {
    if (lineNumbers.length > 1) {
      for (let i = 1; i < lineNumbers.length; i++) {
        superfluousWrites.push({
          variableName,
          line: lineNumbers[i],
          reason: `Redundant assignment to '${variableName}'. It was already assigned on line ${lineNumbers[0]}.`,
        });
      }
    }
  }

  if (superfluousWrites.length > 0) {
    return {
      detected: true,
      superfluousWrites,
      message: 'Unnecessary storage writes detected in the constructor.',
      suggestion: 'Remove redundant assignments to save deployment gas.',
    };
  }

  return {
    detected: false,
    superfluousWrites: [],
    message: 'No unnecessary constructor storage writes detected.',
    suggestion: '',
  };
}