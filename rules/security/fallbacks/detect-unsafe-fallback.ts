/**
 * Detect Unsafe Fallback Functions (#320)
 *
 * Solidity contracts can define `fallback()` and `receive()` functions to
 * handle incoming Ether and unmatched calldata. Unsafe implementations of
 * these functions are a well-known attack vector (e.g., reentrancy through
 * `receive()`).
 *
 * This rule flags the following unsafe patterns:
 *   1. `delegatecall` in fallback/receive — allows arbitrary code execution
 *      when the target address is user-controlled.
 *   2. State modification in `receive()` — `receive()` should only accept
 *      ETH, not alter state.
 *   3. Arbitrary external call in fallback — fallback makes `.call()` or
 *      `.delegatecall()` to user-controlled addresses.
 *   4. Reentrancy-vulnerable pattern in fallback — fallback makes an
 *      external `call{value: ...}()` that enables reentrancy.
 *   5. Complex logic (loops) in fallback — loops in fallback are a strong
 *      indicator the function is doing too much.
 */

export type UnsafeFallbackKind =
  | 'delegatecall-in-fallback'
  | 'state-modification-in-receive'
  | 'arbitrary-external-call'
  | 'reentrancy-vulnerable-fallback'
  | 'complex-logic-in-fallback';

export interface UnsafeFallbackViolation {
  functionName: string;
  line: number;
  kind: UnsafeFallbackKind;
  reason: string;
  snippet: string;
}

export interface UnsafeFallbackResult {
  detected: boolean;
  violations: UnsafeFallbackViolation[];
  message: string;
  suggestion: string;
}

const REASON_MAP: Record<UnsafeFallbackKind, string> = {
  'delegatecall-in-fallback':
    'fallback function uses delegatecall which can execute arbitrary code at the target address',
  'state-modification-in-receive':
    'receive() function modifies contract state; it should only accept Ether',
  'arbitrary-external-call':
    'fallback function makes external calls to what appears to be an arbitrary address, enabling potential reentrancy or redirection attacks',
  'reentrancy-vulnerable-fallback':
    'fallback function makes an external ETH transfer call that could re-enter the contract',
  'complex-logic-in-fallback':
    'fallback function contains loops which is a strong indicator of overly complex logic',
};

/**
 * Extract functions from Solidity source code, returning their name, line
 * number, body, and the full function declaration range.
 */
interface ExtractedFunction {
  name: string;
  declarationLine: number;
  bodyStart: number;
  bodyEnd: number;
  body: string;
  declaration: string;
}

