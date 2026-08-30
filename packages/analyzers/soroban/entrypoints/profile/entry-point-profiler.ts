/**
 * Issue #905 — Soroban Entry-Point Resource Profiler
 *
 * Analyzes Soroban smart contract source code to generate comprehensive
 * resource profiles for each public entry point. Aggregates CPU, memory,
 * storage, and contract-call impacts, computes a composite estimated cost,
 * and ranks entry points from most to least expensive.
 */

import {
  maskNonCode,
  createLineResolver,
  extractFunctions as extractFunctionBlocks,
  FunctionBlock,
} from '../../common/source-utils';
import {
  AggregateResourceMetrics,
  CostThresholds,
  CostWeights,
  CpuImpact,
  EntryPointFinding,
  EntryPointProfile,
  EntryPointProfileReport,
  FunctionVisibility,
  MemoryImpact,
  ProfilerConfig,
  ResourceCategory,
  Severity,
  StorageImpact,
  ContractCallImpact,
  CostTier,
} from './types';

export const DEFAULT_WEIGHTS: CostWeights = {
  cpu: 0.35,
  storage: 0.30,
  memory: 0.20,
  contractCalls: 0.15,
};

export const DEFAULT_THRESHOLDS: CostThresholds = {
  critical: 75,
  high: 50,
  medium: 25,
};

export const DEFAULT_CONFIG: ProfilerConfig = {
  weights: DEFAULT_WEIGHTS,
  thresholds: DEFAULT_THRESHOLDS,
  onlyPublic: true,
  includeInternal: false,
};

interface ExtractedFunction {
  name: string;
  visibility: FunctionVisibility;
  isExported: boolean;
  lineNumber: number;
  bodyStart: number;
  bodyEnd: number;
  bodyLines: number;
  params: string[];
  returnType: string | null;
  rawBody: string;
  maskedBody: string;
}

export class SorobanEntryPointProfiler {
  private config: ProfilerConfig;

  constructor(config?: Partial<ProfilerConfig>) {
    this.config = {
      weights: { ...DEFAULT_WEIGHTS, ...(config?.weights ?? {}) },
      thresholds: { ...DEFAULT_THRESHOLDS, ...(config?.thresholds ?? {}) },
      onlyPublic: config?.onlyPublic ?? DEFAULT_CONFIG.onlyPublic,
      includeInternal: config?.includeInternal ?? DEFAULT_CONFIG.includeInternal,
    };
  }

  /**
   * Profile all entry points in the given Soroban contract source.
   */
  public profile(source: string, filePath = 'contract.rs'): EntryPointProfileReport {
    const contractName = this.extractContractName(source);
    const rawFunctions = this.extractContractFunctions(source);

    const filteredFunctions = rawFunctions.filter((fn) => {
      if (this.config.onlyPublic && !fn.isExported && fn.visibility !== 'public' && fn.visibility !== 'constructor') {
        return this.config.includeInternal;
      }
      return true;
    });

    const entryPoints: EntryPointProfile[] = filteredFunctions.map((fn) => {
      return this.profileSingleEntryPoint(fn, contractName);
    });

    // Rank entry points descending by total estimated cost
    const rankedEntryPoints = [...entryPoints].sort((a, b) => {
      if (b.totalEstimatedCost !== a.totalEstimatedCost) {
        return b.totalEstimatedCost - a.totalEstimatedCost;
      }
      if (b.storage.score !== a.storage.score) {
        return b.storage.score - a.storage.score;
      }
      if (b.cpu.score !== a.cpu.score) {
        return b.cpu.score - a.cpu.score;
      }
      return a.lineNumber - b.lineNumber;
    });

    // Assign 1-based ranks
    rankedEntryPoints.forEach((ep, index) => {
      ep.rank = index + 1;
    });

    const publicCount = entryPoints.filter((e) => e.isExported || e.visibility === 'public').length;
    const aggregateMetrics = this.computeAggregateMetrics(entryPoints);
    const mostExpensive = rankedEntryPoints.length > 0 ? rankedEntryPoints[0] : undefined;
    const leastExpensive = rankedEntryPoints.length > 0 ? rankedEntryPoints[rankedEntryPoints.length - 1] : undefined;
    const summary = this.generateSummary(contractName, entryPoints, rankedEntryPoints, aggregateMetrics);

    return {
      contractName,
      filePath,
      entryPoints,
      rankedEntryPoints,
      totalEntryPoints: entryPoints.length,
      publicEntryPointsCount: publicCount,
      mostExpensiveEntryPoint: mostExpensive,
      leastExpensiveEntryPoint: leastExpensive,
      aggregateMetrics,
      costThresholds: this.config.thresholds,
      summary,
      generatedAt: new Date(),
    };
  }

