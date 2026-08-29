import { CallGraph, CallGraphNode, CallGraphEdge } from './call-graph-builder';

export type GasFindingCategory =
  | 'gas-limit'
  | 'deep-call-stack'
  | 'recursion'
  | 'cross-contract-loop';

export type GasFindingSeverity = 'high' | 'medium' | 'low';

export interface GasPathNode {
  nodeId: string;
  contractName: string;
  functionName: string;
  callSiteLine?: number;
  callType?: string;
  baseGas: number;
  cumulativeGas: number;
  depth: number;
}

export interface GasGraphFinding {
  id: string;
  category: GasFindingCategory;
  severity: GasFindingSeverity;
  entryPointId: string;
  message: string;
  suggestion: string;
  callStackPath: string[];
  metrics: Record<string, number | string | boolean>;
}

export interface EntryPointEvaluation {
  entryPointId: string;
  totalCumulativeGas: number;
  maxDepth: number;
  hasRecursiveLoop: boolean;
  callPaths: GasPathNode[][];
  highGasPaths: GasPathNode[][];
}

export interface GasTreeEvaluationResult {
  evaluations: EntryPointEvaluation[];
  findings: GasGraphFinding[];
  highestGasEntryPoint: string;
  highestGasAmount: number;
  maxDepthEncountered: number;
}

export interface GasTreeEvaluatorOptions {
  maxGasThreshold?: number; // default: 500,000 gas
  maxCallDepthLimit?: number; // default: 5 call stack depth
  warnOnRecursiveCalls?: boolean; // default: true
  warnOnCrossContractLoops?: boolean; // default: true
}

export class GasTreeEvaluator {
  private options: Required<GasTreeEvaluatorOptions>;

  constructor(options?: GasTreeEvaluatorOptions) {
    this.options = {
      maxGasThreshold: options?.maxGasThreshold ?? 500000,
      maxCallDepthLimit: options?.maxCallDepthLimit ?? 5,
      warnOnRecursiveCalls: options?.warnOnRecursiveCalls ?? true,
      warnOnCrossContractLoops: options?.warnOnCrossContractLoops ?? true,
    };
  }

