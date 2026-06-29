export interface StorageGapIssue {
  type: 'missing-gap' | 'incorrect-gap-size' | 'overlapping-gap' | 'gap-after-variables';
  contract: string;
  line: number;
  description: string;
  suggestion: string;
}

export interface StorageGapMisconfigurationResult {
  detected: boolean;
  issues: StorageGapIssue[];
  message: string;
  suggestion: string;
}

const GAP_PATTERN = /__gap\b/g;
const GAP_SIZE_PATTERN = /\[\s*(\d+)\s*\]/;
const CONTRACT_PATTERN = /contract\s+(\w+)/g;

function stripComments(code: string): string {
  return code
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function findMatchingBrace(code: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < code.length; i++) {
    if (code[i] === '{') depth++;
    if (code[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function getContractBody(code: string, startIndex: number): { body: string; startLine: number } | null {
  const openBrace = code.indexOf('{', startIndex);
  if (openBrace === -1) return null;
  const closeBrace = findMatchingBrace(code, openBrace);
  if (closeBrace === -1) return null;
  const startLine = code.slice(0, openBrace).split('\n').length;
  return { body: code.slice(openBrace + 1, closeBrace), startLine };
}

interface StateVarInfo {
  name: string;
  type: string;
  line: number;
  index: number;
}

const STATE_VAR_RE = /^(?:(?:private|internal|public)\s+)?(?:(?:constant|immutable)\s+)?([A-Za-z_]\w*(?:\[[\w]*\])?)\s+(?:(?:private|internal|public)\s+)?(?:(?:constant|immutable)\s+)?([A-Za-z_]\w*)\s*(?:=|;)/;

export function detectStorageGapsMisconfiguration(code: string): StorageGapMisconfigurationResult {
  const issues: StorageGapIssue[] = [];
  const stripped = stripComments(code);

  let contractMatch: RegExpExecArray | null;
  while ((contractMatch = CONTRACT_PATTERN.exec(stripped)) !== null) {
    const contractName = contractMatch[1];
    const ci = getContractBody(stripped, contractMatch.index);
    if (!ci) continue;

    const bodyLines = ci.body.split('\n');
    const stateVariables: StateVarInfo[] = [];

    for (let i = 0; i < bodyLines.length; i++) {
      const line = bodyLines[i].trim();
      if (!line || line.startsWith('//') || line.startsWith('/*')) continue;
      if (/^(function|modifier|event|constructor|struct|enum|error)\s/.test(line)) break;

      const svm = line.match(STATE_VAR_RE);
      if (svm) {
        stateVariables.push({
          name: svm[2],
          type: svm[1],
          line: ci.startLine + i,
          index: i,
        });
      }
    }

    if (stateVariables.length === 0) continue;

    const gapVars = stateVariables.filter(v => v.name === '__gap');
    const lastStateVarIndex = stateVariables[stateVariables.length - 1].index;
    const lastStateVarLine = stateVariables[stateVariables.length - 1].line;

    if (gapVars.length === 0) {
      issues.push({
        type: 'missing-gap',
        contract: contractName,
        line: lastStateVarLine,
        description: `Contract \`${contractName}\` has ${stateVariables.length} state variable(s) but no storage gap (\`__gap\`). Upgradeable contracts may break if new variables are added.`,
        suggestion: `Add \`uint256[${Math.max(50, stateVariables.length * 2)}] private __gap;\` after all state variables to reserve storage slots.`,
      });
    } else {
      for (const gap of gapVars) {
        const sizeMatch = gap.type.match(/\[(\d+)\]/);
        const gapSize = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;

        if (gapSize <= 0) {
          issues.push({
            type: 'incorrect-gap-size',
            contract: contractName,
            line: gap.line,
            description: `Storage gap in \`${contractName}\` has invalid size (${gapSize}). Gaps must have a positive array size.`,
            suggestion: 'Use a positive integer for the gap array size (e.g., `uint256[50] private __gap`).',
          });
          continue;
        }

        if (gapSize < 10) {
          issues.push({
            type: 'incorrect-gap-size',
            contract: contractName,
            line: gap.line,
            description: `Storage gap size ${gapSize} in \`${contractName}\` is too small. Insufficient gap size may not protect against future storage collisions.`,
            suggestion: 'Use a larger gap size (recommended: at least 50 slots).',
          });
          continue;
        }

        if (stateVariables.some(v => v.name !== '__gap' && v.index > gap.index)) {
          issues.push({
            type: 'gap-after-variables',
            contract: contractName,
            line: gap.line,
            description: `Storage gap in \`${contractName}\` is declared before some state variables. Gaps should be the last declaration.`,
            suggestion: 'Move the `__gap` declaration to after all state variables.',
          });
        }
      }
    }
  }

  if (issues.length === 0) {
    return { detected: false, issues: [], message: 'No storage gap misconfiguration detected.', suggestion: '' };
  }

  return {
    detected: true,
    issues,
    message: `${issues.length} storage gap misconfiguration(s) detected.`,
    suggestion: 'Ensure all upgradeable contracts have a properly sized storage gap (`__gap`) declared after all state variables.',
  };
}