  /**
   * Profile a single extracted function entry point across all resource categories.
   */
  private profileSingleEntryPoint(
    fn: ExtractedFunction,
    contractName: string,
  ): EntryPointProfile {
    const findings: EntryPointFinding[] = [];
    const hotspots: string[] = [];
    const recommendations: string[] = [];

    // Analyze individual resource categories
    const cpu = this.analyzeCpuImpact(fn, findings, hotspots, recommendations);
    const memory = this.analyzeMemoryImpact(fn, findings, hotspots, recommendations);
    const storage = this.analyzeStorageImpact(fn, findings, hotspots, recommendations);
    const contractCalls = this.analyzeContractCallImpact(fn, findings, hotspots, recommendations);

    // Compute composite cost score
    const w = this.config.weights;
    let baseScore =
      cpu.score * w.cpu +
      memory.score * w.memory +
      storage.score * w.storage +
      contractCalls.score * w.contractCalls;

    // Compound hazard penalty: if an entry point triggers multiple critical/high category issues
    const severeHotspots =
      (cpu.nestedLoops > 0 ? 1 : 0) +
      (cpu.storageInLoops > 0 || storage.storageInLoops > 0 ? 1 : 0) +
      (cpu.cryptoOperations > 0 ? 1 : 0) +
      (storage.writesCount >= 3 ? 1 : 0) +
      (contractCalls.crossContractInvocations > 0 ? 1 : 0);

    if (severeHotspots >= 3) {
      baseScore = Math.max(baseScore, 75);
    } else if (severeHotspots >= 2) {
      baseScore = Math.max(baseScore, 50);
    }

    const totalEstimatedCost = Math.min(100, Math.round(baseScore));

    const costTier = this.classifyCostTier(totalEstimatedCost);

    return {
      name: fn.name,
      contractName,
      visibility: fn.visibility,
      isExported: fn.isExported,
      lineNumber: fn.lineNumber,
      bodyLines: fn.bodyLines,
      params: fn.params,
      returnType: fn.returnType,
      cpu,
      memory,
      storage,
      contractCalls,
      totalEstimatedCost,
      costTier,
      rank: 0, // Will be set after sorting
      hotspots,
      findings,
      recommendations,
    };
  }

