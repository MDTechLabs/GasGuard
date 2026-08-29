/**
 * Analyzer: Soroban Recursive Call Analyzer (#878)
 *
 * Detects direct and indirect recursive contract call paths (cycles in call graph),
 * builds call dependency chains, and reports recursion severity.
 */

export interface CallGraphEdge {
  caller: string;
  callee: string;
  line: number;
}

export interface RecursiveCallFinding {
  line: number;
  caller: string;
  callee: string;
  cyclePath: string[];
  isDirect: boolean;
  message: string;
  suggestion: string;
  severity: 'high' | 'medium';
}

export class RecursiveCallAnalyzer {
  public analyze(sourceCode: string): RecursiveCallFinding[] {
    const findings: RecursiveCallFinding[] = [];
    const edges = this.extractCallEdges(sourceCode);
    const graph = new Map<string, Array<{ callee: string; line: number }>>();

    for (const edge of edges) {
      const list = graph.get(edge.caller) ?? [];
      list.push({ callee: edge.callee, line: edge.line });
      graph.set(edge.caller, list);
    }

    const visited = new Set<string>();
    const recStack: string[] = [];

    const dfs = (curr: string, currentLine: number) => {
      visited.add(curr);
      recStack.push(curr);

      const neighbors = graph.get(curr) ?? [];
      for (const edge of neighbors) {
        const { callee, line } = edge;
        const stackIndex = recStack.indexOf(callee);

        if (stackIndex !== -1) {
          // Cycle detected!
          const cyclePath = [...recStack.slice(stackIndex), callee];
          const isDirect = curr === callee;

          findings.push({
            line,
            caller: curr,
            callee,
            cyclePath,
            isDirect,
            message: isDirect
              ? `Direct recursion detected in function '${curr}'. Function calls itself at line ${line}.`
              : `Indirect recursive call cycle detected: ${cyclePath.join(' -> ')} at line ${line}.`,
            suggestion: isDirect
              ? `Refactor '${curr}' to use iteration instead of self-recursion to prevent stack overflow and unpredictable gas usage.`
              : `Break the cyclic contract invocation dependency (${cyclePath.join(' -> ')}) using an iterative state machine or asynchronous pattern.`,
            severity: isDirect ? 'high' : 'medium',
          });
        } else if (!visited.has(callee)) {
          dfs(callee, line);
        }
      }

      recStack.pop();
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node, 1);
      }
    }

    return findings;
  }

  private extractCallEdges(source: string): CallGraphEdge[] {
    const edges: CallGraphEdge[] = [];
    const lines = source.split('\n');
    let currentFn = '<unknown>';

    const fnPattern = /fn\s+([a-zA-Z0-9_]+)\s*\(/;
    const callPattern = /(?:self\.|env\.|Client::|ContractClient::)?([a-zA-Z0-9_]+)\s*\(/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fnMatch = line.match(fnPattern);
      if (fnMatch) {
        currentFn = fnMatch[1];
      }

      if (currentFn === '<unknown>') continue;

      let match: RegExpExecArray | null;
      while ((match = callPattern.exec(line)) !== null) {
        const callee = match[1];

        // Skip if this match is the function declaration itself (e.g. `fn helper(`)
        const isDeclaration = fnMatch && fnMatch[1] === callee && line.indexOf(`fn ${callee}`) !== -1;
        if (isDeclaration) continue;

        // Ignore keywords and builtins
        if (
          [
            'if',
            'for',
            'while',
            'match',
            'let',
            'fn',
            'require_auth',
            'require_auth_for_args',
            'env',
            'symbol_short',
            'vec',
            'map',
            'pub',
          ].includes(callee)
        ) {
          continue;
        }

        // Add edge if callee matches a function pattern in source or self call
        if (callee === currentFn || (source.includes(`fn ${callee}`) && callee !== currentFn)) {
          edges.push({
            caller: currentFn,
            callee,
            line: i + 1,
          });
        }
      }
    }

    return edges;
  }
}

export function analyzeRecursiveCalls(sourceCode: string): RecursiveCallFinding[] {
  const analyzer = new RecursiveCallAnalyzer();
  return analyzer.analyze(sourceCode);
}
