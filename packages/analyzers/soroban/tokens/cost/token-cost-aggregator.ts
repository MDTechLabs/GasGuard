import {
  maskNonCode,
  createLineResolver,
  extractFunctions,
  receiverBefore,
  resolveTokenBindings,
  resolveTokenFromReceiver,
  blockStackAt,
  isInLoop,
} from '../../common/source-utils';

export interface ResourceEstimate {
  cpuInstructions: number;
  memoryBytes: number;
  storageReadBytes: number;
  storageWriteBytes: number;
}

export interface TokenCallSite {
  fn: string;
  token: string;
  method: string;
  line: number;
  offset: number;
  inLoop: boolean;
  resourceCost: ResourceEstimate;
}

export interface TokenOperationCostGroup {
  operation: string;
  count: number;
  totalCpuInstructions: number;
  totalMemoryBytes: number;
  totalStorageReadBytes: number;
  totalStorageWriteBytes: number;
  percentageOfTotalCpu: number;
  lines: number[];
}

export interface TokenAssetCostGroup {
  token: string;
  count: number;
  totalCpuInstructions: number;
  totalMemoryBytes: number;
  totalStorageReadBytes: number;
  totalStorageWriteBytes: number;
  dominantOperation: string;
  operations: string[];
}

export interface TokenCostReport {
  callSites: TokenCallSite[];
  byOperation: TokenOperationCostGroup[];
  byAsset: TokenAssetCostGroup[];
  totalCalls: number;
  totalEstimatedCpuInstructions: number;
  totalEstimatedMemoryBytes: number;
  totalEstimatedStorageReadBytes: number;
  totalEstimatedStorageWriteBytes: number;
  dominantOperation: string | null;
  dominantAsset: string | null;
  recommendations: string[];
}

/**
 * Benchmark estimates for standard Soroban token contract methods (SEP-41 / token::Client).
 */
export const TOKEN_METHOD_BENCHMARKS: Record<string, ResourceEstimate> = {
  transfer: {
    cpuInstructions: 120_000,
    memoryBytes: 1_200,
    storageReadBytes: 600,
    storageWriteBytes: 600,
  },
  transfer_from: {
    cpuInstructions: 150_000,
    memoryBytes: 1_500,
    storageReadBytes: 800,
    storageWriteBytes: 800,
  },
  balance: {
    cpuInstructions: 40_000,
    memoryBytes: 400,
    storageReadBytes: 300,
    storageWriteBytes: 0,
  },
  approve: {
    cpuInstructions: 80_000,
    memoryBytes: 800,
    storageReadBytes: 400,
    storageWriteBytes: 400,
  },
  mint: {
    cpuInstructions: 110_000,
    memoryBytes: 1_100,
    storageReadBytes: 500,
    storageWriteBytes: 500,
  },
  burn: {
    cpuInstructions: 110_000,
    memoryBytes: 1_100,
    storageReadBytes: 500,
    storageWriteBytes: 500,
  },
  burn_from: {
    cpuInstructions: 140_000,
    memoryBytes: 1_400,
    storageReadBytes: 700,
    storageWriteBytes: 700,
  },
  clawback: {
    cpuInstructions: 130_000,
    memoryBytes: 1_300,
    storageReadBytes: 600,
    storageWriteBytes: 600,
  },
  allowance: {
    cpuInstructions: 45_000,
    memoryBytes: 450,
    storageReadBytes: 350,
    storageWriteBytes: 0,
  },
  decimals: {
    cpuInstructions: 25_000,
    memoryBytes: 200,
    storageReadBytes: 200,
    storageWriteBytes: 0,
  },
  name: {
    cpuInstructions: 25_000,
    memoryBytes: 200,
    storageReadBytes: 200,
    storageWriteBytes: 0,
  },
  symbol: {
    cpuInstructions: 25_000,
    memoryBytes: 200,
    storageReadBytes: 200,
    storageWriteBytes: 0,
  },
};