  /**
   * Analyze CPU impact for an entry point.
   */
  private analyzeCpuImpact(
    fn: ExtractedFunction,
    findings: EntryPointFinding[],
    hotspots: string[],
    recommendations: string[],
  ): CpuImpact {
    const raw = fn.rawBody;
    const masked = fn.maskedBody;
    let score = 0;
    const heavyOperations: string[] = [];
    const details: string[] = [];

    // Unbounded and bounded loops
    const loopMatches = masked.match(/\b(for|while|loop)\b/g) ?? [];
    const unboundedMatches = masked.match(/\b(for|while|loop)\b(?![^{]*\b(take|limit|MAX_|max_)\b)/g) ?? [];
    const unboundedLoops = unboundedMatches.length;

    // Nested loops
    const nestedLoopMatch = /\b(for|while|loop)\b[\s\S]{0,300}?\b(for|while|loop)\b/.test(masked);
    const nestedLoops = nestedLoopMatch ? 1 : 0;

    if (nestedLoops > 0) {
      score += 45;
      heavyOperations.push('nested-loops');
      hotspots.push('Nested loop construct detected');
      findings.push({
        ruleId: 'soroban-cpu-nested-loop',
        category: 'cpu',
        severity: 'critical',
        line: fn.lineNumber,
        message: `Entry point '${fn.name}' contains nested loops with quadratic CPU complexity.`,
        suggestion: 'Flatten nested loops or index data structures to reduce CPU instruction overhead.',
      });
      recommendations.push('Refactor nested loops into single-pass lookups or keyed index structures.');
    } else if (unboundedLoops > 0) {
      score += Math.min(35, unboundedLoops * 20);
      heavyOperations.push('unbounded-loop');
      hotspots.push(`${unboundedLoops} loop(s) without explicit bounds`);
      findings.push({
        ruleId: 'soroban-cpu-unbounded-loop',
        category: 'cpu',
        severity: 'high',
        line: fn.lineNumber,
        message: `Entry point '${fn.name}' contains ${unboundedLoops} loop(s) without explicit iteration limits.`,
        suggestion: 'Constrain loops with explicit bounds or limits to avoid CPU instruction limits.',
      });
      recommendations.push('Add explicit iteration bounds (e.g. .take(limit) or MAX_ITEMS) to loops.');
    }

    // Collection iterations
    const iterMatches = masked.match(/\.(iter|into_iter|keys|values)\s*\(\s*\)/g) ?? [];
    const collectionIterations = iterMatches.length;
    if (collectionIterations > 0) {
      score += Math.min(20, collectionIterations * 8);
      heavyOperations.push('collection-iteration');
      details.push(`${collectionIterations} collection iteration(s)`);
    }

    // Cryptographic primitives
    const cryptoMatches = raw.match(/\b(keccak256|sha256|ed25519|secp256k1|bls12_381|verify_sig|recover|verify)\b/gi) ?? [];
    const cryptoOperations = cryptoMatches.length;
    if (cryptoOperations > 0) {
      score += Math.min(30, cryptoOperations * 15);
      heavyOperations.push('crypto-primitive');
      hotspots.push(`${cryptoOperations} cryptographic operation(s)`);
      findings.push({
        ruleId: 'soroban-cpu-crypto-heavy',
        category: 'cpu',
        severity: 'high',
        line: fn.lineNumber,
        message: `Entry point '${fn.name}' invokes ${cryptoOperations} cryptographic primitive(s).`,
        suggestion: 'Batch cryptographic signature verifications or avoid duplicate hashing where possible.',
      });
      recommendations.push('Cache verified hashes or batch signature validations.');
    }

    // Serialization operations
    const serMatches = masked.match(/\b(to_xdr|from_xdr|serialize|deserialize|to_bytes|from_bytes)\b/g) ?? [];
    const serializationOps = serMatches.length;
    if (serializationOps > 0) {
      score += Math.min(15, serializationOps * 5);
      heavyOperations.push('serialization');
      details.push(`${serializationOps} serialization/deserialization call(s)`);
    }

    // Dynamic string formatting
    const fmtMatches = raw.match(/\bformat!\s*\(|String::from\s*\(/g) ?? [];
    const dynamicFormatting = fmtMatches.length;
    if (dynamicFormatting > 0) {
      score += Math.min(10, dynamicFormatting * 4);
      details.push(`${dynamicFormatting} dynamic string format/creation call(s)`);
    }

    // Storage inside loops
    const storageInLoopMatch = /\b(for|while|loop)\b[\s\S]{0,300}?\benv\.storage\s*\(\s*\)/.test(masked);
    const storageInLoops = storageInLoopMatch ? 1 : 0;
    if (storageInLoops > 0) {
      score += 25;
      heavyOperations.push('storage-in-loop-cpu');
      hotspots.push('Storage read/write inside loop body');
    }

    const finalScore = Math.min(100, Math.max(score, loopMatches.length > 0 ? 15 : 5));

    return {
      score: finalScore,
      unboundedLoops,
      nestedLoops,
      collectionIterations,
      cryptoOperations,
      serializationOps,
      dynamicFormatting,
      storageInLoops,
      heavyOperations,
      details,
    };
  }

  /**
   * Analyze Memory impact for an entry point.
   */
  private analyzeMemoryImpact(
    fn: ExtractedFunction,
    findings: EntryPointFinding[],
    hotspots: string[],
    recommendations: string[],
  ): MemoryImpact {
    const raw = fn.rawBody;
    const masked = fn.maskedBody;
    let score = 0;
    const details: string[] = [];

    // Large allocations (e.g. Vec::with_capacity(&env, 1000) or Vec::with_capacity(1000))
    const largeAllocMatches = masked.match(/Vec::with_capacity\s*\([^)]*\b\d{3,}\b[^)]*\)/g) ?? [];
    const largeAllocations = largeAllocMatches.length;
    if (largeAllocations > 0) {
      score += Math.min(60, largeAllocations * 35);
      hotspots.push(`${largeAllocations} large vector pre-allocation(s)`);
      findings.push({
        ruleId: 'soroban-mem-large-allocation',
        category: 'memory',
        severity: 'high',
        line: fn.lineNumber,
        message: `Entry point '${fn.name}' pre-allocates large memory buffer(s).`,
        suggestion: 'Avoid large vector pre-allocations in smart contracts; stream or chunk processing.',
      });
      recommendations.push('Avoid pre-allocating large memory structures; process elements lazily.');
    }

    // Nested collections
    const nestedCollMatches = masked.match(/Vec\s*<\s*Vec\s*<|Map\s*<[^>]+,\s*Vec\s*</g) ?? [];
    const nestedCollections = nestedCollMatches.length;
    if (nestedCollections > 0) {
      score += Math.min(30, nestedCollections * 15);
      hotspots.push('Nested collection structure (Vec<Vec<_>> / Map<_, Vec<_>>)');
      findings.push({
        ruleId: 'soroban-mem-nested-collection',
        category: 'memory',
        severity: 'medium',
        line: fn.lineNumber,
        message: `Entry point '${fn.name}' uses nested heap collections.`,
        suggestion: 'Flatten nested collection structures to minimize heap fragmentation.',
      });
    }

    // Clone in loops
    const cloneInLoopMatches = masked.match(/\b(for|while|loop)\b[\s\S]{0,250}?\.clone\s*\(\s*\)/g) ?? [];
    const cloneInLoops = cloneInLoopMatches.length;
    if (cloneInLoops > 0) {
      score += Math.min(35, cloneInLoops * 20);
      hotspots.push(`${cloneInLoops} .clone() inside loop`);
      findings.push({
        ruleId: 'soroban-mem-clone-in-loop',
        category: 'memory',
        severity: 'high',
        line: fn.lineNumber,
        message: `Entry point '${fn.name}' executes .clone() inside a loop.`,
        suggestion: 'Take references or restructure the loop to avoid repeated heap cloning.',
      });
      recommendations.push('Borrow data via references rather than cloning inside loops.');
    }

    // Box heap allocations
    const boxMatches = masked.match(/Box::new\s*\(/g) ?? [];
    const boxAllocations = boxMatches.length;
    if (boxAllocations > 0) {
      score += Math.min(20, boxAllocations * 8);
      details.push(`${boxAllocations} heap Box allocation(s)`);
    }

    // Collection materializations
    const collectMatches = masked.match(/\.collect::<|\.collect\s*\(\s*\)/g) ?? [];
    const collectIterator = collectMatches.length;
    if (collectIterator > 0) {
      score += Math.min(20, collectIterator * 7);
      details.push(`${collectIterator} iterator .collect() materialization(s)`);
    }

    // Large structs on stack
    const structMatches = raw.match(/struct\s+\w+\s*\{(?:[^}]*,){10,}/g) ?? [];
    const largeStructStack = structMatches.length;
    if (largeStructStack > 0) {
      score += 20;
      details.push('Large struct definitions in scope');
    }

    const finalScore = Math.min(100, Math.max(score, 5));

    return {
      score: finalScore,
      largeAllocations,
      nestedCollections,
      cloneInLoops,
      boxAllocations,
      collectIterator,
      largeStructStack,
      details,
    };
  }

  /**
   * Analyze Storage impact for an entry point.
   */
  private analyzeStorageImpact(
    fn: ExtractedFunction,
    findings: EntryPointFinding[],
    hotspots: string[],
    recommendations: string[],
  ): StorageImpact {
    const masked = fn.maskedBody;
    let score = 0;
    const details: string[] = [];

    // Persistent storage
    const persistentReadMatches = masked.match(/\.storage\s*\(\s*\)\.persistent\s*\(\s*\)\.(get|has)\s*\(/g) ?? [];
    const persistentWriteMatches = masked.match(/\.storage\s*\(\s*\)\.persistent\s*\(\s*\)\.(set|set_has|remove)\s*\(/g) ?? [];
    const persistentReads = persistentReadMatches.length;
    const persistentWrites = persistentWriteMatches.length;

    // Instance storage
    const instanceReadMatches = masked.match(/\.storage\s*\(\s*\)\.instance\s*\(\s*\)\.(get|has)\s*\(/g) ?? [];
    const instanceWriteMatches = masked.match(/\.storage\s*\(\s*\)\.instance\s*\(\s*\)\.(set|set_has|remove)\s*\(/g) ?? [];
    const instanceReads = instanceReadMatches.length;
    const instanceWrites = instanceWriteMatches.length;

    // Temporary storage
    const tempReadMatches = masked.match(/\.storage\s*\(\s*\)\.temporary\s*\(\s*\)\.(get|has)\s*\(/g) ?? [];
    const tempWriteMatches = masked.match(/\.storage\s*\(\s*\)\.temporary\s*\(\s*\)\.(set|set_has|remove)\s*\(/g) ?? [];
    const temporaryReads = tempReadMatches.length;
    const temporaryWrites = tempWriteMatches.length;

    // General fallback storage matching (e.g. storage().get / storage().set)
    const generalReadMatches = masked.match(/\.storage\s*\(\s*\)(?:\.\w+\s*\(\s*\))?\.(get|has)\s*\(/g) ?? [];
    const generalWriteMatches = masked.match(/\.storage\s*\(\s*\)(?:\.\w+\s*\(\s*\))?\.(set|set_has|remove)\s*\(/g) ?? [];

    const totalReads = Math.max(persistentReads + instanceReads + temporaryReads, generalReadMatches.length);
    const totalWrites = Math.max(persistentWrites + instanceWrites + temporaryWrites, generalWriteMatches.length);

    // Storage in loops
    const storageInLoopMatch = /\b(for|while|loop)\b[\s\S]{0,350}?\b(env\.)?storage\s*\(\s*\)/.test(masked);
    const storageInLoops = storageInLoopMatch ? 1 : 0;

    // TTL extensions
    const ttlMatches = masked.match(/\.extend_ttl\s*\(/g) ?? [];
    const ttlExtensions = ttlMatches.length;

    // Score calculation
    // Storage writes are substantially more expensive on Soroban than reads
    score += persistentWrites * 25;
    score += instanceWrites * 18;
    score += temporaryWrites * 12;
    score += persistentReads * 10;
    score += instanceReads * 6;
    score += temporaryReads * 4;

    if (storageInLoops > 0) {
      score += 40;
      hotspots.push('Storage operations executed inside loop body');
      findings.push({
        ruleId: 'soroban-storage-in-loop',
        category: 'storage',
        severity: 'critical',
        line: fn.lineNumber,
        message: `Entry point '${fn.name}' performs storage reads/writes inside a loop.`,
        suggestion: 'Accumulate state modifications in memory and commit to storage once after the loop.',
      });
      recommendations.push('Batch state modifications outside loops to minimize ledger write costs.');
    }

    if (totalWrites > 2) {
      hotspots.push(`${totalWrites} separate storage writes`);
      findings.push({
        ruleId: 'soroban-frequent-storage-writes',
        category: 'storage',
        severity: totalWrites >= 4 ? 'high' : 'medium',
        line: fn.lineNumber,
        message: `Entry point '${fn.name}' executes ${totalWrites} distinct storage writes.`,
        suggestion: 'Consolidate multiple storage keys or fields into a combined struct to reduce write overhead.',
      });
      recommendations.push('Combine related storage keys into a single struct entry where appropriate.');
    }

    if (totalReads > 3) {
      details.push(`${totalReads} storage reads identified`);
      findings.push({
        ruleId: 'soroban-multiple-storage-reads',
        category: 'storage',
        severity: 'low',
        line: fn.lineNumber,
        message: `Entry point '${fn.name}' issues ${totalReads} storage reads.`,
        suggestion: 'Cache queried state in local variables within the function.',
      });
      recommendations.push('Cache storage reads in local variables rather than re-querying.');
    }

    if (persistentWrites > 0) details.push(`${persistentWrites} persistent write(s)`);
    if (instanceWrites > 0) details.push(`${instanceWrites} instance write(s)`);
    if (temporaryWrites > 0) details.push(`${temporaryWrites} temporary write(s)`);
    if (totalReads > 0) details.push(`${totalReads} total read(s)`);

    const finalScore = Math.min(100, Math.max(score, totalWrites > 0 || totalReads > 0 ? 10 : 0));

    return {
      score: finalScore,
      readsCount: totalReads,
      writesCount: totalWrites,
      persistentReads,
      persistentWrites,
      instanceReads,
      instanceWrites,
      temporaryReads,
      temporaryWrites,
      storageInLoops,
      ttlExtensions,
      details,
    };
  }

  /**
   * Analyze Contract-Call and Token transfer impact for an entry point.
   */
  private analyzeContractCallImpact(
    fn: ExtractedFunction,
    findings: EntryPointFinding[],
    hotspots: string[],
    recommendations: string[],
  ): ContractCallImpact {
    const raw = fn.rawBody;
    const masked = fn.maskedBody;
    let score = 0;
    const externalCallTargets: string[] = [];
    const details: string[] = [];

    // Cross-contract invocations
    const invokeMatches = masked.match(/\benv\.invoke_contract\s*\(|\benv\.try_invoke_contract\s*\(/g) ?? [];
    const clientMatches = masked.match(/\b\w+Client::new\s*\(/g) ?? [];
    const crossContractInvocations = invokeMatches.length + clientMatches.length;

    if (crossContractInvocations > 0) {
      score += Math.min(50, crossContractInvocations * 25);
      hotspots.push(`${crossContractInvocations} cross-contract invocation(s)`);
      findings.push({
        ruleId: 'soroban-call-cross-contract',
        category: 'contract-calls',
        severity: crossContractInvocations >= 2 ? 'high' : 'medium',
        line: fn.lineNumber,
        message: `Entry point '${fn.name}' performs ${crossContractInvocations} cross-contract call(s).`,
        suggestion: 'Minimize cross-contract calls or batch invocations to reduce cross-contract execution overhead.',
      });
      recommendations.push('Batch arguments into fewer cross-contract invocations.');
    }

    // Token transfers
    const transferMatches = masked.match(/\.(transfer|transfer_from)\s*\(/g) ?? [];
    const tokenTransfers = transferMatches.length;
    if (tokenTransfers > 0) {
      score += Math.min(40, tokenTransfers * 20);
      details.push(`${tokenTransfers} token transfer(s)`);
      if (tokenTransfers >= 2) {
        hotspots.push(`${tokenTransfers} token transfers in single entry point`);
        findings.push({
          ruleId: 'soroban-call-multiple-transfers',
          category: 'contract-calls',
          severity: 'medium',
          line: fn.lineNumber,
          message: `Entry point '${fn.name}' executes ${tokenTransfers} token transfer calls.`,
          suggestion: 'Consolidate multiple token transfers into a net single transfer where possible.',
        });
        recommendations.push('Consolidate token transfers or remove intermediate escrow hops.');
      }
    }

    // Balance queries
    const balanceMatches = masked.match(/\.(balance|balance_of|spendable_balance)\s*\(/g) ?? [];
    const balanceQueries = balanceMatches.length;
    if (balanceQueries > 0) {
      score += Math.min(25, balanceQueries * 10);
      details.push(`${balanceQueries} token balance query(ies)`);
    }

    // Auth checks
    const authMatches = masked.match(/\.(require_auth|require_auth_for_args)\s*\(/g) ?? [];
    const authChecks = authMatches.length;
    if (authChecks > 0) {
      details.push(`${authChecks} authorization check(s)`);
    }

    // Capture target names if any
    const targetMatches = raw.match(/Client::new\s*\(\s*&env\s*,\s*&([A-Za-z0-9_]+)\s*\)/g);
    if (targetMatches) {
      targetMatches.forEach((tm) => {
        const m = tm.match(/&([A-Za-z0-9_]+)\s*\)/);
        if (m && !externalCallTargets.includes(m[1])) {
          externalCallTargets.push(m[1]);
        }
      });
    }

    const finalScore = Math.min(100, Math.max(score, crossContractInvocations > 0 || tokenTransfers > 0 ? 15 : 0));

    return {
      score: finalScore,
      crossContractInvocations,
      tokenTransfers,
      balanceQueries,
      authChecks,
      externalCallTargets,
      details,
    };
  }

  /**
   * Classify composite cost score into standard severity tiers.
   */
  private classifyCostTier(costScore: number): CostTier {
    if (costScore >= this.config.thresholds.critical) return 'critical';
    if (costScore >= this.config.thresholds.high) return 'high';
    if (costScore >= this.config.thresholds.medium) return 'medium';
    return 'low';
  }

  /**
   * Extract contract name from source.
   */
  private extractContractName(source: string): string {
    const contractMatch = source.match(/(?:impl|struct)\s+([A-Za-z0-9_]+)/);
    if (contractMatch) return contractMatch[1];
    const contractTraitMatch = source.match(/pub\s+trait\s+([A-Za-z0-9_]+)/);
    if (contractTraitMatch) return contractTraitMatch[1];
    return 'SorobanContract';
  }

  /**
   * Extract all functions with signatures, line numbers, and body contents.
   */
  private extractContractFunctions(source: string): ExtractedFunction[] {
    const masked = maskNonCode(source);
    const lineOf = createLineResolver(source);
    const functionBlocks = extractFunctionBlocks(masked, source);
    const results: ExtractedFunction[] = [];

    // Also match function signatures in lines to parse parameters and return types
    const lines = source.split('\n');
    const fnDefRe = /^\s*(pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*([^{;]+))?/;

    for (const block of functionBlocks) {
      const fnLineIdx = block.line - 1;
      const signatureLine = lines[fnLineIdx] ?? '';
      const match = signatureLine.match(fnDefRe);

      const isPublic = !!(match && match[1]?.trim().startsWith('pub'));
      const isConstructor = block.name === 'new' || block.name === 'init' || block.name === 'initialize';
      const visibility: FunctionVisibility = isConstructor
        ? 'constructor'
        : isPublic
        ? 'public'
        : 'internal';

      const rawParams = match ? match[3] ?? '' : '';
      const params = this.parseParameters(rawParams);
      const returnType = match && match[4] ? match[4].trim() : null;

      const rawBody = source.slice(block.bodyStart, block.bodyEnd);
      const maskedBody = masked.slice(block.bodyStart, block.bodyEnd);
      const bodyLines = rawBody.split('\n').length;

      // In Soroban, functions inside #[contractimpl] or marked pub fn are exported entry points
      const isExported = isPublic || this.isInContractImplBlock(source, block.bodyStart);

      results.push({
        name: block.name,
        visibility,
        isExported,
        lineNumber: block.line,
        bodyStart: block.bodyStart,
        bodyEnd: block.bodyEnd,
        bodyLines,
        params,
        returnType,
        rawBody,
        maskedBody,
      });
    }

    return results;
  }

  /**
   * Check if a function is within a #[contractimpl] block.
   */
  private isInContractImplBlock(source: string, bodyStart: number): boolean {
    const preceding = source.slice(0, bodyStart);
    const contractImplIdx = preceding.lastIndexOf('#[contractimpl]');
    if (contractImplIdx === -1) return false;

    // Check if the contractimpl impl block is still open at bodyStart
    const slice = preceding.slice(contractImplIdx);
    let depth = 0;
    for (const ch of slice) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    return depth > 0;
  }

  /**
   * Parse parameters string into clean parameter list.
   */
  private parseParameters(paramStr: string): string[] {
    if (!paramStr.trim()) return [];
    return paramStr
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p !== 'self' && p !== '&self' && p !== '&mut self');
  }

  /**
   * Compute aggregate metrics across all profiled entry points.
   */
  private computeAggregateMetrics(entryPoints: EntryPointProfile[]): AggregateResourceMetrics {
    if (entryPoints.length === 0) {
      return {
        totalEstimatedCost: 0,
        averageCost: 0,
        totalCpuScore: 0,
        totalMemoryScore: 0,
        totalStorageReads: 0,
        totalStorageWrites: 0,
        totalContractCalls: 0,
      };
    }

    const totalCost = entryPoints.reduce((s, ep) => s + ep.totalEstimatedCost, 0);
    const totalCpu = entryPoints.reduce((s, ep) => s + ep.cpu.score, 0);
    const totalMem = entryPoints.reduce((s, ep) => s + ep.memory.score, 0);
    const totalReads = entryPoints.reduce((s, ep) => s + ep.storage.readsCount, 0);
    const totalWrites = entryPoints.reduce((s, ep) => s + ep.storage.writesCount, 0);
    const totalCalls = entryPoints.reduce((s, ep) => s + ep.contractCalls.crossContractInvocations + ep.contractCalls.tokenTransfers, 0);

    return {
      totalEstimatedCost: totalCost,
      averageCost: Math.round((totalCost / entryPoints.length) * 10) / 10,
      totalCpuScore: Math.round(totalCpu / entryPoints.length),
      totalMemoryScore: Math.round(totalMem / entryPoints.length),
      totalStorageReads: totalReads,
      totalStorageWrites: totalWrites,
      totalContractCalls: totalCalls,
    };
  }

  /**
   * Generate an executive summary string.
   */
  private generateSummary(
    contractName: string,
    entryPoints: EntryPointProfile[],
    ranked: EntryPointProfile[],
    metrics: AggregateResourceMetrics,
  ): string {
    if (entryPoints.length === 0) {
      return `No entry points detected in contract '${contractName}'.`;
    }

    const top = ranked[0];
    const criticalCount = entryPoints.filter((e) => e.costTier === 'critical').length;
    const highCount = entryPoints.filter((e) => e.costTier === 'high').length;

    let summary = `Analyzed ${entryPoints.length} entry point(s) in contract '${contractName}'. `;
    summary += `Average estimated cost: ${metrics.averageCost}/100. `;

    if (top) {
      summary += `Most expensive entry point: '${top.name}' (Cost: ${top.totalEstimatedCost}/100, Tier: ${top.costTier.toUpperCase()}). `;
      if (top.hotspots.length > 0) {
        summary += `Key hotspot: ${top.hotspots[0]}. `;
      }
    }

    if (criticalCount > 0) {
      summary += `⚠️ ${criticalCount} entry point(s) at CRITICAL resource cost level.`;
    } else if (highCount > 0) {
      summary += `⚠️ ${highCount} entry point(s) at HIGH resource cost level.`;
    } else {
      summary += `All entry points are within acceptable resource parameters.`;
    }

    return summary;
  }
}

/**
 * Convenient standalone entry point for profiling Soroban smart contracts.
 */
export function profileSorobanEntryPoints(
  source: string,
  filePath = 'contract.rs',
  config?: Partial<ProfilerConfig>,
): EntryPointProfileReport {
  const profiler = new SorobanEntryPointProfiler(config);
  return profiler.profile(source, filePath);
}
