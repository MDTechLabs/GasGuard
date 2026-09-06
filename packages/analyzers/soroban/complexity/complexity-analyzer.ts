/**
 * Issue #904 — Soroban Overloaded Entry-Point Analyzer
 *
 * Implements static complexity and resource-load analysis for Soroban smart contracts.
 * Measures cyclomatic complexity, cognitive complexity, and lines of code, while tracking
 * storage operations and external calls. Surfaces overloaded entry points handling
 * excessive responsibilities based on configurable thresholds.
 */

import {
  maskNonCode,
  createLineResolver,
  extractFunctions as extractFunctionBlocks,
  FunctionBlock,
  blockStackAt,
  isInLoop,
  splitArgs,
  normalizeExpr,
} from '../common/source-utils';

import {
  ComplexityMetrics,
  ComplexityReport,
  ComplexityThresholds,
  ContractComplexityMetrics,
  EntryPointComplexity,
  ExternalCallResourceMetrics,
  OverloadFinding,
  Severity,
  StorageResourceMetrics,
} from './types';

export const DEFAULT_THRESHOLDS: ComplexityThresholds = {
  maxCyclomaticComplexity: 10,
  maxCognitiveComplexity: 15,
  maxLinesOfCode: 50,
  maxStorageOperations: 5,
  maxStorageWrites: 3,
  maxExternalCalls: 3,
  maxParameters: 6,
  maxOverloadScore: 65,
};

export class SorobanComplexityAnalyzer {
  private thresholds: ComplexityThresholds;

