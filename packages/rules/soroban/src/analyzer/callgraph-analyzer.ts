/**
 * Soroban Call Graph Analyzer
 *
 * Builds a call graph from Soroban contract source and detects:
 *  - Nested (deep) contract call chains  (#771)
 *  - Cross-contract call patterns         (#772)
 *  - Redundant (repeated identical) calls (#773)
 */

export interface CallNode {
  /** The calling function name */
  caller: string;
  /** The callee (contract.method or env.invoke_contract) */
  callee: string;
  /** Line where the call appears */
  line: number;
  /** Raw argument string (used for redundancy checks) */
  args: string;
}

export interface CallGraphFinding {
  rule: string;
  line: number;
  message: string;
  suggestion: string;
  severity: 'high' | 'medium' | 'low';
}

const CROSS_CONTRACT_PATTERNS = [
  /env\.invoke_contract\s*\(/,
  /Client::new\s*\(/,
  /ContractClient\s*::\s*new\s*\(/,
  /invoke_contract_check_auth\s*\(/,
];

const DEPTH_THRESHOLD = 3;

/**
 * Extract all contract call sites from Soroban Rust source.
 */
function extractCallSites(source: string): CallNode[] {
  const calls: CallNode[] = [];
  const lines = source.split('\n');

  // Track current function context
  let currentFn = '<unknown>';
  const fnPattern = /fn\s+([a-zA-Z0-9_]+)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fnMatch = line.match(fnPattern);
    if (fnMatch) currentFn = fnMatch[1];

    for (const pattern of CROSS_CONTRACT_PATTERNS) {
      if (pattern.test(line)) {
        // Extract callee name and args
        const calleeMatch = line.match(/([A-Za-z0-9_:]+)\s*\(([^)]*)/);
        const callee = calleeMatch ? calleeMatch[1] : 'unknown';
        const args = calleeMatch ? calleeMatch[2].trim() : '';
        calls.push({ caller: currentFn, callee, line: i + 1, args });
      }
    }
  }

  return calls;
}

/**
 * Detect deep call chains by counting cross-contract hops per function.
 */
function detectDeepCallChains(calls: CallNode[]): CallGraphFinding[] {
  const findings: CallGraphFinding[] = [];
  const callsPerFn = new Map<string, CallNode[]>();

  for (const call of calls) {
    const existing = callsPerFn.get(call.caller) ?? [];
    existing.push(call);
    callsPerFn.set(call.caller, existing);
  }

  for (const [fn, fnCalls] of callsPerFn.entries()) {
    if (fnCalls.length >= DEPTH_THRESHOLD) {
      findings.push({
        rule: 'soroban-nested-calls',
        line: fnCalls[0].line,
        message: `Function '${fn}' makes ${fnCalls.length} cross-contract calls, forming a deep call chain.`,
        suggestion:
          'Reduce cross-contract call depth by batching operations or restructuring contract responsibilities.',
        severity: 'high',
      });
    }
  }

  return findings;
}

/**
 * Detect cross-contract calls (any use of invoke_contract / Client::new).
 */
function detectCrossContractCalls(calls: CallNode[]): CallGraphFinding[] {
  return calls.map((call) => ({
    rule: 'soroban-cross-contract-call',
    line: call.line,
    message: `Cross-contract call to '${call.callee}' in function '${call.caller}'. Each call adds execution overhead.`,
    suggestion:
      'Cache results locally when the same contract is called repeatedly with unchanged inputs.',
    severity: 'medium' as const,
  }));
}

/**
 * Detect redundant calls — identical callee + args called more than once.
 */
function detectRedundantCalls(calls: CallNode[]): CallGraphFinding[] {
  const findings: CallGraphFinding[] = [];
  const seen = new Map<string, CallNode>();

  for (const call of calls) {
    const key = `${call.caller}::${call.callee}(${call.args})`;
    if (seen.has(key)) {
      const first = seen.get(key)!;
      findings.push({
        rule: 'soroban-redundant-call',
        line: call.line,
        message: `Redundant call to '${call.callee}(${call.args})' in '${call.caller}' — identical call already made at line ${first.line}.`,
        suggestion: `Cache the result of '${call.callee}' in a local variable and reuse it instead of calling again.`,
        severity: 'medium',
      });
    } else {
      seen.set(key, call);
    }
  }

  return findings;
}

export interface CallGraphAnalysisResult {
  calls: CallNode[];
  findings: CallGraphFinding[];
}

/**
 * Analyze Soroban contract source for call graph issues.
 *
 * Covers:
 *  - #771 Nested expensive calls (depth >= DEPTH_THRESHOLD)
 *  - #772 Cross-contract call tracking
 *  - #773 Redundant identical calls
 */
export function analyzeCallGraph(source: string): CallGraphAnalysisResult {
  const calls = extractCallSites(source);

  const findings: CallGraphFinding[] = [
    ...detectDeepCallChains(calls),
    ...detectCrossContractCalls(calls),
    ...detectRedundantCalls(calls),
  ];

  return { calls, findings };
}
