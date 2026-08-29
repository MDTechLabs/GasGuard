import {
  maskNonCode,
  createLineResolver,
  extractFunctions,
  FunctionBlock,
} from '../../common/source-utils';

export interface ResourceCost {
  cpuInstructions: number;
  memoryBytes: number;
  storageReadBytes: number;
  storageWriteBytes: number;
}

export interface CallInvocation {
  caller: string;
  callee: string;
  isExternal: boolean;
  line: number;
  offset: number;
  estimatedCost: ResourceCost;
}

export interface CallChainPath {
  entryFunction: string;
  path: string[];
  depth: number;
  hasExternalHops: boolean;
  totalCost: ResourceCost;
  dominantBottleneck: string;
  isExpensive: boolean;
}

export interface CallChainFinding {
  ruleId: 'soroban-expensive-call-chain' | 'soroban-deep-call-chain' | 'soroban-external-chain-bottleneck';
  severity: 'critical' | 'high' | 'medium' | 'low';
  entryFunction: string;
  line: number;
  message: string;
  suggestion: string;
  chainPath: string[];
  totalCpu: number;
}

export interface CallChainResourceReport {
  chains: CallChainPath[];
  dominantChain: CallChainPath | null;
  findings: CallChainFinding[];
  maxChainDepth: number;
  totalAggregatedCpu: number;
  summary: string;
}

