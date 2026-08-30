/**
 * Soroban Repeated Ledger Access Analyzer (#901)
 *
 * Performs dataflow analysis on Soroban Rust contracts to identify repeated
 * ledger state accesses (reads/writes) to the same ledger key within a single execution path.
 *
 * Repeated state access increases transaction gas, CPU, and storage fee overhead.
 */

import {
  blockStackAt,
  createLineResolver,
  extractArgs,
  extractFunctions,
  isInLoop,
  maskNonCode,
  normalizeExpr,
  onExclusiveBranches,
  splitArgs,
  BlockFrame,
} from '../common/source-utils';

export type Severity = 'high' | 'medium' | 'low';

export interface LedgerAccess {
  /** Enclosing function name. */
  fn: string;
  /** Storage tier or ledger API kind: 'instance' | 'persistent' | 'temporary' | 'ledger' | 'general' */
  storageKind: 'instance' | 'persistent' | 'temporary' | 'ledger' | 'general';
  /** Access operation: 'get', 'has', 'get_unchecked', 'set', 'timestamp', 'sequence', etc. */
  operation: string;
  /** Normalized target key or ledger access expression. */
  keyOrExpr: string;
  /** Name of assigned variable (if any). */
  assignedVar?: string;
  /** Line number of the access site. */
  line: number;
  /** Character offset of the access site. */
  offset: number;
  /** Enclosing block stack at the access site. */
  blockStack: BlockFrame[];
}

export interface RepeatedLedgerAccessFinding {
  ruleId: 'soroban-repeated-ledger-access';
  severity: Severity;
  line: number;
  fn: string;
  storageKind: string;
  operation: string;
  keyOrExpr: string;
  firstAccessLine: number;
  firstAccessOperation: string;
  accessCount: number;
  message: string;
  suggestion: string;
}

export interface RepeatedLedgerAccessReport {
  accesses: LedgerAccess[];
  findings: RepeatedLedgerAccessFinding[];
  metrics: {
    totalAccesses: number;
    repeatedAccesses: number;
    uniqueKeysAccessed: number;
  };
}

/**
 * Helper to check statement context and extract variable assignment if present.
 */
function findAssignedVar(
  source: string,
  masked: string,
  fnStart: number,
  readOffset: number,
): string | undefined {
  let lineStart = readOffset;
  while (lineStart > fnStart && masked[lineStart - 1] !== '\n' && masked[lineStart - 1] !== ';') {
    lineStart--;
  }

  const prefix = source.slice(lineStart, readOffset).trim();
  const letMatch = prefix.match(/\blet\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)/);
  if (letMatch && letMatch[1] !== '_' && !letMatch[1].startsWith('_')) {
    return letMatch[1];
  }
  return undefined;
}

/**
 * Extract all ledger access operations from Soroban Rust source code.
 */
export function extractLedgerAccesses(source: string): LedgerAccess[] {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);
  const accesses: LedgerAccess[] = [];

  // Patterns for ledger accesses:
  // 1. env.storage().<kind>().get/has/get_unchecked/set(...)
  // 2. env.storage().get/has/set(...)
  // 3. env.ledger().timestamp/sequence/protocol_version/network_id/max_live_until_ledger(...)
  // 4. Standalone helpers like read_state, get_state, load_state, get_ledger_val
  const storageTierRe = /\.\s*storage\s*\(\s*\)\s*\.\s*(instance|persistent|temporary)\s*\(\s*\)\s*\.\s*(get|has|get_unchecked|set)\b/g;
  const storageDirectRe = /\.\s*storage\s*\(\s*\)\s*\.\s*(get|has|set)\b/g;
  const ledgerEnvRe = /\.\s*ledger\s*\(\s*\)\s*\.\s*(timestamp|sequence|protocol_version|network_id|max_live_until_ledger)\b/g;
  const helperRe = /(?<![.\w])(read_state|get_state|load_state|get_ledger_val)\s*\(/g;

  for (const fn of functions) {
    const processMatch = (
      absIndex: number,
      storageKind: 'instance' | 'persistent' | 'temporary' | 'ledger' | 'general',
      operation: string,
      openParenIndex: number,
    ) => {
      if (absIndex < fn.bodyStart || absIndex >= fn.bodyEnd) return;

      const argsText = extractArgs(masked, source, openParenIndex).text;
      const parsedArgs = splitArgs(argsText);
      const keyOrExpr = parsedArgs.length > 0 ? normalizeExpr(parsedArgs[0]) : normalizeExpr(argsText.trim() || operation);

      const assignedVar = findAssignedVar(source, masked, fn.bodyStart, absIndex);
      const blockStack = blockStackAt(masked, fn.bodyStart, absIndex);

      accesses.push({
        fn: fn.name,
        storageKind,
        operation,
        keyOrExpr: keyOrExpr || operation,
        assignedVar,
        line: lineOf(absIndex),
        offset: absIndex,
        blockStack,
      });
    };

    // Match 1: storage tier accesses
    storageTierRe.lastIndex = fn.bodyStart;
    let m: RegExpExecArray | null;
    while ((m = storageTierRe.exec(masked)) !== null) {
      if (m.index >= fn.bodyEnd) break;
      const openParen = m.index + m[0].length;
      processMatch(m.index, m[1] as any, m[2], openParen);
    }

    // Match 2: direct storage accesses
    storageDirectRe.lastIndex = fn.bodyStart;
    while ((m = storageDirectRe.exec(masked)) !== null) {
      if (m.index >= fn.bodyEnd) break;
      const before = masked.slice(Math.max(fn.bodyStart, m.index - 20), m.index);
      if (/(instance|persistent|temporary)\s*\(\s*\)\s*$/i.test(before)) continue;
      const openParen = m.index + m[0].length;
      processMatch(m.index, 'general', m[1], openParen);
    }

    // Match 3: ledger environment calls
    ledgerEnvRe.lastIndex = fn.bodyStart;
    while ((m = ledgerEnvRe.exec(masked)) !== null) {
      if (m.index >= fn.bodyEnd) break;
      const openParen = m.index + m[0].length;
      processMatch(m.index, 'ledger', m[1], openParen);
    }

    // Match 4: helper functions
    helperRe.lastIndex = fn.bodyStart;
    while ((m = helperRe.exec(masked)) !== null) {
      if (m.index >= fn.bodyEnd) break;
      const preceding = masked.slice(Math.max(0, m.index - 8), m.index);
      if (/\bfn\s+$/.test(preceding)) continue;
      const openParen = m.index + m[0].length - 1;
      processMatch(m.index, 'general', m[1], openParen);
    }
  }

  return accesses.sort((a, b) => a.offset - b.offset);
}

