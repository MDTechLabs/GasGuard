import { CallGraph, CallGraphEdge, CallGraphNode, CallGraphReport, CallGraphConfig } from './types';

export class StellarCallGraphGenerator {
  private source: string;
  private filePath: string;
  private config: CallGraphConfig;

  constructor(
    source: string,
    filePath: string,
    config: CallGraphConfig = { includeExternalCalls: false, maxDepth: 10, detectCycles: true },
  ) {
    this.source = source;
    this.filePath = filePath;
    this.config = config;
  }

  generate(): CallGraphReport {
    const contractName = this.extractContractName();
    const nodes = this.extractNodes();
    const edges = this.extractEdges(nodes);
    const entryPoints = this.findEntryPoints(nodes, edges);
    const maxCallDepth = this.calculateMaxDepth(nodes, edges, entryPoints);
    const orphanFunctions = this.findOrphanFunctions(nodes, edges);

    const graph: CallGraph = { nodes, edges, entryPoints };

    return {
      contractName,
      totalFunctions: nodes.filter(n => n.kind === 'function').length,
      totalEdges: edges.length,
      maxCallDepth,
      entryPoints,
      orphanFunctions,
      graph,
      summary: this.generateSummary(contractName, nodes, edges, entryPoints),
    };
  }

  private extractContractName(): string {
    const match = this.source.match(/pub struct (\w+)/)
      || this.source.match(/contract\s+(\w+)/)
      || this.source.match(/#\[contract\]\s*\n\s*pub (?:struct|fn) (\w+)/);
    return match ? match[1] : 'UnknownContract';
  }

  private extractNodes(): CallGraphNode[] {
    const nodes: CallGraphNode[] = [];
    const fnRegex = /(?:pub\s+)?fn\s+(\w+)/g;
    let match;

    while ((match = fnRegex.exec(this.source)) !== null) {
      nodes.push({
        id: match[1],
        label: match[1],
        kind: 'function',
        filePath: this.filePath,
        line: this.getLineNumber(match.index),
      });
    }

    const contractMatch = this.source.match(/#\[contract\]\s*\n\s*pub\s+(?:struct|fn)\s+(\w+)/);
    if (contractMatch) {
      nodes.push({
        id: contractMatch[1],
        label: contractMatch[1],
        kind: 'contract',
        filePath: this.filePath,
        line: this.getLineNumber(contractMatch.index),
      });
    }

    const traitRegex = /trait\s+(\w+)/g;
    while ((match = traitRegex.exec(this.source)) !== null) {
      nodes.push({
        id: match[1],
        label: match[1],
        kind: 'trait',
        filePath: this.filePath,
        line: this.getLineNumber(match.index),
      });
    }

    return nodes;
  }

  private extractEdges(nodes: CallGraphNode[]): CallGraphEdge[] {
    const edges: CallGraphEdge[] = [];
    const fnNames = nodes.filter(n => n.kind === 'function').map(n => n.id);

    for (const fn of fnNames) {
      const fnBody = this.extractFunctionBody(fn);
      if (!fnBody) continue;

      for (const callee of fnNames) {
        if (callee === fn) continue;
        const callRegex = new RegExp(`\\b${callee}\\s*\\(`);
        if (callRegex.test(fnBody)) {
          const line = this.getLineNumber(this.source.indexOf(callee));
          edges.push({ source: fn, target: callee, kind: 'calls', line });
        }
      }
    }

    const implRegex = /impl\s+(?:<\w+>\s+)?(\w+)\s+for\s+(\w+)/g;
    let implMatch;
    while ((implMatch = implRegex.exec(this.source)) !== null) {
      const traitNode = nodes.find(n => n.id === implMatch[1]);
      const contractNode = nodes.find(n => n.id === implMatch[2]);
      if (traitNode && contractNode) {
        edges.push({
          source: contractNode.id,
          target: traitNode.id,
          kind: 'implements',
          line: this.getLineNumber(implMatch.index),
        });
      }
    }

    return edges;
  }

  private extractFunctionBody(fnName: string): string | null {
    const regex = new RegExp(`fn\\s+${fnName}\\s*\\([^)]*\\)\\s*(?:->\\s*[^{]+)?\\s*\\{`);
    const match = regex.exec(this.source);
    if (!match) return null;

    const start = match.index + match[0].length;
    let braceCount = 1;
    let body = '';
    for (let i = start; i < this.source.length && braceCount > 0; i++) {
      if (this.source[i] === '{') braceCount++;
      if (this.source[i] === '}') braceCount--;
      if (braceCount > 0) body += this.source[i];
    }
    return body;
  }

  private findEntryPoints(nodes: CallGraphNode[], edges: CallGraphEdge[]): string[] {
    const called = new Set(edges.map(e => e.target));
    return nodes
      .filter(n => n.kind === 'function' && !called.has(n.id))
      .map(n => n.id);
  }

  private calculateMaxDepth(nodes: CallGraphNode[], edges: CallGraphEdge[], entryPoints: string[]): number {
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
      adjacency.get(edge.source)!.push(edge.target);
    }

    let maxDepth = 0;
    const visited = new Set<string>();

    const dfs = (node: string, depth: number) => {
      if (visited.has(node) && this.config.detectCycles) return;
      visited.add(node);
      maxDepth = Math.max(maxDepth, depth);
      if (depth >= this.config.maxDepth) return;
      for (const neighbor of adjacency.get(node) || []) {
        dfs(neighbor, depth + 1);
      }
    };

    for (const entry of entryPoints) {
      visited.clear();
      dfs(entry, 0);
    }

    return maxDepth;
  }

  private findOrphanFunctions(nodes: CallGraphNode[], edges: CallGraphEdge[]): string[] {
    const connected = new Set<string>();
    for (const edge of edges) {
      connected.add(edge.source);
      connected.add(edge.target);
    }
    return nodes.filter(n => n.kind === 'function' && !connected.has(n.id)).map(n => n.id);
  }

  private getLineNumber(offset: number): number {
    return (this.source.substring(0, offset).match(/\n/g) || []).length + 1;
  }

  private generateSummary(contractName: string, nodes: CallGraphNode[], edges: CallGraphEdge[], entryPoints: string[]): string {
    const fnCount = nodes.filter(n => n.kind === 'function').length;
    return `Contract "${contractName}" has ${fnCount} functions with ${edges.length} call edges. ` +
      `${entryPoints.length} entry point(s) identified.`;
  }
}
