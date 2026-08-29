/**
 * Multi-Contract Execution Call-Graph Generator: CallGraphBuilder
 * 
 * Parses multi-contract import graphs, extracts function definitions,
 * tracks internal and cross-contract external function invocations,
 * and constructs a directed execution call graph.
 */

export interface SourceLocation {
  line: number;
  column?: number;
}

export type FunctionVisibility = 'public' | 'external' | 'internal' | 'private';

export type CallType =
  | 'internal'
  | 'external_call'
  | 'external_static'
  | 'external_delegate'
  | 'cross_contract';

export interface CallGraphNode {
  id: string; // e.g. "Vault::deposit"
  contractName: string;
  functionName: string;
  filePath: string;
  visibility: FunctionVisibility;
  isPayable: boolean;
  isStateModifying: boolean;
  estimatedBaseGas: number;
  sourceLocation: SourceLocation;
  stateAccesses: string[];
  paramTypes?: string[];
  returnType?: string;
}

export interface CallGraphEdge {
  sourceId: string;
  targetId: string;
  callType: CallType;
  targetContract: string;
  targetFunction: string;
  callSiteLine: number;
  estimatedCallOverhead: number;
  isInLoop: boolean;
  loopMultiplier?: number;
}

export interface ContractFile {
  path: string;
  content: string;
}

export interface CallGraph {
  nodes: Map<string, CallGraphNode>;
  edges: CallGraphEdge[];
  entryPoints: string[]; // Node IDs for public/external entry points
  imports: Map<string, string[]>; // filePath -> imported file paths
  contracts: string[]; // List of contract names
}

export interface CallGraphBuilderOptions {
  defaultBaseGasInternal?: number;
  defaultBaseGasExternal?: number;
  sstoreGasCost?: number;
  sloadGasCost?: number;
  callOverheadGas?: number;
  loopMultiplierDefault?: number;
}

export class CallGraphBuilder {
  private options: Required<CallGraphBuilderOptions>;

  constructor(options?: CallGraphBuilderOptions) {
    this.options = {
      defaultBaseGasInternal: options?.defaultBaseGasInternal ?? 200,
      defaultBaseGasExternal: options?.defaultBaseGasExternal ?? 21000,
      sstoreGasCost: options?.sstoreGasCost ?? 20000,
      sloadGasCost: options?.sloadGasCost ?? 2100,
      callOverheadGas: options?.callOverheadGas ?? 2600,
      loopMultiplierDefault: options?.loopMultiplierDefault ?? 10,
    };
  }

  public parseContracts(files: ContractFile[]): CallGraph {
    const nodes = new Map<string, CallGraphNode>();
    const edges: CallGraphEdge[] = [];
    const entryPoints: string[] = [];
    const imports = new Map<string, string[]>();
    const contractsSet = new Set<string>();

    // Step 1: Parse import statements for each file
    for (const file of files) {
      const fileImports = this.extractImports(file.content);
      imports.set(file.path, fileImports);
    }

    // Step 2: Extract contracts and functions from files
    const parsedFunctions: Array<{
      node: CallGraphNode;
      bodyText: string;
      bodyStartLine: number;
    }> = [];

    for (const file of files) {
      const extracted = this.extractContractsAndFunctions(file);
      for (const item of extracted) {
        contractsSet.add(item.node.contractName);
        nodes.set(item.node.id, item.node);
        if (item.node.visibility === 'public' || item.node.visibility === 'external') {
          entryPoints.push(item.node.id);
        }
        parsedFunctions.push(item);
      }
    }

    // Step 3: Parse function body calls and construct edges
    for (const caller of parsedFunctions) {
      const bodyEdges = this.extractFunctionCalls(caller, nodes);
      edges.push(...bodyEdges);
    }

    return {
      nodes,
      edges,
      entryPoints,
      imports,
      contracts: Array.from(contractsSet),
    };
  }

  private extractImports(content: string): string[] {
    const imports: string[] = [];
    // Solidity import syntax: import "./Other.sol"; or import { X } from "./X.sol";
    const solImportRegex = /import\s+(?:(?:\{[^}]*\}|\*?\s+as\s+\w+)\s+from\s+)?["']([^"']+)["'];/g;
    let match: RegExpExecArray | null;