const TOKEN_METHOD_NAMES = Object.keys(TOKEN_METHOD_BENCHMARKS);
const TOKEN_CALL_REGEX = new RegExp(
  `\\.\\s*(${TOKEN_METHOD_NAMES.join('|')})\\s*\\(`,
  'g',
);

/**
 * Extract all token contract call sites with resolved receiver tokens and benchmark estimates.
 */
export function extractTokenCalls(source: string): TokenCallSite[] {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const bindings = resolveTokenBindings(masked, source);
  const functions = extractFunctions(masked, source);
  const callSites: TokenCallSite[] = [];

  let m: RegExpExecArray | null;
  while ((m = TOKEN_CALL_REGEX.exec(masked)) !== null) {
    const offset = m.index;
    const method = m[1];
    const enclosing = functions.find((f) => offset >= f.bodyStart && offset < f.bodyEnd);
    if (!enclosing) continue;

    const receiver = receiverBefore(source, offset);
    const token = resolveTokenFromReceiver(receiver, bindings);
    const stack = blockStackAt(masked, enclosing.bodyStart, offset);
    const inLoop = isInLoop(stack);

    const baseCost = TOKEN_METHOD_BENCHMARKS[method] || {
      cpuInstructions: 50_000,
      memoryBytes: 500,
      storageReadBytes: 300,
      storageWriteBytes: 0,
    };

    // Loops amplify estimated execution cost (conservative 5x multiplier for unbounded/loop contexts)
    const loopMultiplier = inLoop ? 5 : 1;
    const resourceCost: ResourceEstimate = {
      cpuInstructions: baseCost.cpuInstructions * loopMultiplier,
      memoryBytes: baseCost.memoryBytes * loopMultiplier,
      storageReadBytes: baseCost.storageReadBytes * loopMultiplier,
      storageWriteBytes: baseCost.storageWriteBytes * loopMultiplier,
    };

    callSites.push({
      fn: enclosing.name,
      token,
      method,
      line: lineOf(offset),
      offset,
      inLoop,
      resourceCost,
    });
  }

  return callSites.sort((a, b) => a.offset - b.offset);
}

/**
 * Group token call costs by method operation.
 */
export function groupCostsByOperation(
  callSites: TokenCallSite[],
  totalCpu: number,
): TokenOperationCostGroup[] {
  const groups = new Map<string, TokenCallSite[]>();

  for (const site of callSites) {
    const list = groups.get(site.method) || [];
    list.push(site);
    groups.set(site.method, list);
  }

  const result: TokenOperationCostGroup[] = [];

  for (const [operation, sites] of groups.entries()) {
    const opCpu = sites.reduce((sum, s) => sum + s.resourceCost.cpuInstructions, 0);
    const opMem = sites.reduce((sum, s) => sum + s.resourceCost.memoryBytes, 0);
    const opRead = sites.reduce((sum, s) => sum + s.resourceCost.storageReadBytes, 0);
    const opWrite = sites.reduce((sum, s) => sum + s.resourceCost.storageWriteBytes, 0);

    result.push({
      operation,
      count: sites.length,
      totalCpuInstructions: opCpu,
      totalMemoryBytes: opMem,
      totalStorageReadBytes: opRead,
      totalStorageWriteBytes: opWrite,
      percentageOfTotalCpu: totalCpu > 0 ? Math.round((opCpu / totalCpu) * 100) : 0,
      lines: sites.map((s) => s.line),
    });
  }

  return result.sort((a, b) => b.totalCpuInstructions - a.totalCpuInstructions);
}

/**
 * Group token call costs by target asset token.
 */
