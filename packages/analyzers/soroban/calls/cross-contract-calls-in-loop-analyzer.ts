import {
  maskNonCode,
  createLineResolver,
  extractFunctions,
  receiverBefore,
  resolveTokenBindings,
  resolveTokenFromReceiver,
  blockStackAt,
  isInLoop,
} from '../common/source-utils';

export type LoopBoundType = 'bounded_range' | 'collection_iterator' | 'unbounded' | 'dynamic_condition';

export interface LoopContext {
  loopType: 'for' | 'while' | 'loop';
  boundType: LoopBoundType;
  boundExpression: string;
  line: number;
}

export interface CrossContractCallInLoopSite {
  fn: string;
  targetContract: string;
  method: string;
  line: number;
  offset: number;
  loopContext: LoopContext;
  severity: 'critical' | 'high' | 'medium';
  estimatedCostMultiplier: number;
  message: string;
  suggestion: string;
}

export interface CrossContractCallsInLoopReport {
  callsInLoops: CrossContractCallInLoopSite[];
  totalCallsInLoops: number;
  affectedFunctions: string[];
  recommendations: string[];
}

const CROSS_CONTRACT_CALL_PATTERNS = [
  /env\.invoke_contract\s*\(/,
  /Client::new\s*\(/,
  /ContractClient\s*::\s*new\s*\(/,
  /invoke_contract_check_auth\s*\(/,
  /\.\s*(transfer|transfer_from|balance|approve|mint|burn|clawback|allowance)\s*\(/,
];

/**
 * Classifies loop bounds and expressions from the source preceding a block.
 */
export function classifyLoopHeader(precedingSource: string): LoopContext {
  const forMatch = precedingSource.match(/for\s+([A-Za-z0-9_(),\s]+)\s+in\s+([^{]+)/);
  if (forMatch) {
    const expr = forMatch[2].trim();
    const isRange = /\d+\s*\.\.\s*=?\s*\d+/.test(expr);
    return {
      loopType: 'for',
      boundType: isRange ? 'bounded_range' : 'collection_iterator',
      boundExpression: expr,
      line: 0,
    };
  }

  const whileMatch = precedingSource.match(/while\s+([^{]+)/);
  if (whileMatch) {
    const expr = whileMatch[1].trim();
    const isTrue = expr === 'true';
    return {
      loopType: 'while',
      boundType: isTrue ? 'unbounded' : 'dynamic_condition',
      boundExpression: expr,
      line: 0,
    };
  }

  return {
    loopType: 'loop',
    boundType: 'unbounded',
    boundExpression: 'unbounded loop',
    line: 0,
  };
}

/**
 * Detect cross-contract calls inside loop bodies and extract detailed loop context.
 */
export function detectCrossContractCallsInLoops(source: string): CrossContractCallInLoopSite[] {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const bindings = resolveTokenBindings(masked, source);
  const functions = extractFunctions(masked, source);
  const callSites: CrossContractCallInLoopSite[] = [];

  for (const fn of functions) {
    for (const pattern of CROSS_CONTRACT_CALL_PATTERNS) {
      const re = new RegExp(pattern.source, 'g');
      const body = masked.slice(fn.bodyStart, fn.bodyEnd);
      let m: RegExpExecArray | null;

      while ((m = re.exec(body)) !== null) {
        const offset = fn.bodyStart + m.index;
        const stack = blockStackAt(masked, fn.bodyStart, offset);

        if (!isInLoop(stack)) {
          continue;
        }

        // Find the nearest loop frame
        const loopFrame = stack.slice().reverse().find((f) => f.kind === 'loop');
        const loopHeaderSnippet = loopFrame
          ? source.slice(Math.max(fn.bodyStart, loopFrame.start - 80), loopFrame.start)
          : '';

        const loopContext = classifyLoopHeader(loopHeaderSnippet);
        loopContext.line = loopFrame ? lineOf(loopFrame.start) : lineOf(offset);

        // Resolve method & target contract
        const receiver = receiverBefore(source, offset);
        const targetContract = resolveTokenFromReceiver(receiver, bindings) || 'external_contract';
        const lineText = source.slice(offset, Math.min(source.length, offset + 120));
        const methodMatch = lineText.match(/(?:invoke_contract\s*\([^,]+,\s*&?Symbol::new\([^,]+,\s*"([^"]+)"|\.([A-Za-z0-9_]+)\s*\()/);
        const method = methodMatch ? (methodMatch[1] || methodMatch[2]) : 'call';

        const severity = loopContext.boundType === 'unbounded'
          ? 'critical'
          : loopContext.boundType === 'collection_iterator'
            ? 'high'
            : 'medium';

        const costMultiplier = loopContext.boundType === 'bounded_range' ? 5 : 20;

        callSites.push({
          fn: fn.name,
          targetContract,
          method,
          line: lineOf(offset),
          offset,
          loopContext,
          severity,
          estimatedCostMultiplier: costMultiplier,
          message: `Cross-contract call to '${targetContract}.${method}()' inside a '${loopContext.loopType}' loop (${loopContext.boundType}) in function '${fn.name}'.`,
          suggestion:
            `Repeated cross-contract invocations inside loops multiply auth, VM dispatch, and storage costs by ~${costMultiplier}x. ` +
            `Batch external calls into a single multicall invocation or hoist loop-invariant queries outside the loop.`,
        });
      }
    }
  }

  // Deduplicate call sites by line & method
  const seen = new Set<string>();
  const uniqueSites: CrossContractCallInLoopSite[] = [];
  for (const site of callSites.sort((a, b) => a.line - b.line)) {
    const key = `${site.line}|${site.method}|${site.targetContract}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueSites.push(site);
    }
  }

  return uniqueSites;
}

/**
 * Full analysis entry point.
 */
export function analyzeCrossContractCallsInLoops(source: string): CrossContractCallsInLoopReport {
  const callsInLoops = detectCrossContractCallsInLoops(source);
  const affectedFunctions = Array.from(new Set(callsInLoops.map((c) => c.fn)));

  const recommendations: string[] = [];
  if (callsInLoops.length > 0) {
    recommendations.push(
      `Found ${callsInLoops.length} cross-contract call(s) executed inside loops across ${affectedFunctions.length} function(s).`,
    );
    recommendations.push(
      'Use batch settlement or multicall interfaces on target contracts to process multiple operations in a single invocation.',
    );
  }

  return {
    callsInLoops,
    totalCallsInLoops: callsInLoops.length,
    affectedFunctions,
    recommendations,
  };
}