    while ((match = solImportRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Rust use/mod syntax: mod other; or use crate::other::*;
    const rustModRegex = /(?:mod|use)\s+([a-zA-Z0-9_:]+);/g;
    while ((match = rustModRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return imports;
  }

  private extractContractsAndFunctions(file: ContractFile): Array<{
    node: CallGraphNode;
    bodyText: string;
    bodyStartLine: number;
  }> {
    const results: Array<{ node: CallGraphNode; bodyText: string; bodyStartLine: number }> = [];
    const lines = file.content.split('\n');

    let currentContract = 'UnknownContract';
    const contractRegex = /(?:contract|interface|library|abstract\s+contract)\s+([a-zA-Z0-9_]+)/;
    const rustImplRegex = /impl(?:\s+[a-zA-Z0-9_]+)?\s+for\s+([a-zA-Z0-9_]+)|impl\s+([a-zA-Z0-9_]+)/;

    let inFunction = false;
    let funcName = '';
    let funcVisibility: FunctionVisibility = 'public';
    let funcIsPayable = false;
    let funcIsStateModifying = true;
    let funcStartLine = 1;
    let funcBodyLines: string[] = [];
    let braceBalance = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check contract declaration
      const contractMatch = line.match(contractRegex);
      if (contractMatch) {
        currentContract = contractMatch[1];
      } else {
        const rustMatch = line.match(rustImplRegex);
        if (rustMatch) {
          currentContract = rustMatch[1] || rustMatch[2];
        }
      }

      // Check function declaration
      // Solidity: function deposit(uint amount) public payable returns (bool) {
      // Rust: pub fn deposit(env: Env, amount: i128) {
      const funcMatch = line.match(
        /(?:function|pub\s+fn|fn)\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*([^{]*)/
      );

      if (funcMatch && !inFunction) {
        funcName = funcMatch[1];
        const paramsStr = funcMatch[2];
        const modifiersStr = funcMatch[3];

        funcVisibility = this.parseVisibility(modifiersStr);
        funcIsPayable = modifiersStr.includes('payable');
        funcIsStateModifying = !modifiersStr.includes('view') && !modifiersStr.includes('pure');
        funcStartLine = i + 1;
        funcBodyLines = [line];

        inFunction = true;
        braceBalance = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        continue;
      }

      if (inFunction) {
        funcBodyLines.push(line);
        braceBalance += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

        if (braceBalance <= 0) {
          inFunction = false;
          const bodyText = funcBodyLines.join('\n');
          const stateAccesses = this.extractStateAccesses(bodyText);
          const baseGas = this.estimateBaseGas(
            funcVisibility,
            funcIsStateModifying,
            stateAccesses,
            funcBodyLines.length
          );

          const nodeId = `${currentContract}::${funcName}`;

          results.push({
            node: {
              id: nodeId,
              contractName: currentContract,
              functionName: funcName,
              filePath: file.path,
              visibility: funcVisibility,
              isPayable: funcIsPayable,
              isStateModifying: funcIsStateModifying,
              estimatedBaseGas: baseGas,
              sourceLocation: { line: funcStartLine },
              stateAccesses,
            },
            bodyText,
            bodyStartLine: funcStartLine,
          });
        }
      }
    }

    return results;
  }

  private parseVisibility(modifiersStr: string): FunctionVisibility {
    if (modifiersStr.includes('external')) return 'external';
    if (modifiersStr.includes('private')) return 'private';
    if (modifiersStr.includes('internal')) return 'internal';
    return 'public';
  }

  private extractStateAccesses(bodyText: string): string[] {
    const accesses: string[] = [];
    // Detect Solidity state variable assignment or storage access: storageVar = x, storageVar[k] = v, sload, sstore
    const assignmentRegex = /([a-zA-Z0-9_]+)(?:\[[^\]]+\])?\s*=\s*/g;
    let match: RegExpExecArray | null;

    while ((match = assignmentRegex.exec(bodyText)) !== null) {
      const varName = match[1];
      if (!['let', 'var', 'const', 'uint', 'address', 'bool', 'int', 'bytes32', 'return'].includes(varName)) {
        accesses.push(varName);
      }
    }

    // Soroban storage calls: env.storage().persistent().set(...)
    if (bodyText.includes('env.storage()')) {
      accesses.push('env.storage()');
    }

    return Array.from(new Set(accesses));
  }

  private estimateBaseGas(
    visibility: FunctionVisibility,
    isStateModifying: boolean,
    stateAccesses: string[],
    lineCount: number
  ): number {
    let base =
      visibility === 'external' || visibility === 'public'
        ? this.options.defaultBaseGasExternal
        : this.options.defaultBaseGasInternal;

    // Add cost for state modifications (SSTORE) or reads (SLOAD)
    if (isStateModifying && stateAccesses.length > 0) {
      base += stateAccesses.length * this.options.sstoreGasCost;
    }

    // Code complexity overhead based on body size
    base += lineCount * 15;

    return base;
  }

  private extractFunctionCalls(
    caller: { node: CallGraphNode; bodyText: string; bodyStartLine: number },
    nodes: Map<string, CallGraphNode>
  ): CallGraphEdge[] {
    const edges: CallGraphEdge[] = [];
    const lines = caller.bodyText.split('\n');

    let inLoop = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const currentLineNum = caller.bodyStartLine + i;

      if (line.includes('for ') || line.includes('while ') || line.includes('loop {')) {
        inLoop = true;
      }

      // Check external call patterns:
      // 1. Contract.method(args) e.g. Vault.withdraw(), token.transfer()
      // 2. Address.call() / Address.delegatecall()
      // 3. env.invoke_contract()
      // 4. Direct method calls: bar()
      const crossContractRegex = /([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s*\(/g;
      let match: RegExpExecArray | null;

      while ((match = crossContractRegex.exec(line)) !== null) {
        const targetObj = match[1];
        const targetFunc = match[2];

        if (targetObj === 'console' || targetObj === 'require' || targetObj === 'assert' || targetObj === 'env') {
          continue;
        }

        let callType: CallType = 'cross_contract';
        if (targetFunc === 'delegatecall') callType = 'external_delegate';
        else if (targetFunc === 'staticcall') callType = 'external_static';
        else if (targetObj === 'this' || targetObj === 'self') callType = 'internal';

        // Match against existing nodes in graph
        const possibleTargetId = Array.from(nodes.keys()).find((id) => {
          const node = nodes.get(id)!;
          return (
            (node.contractName === targetObj || node.functionName === targetFunc) &&
            id !== caller.node.id
          );
        }) || `${targetObj}::${targetFunc}`;

        edges.push({
          sourceId: caller.node.id,
          targetId: possibleTargetId,
          callType,
          targetContract: targetObj,
          targetFunction: targetFunc,
          callSiteLine: currentLineNum,
          estimatedCallOverhead: this.options.callOverheadGas,
          isInLoop: inLoop,
          loopMultiplier: inLoop ? this.options.loopMultiplierDefault : 1,
        });
      }

      // Direct internal calls: functionName()
      const internalCallRegex = /(?:^|\s+)([a-zA-Z0-9_]+)\s*\(/g;
      while ((match = internalCallRegex.exec(line)) !== null) {
        const targetFunc = match[1];
        const targetId = `${caller.node.contractName}::${targetFunc}`;

        if (nodes.has(targetId) && targetId !== caller.node.id) {
          edges.push({
            sourceId: caller.node.id,
            targetId,
            callType: 'internal',
            targetContract: caller.node.contractName,
            targetFunction: targetFunc,
            callSiteLine: currentLineNum,
            estimatedCallOverhead: 100, // cheap internal call
            isInLoop: inLoop,
            loopMultiplier: inLoop ? this.options.loopMultiplierDefault : 1,
          });
        }
      }

      if (line.includes('}') && inLoop) {
        inLoop = false;
      }
    }

    return edges;
  }
}
