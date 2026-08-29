import * as path from 'path';

export interface ContractNode {
  name: string;
  filePath: string;
  lineCount: number;
  functions: string[];
}

export interface DependencyEdge {
  source: string;
  target: string;
  type: 'client' | 'invoke' | 'import' | 'generic';
  lineNumber: number;
  snippet: string;
}

export interface GraphStructure {
  nodes: ContractNode[];
  edges: DependencyEdge[];
}

export class SorobanDependencyAnalyzer {
  private nodes: Map<string, ContractNode> = new Map();
  private edges: DependencyEdge[] = [];

  /**
   * Parse files and build the dependency graph.
   * @param files Array of file objects with path and raw Rust source content.
   */
  analyze(files: { filePath: string; source: string }[]): GraphStructure {
    this.nodes.clear();
    this.edges = [];

    // 1. Identify all defined contracts first
    const contractFileMap = new Map<string, { source: string; filePath: string }>();
    
    for (const file of files) {
      const contractNames = this.extractContractNames(file.source, file.filePath);
      const lines = file.source.split('\n');
      const functions = this.extractFunctions(file.source);

      for (const name of contractNames) {
        this.nodes.set(name, {
          name,
          filePath: file.filePath,
          lineCount: lines.length,
          functions,
        });
        contractFileMap.set(name, file);
      }
    }

    // 2. Scan each contract for interactions with other contracts
    for (const [name, node] of this.nodes.entries()) {
      const file = contractFileMap.get(name);
      if (!file) continue;

      const detectedEdges = this.detectInteractions(name, file.source);
      this.edges.push(...detectedEdges);
    }

    return this.getGraph();
  }

