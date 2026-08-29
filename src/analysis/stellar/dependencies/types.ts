export interface DependencyNode {
  name: string;
  version: string;
  source: string;
  isDirect: boolean;
  dependencies: string[];
  usedSymbols: string[];
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: 'import' | 'use' | 'fn_call' | 'type_ref';
}

export interface DependencyScanResult {
  contractName: string;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  directCount: number;
  transitiveCount: number;
  unusedDependencies: string[];
  circularDependencies: string[][];
  summary: string;
}

export interface ScanConfig {
  maxDepth: number;
  includeTransitive: boolean;
  detectCircular: boolean;
}
