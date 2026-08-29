/**
 * Soroban Unused Ledger Read Analyzer (#902)
 *
 * Performs dataflow analysis on Soroban Rust contracts to identify ledger state
 * reads whose results do not affect contract behavior.
 *
 * Unused state reads consume CPU cycles and storage-read budget without contributing
 * to transaction execution.
 */

import {
  createLineResolver,
  extractArgs,
  extractFunctions,
  maskNonCode,
  normalizeExpr,
} from '../common/source-utils';

export type Severity = 'high' | 'medium' | 'low';

export interface LedgerRead {
  /** Enclosing function name. */
  fn: string;
  /** Storage tier or ledger API kind: 'instance' | 'persistent' | 'temporary' | 'ledger' | 'general' */
  storageKind: 'instance' | 'persistent' | 'temporary' | 'ledger' | 'general';
  /** Operation type: 'get', 'has', 'timestamp', 'sequence', etc. */
  operation: string;
  /** Target key or read expression. */
  keyOrExpr: string;
  /** Name of assigned variable (if any). */
  assignedVar?: string;
  /** True when the read is a statement without assignment. */
  isStatementOnly: boolean;
  /** True when assigned to wildcard `_` or `_var`. */
  isWildcard: boolean;
  /** True when the result is consumed later in dataflow. */
  isConsumed: boolean;
  /** Line number of the read site. */
  line: number;
  /** Character offset of the read site. */
  offset: number;
}

export interface UnusedLedgerReadFinding {
  ruleId: 'soroban-unused-ledger-read';
  severity: Severity;
  line: number;
  fn: string;
  storageKind: string;
  operation: string;
  keyOrExpr: string;
  assignedVar?: string;
  message: string;
  suggestion: string;
  isConsumed: false;
}

export interface LedgerReadReport {
  reads: LedgerRead[];
  findings: UnusedLedgerReadFinding[];
  metrics: {
    totalReads: number;
    consumedReads: number;
    unusedReads: number;
  };
}

/**
 * Extract all ledger reads from Soroban Rust source and perform dataflow analysis
 * to check whether their results are consumed.
 */
export function extractLedgerReads(source: string): LedgerRead[] {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);
  const reads: LedgerRead[] = [];

  // Patterns for ledger reads:
  // 1. env.storage().<kind>().get/has/get_unchecked(...)
  // 2. env.storage().get/has(...)
  // 3. env.ledger().timestamp/sequence/protocol_version/network_id/max_live_until_ledger(...)
  // 4. Standalone helper functions like read_state, get_state, load_state
  const storageTierRe = /\.\s*storage\s*\(\s*\)\s*\.\s*(instance|persistent|temporary)\s*\(\s*\)\s*\.\s*(get|has|get_unchecked)\b/g;
  const storageDirectRe = /\.\s*storage\s*\(\s*\)\s*\.\s*(get|has)\b/g;
  const ledgerEnvRe = /\.\s*ledger\s*\(\s*\)\s*\.\s*(timestamp|sequence|protocol_version|network_id|max_live_until_ledger)\b/g;
  const helperRe = /(?<![.\w])(read_state|get_state|load_state|get_ledger_val)\s*\(/g;

  for (const fn of functions) {
    const fnMasked = masked.slice(fn.bodyStart, fn.bodyEnd);
    const fnSource = source.slice(fn.bodyStart, fn.bodyEnd);

    const processMatch = (
      absIndex: number,
      storageKind: 'instance' | 'persistent' | 'temporary' | 'ledger' | 'general',
      operation: string,
      openParenIndex: number,
    ) => {
      if (absIndex < fn.bodyStart || absIndex >= fn.bodyEnd) return;

      const argsText = extractArgs(masked, source, openParenIndex).text;
      const keyOrExpr = normalizeExpr(argsText.trim() || operation);

      // Analyze statement context around absIndex
      const stmtInfo = analyzeStatementContext(source, masked, fn, absIndex);

      reads.push({
        fn: fn.name,
        storageKind,
        operation,
        keyOrExpr,
        assignedVar: stmtInfo.assignedVar,
        isStatementOnly: stmtInfo.isStatementOnly,
        isWildcard: stmtInfo.isWildcard,
        isConsumed: stmtInfo.isConsumed,
        line: lineOf(absIndex),
        offset: absIndex,
      });
    };

    // Match 1: storage tier reads
    storageTierRe.lastIndex = fn.bodyStart;
    let m: RegExpExecArray | null;
    while ((m = storageTierRe.exec(masked)) !== null) {
      if (m.index >= fn.bodyEnd) break;
      const openParen = m.index + m[0].length;
      processMatch(m.index, m[1] as any, m[2], openParen);
    }

    // Match 2: storage direct reads
    storageDirectRe.lastIndex = fn.bodyStart;
    while ((m = storageDirectRe.exec(masked)) !== null) {
      if (m.index >= fn.bodyEnd) break;
      // Skip if this was already captured by storage tier regex
      const before = masked.slice(Math.max(fn.bodyStart, m.index - 20), m.index);
      if (/(instance|persistent|temporary)\s*\(\s*\)\s*$/i.test(before)) continue;
      const openParen = m.index + m[0].length;
      processMatch(m.index, 'general', m[1], openParen);
    }

    // Match 3: ledger env reads
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
      // Skip fn definitions
      const preceding = masked.slice(Math.max(0, m.index - 8), m.index);
      if (/\bfn\s+$/.test(preceding)) continue;
      const openParen = m.index + m[0].length - 1;
      processMatch(m.index, 'general', m[1], openParen);
    }
  }

  return reads.sort((a, b) => a.offset - b.offset);
}