  constructor(thresholds?: Partial<ComplexityThresholds>) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(thresholds ?? {}) };
  }

  /**
   * Analyze complexity and resource usage for all entry points in a Soroban contract.
   */
  public analyze(source: string, filePath = 'contract.rs'): ComplexityReport {
    const masked = maskNonCode(source);
    const lineOf = createLineResolver(source);
    const contractName = this.detectContractName(source);
    const functionBlocks = extractFunctionBlocks(masked, source);

    const entryPoints: EntryPointComplexity[] = [];

    for (const block of functionBlocks) {
      const ep = this.analyzeFunctionComplexity(block, source, masked, lineOf);
      entryPoints.push(ep);
    }

    const overloadedEntryPoints = entryPoints.filter((e) => e.isOverloaded);
    const allFindings: OverloadFinding[] = [];
    entryPoints.forEach((e) => allFindings.push(...e.findings));

    const aggregateMetrics = this.calculateAggregateMetrics(entryPoints);
    const summary = this.generateSummary(contractName, entryPoints, overloadedEntryPoints, aggregateMetrics);

    return {
      contractName,
      filePath,
      entryPoints,
      overloadedEntryPoints,
      totalEntryPoints: entryPoints.length,
      overloadedCount: overloadedEntryPoints.length,
      findings: allFindings,
      aggregateMetrics,
      thresholds: this.thresholds,
      summary,
      generatedAt: new Date(),
    };
  }

  /**
   * Analyze complexity and resource consumption for a single function block.
   */
  private analyzeFunctionComplexity(
    block: FunctionBlock,
    source: string,
    masked: string,
    lineOf: (offset: number) => number,
  ): EntryPointComplexity {
    const rawBody = source.slice(block.bodyStart, block.bodyEnd);
    const maskedBody = masked.slice(block.bodyStart, block.bodyEnd);
    const lineEnd = lineOf(block.bodyEnd);

    // Signature inspection
    const precedingSource = source.slice(0, block.bodyStart);
    const sigInfo = this.inspectSignature(precedingSource, block.line);
    const isExported = sigInfo.isPublic || this.isInContractImpl(source, block.bodyStart);
    const visibility = sigInfo.isConstructor
      ? 'constructor'
      : sigInfo.isPublic || isExported
      ? 'public'
      : 'internal';

    // 1. Measure Control Flow & Structural Complexity
    const metrics = this.measureComplexityMetrics(rawBody, maskedBody, sigInfo.parameterCount);

    // 2. Track Storage Resource Operations
    const storage = this.trackStorageOperations(block, source, masked, maskedBody);

    // 3. Track External & Cross-Contract Calls
    const externalCalls = this.trackExternalCalls(block, source, masked, maskedBody);

    // 4. Compute Composite Overload Score
    const overloadScore = this.computeOverloadScore(metrics, storage, externalCalls);

    // 5. Evaluate Thresholds & Generate Findings
    const findings: OverloadFinding[] = [];
    const overloadReasons: string[] = [];
    const recommendations: string[] = [];

    this.evaluateThresholds(
      block.name,
      block.line,
      metrics,
      storage,
      externalCalls,
      overloadScore,
      findings,
      overloadReasons,
      recommendations,
    );

    const isOverloaded = overloadReasons.length > 0;

    return {
      name: block.name,
      visibility,
      isExported,
      line: block.line,
      lineEnd,
      metrics,
      storage,
      externalCalls,
      overloadScore,
      isOverloaded,
      overloadReasons,
      findings,
      recommendations,
    };
  }

  /**
   * Measure cyclomatic complexity, cognitive complexity, lines of code, and branching metrics.
   */
  private measureComplexityMetrics(
    rawBody: string,
    maskedBody: string,
    parameterCount: number,
  ): ComplexityMetrics {
    const rawLines = rawBody.split('\n');
    // Lines of code excluding empty lines and comment-only lines
    const linesOfCode = rawLines.filter((l) => l.trim().length > 0).length;

    // Statement count approximated by semicolons and trailing expressions
    const semicolonMatches = maskedBody.match(/;/g) ?? [];
    const statementsCount = semicolonMatches.length + 1;

    // McCabe Cyclomatic Complexity:
    // Base complexity = 1
    // +1 for every conditional branch: if, else if, match arm (=>), while, for, loop
    // +1 for boolean operators: &&, ||
    // +1 for error-propagation operator: ?
    let cyclomaticComplexity = 1;
    let decisionPointsCount = 0;
    let branchCount = 0;
    let loopCount = 0;

    // Match branches
    const ifMatches = maskedBody.match(/\bif\b/g) ?? [];
    const matchArms = maskedBody.match(/=>/g) ?? [];
    branchCount = ifMatches.length + matchArms.length;

    // Match loops
    const forMatches = maskedBody.match(/\bfor\s+[^{]+\bin\b/g) ?? [];
    const whileMatches = maskedBody.match(/\bwhile\b/g) ?? [];
    const loopMatches = maskedBody.match(/\bloop\s*\{/g) ?? [];
    loopCount = forMatches.length + whileMatches.length + loopMatches.length;

    // Boolean operators & error propagation
    const andMatches = maskedBody.match(/&&/g) ?? [];
    const orMatches = maskedBody.match(/\|\|/g) ?? [];
    const tryOpMatches = maskedBody.match(/\?[^;)]*[;)]/g) ?? [];

    decisionPointsCount =
      branchCount + loopCount + andMatches.length + orMatches.length + tryOpMatches.length;
    cyclomaticComplexity += decisionPointsCount;

    // Cognitive Complexity & Nesting Depth:
    // Tracks brace depth and adds incremental nesting penalties to decision structures
    let cognitiveComplexity = 0;
    let currentNesting = 0;
    let nestingDepthMax = 0;

    for (let i = 0; i < maskedBody.length; i++) {
      const ch = maskedBody[i];
      if (ch === '{') {
        currentNesting++;
        if (currentNesting > nestingDepthMax) {
          nestingDepthMax = currentNesting;
        }
      } else if (ch === '}') {
        if (currentNesting > 0) currentNesting--;
      }
    }

    // Cognitive calculation: nesting penalty added at decision sites
    const decisionPattern = /\b(if|else\s+if|for|while|loop)\b|=>/g;
    let dm: RegExpExecArray | null;
    while ((dm = decisionPattern.exec(maskedBody)) !== null) {
      const preceding = maskedBody.slice(0, dm.index);
      let depth = 0;
      for (const c of preceding) {
        if (c === '{') depth++;
        else if (c === '}') depth = Math.max(0, depth - 1);
      }
      cognitiveComplexity += 1 + Math.max(0, depth - 1);
    }

    return {
      cyclomaticComplexity,
      cognitiveComplexity,
      linesOfCode,
      statementsCount,
      decisionPointsCount,
      branchCount,
      loopCount,
      nestingDepthMax,
      parameterCount,
    };
  }

  /**
   * Track storage operations (reads, writes, TTLs, unique keys, storage in loops).
   */
  private trackStorageOperations(
    block: FunctionBlock,
    source: string,
    masked: string,
    maskedBody: string,
  ): StorageResourceMetrics {
    let readsCount = 0;
    let writesCount = 0;
    let ttlExtensionsCount = 0;
    let instanceOps = 0;
    let persistentOps = 0;
    let temporaryOps = 0;
    let storageInLoopsCount = 0;
    const uniqueKeys = new Set<string>();

    const storageRe =
      /\bstorage\s*\(\s*\)\s*\.\s*(instance|persistent|temporary)\s*\(\s*\)\s*\.\s*(get|set|has|get_unchecked|put|extend_ttl|update_ttl)\s*\(/g;
    let m: RegExpExecArray | null;

    while ((m = storageRe.exec(maskedBody)) !== null) {
      const kind = m[1];
      const op = m[2];
      const isWrite = op === 'set' || op === 'put';
      const isTtl = op === 'extend_ttl' || op === 'update_ttl';

      const absOffset = block.bodyStart + m.index;
      const stack = blockStackAt(masked, block.bodyStart, absOffset);
      if (isInLoop(stack)) {
        storageInLoopsCount++;
      }

      if (kind === 'instance') instanceOps++;
      else if (kind === 'persistent') persistentOps++;
      else if (kind === 'temporary') temporaryOps++;

      if (isTtl) {
        ttlExtensionsCount++;
      } else if (isWrite) {
        writesCount++;
      } else {
        readsCount++;
      }

      // Extract storage key
      const openParen = absOffset + m[0].length - 1;
      const rawArg = this.extractFirstArgument(source, openParen);
      if (rawArg) {
        uniqueKeys.add(normalizeExpr(rawArg));
      }
    }

    const totalStorageOperations = readsCount + writesCount + ttlExtensionsCount;

    return {
      totalStorageOperations,
      readsCount,
      writesCount,
      ttlExtensionsCount,
      instanceOps,
      persistentOps,
      temporaryOps,
      uniqueKeysCount: uniqueKeys.size,
      uniqueKeys: Array.from(uniqueKeys),
      storageInLoopsCount,
    };
  }

  /**
   * Track external and cross-contract call invocations.
   */
  private trackExternalCalls(
    block: FunctionBlock,
    source: string,
    masked: string,
    maskedBody: string,
  ): ExternalCallResourceMetrics {
    let crossContractInvocations = 0;
    let clientInvocations = 0;
    let tokenTransfers = 0;
    let tokenStateMutations = 0;
    let balanceQueries = 0;
    let callsInLoopsCount = 0;
    const targets = new Set<string>();

    // 1. Raw invoke_contract
    const invokeRe = /\benv\s*\.\s*(invoke_contract|try_invoke_contract)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = invokeRe.exec(maskedBody)) !== null) {
      crossContractInvocations++;
      const absOffset = block.bodyStart + m.index;
      const stack = blockStackAt(masked, block.bodyStart, absOffset);
      if (isInLoop(stack)) callsInLoopsCount++;

      const openParen = absOffset + m[0].length - 1;
      const targetArg = this.extractFirstArgument(source, openParen);
      if (targetArg) targets.add(normalizeExpr(targetArg));
    }

    // 2. Typed Client calls
    const clientNewRe = /([A-Za-z0-9_]+Client)\s*::\s*new\s*\(/g;
    while ((m = clientNewRe.exec(maskedBody)) !== null) {
      clientInvocations++;
      const clientName = m[1];
      targets.add(clientName);
      const absOffset = block.bodyStart + m.index;
      const stack = blockStackAt(masked, block.bodyStart, absOffset);
      if (isInLoop(stack)) callsInLoopsCount++;
    }

    // 3. Token operations
    const tokenOpRe =
      /([A-Za-z0-9_]+)\s*\.\s*(transfer|transfer_from|balance|spendable_balance|mint|burn|clawback|approve)\s*\(/g;
    while ((m = tokenOpRe.exec(maskedBody)) !== null) {
      const receiver = m[1];
      const op = m[2];
      targets.add(receiver);

      const absOffset = block.bodyStart + m.index;
      const stack = blockStackAt(masked, block.bodyStart, absOffset);
      if (isInLoop(stack)) callsInLoopsCount++;

      if (op === 'transfer' || op === 'transfer_from') {
        tokenTransfers++;
      } else if (op === 'balance' || op === 'spendable_balance') {
        balanceQueries++;
      } else {
        tokenStateMutations++;
      }
    }

    const totalCalls = crossContractInvocations + clientInvocations + tokenTransfers + tokenStateMutations + balanceQueries;

    return {
      totalCalls,
      crossContractInvocations,
      clientInvocations,
      tokenTransfers,
      tokenStateMutations,
      balanceQueries,
      callsInLoopsCount,
      distinctTargetsCount: targets.size,
      targets: Array.from(targets),
    };
  }

  /**
   * Compute composite overload score (0–100) based on weighted metrics.
   */
  private computeOverloadScore(
    metrics: ComplexityMetrics,
    storage: StorageResourceMetrics,
    externalCalls: ExternalCallResourceMetrics,
  ): number {
    const t = this.thresholds;

    // Weighted component scores (each capped at sensible maximums)
    const cyclomaticWeight = Math.min(30, (metrics.cyclomaticComplexity / t.maxCyclomaticComplexity) * 25);
    const cognitiveWeight = Math.min(25, (metrics.cognitiveComplexity / t.maxCognitiveComplexity) * 20);
    const locWeight = Math.min(20, (metrics.linesOfCode / t.maxLinesOfCode) * 15);
    const storageWeight = Math.min(25, (storage.totalStorageOperations / t.maxStorageOperations) * 20);
    const callsWeight = Math.min(25, (externalCalls.totalCalls / t.maxExternalCalls) * 20);

    // Hazard penalties: operations inside loops severely inflate execution load
    let hazardPenalty = 0;
    if (storage.storageInLoopsCount > 0) hazardPenalty += 15;
    if (externalCalls.callsInLoopsCount > 0) hazardPenalty += 20;
    if (storage.writesCount >= t.maxStorageWrites) hazardPenalty += 10;
    if (metrics.parameterCount > t.maxParameters) hazardPenalty += 10;

    const rawScore = cyclomaticWeight + cognitiveWeight + locWeight + storageWeight + callsWeight + hazardPenalty;
    return Math.min(100, Math.round(rawScore));
  }

  /**
   * Evaluate thresholds against measured metrics and populate findings and reasons.
   */
  private evaluateThresholds(
    name: string,
    line: number,
    metrics: ComplexityMetrics,
    storage: StorageResourceMetrics,
    externalCalls: ExternalCallResourceMetrics,
    overloadScore: number,
    findings: OverloadFinding[],
    overloadReasons: string[],
    recommendations: string[],
  ): void {
    const t = this.thresholds;

    // 1. Cyclomatic Complexity Threshold
    if (metrics.cyclomaticComplexity > t.maxCyclomaticComplexity) {
      const severity: Severity = metrics.cyclomaticComplexity > t.maxCyclomaticComplexity * 1.5 ? 'critical' : 'high';
      overloadReasons.push(`Cyclomatic complexity (${metrics.cyclomaticComplexity}) exceeds threshold (${t.maxCyclomaticComplexity})`);
      findings.push({
        ruleId: 'soroban-overloaded-entry-point',
        entryPointName: name,
        dimension: 'control_flow',
        severity,
        line,
        metricValue: metrics.cyclomaticComplexity,
        threshold: t.maxCyclomaticComplexity,
        message: `Entry point '${name}' is overloaded with high cyclomatic complexity (${metrics.cyclomaticComplexity} > ${t.maxCyclomaticComplexity}).`,
        suggestion: `Refactor branching paths and conditional logic into private helper functions.`,
      });
      recommendations.push('Extract nested conditional branches into dedicated helper functions.');
    }

    // 2. Cognitive Complexity Threshold
    if (metrics.cognitiveComplexity > t.maxCognitiveComplexity) {
      overloadReasons.push(`Cognitive complexity (${metrics.cognitiveComplexity}) exceeds threshold (${t.maxCognitiveComplexity})`);
      findings.push({
        ruleId: 'soroban-overloaded-entry-point',
        entryPointName: name,
        dimension: 'control_flow',
        severity: 'high',
        line,
        metricValue: metrics.cognitiveComplexity,
        threshold: t.maxCognitiveComplexity,
        message: `Entry point '${name}' has high cognitive complexity (${metrics.cognitiveComplexity} > ${t.maxCognitiveComplexity}) due to deep nesting.`,
        suggestion: `Flatten nested control flow with early returns and guard clauses.`,
      });
      recommendations.push('Use guard clauses with early returns to reduce nesting depth.');
    }

    // 3. Lines of Code Threshold
    if (metrics.linesOfCode > t.maxLinesOfCode) {
      overloadReasons.push(`Lines of code (${metrics.linesOfCode}) exceeds threshold (${t.maxLinesOfCode})`);
      findings.push({
        ruleId: 'soroban-overloaded-entry-point',
        entryPointName: name,
        dimension: 'code_size',
        severity: 'medium',
        line,
        metricValue: metrics.linesOfCode,
        threshold: t.maxLinesOfCode,
        message: `Entry point '${name}' exceeds maximum recommended size (${metrics.linesOfCode} lines > ${t.maxLinesOfCode}).`,
        suggestion: `Decompose long function body into modular single-responsibility units.`,
      });
      recommendations.push('Decompose the entry point body into focused helper methods.');
    }

    // 4. Excessive Storage Operations Threshold
    if (storage.totalStorageOperations > t.maxStorageOperations) {
      const severity: Severity = storage.writesCount > t.maxStorageWrites ? 'high' : 'medium';
      overloadReasons.push(`Storage operations (${storage.totalStorageOperations}) exceeds threshold (${t.maxStorageOperations})`);
      findings.push({
        ruleId: 'soroban-overloaded-entry-point',
        entryPointName: name,
        dimension: 'storage_operations',
        severity,
        line,
        metricValue: storage.totalStorageOperations,
        threshold: t.maxStorageOperations,
        message: `Entry point '${name}' executes ${storage.totalStorageOperations} storage operations (${storage.writesCount} writes, ${storage.readsCount} reads).`,
        suggestion: `Consolidate storage keys into a single composite struct or cache query results locally.`,
      });
      recommendations.push('Batch multiple storage entries into composite structs to reduce I/O overhead.');
    }

    // 5. Excessive Storage Writes
    if (storage.writesCount > t.maxStorageWrites) {
      overloadReasons.push(`Storage writes (${storage.writesCount}) exceeds write threshold (${t.maxStorageWrites})`);
      findings.push({
        ruleId: 'soroban-overloaded-entry-point',
        entryPointName: name,
        dimension: 'storage_operations',
        severity: 'high',
        line,
        metricValue: storage.writesCount,
        threshold: t.maxStorageWrites,
        message: `Entry point '${name}' performs ${storage.writesCount} state modifications, exceeding write limit (${t.maxStorageWrites}).`,
        suggestion: `Combine related state modifications into a single write call.`,
      });
    }

    // 6. Excessive External Calls Threshold
    if (externalCalls.totalCalls > t.maxExternalCalls) {
      overloadReasons.push(`External calls (${externalCalls.totalCalls}) exceeds threshold (${t.maxExternalCalls})`);
      findings.push({
        ruleId: 'soroban-overloaded-entry-point',
        entryPointName: name,
        dimension: 'external_calls',
        severity: 'high',
        line,
        metricValue: externalCalls.totalCalls,
        threshold: t.maxExternalCalls,
        message: `Entry point '${name}' performs ${externalCalls.totalCalls} external/cross-contract calls across ${externalCalls.distinctTargetsCount} target(s).`,
        suggestion: `Minimize cross-contract interactions or delegate multi-contract coordination to an external router.`,
      });
      recommendations.push('Reduce or batch cross-contract calls to prevent excessive transaction execution limits.');
    }

    // 7. Excessive Parameter Count Threshold
    if (metrics.parameterCount > t.maxParameters) {
      overloadReasons.push(`Parameter count (${metrics.parameterCount}) exceeds threshold (${t.maxParameters})`);
      findings.push({
        ruleId: 'soroban-overloaded-entry-point',
        entryPointName: name,
        dimension: 'parameter_count',
        severity: 'medium',
        line,
        metricValue: metrics.parameterCount,
        threshold: t.maxParameters,
        message: `Entry point '${name}' accepts ${metrics.parameterCount} parameters, exceeding the threshold (${t.maxParameters}).`,
        suggestion: `Group related parameters into a custom argument struct to simplify the interface and invocation ABI.`,
      });
      recommendations.push('Bundle related function parameters into a single configuration or argument struct.');
    }

    // 8. Overall Composite Overload Score
    if (overloadScore >= t.maxOverloadScore && findings.length === 0) {
      overloadReasons.push(`Composite overload score (${overloadScore}) exceeds threshold (${t.maxOverloadScore})`);
      findings.push({
        ruleId: 'soroban-overloaded-entry-point',
        entryPointName: name,
        dimension: 'control_flow',
        severity: 'high',
        line,
        metricValue: overloadScore,
        threshold: t.maxOverloadScore,
        message: `Entry point '${name}' handles excessive cumulative responsibilities (Overload Score: ${overloadScore}/100).`,
        suggestion: `Split multi-step workflows across dedicated entry points or helper contracts.`,
      });
    }
  }

  private extractFirstArgument(source: string, openParenIdx: number): string | null {
    let depth = 0;
    for (let i = openParenIdx; i < source.length; i++) {
      const ch = source[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          const content = source.slice(openParenIdx + 1, i);
          const args = splitArgs(content);
          return args[0] ?? null;
        }
      }
    }
    return null;
  }

  private inspectSignature(
    precedingSource: string,
    fnLine: number,
  ): { isPublic: boolean; isConstructor: boolean; parameterCount: number } {
    const lines = precedingSource.split('\n');
    const targetIdx = fnLine - 1;
    const sigLines: string[] = [];

    if (targetIdx < lines.length) {
      for (let i = targetIdx; i < lines.length; i++) {
        sigLines.push(lines[i]);
        if (lines[i].includes('{') || lines[i].includes(';')) break;
      }
    }

    const fullSig = sigLines.join(' ').replace(/\s+/g, ' ').trim();
    const isPublic = /\bpub(?:\([^)]*\))?\s+fn\b/.test(fullSig);

    const fnMatch = fullSig.match(/\bfn\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/);
    const name = fnMatch ? fnMatch[1] : '';
    const isConstructor = name === 'new' || name === 'init' || name === 'initialize';

    const rawParams = fnMatch ? fnMatch[2] ?? '' : '';
    const paramList = splitArgs(rawParams).filter(
      (p) => p !== 'self' && p !== '&self' && p !== '&mut self',
    );

    return {
      isPublic,
      isConstructor,
      parameterCount: paramList.length,
    };
  }

  private isInContractImpl(source: string, bodyStart: number): boolean {
    const preceding = source.slice(0, bodyStart);
    const contractImplIdx = preceding.lastIndexOf('#[contractimpl]');
    if (contractImplIdx === -1) return false;

    const slice = preceding.slice(contractImplIdx);
    let depth = 0;
    for (const ch of slice) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    return depth > 0;
  }

  private detectContractName(source: string): string {
    const structMatch = source.match(/#\[contract\]\s*(?:pub\s+)?struct\s+([A-Za-z0-9_]+)/);
    if (structMatch) return structMatch[1];
    const implMatch = source.match(/impl\s+([A-Za-z0-9_]+)/);
    if (implMatch) return implMatch[1];
    return 'SorobanContract';
  }

  private calculateAggregateMetrics(entryPoints: EntryPointComplexity[]): ContractComplexityMetrics {
    if (entryPoints.length === 0) {
      return {
        totalEntryPoints: 0,
        overloadedCount: 0,
        averageCyclomaticComplexity: 0,
        averageCognitiveComplexity: 0,
        averageLinesOfCode: 0,
        totalStorageOperations: 0,
        totalStorageWrites: 0,
        totalExternalCalls: 0,
        maxOverloadScore: 0,
      };
    }

    const totalCyclomatic = entryPoints.reduce((acc, e) => acc + e.metrics.cyclomaticComplexity, 0);
    const totalCognitive = entryPoints.reduce((acc, e) => acc + e.metrics.cognitiveComplexity, 0);
    const totalLoc = entryPoints.reduce((acc, e) => acc + e.metrics.linesOfCode, 0);
    const totalStorage = entryPoints.reduce((acc, e) => acc + e.storage.totalStorageOperations, 0);
    const totalWrites = entryPoints.reduce((acc, e) => acc + e.storage.writesCount, 0);
    const totalCalls = entryPoints.reduce((acc, e) => acc + e.externalCalls.totalCalls, 0);
    const maxScore = Math.max(...entryPoints.map((e) => e.overloadScore));

    const mostComplex = [...entryPoints].sort((a, b) => b.overloadScore - a.overloadScore)[0];

    return {
      totalEntryPoints: entryPoints.length,
      overloadedCount: entryPoints.filter((e) => e.isOverloaded).length,
      averageCyclomaticComplexity: Math.round((totalCyclomatic / entryPoints.length) * 10) / 10,
      averageCognitiveComplexity: Math.round((totalCognitive / entryPoints.length) * 10) / 10,
      averageLinesOfCode: Math.round(totalLoc / entryPoints.length),
      totalStorageOperations: totalStorage,
      totalStorageWrites: totalWrites,
      totalExternalCalls: totalCalls,
      maxOverloadScore: maxScore,
      mostComplexEntryPoint: mostComplex,
    };
  }

  private generateSummary(
    contractName: string,
    entryPoints: EntryPointComplexity[],
    overloaded: EntryPointComplexity[],
    metrics: ContractComplexityMetrics,
  ): string {
    if (entryPoints.length === 0) {
      return `No entry points identified in contract '${contractName}'.`;
    }

    let summary = `Contract '${contractName}' has ${entryPoints.length} entry point(s). `;
    summary += `Average cyclomatic complexity: ${metrics.averageCyclomaticComplexity}, average lines of code: ${metrics.averageLinesOfCode}. `;

    if (overloaded.length > 0) {
      summary += `⚠️ Detected ${overloaded.length} overloaded entry point(s) handling excessive responsibilities: `;
      summary += overloaded.map((o) => `'${o.name}' (Score: ${o.overloadScore})`).join(', ') + '.';
    } else {
      summary += `All entry points are well-sized and maintain acceptable complexity and resource bounds.`;
    }

    return summary;
  }
}

/**
 * Convenience function to analyze Soroban entry point complexity.
 */
export function analyzeEntryPointComplexity(
  source: string,
  filePath = 'contract.rs',
  thresholds?: Partial<ComplexityThresholds>,
): ComplexityReport {
  const analyzer = new SorobanComplexityAnalyzer(thresholds);
  return analyzer.analyze(source, filePath);
}
