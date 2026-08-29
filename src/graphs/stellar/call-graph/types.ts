export interface CallGraphNode {
  id: string;
  label: string;
  kind: 'function' | 'contract' | 'trait' | 'library';
  filePath: string;
  line: number;
}

export interface CallGraphEdge {
  source: string;
  target: string;
  kind: 'calls' | 'inherits' | 'implements' | 'references';
  line: number;
}

export interface CallGraph {
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
  entryPoints: string[];
}

export interface CallGraphReport {
  contractName: string;
  totalFunctions: number;
  totalEdges: number;
  maxCallDepth: number;
  entryPoints: string[];
  orphanFunctions: string[];
  graph: CallGraph;
  summary: string;
}

export interface CallGraphConfig {
  includeExternalCalls: boolean;
  maxDepth: number;
  detectCycles: boolean;
}
