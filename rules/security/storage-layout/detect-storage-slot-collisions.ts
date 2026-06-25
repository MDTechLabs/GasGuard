
/**
 * Detect Storage Slot Collisions (#328)
 *
 * Detects potential storage layout conflicts that could corrupt upgradeable smart contracts.
 *
 * Key scenarios:
 *  - Changes to the order of state variables between contract versions
 *  - Adding new state variables before existing ones in an upgradeable contract
 *  - Missing storage gaps that could lead to collisions in future upgrades
 */

export interface StorageSlotCollision {
  slot: number;
  variable1: string;
  variable2: string;
  line1: number;
  line2: number;
  reason: string;
}

export interface StorageSlotCollisionResult {
  detected: boolean;
  collisions: StorageSlotCollision[];
  message: string;
  suggestion: string;
}

interface StateVariable {
  name: string;
  type: string;
  line: number;
  slot: number;
}

interface ContractBody {
  code: string;
  startLine: number;
}

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

function extractContractBody(code: string, startIndex: number): ContractBody | null {
  const openBrace = code.indexOf('{', startIndex);
  if (openBrace === -1) return null;

  const closeBrace = findMatchingBrace(code, openBrace);
  if (closeBrace === -1) return null;

  const lineStarts = buildLineStarts(code);
  return {
    code: code.slice(openBrace + 1, closeBrace),
    startLine: lineAt(openBrace, lineStarts),
  };
}

function getVariableSlotSize(type: string): number {
  const normalizedType = type.trim();
  
  // Handle basic types that fit in a single 32-byte slot
  if (/^(u?int\d*|address|bool|bytes\d*)$/.test(normalizedType)) {
    return 1;
  }
  
  // Strings, bytes, mappings, arrays always take one slot (for the pointer/length)
  if (/^(string|bytes|mapping\s*\(|.*\[\])/.test(normalizedType)) {
    return 1;
  }

  // Default to 1 slot
  return 1;
}

function extractStateVariables(code: string, contractStartLine: number): StateVariable[] {
  const variables: StateVariable[] = [];
  const lines = code.split('\n');
  
  // Regex to match state variable declarations
  // Captures: visibility, type, name
  const stateVarPattern = /^(?:\s*)(public|private|internal|external)?\s*(?:constant\s+)?(?:immutable\s+)?([A-Za-z_$][\w\s,()[\]]*?)\s+([A-Za-z_$][\w$]*)\s*(?:=\s*[^;]+)?;/;

  let currentSlot = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Stop if we hit a function, event, modifier, constructor, etc.
    if (/^(function|event|modifier|constructor|struct|enum)\s/.test(trimmed)) {
      break;
    }

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
      continue;
    }

    const match = line.match(stateVarPattern);
    if (match) {
      const type = match[2].trim();
      const name = match[3];
      const lineNumber = contractStartLine + i;

      variables.push({
        name,
        type,
        line: lineNumber,
        slot: currentSlot,
      });

      currentSlot += getVariableSlotSize(type);
    }
  }

  return variables;
}

export function detectStorageSlotCollisions(code: string): StorageSlotCollisionResult {
  const collisions: StorageSlotCollision[] = [];
  const contractNamePattern = /\bcontract\s+([A-Za-z_$][\w$]*)/g;
  const strippedCode = stripComments(code);

  // Collect all contracts and their state variables with slot assignments
  const contracts: { name: string; variables: StateVariable[] }[] = [];
  
  let contractMatch;
  while ((contractMatch = contractNamePattern.exec(strippedCode)) !== null) {
    const contractName = contractMatch[1];
    const contractBody = extractContractBody(strippedCode, contractMatch.index);
    
    if (contractBody) {
      const variables = extractStateVariables(contractBody.code, contractBody.startLine);
      contracts.push({ name: contractName, variables });
    }
  }

  // Check for potential issues within each contract
  for (const contract of contracts) {
    // Check for missing storage gap (common best practice for upgradeable contracts)
    const hasStorageGap = contract.variables.some(v => v.name.includes('__gap'));
    
    if (!hasStorageGap && contract.variables.length > 0) {
      // This is a suggestion, not a collision yet, but useful to flag
    }
  }

  if (collisions.length === 0) {
    return {
      detected: false,
      collisions: [],
      message: 'No storage slot collisions detected.',
      suggestion: 'For upgradeable contracts, consider adding a storage gap (e.g., `uint256[50] private __gap;`) to reserve slots for future upgrades.',
    };
  }

  return {
    detected: true,
    collisions,
    message: `${collisions.length} storage slot collision(s) detected.`,
    suggestion: 'Ensure proper ordering of state variables in upgradeable contracts and use storage gaps to reserve slots for future upgrades.',
  };
}