const EXTERNAL_CALL_PATTERNS = [
  /env\.invoke_contract\s*\(/,
  /Client::new\s*\(/,
  /ContractClient\s*::\s*new\s*\(/,
  /invoke_contract_check_auth\s*\(/,
  /token::Client/,
];

const BASE_INTERNAL_CALL_COST: ResourceCost = {
  cpuInstructions: 5_000,
  memoryBytes: 150,
  storageReadBytes: 0,
  storageWriteBytes: 0,
};

const BASE_EXTERNAL_CALL_COST: ResourceCost = {
  cpuInstructions: 120_000,
  memoryBytes: 1_200,
  storageReadBytes: 600,
  storageWriteBytes: 400,
};

const EXPENSIVE_CHAIN_CPU_THRESHOLD = 150_000;
const DEEP_CHAIN_DEPTH_THRESHOLD = 3;

/**
 * Extract all direct function calls and external contract invocations from function bodies.
 */
export function extractFunctionInvocations(
  source: string,
  functions: FunctionBlock[],
): CallInvocation[] {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const invocations: CallInvocation[] = [];
  const knownFnNames = new Set(functions.map((f) => f.name));

  for (const fn of functions) {
    const body = masked.slice(fn.bodyStart, fn.bodyEnd);
    const originalBody = source.slice(fn.bodyStart, fn.bodyEnd);

    // 1. Check for external invocations inside the body
    for (const pattern of EXTERNAL_CALL_PATTERNS) {
      const re = new RegExp(pattern.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        const offset = fn.bodyStart + m.index;
        const lineText = originalBody.slice(
          Math.max(0, m.index - 50),
          Math.min(body.length, m.index + 100),
        );
        const calleeMatch = lineText.match(/([A-Za-z0-9_:]+)\s*\(/);
        const callee = calleeMatch ? calleeMatch[1] : 'external_contract_call';

        invocations.push({
          caller: fn.name,
          callee,
          isExternal: true,
          line: lineOf(offset),
          offset,
          estimatedCost: { ...BASE_EXTERNAL_CALL_COST },
        });
      }
    }

    // 2. Check for calls to other internal functions
    for (const targetName of knownFnNames) {
      if (targetName === fn.name) continue; // direct recursion handled separately
      const callRe = new RegExp(`\\b${targetName}\\s*\\(`, 'g');
      let m: RegExpExecArray | null;
      while ((m = callRe.exec(body)) !== null) {
        const offset = fn.bodyStart + m.index;
        invocations.push({
          caller: fn.name,
          callee: targetName,
          isExternal: false,
          line: lineOf(offset),
          offset,
          estimatedCost: { ...BASE_INTERNAL_CALL_COST },
        });
      }
    }
  }

  return invocations.sort((a, b) => a.offset - b.offset);
}

/**
 * Recursively builds call chains starting from entry points (public functions or top-level functions).
 */
export function buildCallChains(
  invocations: CallInvocation[],
  functions: FunctionBlock[],
): CallChainPath[] {
  const callGraph = new Map<string, CallInvocation[]>();

  for (const inv of invocations) {
    const list = callGraph.get(inv.caller) || [];
    list.push(inv);
    callGraph.set(inv.caller, list);
  }

  const chains: CallChainPath[] = [];

  const traverse = (
    currentPath: string[],
    visited: Set<string>,
    accCost: ResourceCost,
    hasExternal: boolean,
  ) => {
    const currentCaller = currentPath[currentPath.length - 1];
    const outgoing = callGraph.get(currentCaller) || [];

    if (outgoing.length === 0 || visited.has(currentCaller)) {
      // Leaf node in call graph: record path
      if (currentPath.length > 1 || hasExternal) {
        const isExpensive = accCost.cpuInstructions >= EXPENSIVE_CHAIN_CPU_THRESHOLD;
        chains.push({
          entryFunction: currentPath[0],
          path: [...currentPath],
          depth: currentPath.length,
          hasExternalHops: hasExternal,
          totalCost: { ...accCost },
          dominantBottleneck: hasExternal ? 'cross_contract_invocation' : currentPath[currentPath.length - 1],
          isExpensive,
        });
      }
      return;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(currentCaller);

    for (const edge of outgoing) {
      if (nextVisited.has(edge.callee)) {
        // Prevent infinite loops on cycles
        continue;
      }

      const nextCost: ResourceCost = {
        cpuInstructions: accCost.cpuInstructions + edge.estimatedCost.cpuInstructions,
        memoryBytes: accCost.memoryBytes + edge.estimatedCost.memoryBytes,
        storageReadBytes: accCost.storageReadBytes + edge.estimatedCost.storageReadBytes,
        storageWriteBytes: accCost.storageWriteBytes + edge.estimatedCost.storageWriteBytes,
      };

      traverse(
        [...currentPath, edge.callee],
        nextVisited,
        nextCost,
        hasExternal || edge.isExternal,
      );
    }
  };

  for (const fn of functions) {
    traverse([fn.name], new Set(), { ...BASE_INTERNAL_CALL_COST }, false);
  }

  return chains.sort((a, b) => b.totalCost.cpuInstructions - a.totalCost.cpuInstructions);
}

/**
 * Generate actionable findings for expensive downstream call paths and deep call chains.
 */
export function generateCallChainFindings(
  chains: CallChainPath[],
  functions: FunctionBlock[],
): CallChainFinding[] {
  const findings: CallChainFinding[] = [];
  const fnLineMap = new Map(functions.map((f) => [f.name, f.line]));

  for (const chain of chains) {
    const line = fnLineMap.get(chain.entryFunction) || 1;

    if (chain.totalCost.cpuInstructions >= EXPENSIVE_CHAIN_CPU_THRESHOLD && chain.hasExternalHops) {
      findings.push({
        ruleId: 'soroban-expensive-call-chain',
        severity: 'high',
        entryFunction: chain.entryFunction,
        line,
        message: `Call chain from '${chain.entryFunction}' (${chain.path.join(' → ')}) incurs high downstream resource cost (~${chain.totalCost.cpuInstructions} CPU instructions).`,
        suggestion:
          'Flatten call hierarchy, batch downstream external contract calls, or cache intermediate results.',
        chainPath: chain.path,
        totalCpu: chain.totalCost.cpuInstructions,
      });
    } else if (chain.depth >= DEEP_CHAIN_DEPTH_THRESHOLD) {
      findings.push({
        ruleId: 'soroban-deep-call-chain',
        severity: 'medium',
        entryFunction: chain.entryFunction,
        line,
        message: `Deep call chain detected starting from '${chain.entryFunction}' with depth ${chain.depth} (${chain.path.join(' → ')}).`,
        suggestion:
          'Refactor deeply nested function calls to reduce stack frame allocation and invocation overhead.',
        chainPath: chain.path,
        totalCpu: chain.totalCost.cpuInstructions,
      });
    }
  }

  return findings;
}

/**
 * Full analysis entry point for call-chain resource aggregation.
 */
export function analyzeCallChainResources(source: string): CallChainResourceReport {
  const masked = maskNonCode(source);
  const functions = extractFunctions(masked, source);
  const invocations = extractFunctionInvocations(source, functions);
  const chains = buildCallChains(invocations, functions);
  const findings = generateCallChainFindings(chains, functions);

  const dominantChain = chains[0] || null;
  const maxChainDepth = chains.reduce((max, c) => Math.max(max, c.depth), 0);
  const totalAggregatedCpu = chains.reduce((sum, c) => sum + c.totalCost.cpuInstructions, 0);

  const summary = dominantChain
    ? `Analyzed ${chains.length} call chain(s). Dominant path: '${dominantChain.path.join(' → ')}' with estimated ${dominantChain.totalCost.cpuInstructions} CPU instructions.`
    : 'No complex call chains detected.';

  return {
    chains,
    dominantChain,
    findings,
    maxChainDepth,
    totalAggregatedCpu,
    summary,
  };
}