  public evaluate(graph: CallGraph): GasTreeEvaluationResult {
    const evaluations: EntryPointEvaluation[] = [];
    const findings: GasGraphFinding[] = [];

    let highestGasAmount = 0;
    let highestGasEntryPoint = '';
    let maxDepthEncountered = 0;

    for (const entryPointId of graph.entryPoints) {
      const entryNode = graph.nodes.get(entryPointId);
      if (!entryNode) continue;

      const visitedPath = new Set<string>();
      const currentCallStack: GasPathNode[] = [];
      const completedPaths: GasPathNode[][] = [];

      let hasRecursiveLoop = false;
      let entryMaxDepth = 0;

      const totalGas = this.traverseCallTree(
        entryPointId,
        0, // current depth
        graph,
        visitedPath,
        currentCallStack,
        completedPaths,
        (loopNodeId, depth, path) => {
          hasRecursiveLoop = true;
          if (this.options.warnOnRecursiveCalls) {
            findings.push({
              id: 'RECURSIVE_CALL_LOOP',
              category: 'recursion',
              severity: 'high',
              entryPointId,
              message: `Recursive call cycle detected in entry point '${entryPointId}': call stack loops back to '${loopNodeId}' at depth ${depth}. Recursive cross-contract/internal calls can cause stack overflow or unconstrained gas exhaustion.`,
              suggestion:
                'Eliminate recursive function invocations. Use iterative algorithms or bounded loops.',
              callStackPath: path.map((n) => n.nodeId),
              metrics: { entryPointId, loopNodeId, depth },
            });
          }
        },
        (edge, depth, path) => {
          if (edge.isInLoop && this.options.warnOnCrossContractLoops) {
            findings.push({
              id: 'EXPENSIVE_CROSS_CONTRACT_LOOP',
              category: 'cross-contract-loop',
              severity: 'high',
              message: `Function '${edge.sourceId}' invokes external function '${edge.targetId}' inside a loop at line ${edge.callSiteLine}. Repeated external call overhead inside loops rapidly depletes transaction gas.`,
              suggestion:
                'Batch external calls into a single bulk transaction or cache results before entering the loop.',
              callStackPath: path.map((n) => n.nodeId),
              metrics: {
                sourceId: edge.sourceId,
                targetId: edge.targetId,
                callSiteLine: edge.callSiteLine,
              },
            });
          }
        }
      );

      for (const path of completedPaths) {
        if (path.length > entryMaxDepth) {
          entryMaxDepth = path.length;
        }
      }

      if (entryMaxDepth > maxDepthEncountered) {
        maxDepthEncountered = entryMaxDepth;
      }

      if (totalGas > highestGasAmount) {
        highestGasAmount = totalGas;
        highestGasEntryPoint = entryPointId;
      }

      // Check threshold limits for cumulative gas & max depth
      if (totalGas > this.options.maxGasThreshold) {
        const primaryPath = completedPaths[0] || [];
        findings.push({
          id: 'HIGH_CUMULATIVE_GAS_EXCEEDED',
          category: 'gas-limit',
          severity: 'high',
          message: `Cumulative execution gas cost for entry point '${entryPointId}' is ${totalGas.toLocaleString()} gas, exceeding maximum safety limit of ${this.options.maxGasThreshold.toLocaleString()} gas.`,
          suggestion:
            'Optimize state accesses (SSTORE/SLOAD), reduce deep external calls, or split execution across multiple transactions.',
          callStackPath: primaryPath.map((n) => n.nodeId),
          metrics: {
            entryPointId,
            totalGas,
            maxGasThreshold: this.options.maxGasThreshold,
          },
        });
      }

      if (entryMaxDepth > this.options.maxCallDepthLimit) {
        const deepPath = completedPaths.find((p) => p.length > this.options.maxCallDepthLimit) || [];
        findings.push({
          id: 'DEEP_CALL_STACK_EXCEEDED',
          category: 'deep-call-stack',
          severity: 'medium',
          message: `Execution call stack for entry point '${entryPointId}' reaches depth ${entryMaxDepth}, exceeding maximum depth limit of ${this.options.maxCallDepthLimit} hops. Deep call stacks increase risk of call stack depth limit exceptions (63/64th gas rule).`,
          suggestion:
            'Flatten call tree architecture to reduce external contract call hops.',
          callStackPath: deepPath.map((n) => n.nodeId),
          metrics: {
            entryPointId,
            depth: entryMaxDepth,
            limit: this.options.maxCallDepthLimit,
          },
        });
      }

      const highGasPaths = completedPaths.filter(
        (p) =>
          p.length > 0 &&
          p[p.length - 1].cumulativeGas > this.options.maxGasThreshold / 2
      );

      evaluations.push({
        entryPointId,
        totalCumulativeGas: totalGas,
        maxDepth: entryMaxDepth,
        hasRecursiveLoop,
        callPaths: completedPaths,
        highGasPaths,
      });
    }

    return {
      evaluations,
      findings,
      highestGasEntryPoint,
      highestGasAmount,
      maxDepthEncountered,
    };
  }

  private traverseCallTree(
    nodeId: string,
    depth: number,
    graph: CallGraph,
    visitedInPath: Set<string>,
    currentCallStack: GasPathNode[],
    completedPaths: GasPathNode[][],
    onRecursion: (loopNodeId: string, depth: number, path: GasPathNode[]) => void,
    onLoopEdge: (edge: CallGraphEdge, depth: number, path: GasPathNode[]) => void
  ): number {
    const node = graph.nodes.get(nodeId);
    if (!node) return 0;

    if (visitedInPath.has(nodeId)) {
      onRecursion(nodeId, depth, currentCallStack);
      return node.estimatedBaseGas; // Cycle breaker
    }

    visitedInPath.add(nodeId);

    const pathNode: GasPathNode = {
      nodeId,
      contractName: node.contractName,
      functionName: node.functionName,
      baseGas: node.estimatedBaseGas,
      cumulativeGas: node.estimatedBaseGas,
      depth,
    };

    currentCallStack.push(pathNode);

    // Find outgoing edges from this node
    const outgoingEdges = graph.edges.filter((e) => e.sourceId === nodeId);

    let childGasSum = 0;

    if (outgoingEdges.length === 0) {
      // Leaf node in call tree
      completedPaths.push([...currentCallStack]);
    } else {
      for (const edge of outgoingEdges) {
        if (edge.isInLoop) {
          onLoopEdge(edge, depth, currentCallStack);
        }

        const multiplier = edge.isInLoop ? (edge.loopMultiplier ?? 10) : 1;
        const targetGas = this.traverseCallTree(
          edge.targetId,
          depth + 1,
          graph,
          visitedInPath,
          currentCallStack,
          completedPaths,
          onRecursion,
          onLoopEdge
        );

        childGasSum += (edge.estimatedCallOverhead + targetGas) * multiplier;
      }
    }

    const totalNodeGas = node.estimatedBaseGas + childGasSum;
    pathNode.cumulativeGas = totalNodeGas;

    currentCallStack.pop();
    visitedInPath.delete(nodeId);

    return totalNodeGas;
  }
}
