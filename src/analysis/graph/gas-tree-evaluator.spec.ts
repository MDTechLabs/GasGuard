import { CallGraph, CallGraphNode, CallGraphEdge } from './call-graph-builder';
import { GasTreeEvaluator } from './gas-tree-evaluator';

describe('GasTreeEvaluator (Multi-Contract Execution Call-Graph Generator)', () => {
  let evaluator: GasTreeEvaluator;

  beforeEach(() => {
    evaluator = new GasTreeEvaluator({
      maxGasThreshold: 100000, // low threshold for testing
      maxCallDepthLimit: 3,
      warnOnRecursiveCalls: true,
      warnOnCrossContractLoops: true,
    });
  });

  it('should calculate cumulative gas across multi-contract execution call stack', () => {
    const nodes = new Map<string, CallGraphNode>();
    nodes.set('Vault::deposit', {
      id: 'Vault::deposit',
      contractName: 'Vault',
      functionName: 'deposit',
      filePath: 'contracts/Vault.sol',
      visibility: 'external',
      isPayable: false,
      isStateModifying: true,
      estimatedBaseGas: 30000,
      sourceLocation: { line: 10 },
      stateAccesses: ['totalDeposits'],
    });

    nodes.set('Token::transferFrom', {
      id: 'Token::transferFrom',
      contractName: 'Token',
      functionName: 'transferFrom',
      filePath: 'contracts/Token.sol',
      visibility: 'external',
      isPayable: false,
      isStateModifying: true,
      estimatedBaseGas: 40000,
      sourceLocation: { line: 15 },
      stateAccesses: ['balances'],
    });

    const edges: CallGraphEdge[] = [
      {
        sourceId: 'Vault::deposit',
        targetId: 'Token::transferFrom',
        callType: 'cross_contract',
        targetContract: 'Token',
        targetFunction: 'transferFrom',
        callSiteLine: 12,
        estimatedCallOverhead: 2600,
        isInLoop: false,
      },
    ];

    const graph: CallGraph = {
      nodes,
      edges,
      entryPoints: ['Vault::deposit'],
      imports: new Map(),
      contracts: ['Vault', 'Token'],
    };

    const result = evaluator.evaluate(graph);

    expect(result.evaluations.length).toBe(1);
    const evalResult = result.evaluations[0];
    expect(evalResult.entryPointId).toBe('Vault::deposit');

    // Expected cumulative gas = 30,000 (Vault) + 2,600 (overhead) + 40,000 (Token) = 72,600
    expect(evalResult.totalCumulativeGas).toBe(72600);
  });

  it('should detect and flag high cumulative gas exceeding threshold limit', () => {
    const nodes = new Map<string, CallGraphNode>();
    nodes.set('Heavy::execute', {
      id: 'Heavy::execute',
      contractName: 'Heavy',
      functionName: 'execute',
      filePath: 'contracts/Heavy.sol',
      visibility: 'external',
      isPayable: false,
      isStateModifying: true,
      estimatedBaseGas: 120000, // Exceeds 100,000 threshold
      sourceLocation: { line: 5 },
      stateAccesses: ['storageVal'],
    });

    const graph: CallGraph = {
      nodes,
      edges: [],
      entryPoints: ['Heavy::execute'],
      imports: new Map(),
      contracts: ['Heavy'],
    };

    const result = evaluator.evaluate(graph);
    const gasFinding = result.findings.find((f) => f.id === 'HIGH_CUMULATIVE_GAS_EXCEEDED');

    expect(gasFinding).toBeDefined();
    expect(gasFinding?.severity).toBe('high');
    expect(gasFinding?.message).toContain('120,000 gas');
  });

  it('should detect deep call stacks exceeding maximum call depth limit', () => {
    const nodes = new Map<string, CallGraphNode>();
    // Chain A -> B -> C -> D -> E (depth 4 > limit 3)
    const chain = ['A::step', 'B::step', 'C::step', 'D::step', 'E::step'];
    for (const id of chain) {
      const [contract, func] = id.split('::');
      nodes.set(id, {
        id,
        contractName: contract,
        functionName: func,
        filePath: `contracts/${contract}.sol`,
        visibility: 'external',
        isPayable: false,
        isStateModifying: false,
        estimatedBaseGas: 1000,
        sourceLocation: { line: 1 },
        stateAccesses: [],
      });
    }

    const edges: CallGraphEdge[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      edges.push({
        sourceId: chain[i],
        targetId: chain[i + 1],
        callType: 'cross_contract',
        targetContract: chain[i + 1].split('::')[0],
        targetFunction: 'step',
        callSiteLine: 5,
        estimatedCallOverhead: 100,
        isInLoop: false,
      });
    }

    const graph: CallGraph = {
      nodes,
      edges,
      entryPoints: ['A::step'],
      imports: new Map(),
      contracts: ['A', 'B', 'C', 'D', 'E'],
    };

    const result = evaluator.evaluate(graph);
    const depthFinding = result.findings.find((f) => f.id === 'DEEP_CALL_STACK_EXCEEDED');

    expect(depthFinding).toBeDefined();
    expect(depthFinding?.severity).toBe('medium');
    expect(depthFinding?.metrics.depth).toBe(4);
  });

  it('should detect recursive call loops in execution path', () => {
    const nodes = new Map<string, CallGraphNode>();
    nodes.set('LoopA::start', {
      id: 'LoopA::start',
      contractName: 'LoopA',
      functionName: 'start',
      filePath: 'contracts/LoopA.sol',
      visibility: 'external',
      isPayable: false,
      isStateModifying: true,
      estimatedBaseGas: 5000,
      sourceLocation: { line: 1 },
      stateAccesses: [],
    });

    nodes.set('LoopB::bounce', {
      id: 'LoopB::bounce',
      contractName: 'LoopB',
      functionName: 'bounce',
      filePath: 'contracts/LoopB.sol',
      visibility: 'external',
      isPayable: false,
      isStateModifying: true,
      estimatedBaseGas: 5000,
      sourceLocation: { line: 1 },
      stateAccesses: [],
    });

    // Edges: LoopA::start -> LoopB::bounce -> LoopA::start (cycle!)
    const edges: CallGraphEdge[] = [
      {
        sourceId: 'LoopA::start',
        targetId: 'LoopB::bounce',
        callType: 'cross_contract',
        targetContract: 'LoopB',
        targetFunction: 'bounce',
        callSiteLine: 5,
        estimatedCallOverhead: 500,
        isInLoop: false,
      },
      {
        sourceId: 'LoopB::bounce',
        targetId: 'LoopA::start',
        callType: 'cross_contract',
        targetContract: 'LoopA',
        targetFunction: 'start',
        callSiteLine: 10,
        estimatedCallOverhead: 500,
        isInLoop: false,
      },
    ];

    const graph: CallGraph = {
      nodes,
      edges,
      entryPoints: ['LoopA::start'],
      imports: new Map(),
      contracts: ['LoopA', 'LoopB'],
    };

    const result = evaluator.evaluate(graph);
    const recursionFinding = result.findings.find((f) => f.id === 'RECURSIVE_CALL_LOOP');

    expect(recursionFinding).toBeDefined();
    expect(recursionFinding?.category).toBe('recursion');
    expect(recursionFinding?.severity).toBe('high');
  });

  it('should flag expensive cross-contract calls executed inside loops', () => {
    const nodes = new Map<string, CallGraphNode>();
    nodes.set('LoopCaller::payMany', {
      id: 'LoopCaller::payMany',
      contractName: 'LoopCaller',
      functionName: 'payMany',
      filePath: 'contracts/LoopCaller.sol',
      visibility: 'external',
      isPayable: false,
      isStateModifying: true,
      estimatedBaseGas: 5000,
      sourceLocation: { line: 1 },
      stateAccesses: [],
    });

    nodes.set('Target::payout', {
      id: 'Target::payout',
      contractName: 'Target',
      functionName: 'payout',
      filePath: 'contracts/Target.sol',
      visibility: 'external',
      isPayable: false,
      isStateModifying: true,
      estimatedBaseGas: 2000,
      sourceLocation: { line: 1 },
      stateAccesses: [],
    });

    const edges: CallGraphEdge[] = [
      {
        sourceId: 'LoopCaller::payMany',
        targetId: 'Target::payout',
        callType: 'cross_contract',
        targetContract: 'Target',
        targetFunction: 'payout',
        callSiteLine: 12,
        estimatedCallOverhead: 2600,
        isInLoop: true, // In loop!
        loopMultiplier: 10,
      },
    ];

    const graph: CallGraph = {
      nodes,
      edges,
      entryPoints: ['LoopCaller::payMany'],
      imports: new Map(),
      contracts: ['LoopCaller', 'Target'],
    };

    const result = evaluator.evaluate(graph);
    const loopFinding = result.findings.find((f) => f.id === 'EXPENSIVE_CROSS_CONTRACT_LOOP');

    expect(loopFinding).toBeDefined();
    expect(loopFinding?.category).toBe('cross-contract-loop');
    expect(loopFinding?.severity).toBe('high');
  });
});
