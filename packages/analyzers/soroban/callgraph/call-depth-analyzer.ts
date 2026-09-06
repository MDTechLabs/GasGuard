/**
 * Analyzer: Soroban Call Depth Analyzer (#879)
 *
 * Calculates contract call depth and detects when invocation depth exceeds configured threshold limits.
 */

export interface CallDepthFinding {
  line: number;
  functionName: string;
  depth: number;
  maxThreshold: number;
  callChain: string[];
  message: string;
  suggestion: string;
  severity: 'high' | 'medium';
}

export class CallDepthAnalyzer {
  private defaultMaxDepth: number;

  constructor(maxDepth: number = 3) {
    this.defaultMaxDepth = maxDepth;
  }

  public analyze(sourceCode: string, options?: { maxDepth?: number }): CallDepthFinding[] {
    const findings: CallDepthFinding[] = [];
    const threshold = options?.maxDepth ?? this.defaultMaxDepth;
    const functions = this.extractFunctions(sourceCode);
    const callGraph = this.buildCallGraph(functions);

    for (const fn of functions) {
      const { maxDepth, longestPath } = this.calculateMaxDepth(fn.name, callGraph);

      if (maxDepth > threshold) {
        findings.push({
          line: fn.startLine,
          functionName: fn.name,
          depth: maxDepth,
          maxThreshold: threshold,
          callChain: longestPath,
          message: `Function '${fn.name}' invocation chain depth is ${maxDepth}, exceeding configured threshold limit of ${threshold}. Chain: ${longestPath.join(' -> ')}.`,
          suggestion: `Flatten call chain architecture for '${fn.name}' or batch cross-contract calls to reduce depth below ${threshold} hops.`,
          severity: maxDepth > threshold + 2 ? 'high' : 'medium',
        });
      }
    }

    return findings;
  }

  private extractFunctions(source: string): Array<{ name: string; body: string; startLine: number }> {
    const blocks: Array<{ name: string; body: string; startLine: number }> = [];
    const fnHeaderRe = /\bfn\s+([a-zA-Z0-9_]+)\s*\([^)]*\)[^{]*\{/g;
    let match: RegExpExecArray | null;

    while ((match = fnHeaderRe.exec(source)) !== null) {
      const openPos = match.index + match[0].length - 1;
      const body = this.extractBraceBlock(source, openPos);
      if (!body) continue;

      const startLine = source.slice(0, match.index).split('\n').length;
      blocks.push({ name: match[1], body, startLine });
    }

    return blocks;
  }

  private buildCallGraph(functions: Array<{ name: string; body: string; startLine: number }>): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    const knownFnNames = new Set(functions.map((f) => f.name));

    for (const fn of functions) {
      const callees: string[] = [];
      const callPattern = /(?:invoke_contract|Client::new|ContractClient::new|\b([a-zA-Z0-9_]+)\s*\()/g;
      let match: RegExpExecArray | null;

      while ((match = callPattern.exec(fn.body)) !== null) {
        const callee = match[1] || match[0];
        if (knownFnNames.has(callee) && callee !== fn.name) {
          callees.push(callee);
        }
      }

      graph.set(fn.name, callees);
    }

    return graph;
  }

  private calculateMaxDepth(
    root: string,
    graph: Map<string, string[]>,
    visited: Set<string> = new Set()
  ): { maxDepth: number; longestPath: string[] } {
    visited.add(root);
    const callees = graph.get(root) ?? [];

    if (callees.length === 0) {
      return { maxDepth: 1, longestPath: [root] };
    }

    let maxSubDepth = 0;
    let longestSubPath: string[] = [];

    for (const callee of callees) {
      if (!visited.has(callee)) {
        const subResult = this.calculateMaxDepth(callee, graph, new Set(visited));
        if (subResult.maxDepth > maxSubDepth) {
          maxSubDepth = subResult.maxDepth;
          longestSubPath = subResult.longestPath;
        }
      }
    }

    return {
      maxDepth: 1 + maxSubDepth,
      longestPath: [root, ...longestSubPath],
    };
  }

  private extractBraceBlock(source: string, openPos: number): string | null {
    let depth = 0;
    for (let i = openPos; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) return source.slice(openPos, i + 1);
      }
    }
    return null;
  }
}

export function analyzeCallDepth(
  sourceCode: string,
  options?: { maxDepth?: number }
): CallDepthFinding[] {
  const analyzer = new CallDepthAnalyzer(options?.maxDepth);
  return analyzer.analyze(sourceCode, options);
}
