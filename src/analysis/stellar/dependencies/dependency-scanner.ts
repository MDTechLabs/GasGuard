import { DependencyEdge, DependencyNode, DependencyScanResult, ScanConfig } from './types';

export class StellarDependencyScanner {
  private source: string;
  private filePath: string;
  private config: ScanConfig;

  private stdLibSymbols = new Set([
    'Env', 'Address', 'Bytes', 'BytesN', 'String', 'Symbol', 'Vec', 'Map',
    'I128', 'U128', 'I256', 'U256', 'i128', 'u128', 'i256', 'u256',
    'IntoVal', 'FromVal', 'TryFromVal', 'TryIntoVal',
    'require_auth', 'authorized_invocation',
  ]);

  constructor(
    source: string,
    filePath: string,
    config: ScanConfig = { maxDepth: 3, includeTransitive: true, detectCircular: true },
  ) {
    this.source = source;
    this.filePath = filePath;
    this.config = config;
  }

  scan(): DependencyScanResult {
    const contractName = this.extractContractName();
    const nodes = this.extractDependencies();
    const edges = this.extractEdges(nodes);

    const directCount = nodes.filter(n => n.isDirect).length;
    const transitiveCount = nodes.filter(n => !n.isDirect).length;

    const unusedDependencies = nodes
      .filter(n => n.isDirect && n.usedSymbols.length === 0)
      .map(n => n.name);

    const circularDependencies = this.config.detectCircular
      ? this.detectCircular(nodes, edges)
      : [];

    return {
      contractName,
      nodes,
      edges,
      directCount,
      transitiveCount,
      unusedDependencies,
      circularDependencies,
      summary: this.generateSummary(contractName, nodes.length, directCount, transitiveCount, unusedDependencies.length, circularDependencies.length),
    };
  }

  private extractContractName(): string {
    const match = this.source.match(/pub struct (\w+)/)
      || this.source.match(/#\[contract\]\s*\n.*?pub\s+(?:struct|fn)\s+(\w+)/);
    return match ? match[1] : 'UnknownContract';
  }

  private extractDependencies(): DependencyNode[] {
    const nodes: DependencyNode[] = [];
    const importSet = new Set<string>();

    const useRegex = /use\s+([^;]+);/g;
    let match;
    while ((match = useRegex.exec(this.source)) !== null) {
      const importPath = match[1].trim();
      const parts = importPath.split('::');
      const crateName = parts[0];

      if (this.isSdkImport(crateName) || importSet.has(crateName)) continue;
      importSet.add(crateName);

      const usedSymbols = this.findUsedSymbols(crateName, importPath, parts[parts.length - 1]);

      if (this.isStdCrate(crateName)) {
        nodes.push({
          name: crateName,
          version: '*',
          source: 'stellar-sdk',
          isDirect: false,
          dependencies: [],
          usedSymbols,
        });
      } else {
        nodes.push({
          name: crateName,
          version: '*',
          source: 'external',
          isDirect: true,
          dependencies: [],
          usedSymbols,
        });
      }
    }

    const modDeclRegex = /mod\s+(\w+);|mod\s+(\w+)\s*\{/g;
    while ((match = modDeclRegex.exec(this.source)) !== null) {
      const modName = match[1] || match[2];
      if (!importSet.has(modName)) {
        importSet.add(modName);
        nodes.push({
          name: modName,
          version: 'internal',
          source: 'local',
          isDirect: true,
          dependencies: [],
          usedSymbols: [],
        });
      }
    }

    return nodes;
  }

  private isSdkImport(crateName: string): boolean {
    const sdkCrates = ['soroban_sdk', 'stellar_sdk', 'stella'];
    return sdkCrates.includes(crateName);
  }

  private isStdCrate(crateName: string): boolean {
    const stdCrates = ['soroban_sdk', 'core', 'alloc', 'std', 'stellar_sdk'];
    return stdCrates.includes(crateName);
  }

  private findUsedSymbols(crateName: string, importPath: string, symbol: string): string[] {
    const symbols: string[] = [];

    const sourceWithoutUse = this.source.replace(/use\s+[^;]+;/g, '');

    const symbolRegex = new RegExp(`\\b${symbol}\\b`, 'g');
    if (symbolRegex.test(sourceWithoutUse)) {
      symbols.push(symbol);
    }

    const fnCallRegex = new RegExp(`\\b${crateName}::\\w+`, 'g');
    if (fnCallRegex.test(sourceWithoutUse)) {
      const calls = this.source.match(fnCallRegex) || [];
      symbols.push(...calls.map(c => c.trim()));
    }

    return symbols;
  }

  private extractEdges(nodes: DependencyNode[]): DependencyEdge[] {
    const edges: DependencyEdge[] = [];

    for (const node of nodes) {
      edges.push({
        from: 'contract',
        to: node.name,
        kind: 'import',
      });
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (nodes[i].usedSymbols.some(s => nodes[j].usedSymbols.includes(s))) {
          edges.push({
            from: nodes[i].name,
            to: nodes[j].name,
            kind: 'type_ref',
          });
        }
      }
    }

    return edges;
  }

  private detectCircular(nodes: DependencyNode[], edges: DependencyEdge[]): string[][] {
    const adjList = new Map<string, string[]>();
    for (const node of nodes) {
      adjList.set(node.name, []);
    }
    for (const edge of edges) {
      const neighbors = adjList.get(edge.from) || [];
      neighbors.push(edge.to);
      adjList.set(edge.from, neighbors);
    }

    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string) => {
      visited.add(node);
      recStack.add(node);
      path.push(node);

      const neighbors = adjList.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recStack.has(neighbor)) {
          const cycle = path.slice(path.indexOf(neighbor));
          cycles.push(cycle);
        }
      }

      path.pop();
      recStack.delete(node);
    };

    for (const node of nodes) {
      if (!visited.has(node.name)) {
        dfs(node.name);
      }
    }

    return cycles;
  }

  private generateSummary(
    name: string,
    totalDeps: number,
    direct: number,
    transitive: number,
    unused: number,
    cycles: number,
  ): string {
    let summary = `Contract "${name}": ${totalDeps} dependencies (${direct} direct, ${transitive} transitive).`;
    if (unused > 0) summary += ` ${unused} unused import(s) detected.`;
    if (cycles > 0) summary += ` ${cycles} circular dependenc(ies) found.`;
    return summary;
  }
}