/**
 * Generate findings for repeated ledger access within single execution paths.
 */
export function generateRepeatedAccessFindings(accesses: LedgerAccess[]): RepeatedLedgerAccessFinding[] {
  const findings: RepeatedLedgerAccessFinding[] = [];

  // Group accesses by function name
  const byFunction = new Map<string, LedgerAccess[]>();
  for (const access of accesses) {
    const list = byFunction.get(access.fn) || [];
    list.push(access);
    byFunction.set(access.fn, list);
  }

  for (const [fn, fnAccesses] of byFunction) {
    // Group accesses in fn by storageKind + ':' + keyOrExpr
    const keyGroups = new Map<string, LedgerAccess[]>();
    for (const access of fnAccesses) {
      const groupKey = `${access.storageKind}:${access.keyOrExpr}`;
      const group = keyGroups.get(groupKey) || [];
      group.push(access);
      keyGroups.set(groupKey, group);
    }

    for (const group of keyGroups.values()) {
      if (group.length < 2) continue;

      // Track access occurrences along non-exclusive paths
      for (let i = 1; i < group.length; i++) {
        const current = group[i];

        // Find the earlier access that is on the same execution path
        const previous = group.slice(0, i).reverse().find((prev) => !onExclusiveBranches(prev.blockStack, current.blockStack));

        if (!previous) continue; // Divergent branches, not on same path

        const isLoop = isInLoop(current.blockStack);
        const severity: Severity = isLoop || current.operation === 'get' || current.operation === 'get_unchecked' ? 'high' : 'medium';

        const accessCount = group.indexOf(current) + 1;
        const message = `Repeated ledger state access for key '${current.keyOrExpr}' (${current.operation}) in '${fn}' at line ${current.line}. (First accessed at line ${previous.line} via '${previous.operation}').`;

        const suggestion = previous.assignedVar
          ? `Reuse local variable '${previous.assignedVar}' from line ${previous.line} instead of accessing ledger key '${current.keyOrExpr}' again.`
          : `Store the result of the initial ledger access for '${current.keyOrExpr}' (line ${previous.line}) in a local variable and reuse it.`;

        findings.push({
          ruleId: 'soroban-repeated-ledger-access',
          severity,
          line: current.line,
          fn,
          storageKind: current.storageKind,
          operation: current.operation,
          keyOrExpr: current.keyOrExpr,
          firstAccessLine: previous.line,
          firstAccessOperation: previous.operation,
          accessCount,
          message,
          suggestion,
        });
      }
    }
  }

  return findings.sort((a, b) => a.line - b.line);
}

/**
 * Analyze repeated ledger accesses in Soroban source and return a complete report.
 */
export function analyzeRepeatedLedgerAccesses(source: string): RepeatedLedgerAccessReport {
  const accesses = extractLedgerAccesses(source);
  const findings = generateRepeatedAccessFindings(accesses);

  const uniqueKeys = new Set(accesses.map((a) => `${a.storageKind}:${a.keyOrExpr}`));

  return {
    accesses,
    findings,
    metrics: {
      totalAccesses: accesses.length,
      repeatedAccesses: findings.length,
      uniqueKeysAccessed: uniqueKeys.size,
    },
  };
}