  /**
   * Get the generated nodes and edges.
   */
  getGraph(): GraphStructure {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: [...this.edges],
    };
  }

  /**
   * Extract contract names defined in a Rust file.
   * Looks for #[contract] macros, struct definitions, or contract impl blocks.
   */
  private extractContractNames(source: string, filePath: string): string[] {
    const names = new Set<string>();
    const lines = source.split('\n');

    // Pattern 1: #[contract(name = "...")] or #[contract]
    const contractAttrRegex = /#\s*\[\s*contract\s*(?:\(\s*name\s*=\s*"([^"]+)"\s*\))?\s*\]/g;
    let match;
    while ((match = contractAttrRegex.exec(source)) !== null) {
      if (match[1]) {
        names.add(match[1]);
      }
    }

    // Pattern 2: struct declarations (usually matches contract struct)
    const structRegex = /(?:pub\s+)?struct\s+(\w+)/g;
    while ((match = structRegex.exec(source)) !== null) {
      const structName = match[1];
      // Skip common generic rust structs that aren't contracts
      if (structName !== 'Env' && structName !== 'String' && structName !== 'Vec' && structName !== 'Map') {
        names.add(structName);
      }
    }

    // Fallback: If no contracts found, use file name
    if (names.size === 0) {
      const basename = path.basename(filePath, '.rs');
      const camelCaseName = basename
        .split(/[-_]/)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
      names.add(camelCaseName);
    }

    return Array.from(names);
  }

  /**
   * Extract public contract functions.
   */
  private extractFunctions(source: string): string[] {
    const functions: string[] = [];
    const fnRegex = /pub\s+fn\s+(\w+)\s*\(/g;
    let match;
    while ((match = fnRegex.exec(source)) !== null) {
      if (match[1] !== 'new') {
        functions.push(match[1]);
      }
    }
    return functions;
  }

  /**
   * Detect interactions within a contract's source code.
   */
  private detectInteractions(sourceContractName: string, source: string): DependencyEdge[] {
    const detected: DependencyEdge[] = [];
    const lines = source.split('\n');

    // Get list of all defined contract names (except current one)
    const otherContractNames = Array.from(this.nodes.keys()).filter(n => n !== sourceContractName);

    lines.forEach((line, idx) => {
      const lineNumber = idx + 1;
      const cleanLine = line.trim();

      // Skip comments
      if (cleanLine.startsWith('//') || cleanLine.startsWith('/*')) {
        return;
      }

      // Check 1: Client call usage: e.g. TokenClient::new(&env, &id) or TokenClient::some_method
      for (const targetName of otherContractNames) {
        // e.g. "TokenClient::" or "TokenClient " or "TokenClient<"
        const clientRegex = new RegExp(`\\b${targetName}Client\\b`);
        if (clientRegex.test(line)) {
          detected.push({
            source: sourceContractName,
            target: targetName,
            type: 'client',
            lineNumber,
            snippet: cleanLine,
          });
          continue; // Move to next line to avoid double detection on the same line
        }
      }

      // Check 2: contractimport! macro usage
      // e.g. contractimport!(file = "../token/target/wasm32-unknown-unknown/release/token.wasm");
      if (line.includes('contractimport!')) {
        // Try to match imported contract name based on path or file suffix
        for (const targetName of otherContractNames) {
          const lowerTarget = targetName.toLowerCase();
          if (line.toLowerCase().includes(lowerTarget)) {
            detected.push({
              source: sourceContractName,
              target: targetName,
              type: 'import',
              lineNumber,
              snippet: cleanLine,
            });
            continue;
          }
        }
      }

      // Check 3: env.invoke_contract call usage
      // e.g. env.invoke_contract::<Type>(&contract_id, &symbol!("transfer"), ...)
      if (line.includes('invoke_contract')) {
        // Try to infer target contract based on variable name or context
        for (const targetName of otherContractNames) {
          const lowerTarget = targetName.toLowerCase();
          if (line.toLowerCase().includes(lowerTarget)) {
            detected.push({
              source: sourceContractName,
              target: targetName,
              type: 'invoke',
              lineNumber,
              snippet: cleanLine,
            });
            continue;
          }
        }
      }
    });

    // De-duplicate edges on same source->target and type to keep it clean, but keep different types/lines
    const seen = new Set<string>();
    return detected.filter(edge => {
      const key = `${edge.source}->${edge.target}:${edge.type}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Detect circular dependencies in the contract graph.
   * Returns a list of cycles, each cycle represented as an array of contract names.
   */
  detectCycles(): string[][] {
    const adjList = new Map<string, string[]>();
    for (const nodeName of this.nodes.keys()) {
      adjList.set(nodeName, []);
    }
    for (const edge of this.edges) {
      adjList.get(edge.source)?.push(edge.target);
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
          // Found cycle
          const startIndex = path.indexOf(neighbor);
          const cycle = path.slice(startIndex);
          cycle.push(neighbor); // Complete the path representation (e.g. A -> B -> A)
          cycles.push(cycle);
        }
      }

      path.pop();
      recStack.delete(node);
    };

    for (const node of this.nodes.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }

  /**
   * Perform topological sorting of contracts.
   * Returns order in which contracts can be compiled/deployed.
   */
  getTopologicalOrder(): string[] {
    const adjList = new Map<string, string[]>();
    for (const nodeName of this.nodes.keys()) {
      adjList.set(nodeName, []);
    }
    for (const edge of this.edges) {
      adjList.get(edge.source)?.push(edge.target);
    }

    // If cycle is detected, topological sort is not strictly possible, but we'll return a best effort
    const visited = new Set<string>();
    const temp = new Set<string>();
    const order: string[] = [];

    const visit = (node: string) => {
      if (visited.has(node)) return;
      if (temp.has(node)) return; // Cycle! Backtrack/skip

      temp.add(node);

      const neighbors = adjList.get(node) || [];
      for (const neighbor of neighbors) {
        visit(neighbor);
      }

      temp.delete(node);
      visited.add(node);
      order.push(node);
    };

    for (const node of this.nodes.keys()) {
      if (!visited.has(node)) {
        visit(node);
      }
    }

    return order; // Order represents deployment dependency order (leaf dependencies first)
  }

  /**
   * Generate Mermaid diagram syntax representing the dependency graph.
   */
  generateMermaid(): string {
    const lines: string[] = ['graph TD'];

    // Add nodes with formatting
    for (const [name, node] of this.nodes.entries()) {
      const label = `${name}["${name} (${node.lineCount} lines)"]`;
      lines.push(`  ${name}${label}`);
    }

    // Add edges
    for (const edge of this.edges) {
      const typeLabel = edge.type !== 'generic' ? ` -- ${edge.type} --> ` : ' --> ';
      lines.push(`  ${edge.source}${typeLabel}${edge.target}`);
    }

    return lines.join('\n');
  }

  /**
   * Generate JSON string representation of the graph.
   */
  generateJSON(): string {
    return JSON.stringify(this.getGraph(), null, 2);
  }
}