function buildLineStarts(code: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineAt(offset: number, lineStarts: number[]): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lineStarts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

/**
 * Strip string contents and comments from code so patterns inside them
 * are not matched by accident. Keeps line-breaks for accurate line numbers.
 */
function sanitizeCode(code: string): string {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    const nx = code[i + 1];

    // Single-line comment
    if (ch === '/' && nx === '/') {
      out += '  ';
      i += 2;
      while (i < code.length && code[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }

    // Multi-line comment
    if (ch === '/' && nx === '*') {
      out += '  ';
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        out += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < code.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }

    // String literals
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += quote;
      i++;
      while (i < code.length) {
        if (code[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        if (code[i] === quote) {
          out += quote;
          i++;
          break;
        }
        out += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/**
 * Find all `fallback()` and `receive()` function declarations in Solidity
 * code, along with their full bodies.
 */
function extractFallbackFunctions(
  code: string,
  lineStarts: number[],
): ExtractedFunction[] {
  const functions: ExtractedFunction[] = [];
  const sanitized = sanitizeCode(code);

  // Match: `fallback () external [payable] [...] { ... }`
  // or:     `receive () external payable { ... }`
  // The pattern allows optional whitespace and visibility modifiers between
  // the function name and the opening brace.
  // Match fallback/receive declarations with optional parameters, modifiers,
  // and return types. `fallback()` may have `bytes calldata data` parameters,
  // while `receive()` always has empty parens. This pattern handles both.
  const fallbackPattern =
    /\b(fallback|receive)\s*\([^)]*\)\s*(?:external|public)?\s*(?:(?:payable|virtual|override)\s+)*(?:returns\s*\([^)]*\))?\s*(?:external|public)?\s*\{/g;

  for (const match of sanitized.matchAll(fallbackPattern)) {
    const declStart = match.index ?? 0;
    const openBrace = declStart + match[0].lastIndexOf('{');
    const depth = findMatchingBrace(sanitized, openBrace);
    if (depth === -1) continue;

    const body = code.slice(openBrace + 1, depth);
    const declaration = code.slice(declStart, openBrace).trim();

    functions.push({
      name: match[1],
      declarationLine: lineAt(declStart, lineStarts),
      bodyStart: openBrace + 1,
      bodyEnd: depth,
      body,
      declaration,
    });
  }

  return functions;
}

function findMatchingBrace(code: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Check if the fallback body contains a `delegatecall` to an address that
 * appears uncontrolled (not a hardcoded constant).
 */
function hasUnrestrictedDelegatecall(body: string): boolean {
  // Check whether the fallback body contains `.delegatecall(`.
  if (!/\.\s*delegatecall\s*\(/g.test(body)) return false;

  // Heuristic: if the body contains a literal hex address (`0x...`)
  // or an `address(...)` cast, assume the delegatecall target is under
  // reasonable control (e.g., a constant, immutable, or inline address).
  if (/0x[0-9a-fA-F]{40}/.test(body)) return false;
  if (/address\s*\(/i.test(body)) return false;

  // Otherwise, the delegatecall target appears to be a variable or
  // function parameter that is not obviously constrained -> flag.
  return true;
}

/**
 * Check if the body modifies state variables (direct `=` assignment or
 * `storage` mutation) — only relevant for `receive()`.
 */
function hasStateModification(body: string): boolean {
  const sanitized = sanitizeCode(body);

  // Check for patterns that are definitely state modifications
  const statePatterns = [
    /\.call\s*\{[^}]*\}\s*\(/,  // external call
    /\bdelete\s+\w+/,            // delete statement
    /\.push\s*\(/,              // push to storage array
    /\btransfer\s*\(/,          // ETH transfer
    /\bsend\s*\(/,              // ETH send
  ];
  for (const pattern of statePatterns) {
    if (pattern.test(sanitized)) return true;
  }

  // Check for assignment statements (`=`, `+=`, `-=`, etc.)
  // The pattern matches `=` that is NOT part of `==`, `!=`, `<=`, `>=`, `=>`.
  const assignmentPattern = /(?<![!<>=])=(?!=)/g;
  for (const match of sanitized.matchAll(assignmentPattern)) {
    if (match.index === null) continue;

    // Compound assignments (+=, -=, *=, etc.) always modify existing variables
    if (match.index > 0) {
      const charBefore = sanitized[match.index - 1];
      if (charBefore && /[+\-*/%&|^~]/.test(charBefore)) {
        return true;
      }
    }

    // Get the full left-hand side of the assignment
    const before = sanitized.slice(0, match.index).trimEnd();

    // If the LHS contains `[`, it's an array/mapping write -> state modification
    if (before.includes('[')) return true;

    // If the LHS ends with an identifier, check if it's a local declaration
    const identifierMatch = before.match(/(\w+)\s*$/);
    if (identifierMatch) {
      const lastWord = identifierMatch[1];
      // Check if it's a local variable declaration: `type name = value`
      const localPattern =
        /(?:uint|int|bool|string|bytes\d*|address|mapping|struct)\s+\w+\s*$/i;
      if (localPattern.test(before)) {
        continue; // Local declaration, skip
      }
      // Existing variable assignment -> state modification
      return true;
    }

    // If we can't extract a clean identifier, the LHS is a complex expression
    // (e.g., `arr[i]`, `obj.field`) -> state modification
    return true;
  }

  return false;
}

/**
 * Check if the body makes an external `call` or `delegatecall` to an
 * address that appears to be user-controlled (parameter or variable).
 */
function hasArbitraryExternalCall(body: string): boolean {
  const sanitized = sanitizeCode(body);
  const callPattern = /\.\s*(call|delegatecall|staticcall)\s*\{/g;

  for (const match of sanitized.matchAll(callPattern)) {
    const before = body.slice(0, match.index ?? 0).trimEnd();
    const lastWord = before.split(/[\s\n;(){}]+/).pop() ?? '';

    // If the receiver is a parameter, a local variable (not a hardcoded address
    // or `address(this)`), flag it.
    if (
      !/^0x[0-9a-fA-F]{40}$/.test(lastWord) &&
      !/^address\s*\(\s*this\s*\)$/i.test(lastWord) &&
      !/^address\(this\)$/i.test(lastWord)
    ) {
      // Check if it's one of the function parameters (msg.sender, tx.origin are fine)
      if (
        lastWord !== 'msg.sender' &&
        lastWord !== 'tx.origin' &&
        lastWord !== 'address(this)'
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if the fallback body contains a reentrancy-vulnerable pattern:
 * making an external ETH transfer (`call{value: ...}()`) in a fallback
 * function (which is itself called on ETH receipt).
 */
function hasReentrancyVulnerableCall(body: string): boolean {
  const sanitized = sanitizeCode(body);
  // Match `.call{value: ...}(...)` — ETH transfer that can trigger
  // the recipient's fallback again.
  const valueCallPattern = /\.\s*call\s*\{[^}]*value\s*[:=]/i;
  return valueCallPattern.test(sanitized);
}

/**
 * Check if the fallback body contains loops (for, while, do-while).
 */
function hasComplexLogic(body: string): boolean {
  const sanitized = sanitizeCode(body);
  const loopPattern = /\b(for|while)\s*\(/g;
  return loopPattern.test(sanitized);
}

/**
 * Truncate a code snippet to a readable length.
 */
function toSnippet(source: string, maxLen = 120): string {
  const compact = source.replace(/\s+/g, ' ').trim();
  return compact.length > maxLen
    ? `${compact.slice(0, maxLen - 3)}...`
    : compact;
}

export function detectUnsafeFallback(code: string): UnsafeFallbackResult {
  const violations: UnsafeFallbackViolation[] = [];
  const lineStarts = buildLineStarts(code);
  const functions = extractFallbackFunctions(code, lineStarts);

  for (const fn of functions) {
    const fnBody = fn.body;

    // 1. Unrestricted delegatecall in fallback
    if (hasUnrestrictedDelegatecall(fnBody)) {
      violations.push({
        functionName: fn.name,
        line: fn.declarationLine,
        kind: 'delegatecall-in-fallback',
        reason: REASON_MAP['delegatecall-in-fallback'],
        snippet: toSnippet(fn.declaration),
      });
    }

    // 2. State modification in receive()
    if (fn.name === 'receive' && hasStateModification(fnBody)) {
      violations.push({
        functionName: fn.name,
        line: fn.declarationLine,
        kind: 'state-modification-in-receive',
        reason: REASON_MAP['state-modification-in-receive'],
        snippet: toSnippet(fn.declaration),
      });
    }

    // 3. Arbitrary external calls in fallback
    if (fn.name === 'fallback' && hasArbitraryExternalCall(fnBody)) {
      violations.push({
        functionName: fn.name,
        line: fn.declarationLine,
        kind: 'arbitrary-external-call',
        reason: REASON_MAP['arbitrary-external-call'],
        snippet: toSnippet(fn.declaration),
      });
    }

    // 4. Reentrancy-vulnerable pattern (ETH transfer in fallback)
    if (hasReentrancyVulnerableCall(fnBody)) {
      violations.push({
        functionName: fn.name,
        line: fn.declarationLine,
        kind: 'reentrancy-vulnerable-fallback',
        reason: REASON_MAP['reentrancy-vulnerable-fallback'],
        snippet: toSnippet(fnBody),
      });
    }

    // 5. Complex logic (loops) in fallback
    if (hasComplexLogic(fnBody)) {
      violations.push({
        functionName: fn.name,
        line: fn.declarationLine,
        kind: 'complex-logic-in-fallback',
        reason: REASON_MAP['complex-logic-in-fallback'],
        snippet: toSnippet(fn.declaration),
      });
    }
  }

  if (violations.length === 0) {
    return {
      detected: false,
      violations: [],
      message:
        functions.length === 0
          ? 'No fallback or receive functions found.'
          : 'All fallback/receive functions appear safe.',
      suggestion: '',
    };
  }

  // Deduplicate violations by (functionName, kind) to avoid double-reporting
  const seen = new Set<string>();
  const uniqueViolations = violations.filter((v) => {
    const key = `${v.functionName}:${v.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const violationSummary = uniqueViolations
    .map((v) => `${v.functionName}() — ${v.kind}`)
    .join('; ');

  return {
    detected: true,
    violations: uniqueViolations,
    message: `Unsafe fallback function(s) detected (${uniqueViolations.length}): ${violationSummary}.`,
    suggestion:
      'Audit every fallback and receive function carefully. ' +
      'Avoid delegatecall with user-controlled targets, state changes in receive(), ' +
      'arbitrary external calls, reentrancy-vulnerable ETH transfers, and complex logic. ' +
      'Consider using a reentrancy guard or access control where appropriate.',
  };
}