export function groupCostsByAsset(callSites: TokenCallSite[]): TokenAssetCostGroup[] {
  const groups = new Map<string, TokenCallSite[]>();

  for (const site of callSites) {
    const list = groups.get(site.token) || [];
    list.push(site);
    groups.set(site.token, list);
  }

  const result: TokenAssetCostGroup[] = [];

  for (const [token, sites] of groups.entries()) {
    const assetCpu = sites.reduce((sum, s) => sum + s.resourceCost.cpuInstructions, 0);
    const assetMem = sites.reduce((sum, s) => sum + s.resourceCost.memoryBytes, 0);
    const assetRead = sites.reduce((sum, s) => sum + s.resourceCost.storageReadBytes, 0);
    const assetWrite = sites.reduce((sum, s) => sum + s.resourceCost.storageWriteBytes, 0);

    // Identify dominant operation for this asset
    const opCounts = new Map<string, number>();
    for (const s of sites) {
      opCounts.set(s.method, (opCounts.get(s.method) || 0) + 1);
    }
    const dominantOperation = Array.from(opCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none';

    result.push({
      token,
      count: sites.length,
      totalCpuInstructions: assetCpu,
      totalMemoryBytes: assetMem,
      totalStorageReadBytes: assetRead,
      totalStorageWriteBytes: assetWrite,
      dominantOperation,
      operations: Array.from(new Set(sites.map((s) => s.method))),
    });
  }

  return result.sort((a, b) => b.totalCpuInstructions - a.totalCpuInstructions);
}

/**
 * Aggregate token contract call costs and produce a comprehensive resource impact report.
 */
export function aggregateTokenCosts(source: string): TokenCostReport {
  const callSites = extractTokenCalls(source);

  const totalEstimatedCpuInstructions = callSites.reduce(
    (sum, s) => sum + s.resourceCost.cpuInstructions,
    0,
  );
  const totalEstimatedMemoryBytes = callSites.reduce(
    (sum, s) => sum + s.resourceCost.memoryBytes,
    0,
  );
  const totalEstimatedStorageReadBytes = callSites.reduce(
    (sum, s) => sum + s.resourceCost.storageReadBytes,
    0,
  );
  const totalEstimatedStorageWriteBytes = callSites.reduce(
    (sum, s) => sum + s.resourceCost.storageWriteBytes,
    0,
  );

  const byOperation = groupCostsByOperation(callSites, totalEstimatedCpuInstructions);
  const byAsset = groupCostsByAsset(callSites);

  const dominantOperation = byOperation[0]?.operation || null;
  const dominantAsset = byAsset[0]?.token || null;

  const recommendations: string[] = [];

  // Check for in-loop token operations
  const loopCalls = callSites.filter((s) => s.inLoop);
  if (loopCalls.length > 0) {
    recommendations.push(
      `Detected ${loopCalls.length} token call(s) executed inside loops (lines: ${loopCalls.map((s) => s.line).join(', ')}). Batch or hoist these operations to avoid multiplicative CPU and storage costs.`,
    );
  }

  // Check for high transfer concentration
  const transferGroup = byOperation.find((o) => o.operation === 'transfer' || o.operation === 'transfer_from');
  if (transferGroup && transferGroup.count >= 3) {
    recommendations.push(
      `Multiple token transfers (${transferGroup.count} calls) account for ${transferGroup.percentageOfTotalCpu}% of token CPU budget. Consolidate transfers to the same recipient or use batched settlements.`,
    );
  }

  // Check for repeated balance queries
  const balanceGroup = byOperation.find((o) => o.operation === 'balance');
  if (balanceGroup && balanceGroup.count >= 2) {
    recommendations.push(
      `Multiple balance queries detected (${balanceGroup.count} calls). Cache token balance in a local variable if state does not mutate between reads.`,
    );
  }

  return {
    callSites,
    byOperation,
    byAsset,
    totalCalls: callSites.length,
    totalEstimatedCpuInstructions,
    totalEstimatedMemoryBytes,
    totalEstimatedStorageReadBytes,
    totalEstimatedStorageWriteBytes,
    dominantOperation,
    dominantAsset,
    recommendations,
  };
}