/**
 * Perform dataflow analysis for a specific read site within its function.
 */
function analyzeStatementContext(
  source: string,
  masked: string,
  fn: { name: string; bodyStart: number; bodyEnd: number },
  readOffset: number,
): {
  assignedVar?: string;
  isStatementOnly: boolean;
  isWildcard: boolean;
  isConsumed: boolean;
} {
  // Find line / statement boundary before readOffset
  let lineStart = readOffset;
  while (lineStart > fn.bodyStart && masked[lineStart - 1] !== '\n' && masked[lineStart - 1] !== ';') {
    lineStart--;
  }

  const prefix = source.slice(lineStart, readOffset).trim();

  // Check if expression is chained/consumed immediately (e.g. .unwrap(), .is_some(), inside if condition, arg, return)
  // Find end of call
  let parenDepth = 0;
  let callEnd = readOffset;
  for (let i = readOffset; i < fn.bodyEnd; i++) {
    if (masked[i] === '(') parenDepth++;
    else if (masked[i] === ')') {
      parenDepth--;
      if (parenDepth === 0) {
        callEnd = i + 1;
        break;
      }
    }
  }

  const suffix = source.slice(callEnd, Math.min(fn.bodyEnd, callEnd + 30)).trim();

  // If method call is directly chained like `.unwrap()`, `.is_some()`, `.expect(...)`, or used in `if`, `return`, `match`, binary op
  if (
    /^\s*\.\s*(unwrap|unwrap_or|expect|is_some|is_none|map|and_then|ok_or|into)\b/.test(suffix) ||
    /\b(return|if|match)\b/.test(prefix) ||
    /^\s*(\+|\-|\*|\/|==|!=|<|>|&&|\|\||,|\))/.test(suffix)
  ) {
    return {
      isStatementOnly: false,
      isWildcard: false,
      isConsumed: true,
    };
  }

  // Check for `let [mut] <var_name> [ : <type> ] =`
  const letMatch = prefix.match(/\blet\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)/);
  if (letMatch) {
    const varName = letMatch[1];
    if (varName === '_' || varName.startsWith('_')) {
      return {
        assignedVar: varName,
        isStatementOnly: false,
        isWildcard: true,
        isConsumed: false,
      };
    }

    // Dataflow analysis: check if `varName` is consumed in subsequent code in function
    const restOfFn = masked.slice(callEnd, fn.bodyEnd);
    const varUseRe = new RegExp(`\\b${varName}\\b`);

    const isConsumed = varUseRe.test(restOfFn);

    return {
      assignedVar: varName,
      isStatementOnly: false,
      isWildcard: false,
      isConsumed,
    };
  }

  // If not assigned with `let` and not used in expression chain/return/arg -> statement only (dropped result)
  const isStatementOnly = !letMatch && /;\s*$/.test(suffix) || suffix.startsWith(';');

  return {
    isStatementOnly,
    isWildcard: false,
    isConsumed: !isStatementOnly,
  };
}

/**
 * Generate analysis findings for unused ledger reads.
 */
export function generateLedgerReadFindings(reads: LedgerRead[]): UnusedLedgerReadFinding[] {
  const findings: UnusedLedgerReadFinding[] = [];

  for (const read of reads) {
    if (read.isConsumed) continue;

    const severity: Severity = read.isStatementOnly || read.isWildcard ? 'high' : 'medium';
    let message: string;
    let suggestion: string;

    if (read.assignedVar) {
      message = `Unused ledger state read '${read.operation}' result assigned to '${read.assignedVar}' in '${read.fn}' (line ${read.line}).`;
      suggestion = `Remove the unused ledger read for '${read.keyOrExpr}' or utilize '${read.assignedVar}' in subsequent logic to save transaction resources.`;
    } else {
      message = `Unused ledger state read '${read.operation}' result dropped without consumption in '${read.fn}' (line ${read.line}).`;
      suggestion = `Remove the unnecessary state read for '${read.keyOrExpr}' to eliminate unnecessary CPU and ledger-read gas overhead.`;
    }

    findings.push({
      ruleId: 'soroban-unused-ledger-read',
      severity,
      line: read.line,
      fn: read.fn,
      storageKind: read.storageKind,
      operation: read.operation,
      keyOrExpr: read.keyOrExpr,
      assignedVar: read.assignedVar,
      message,
      suggestion,
      isConsumed: false,
    });
  }

  return findings.sort((a, b) => a.line - b.line);
}

/**
 * Main analysis entry point.
 */
export function analyzeUnusedLedgerReads(source: string): LedgerReadReport {
  const reads = extractLedgerReads(source);
  const findings = generateLedgerReadFindings(reads);

  const consumedReads = reads.filter((r) => r.isConsumed).length;
  const unusedReads = reads.filter((r) => !r.isConsumed).length;

  return {
    reads,
    findings,
    metrics: {
      totalReads: reads.length,
      consumedReads,
      unusedReads,
    },
  };
}
