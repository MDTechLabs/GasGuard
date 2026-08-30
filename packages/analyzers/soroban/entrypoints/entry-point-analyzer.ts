/**
 * Issue #903 — Soroban Contract Entry-Point Analyzer
 *
 * Implements static analysis for Soroban smart contracts to identify all public
 * and externally accessible entry points, extract function signatures and parameters,
 * track authorization paths and coverage, and monitor storage accesses and external calls.
 */

import {
  maskNonCode,
  createLineResolver,
  extractFunctions as extractFunctionBlocks,
  FunctionBlock,
  blockStackAt,
  isInLoop,
  isInBranch,
  splitArgs,
  normalizeExpr,
} from '../common/source-utils';

import {
  AuthCheck,
  AuthCheckType,
  AuthorizationSummary,
  ContractBlockType,
  EntryPoint,
  EntryPointAggregateMetrics,
  EntryPointAnalysisReport,
  EntryPointAnalyzerConfig,
  EntryPointFinding,
  EntryPointParameter,
  ExternalCall,
  ExternalCallSummary,
  ExternalCallType,
  FunctionVisibility,
  RiskLevel,
  Severity,
  StorageAccess,
  StorageKind,
  StorageOperation,
  StorageSummary,
} from './types';

export const DEFAULT_CONFIG: EntryPointAnalyzerConfig = {
  includeInternal: true,
  checkMissingAuth: true,
  checkCallsInLoops: true,
  checkStorageInLoops: true,
  checkAuthInLoops: true,
  checkUnusedParams: true,
};

interface ContractBlockInfo {
  type: ContractBlockType;
  contractName: string;
  traitName?: string;
  startOffset: number;
  endOffset: number;
}

export class SorobanEntryPointAnalyzer {
  private config: EntryPointAnalyzerConfig;

  constructor(config?: Partial<EntryPointAnalyzerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  }

  /**
   * Main entry point to analyze a Soroban contract source file.
   */
  public analyze(source: string, filePath = 'contract.rs'): EntryPointAnalysisReport {
    const masked = maskNonCode(source);
    const lineOf = createLineResolver(source);
    const contractName = this.detectContractName(source);
    const contractBlocks = this.detectContractBlocks(source, masked);
    const functionBlocks = extractFunctionBlocks(masked, source);

    const entryPoints: EntryPoint[] = [];

    for (const block of functionBlocks) {
      const ep = this.analyzeSingleFunction(block, source, masked, lineOf, contractBlocks, contractName);
      if (ep) {
        if (this.config.includeInternal || ep.isExported || ep.visibility === 'public' || ep.visibility === 'constructor') {
          entryPoints.push(ep);
        }
      }
    }

    const publicEntryPoints = entryPoints.filter((e) => e.isExported || e.visibility === 'public');
    const constructorEntryPoints = entryPoints.filter((e) => e.visibility === 'constructor' || e.isConstructorOrInit);
    const internalFunctions = entryPoints.filter((e) => !e.isExported && e.visibility !== 'public' && e.visibility !== 'constructor');

    const allFindings: EntryPointFinding[] = [];
    entryPoints.forEach((ep) => allFindings.push(...ep.findings));

    const metrics = this.calculateAggregateMetrics(entryPoints);
    const summary = this.generateExecutiveSummary(contractName, entryPoints, metrics, allFindings);

    return {
      contractName,
      filePath,
      entryPoints,
      publicEntryPoints,
      constructorEntryPoints,
      internalFunctions,
      findings: allFindings,
      metrics,
      summary,
      generatedAt: new Date(),
    };
  }

  /**
   * Analyze an individual function into a rich EntryPoint structure.
   */
  private analyzeSingleFunction(
    block: FunctionBlock,
    source: string,
    masked: string,
    lineOf: (offset: number) => number,
    contractBlocks: ContractBlockInfo[],
    defaultContractName: string,
  ): EntryPoint | null {
    const rawBody = source.slice(block.bodyStart, block.bodyEnd);
    const maskedBody = masked.slice(block.bodyStart, block.bodyEnd);
    const bodyLines = rawBody.split('\n').length;
    const lineEnd = lineOf(block.bodyEnd);

    // Enclosing contract block
    const enclosingBlock = this.findEnclosingBlock(block.bodyStart, contractBlocks);
    const contractBlockType: ContractBlockType = enclosingBlock ? enclosingBlock.type : 'standalone';
    const contractName = enclosingBlock ? enclosingBlock.contractName : defaultContractName;
    const traitName = enclosingBlock?.traitName;

    // Parse signature and doc comments preceding function
    const precedingSource = source.slice(0, block.bodyStart);
    const fnDefMatch = this.extractFunctionSignature(precedingSource, block.line);
    const signature = fnDefMatch ? fnDefMatch.fullSignature : `fn ${block.name}()`;
    const docComment = this.extractDocComment(source, block.line);

    // Visibility & constructor detection
    const isTraitImpl = contractBlockType === 'impl_trait' || contractBlockType === 'pub_trait';
    const isExplicitPub = fnDefMatch ? fnDefMatch.isPublic : false;
    const isConstructor = this.isConstructorName(block.name);

    // In Rust / Soroban, methods in `impl Trait for Contract` or marked `pub fn` are exported
    // Non-pub fn in #[contractimpl] or impl Contract are internal helper methods
    const isExported = isConstructor || isTraitImpl || isExplicitPub;
    const visibility: FunctionVisibility = isConstructor
      ? 'constructor'
      : isTraitImpl || isExplicitPub
      ? 'public'
      : 'internal';

    // Parameters
    const rawParams = fnDefMatch ? fnDefMatch.rawParameters : '';
    const parameters = this.parseParameters(rawParams, block.line, rawBody);
    const returnType = fnDefMatch ? fnDefMatch.returnType : null;

    // Sub-analyses
    const authorization = this.analyzeAuthorization(block, source, masked, lineOf, parameters, rawBody, maskedBody);
    const storage = this.analyzeStorage(block, source, masked, lineOf, rawBody, maskedBody);
    const externalCalls = this.analyzeExternalCalls(block, source, masked, lineOf, rawBody, maskedBody);

    // Check state mutation: storage writes, token transfers, mint/burn
    const isStateMutating =
      storage.writesCount > 0 ||
      storage.ttlExtensionsCount > 0 ||
      externalCalls.tokenTransfers > 0 ||
      externalCalls.tokenStateMutations > 0;
    const isReadOnly = !isStateMutating && (storage.readsCount > 0 || externalCalls.balanceQueries > 0 || !externalCalls.totalCalls);
    const isConstructorOrInit = isConstructor;

    // Findings & Risk
    const findings: EntryPointFinding[] = [];
    this.evaluateFindings(
      block.name,
      block.line,
      visibility,
      isExported,
      parameters,
      authorization,
      storage,
      externalCalls,
      isStateMutating,
      findings,
    );

    const { riskScore, riskLevel } = this.calculateRiskScore(
      visibility,
      isExported,
      isStateMutating,
      authorization,
      storage,
      externalCalls,
      findings,
    );

    return {
      name: block.name,
      visibility,
      isExported,
      contractBlockType,
      contractName,
      traitName,
      lineNumber: block.line,
      lineEnd,
      bodyLines,
      signature,
      docComment,
      parameters,
      returnType,
      authorization,
      storage,
      externalCalls,
      isStateMutating,
      isReadOnly,
      isConstructorOrInit,
      findings,
      riskScore,
      riskLevel,
    };
  }

  /**
   * Parse parameters into typed EntryPointParameter objects.
   */
  private parseParameters(paramString: string, baseLine: number, body: string): EntryPointParameter[] {
    if (!paramString.trim()) return [];

    const rawList = splitArgs(paramString);
    const results: EntryPointParameter[] = [];

    for (const raw of rawList) {
      if (raw === 'self' || raw === '&self' || raw === '&mut self') continue;

      const colonIdx = raw.indexOf(':');
      if (colonIdx === -1) continue;

      let rawName = raw.slice(0, colonIdx).trim();
      const rawType = raw.slice(colonIdx + 1).trim();

      const isMutable = rawName.startsWith('mut ');
      if (isMutable) rawName = rawName.slice(4).trim();

      const isEnv = /\bEnv\b/.test(rawType);
      const isAddress = /\bAddress\b/.test(rawType);
      const isCollection = /\b(Vec|Map|Bytes|BytesN|Symbol|String|Set)\b/.test(rawType);
      const isReference = rawType.startsWith('&');
      const isOptional = /\bOption<.*>/.test(rawType);

      // Check if parameter identifier is referenced within the function body
      const nameRegex = new RegExp(`\\b${this.escapeRegex(rawName)}\\b`, 'g');
      const occurrences = (body.match(nameRegex) ?? []).length;
      const isUnused = occurrences === 0 && !rawName.startsWith('_');

      results.push({
        name: rawName,
        type: rawType,
        isEnv,
        isAddress,
        isAuthParam: false, // Updated during authorization analysis
        isCollection,
        isMutable,
        isReference,
        isOptional,
        line: baseLine,
        isUnused,
      });
    }

    return results;
  }

  /**
   * Analyze authorization paths, authorized parameters, and missing/redundant checks.
   */
  private analyzeAuthorization(
    fnBlock: FunctionBlock,
    source: string,
    masked: string,
    lineOf: (offset: number) => number,
    parameters: EntryPointParameter[],
    rawBody: string,
    maskedBody: string,
  ): AuthorizationSummary {
    const checks: AuthCheck[] = [];
    const authorizedParams = new Set<string>();

    // 1. require_auth checks e.g. caller.require_auth()
    const requireAuthRe = /([A-Za-z0-9_]+)\s*\.\s*require_auth\s*\(\s*\)/g;
    let m: RegExpExecArray | null;

    while ((m = requireAuthRe.exec(maskedBody)) !== null) {
      const target = m[1];
      const checkOffset = fnBlock.bodyStart + m.index;
      const stack = blockStackAt(masked, fnBlock.bodyStart, checkOffset);
      const inLoop = isInLoop(stack);
      const inBranch = isInBranch(stack);

      checks.push({
        type: 'require_auth',
        target,
        line: lineOf(checkOffset),
        offset: checkOffset,
        isInLoop: inLoop,
        isInBranch: inBranch,
      });
      authorizedParams.add(target);
    }

    // 2. require_auth_for_args checks e.g. caller.require_auth_for_args(...)
    const requireAuthArgsRe = /([A-Za-z0-9_]+)\s*\.\s*require_auth_for_args\s*\(/g;
    while ((m = requireAuthArgsRe.exec(maskedBody)) !== null) {
      const target = m[1];
      const checkOffset = fnBlock.bodyStart + m.index;
      const stack = blockStackAt(masked, fnBlock.bodyStart, checkOffset);
      const inLoop = isInLoop(stack);
      const inBranch = isInBranch(stack);

      // Extract arguments passed
      const openParen = checkOffset + m[0].length - 1;
      const rawArgs = this.extractParens(source, openParen);

      checks.push({
        type: 'require_auth_for_args',
        target,
        args: rawArgs ? splitArgs(rawArgs) : [],
        line: lineOf(checkOffset),
        offset: checkOffset,
        isInLoop: inLoop,
        isInBranch: inBranch,
      });
      authorizedParams.add(target);
    }

    // 3. auth.authenticate / invoker checks
    const authAuthenticateRe = /([A-Za-z0-9_]+)\s*\.\s*authenticate\s*\(/g;
    while ((m = authAuthenticateRe.exec(maskedBody)) !== null) {
      const target = m[1];
      const checkOffset = fnBlock.bodyStart + m.index;
      const stack = blockStackAt(masked, fnBlock.bodyStart, checkOffset);

      checks.push({
        type: 'auth_authenticate',
        target,
        line: lineOf(checkOffset),
        offset: checkOffset,
        isInLoop: isInLoop(stack),
        isInBranch: isInBranch(stack),
      });
      authorizedParams.add(target);
    }

    // 4. invoker() or env.require_auth()
    const invokerRe = /env\s*\.\s*require_auth\s*\(\s*&?([A-Za-z0-9_]+)/g;
    while ((m = invokerRe.exec(maskedBody)) !== null) {
      const target = m[1];
      const checkOffset = fnBlock.bodyStart + m.index;
      const stack = blockStackAt(masked, fnBlock.bodyStart, checkOffset);

      checks.push({
        type: 'invoker',
        target,
        line: lineOf(checkOffset),
        offset: checkOffset,
        isInLoop: isInLoop(stack),
        isInBranch: isInBranch(stack),
      });
      authorizedParams.add(target);
    }

    // Mark isAuthParam on parameters
    const addressParams = parameters.filter((p) => p.isAddress);
    addressParams.forEach((param) => {
      if (authorizedParams.has(param.name)) {
        param.isAuthParam = true;
      }
    });

    const unauthorizedAddressParams = addressParams
      .filter((p) => !authorizedParams.has(p.name))
      .map((p) => p.name);

    const hasLoopAuth = checks.some((c) => c.isInLoop);

    // Redundant auth check: both require_auth and require_auth_for_args on same target
    const requireAuthTargets = new Set(checks.filter((c) => c.type === 'require_auth').map((c) => c.target));
    const requireAuthArgsTargets = new Set(checks.filter((c) => c.type === 'require_auth_for_args').map((c) => c.target));
    const hasRedundantAuth = [...requireAuthTargets].some((t) => requireAuthArgsTargets.has(t));

    // Missing required auth: if there are address parameters and state writes or token transfers happen,
    // but no authorization check was executed for any caller address
    const hasStateModification =
      /\bstorage\s*\(\s*\)\s*\.\s*(instance|persistent|temporary)\s*\(\s*\)\s*\.\s*(set|put|extend_ttl)\s*\(/.test(maskedBody) ||
      /\.(transfer|transfer_from|mint|burn|clawback)\s*\(/.test(maskedBody);

    const isMissingRequiredAuth = hasStateModification && addressParams.length > 0 && checks.length === 0;

    const authCoverage =
      addressParams.length > 0
        ? (addressParams.length - unauthorizedAddressParams.length) / addressParams.length
        : checks.length > 0
        ? 1.0
        : 1.0;

    return {
      hasAuthCheck: checks.length > 0,
      checks,
      authorizedParams: Array.from(authorizedParams),
      unauthorizedAddressParams,
      hasLoopAuth,
      hasRedundantAuth,
      isMissingRequiredAuth,
      authCoverage: Math.round(authCoverage * 100) / 100,
    };
  }

  /**
   * Analyze storage accesses (instance, persistent, temporary reads and writes).
   */
  private analyzeStorage(
    fnBlock: FunctionBlock,
    source: string,
    masked: string,
    lineOf: (offset: number) => number,
    rawBody: string,
    maskedBody: string,
  ): StorageSummary {
    const accesses: StorageAccess[] = [];
    const uniqueKeysAccessed = new Set<string>();
    const uniqueKeysWritten = new Set<string>();

    let instanceReads = 0;
    let instanceWrites = 0;
    let persistentReads = 0;
    let persistentWrites = 0;
    let temporaryReads = 0;
    let temporaryWrites = 0;
    let ttlExtensionsCount = 0;
    let storageInLoopsCount = 0;

    const storageRe =
      /\bstorage\s*\(\s*\)\s*\.\s*(instance|persistent|temporary)\s*\(\s*\)\s*\.\s*(get|set|has|get_unchecked|put|extend_ttl|update_ttl)\s*\(/g;
    let m: RegExpExecArray | null;

    while ((m = storageRe.exec(maskedBody)) !== null) {
      const storageKind = m[1] as StorageKind;
      const op = m[2];
      const isWrite = op === 'set' || op === 'put' || op === 'extend_ttl' || op === 'update_ttl';
      const isTtl = op === 'extend_ttl' || op === 'update_ttl';
      const accessType: 'read' | 'write' = isWrite ? 'write' : 'read';

      const accessOffset = fnBlock.bodyStart + m.index;
      const stack = blockStackAt(masked, fnBlock.bodyStart, accessOffset);
      const inLoop = isInLoop(stack);
      const inBranch = isInBranch(stack);

      if (inLoop) storageInLoopsCount++;

      // Extract storage key argument
      const openParen = accessOffset + m[0].length - 1;
      const rawArgs = this.extractParens(source, openParen);
      const keyArgs = rawArgs ? splitArgs(rawArgs) : [];
      const rawKey = keyArgs[0] ?? 'unknown';
      const key = normalizeExpr(rawKey);

      uniqueKeysAccessed.add(key);
      if (isWrite && !isTtl) uniqueKeysWritten.add(key);

      if (isTtl) {
        ttlExtensionsCount++;
      } else if (storageKind === 'instance') {
        if (isWrite) instanceWrites++;
        else instanceReads++;
      } else if (storageKind === 'persistent') {
        if (isWrite) persistentWrites++;
        else persistentReads++;
      } else if (storageKind === 'temporary') {
        if (isWrite) temporaryWrites++;
        else temporaryReads++;
      }

      accesses.push({
        storageKind,
        operation: op as StorageOperation,
        accessType,
        rawKey,
        key,
        line: lineOf(accessOffset),
        offset: accessOffset,
        isInLoop: inLoop,
        isInBranch: inBranch,
      });
    }

    const readsCount = instanceReads + persistentReads + temporaryReads;
    const writesCount = instanceWrites + persistentWrites + temporaryWrites;
    const isStateMutating = writesCount > 0 || ttlExtensionsCount > 0;

    return {
      readsCount,
      writesCount,
      ttlExtensionsCount,
      instanceReads,
      instanceWrites,
      persistentReads,
      persistentWrites,
      temporaryReads,
      temporaryWrites,
      uniqueKeysAccessed: Array.from(uniqueKeysAccessed),
      uniqueKeysWritten: Array.from(uniqueKeysWritten),
      accesses,
      storageInLoopsCount,
      isStateMutating,
    };
  }

  /**
   * Analyze external calls (cross-contract, contract clients, token transfers, balance queries).
   */
  private analyzeExternalCalls(
    fnBlock: FunctionBlock,
    source: string,
    masked: string,
    lineOf: (offset: number) => number,
    rawBody: string,
    maskedBody: string,
  ): ExternalCallSummary {
    const calls: ExternalCall[] = [];
    const targetsInvoked = new Set<string>();

    let crossContractInvocations = 0;
    let clientInvocations = 0;
    let tokenTransfers = 0;
    let balanceQueries = 0;
    let tokenStateMutations = 0;
    let callsInLoopsCount = 0;

    // 1. Raw cross-contract invocations: env.invoke_contract(...) or env.try_invoke_contract(...)
    const invokeRe = /\benv\s*\.\s*(invoke_contract|try_invoke_contract)\s*\(/g;
    let m: RegExpExecArray | null;

    while ((m = invokeRe.exec(maskedBody)) !== null) {
      const callOffset = fnBlock.bodyStart + m.index;
      const stack = blockStackAt(masked, fnBlock.bodyStart, callOffset);
      const inLoop = isInLoop(stack);
      if (inLoop) callsInLoopsCount++;

      const openParen = callOffset + m[0].length - 1;
      const rawArgs = this.extractParens(source, openParen);
      const argsList = rawArgs ? splitArgs(rawArgs) : [];
      const target = argsList[0] ? normalizeExpr(argsList[0]) : 'unknown_contract';
      const method = argsList[1] ? normalizeExpr(argsList[1]) : 'invoke';

      targetsInvoked.add(target);
      crossContractInvocations++;

      calls.push({
        callType: m[1] === 'try_invoke_contract' ? 'try_cross_contract_invoke' : 'cross_contract_invoke',
        target,
        method,
        args: argsList,
        line: lineOf(callOffset),
        offset: callOffset,
        isInLoop: inLoop,
        isInBranch: isInBranch(stack),
      });
    }

    // 2. Typed Client invocations: <Contract>Client::new(&env, &addr).<method>(...)
    const clientNewRe = /([A-Za-z0-9_]+Client)\s*::\s*new\s*\(/g;
    while ((m = clientNewRe.exec(maskedBody)) !== null) {
      const clientType = m[1];
      const callOffset = fnBlock.bodyStart + m.index;
      const stack = blockStackAt(masked, fnBlock.bodyStart, callOffset);
      const inLoop = isInLoop(stack);
      if (inLoop) callsInLoopsCount++;

      const openParen = callOffset + m[0].length - 1;
      const rawArgs = this.extractParens(source, openParen);
      const argsList = rawArgs ? splitArgs(rawArgs) : [];
      const target = argsList[1] ? normalizeExpr(argsList[1]) : clientType;

      targetsInvoked.add(target);
      clientInvocations++;

      // Try to find the chained method call right after client creation
      const afterClient = source.slice(callOffset + m[0].length);
      const chainedMethodMatch = afterClient.match(/^\s*[^)]*\)\s*\.\s*([A-Za-z0-9_]+)\s*\(/);
      const method = chainedMethodMatch ? chainedMethodMatch[1] : 'client_call';

      calls.push({
        callType: 'client_call',
        target,
        method,
        args: argsList,
        line: lineOf(callOffset),
        offset: callOffset,
        isInLoop: inLoop,
        isInBranch: isInBranch(stack),
      });
    }

    // 3. Token operations: client.transfer(...), client.transfer_from(...), client.balance(...), client.mint(...), client.burn(...)
    const tokenOpRe =
      /([A-Za-z0-9_]+)\s*\.\s*(transfer|transfer_from|balance|spendable_balance|mint|burn|clawback|approve)\s*\(/g;
    while ((m = tokenOpRe.exec(maskedBody)) !== null) {
      const receiver = m[1];
      const op = m[2];
      const callOffset = fnBlock.bodyStart + m.index;
      const stack = blockStackAt(masked, fnBlock.bodyStart, callOffset);
      const inLoop = isInLoop(stack);
      if (inLoop) callsInLoopsCount++;

      const openParen = callOffset + m[0].length - 1;
      const rawArgs = this.extractParens(source, openParen);
      const argsList = rawArgs ? splitArgs(rawArgs) : [];

      let callType: ExternalCallType = 'client_call';
      if (op === 'transfer' || op === 'transfer_from') {
        tokenTransfers++;
        callType = 'token_transfer';
      } else if (op === 'balance' || op === 'spendable_balance') {
        balanceQueries++;
        callType = 'balance_query';
      } else if (op === 'mint') {
        tokenStateMutations++;
        callType = 'token_mint';
      } else if (op === 'burn') {
        tokenStateMutations++;
        callType = 'token_burn';
      } else if (op === 'approve') {
        tokenStateMutations++;
        callType = 'token_approve';
      }

      targetsInvoked.add(receiver);

      calls.push({
        callType,
        target: receiver,
        method: op,
        args: argsList,
        line: lineOf(callOffset),
        offset: callOffset,
        isInLoop: inLoop,
        isInBranch: isInBranch(stack),
      });
    }

    const totalCalls = crossContractInvocations + clientInvocations + tokenTransfers + balanceQueries + tokenStateMutations;

    return {
      totalCalls,
      crossContractInvocations,
      clientInvocations,
      tokenTransfers,
      balanceQueries,
      tokenStateMutations,
      callsInLoopsCount,
      targetsInvoked: Array.from(targetsInvoked),
      calls,
    };
  }

  /**
   * Evaluate security & optimization findings for an entry point.
   */
  private evaluateFindings(
    name: string,
    line: number,
    visibility: FunctionVisibility,
    isExported: boolean,
    parameters: EntryPointParameter[],
    auth: AuthorizationSummary,
    storage: StorageSummary,
    externalCalls: ExternalCallSummary,
    isStateMutating: boolean,
    findings: EntryPointFinding[],
  ): void {
    const isPublic = isExported || visibility === 'public' || visibility === 'constructor';

    // 1. Unprotected public state-mutating entry point
    if (this.config.checkMissingAuth && isPublic && isStateMutating && auth.isMissingRequiredAuth) {
      findings.push({
        ruleId: 'soroban-unprotected-entry-point',
        category: 'authorization',
        severity: 'critical',
        line,
        entryPointName: name,
        message: `Public entry point '${name}' mutates state or transfers tokens without validating caller authorization.`,
        suggestion: `Add 'require_auth()' or 'require_auth_for_args()' check on the caller or admin Address parameter.`,
      });
    }

    // 2. External calls inside loops
    if (this.config.checkCallsInLoops && externalCalls.callsInLoopsCount > 0) {
      findings.push({
        ruleId: 'soroban-entry-point-call-in-loop',
        category: 'external_calls',
        severity: 'high',
        line,
        entryPointName: name,
        message: `Entry point '${name}' executes ${externalCalls.callsInLoopsCount} cross-contract/token call(s) inside a loop.`,
        suggestion: `Batch cross-contract calls or execute external interactions outside loop constructs to reduce gas costs.`,
      });
    }

    // 3. Storage writes inside loops
    if (this.config.checkStorageInLoops && storage.storageInLoopsCount > 0) {
      findings.push({
        ruleId: 'soroban-entry-point-storage-in-loop',
        category: 'storage',
        severity: 'high',
        line,
        entryPointName: name,
        message: `Entry point '${name}' performs ${storage.storageInLoopsCount} storage access operation(s) inside a loop.`,
        suggestion: `Aggregate state changes in local memory structures (Vec/Map) and commit to persistent/instance storage once.`,
      });
    }

    // 4. Authorization check inside loop
    if (this.config.checkAuthInLoops && auth.hasLoopAuth) {
      findings.push({
        ruleId: 'soroban-entry-point-auth-in-loop',
        category: 'authorization',
        severity: 'medium',
        line,
        entryPointName: name,
        message: `Entry point '${name}' contains an authorization check inside a loop construct.`,
        suggestion: `Move authorization checks to the beginning of the function before entering the loop.`,
      });
    }

    // 5. Redundant authorization checks
    if (auth.hasRedundantAuth) {
      findings.push({
        ruleId: 'soroban-entry-point-redundant-auth',
        category: 'authorization',
        severity: 'low',
        line,
        entryPointName: name,
        message: `Entry point '${name}' calls both 'require_auth' and 'require_auth_for_args' for the same address.`,
        suggestion: `Keep only 'require_auth_for_args' to avoid redundant checks.`,
      });
    }

    // 6. Unused parameters in public entry point
    if (this.config.checkUnusedParams && isPublic) {
      const unusedList = parameters.filter((p) => p.isUnused);
      if (unusedList.length > 0) {
        findings.push({
          ruleId: 'soroban-entry-point-unused-parameter',
          category: 'parameters',
          severity: 'low',
          line,
          entryPointName: name,
          message: `Entry point '${name}' has unused parameter(s): ${unusedList.map((p) => `'${p.name}'`).join(', ')}.`,
          suggestion: `Prefix unused parameter identifiers with an underscore (e.g. '_${unusedList[0].name}') or remove them.`,
        });
      }
    }
  }

  /**
   * Calculate qualitative risk level and composite score.
   */
  private calculateRiskScore(
    visibility: FunctionVisibility,
    isExported: boolean,
    isStateMutating: boolean,
    auth: AuthorizationSummary,
    storage: StorageSummary,
    externalCalls: ExternalCallSummary,
    findings: EntryPointFinding[],
  ): { riskScore: number; riskLevel: RiskLevel } {
    let score = 0;

    findings.forEach((f) => {
      switch (f.severity) {
        case 'critical':
          score += 40;
          break;
        case 'high':
          score += 25;
          break;
        case 'medium':
          score += 15;
          break;
        case 'low':
          score += 5;
          break;
        default:
          break;
      }
    });

    if (externalCalls.callsInLoopsCount > 0) score += 20;
    if (storage.storageInLoopsCount > 0) score += 15;
    if (auth.isMissingRequiredAuth) score += 30;

    const normalizedScore = Math.min(100, score);

    let riskLevel: RiskLevel = 'safe';
    if (normalizedScore >= 70) riskLevel = 'critical';
    else if (normalizedScore >= 45) riskLevel = 'high';
    else if (normalizedScore >= 20) riskLevel = 'medium';
    else if (normalizedScore > 0) riskLevel = 'low';

    return { riskScore: normalizedScore, riskLevel };
  }

  /**
   * Extract doc comments attached to the function.
   */
  private extractDocComment(source: string, fnLine: number): string | undefined {
    const lines = source.split('\n');
    const docLines: string[] = [];

    let curr = fnLine - 2; // Line before `fn` (0-indexed)
    while (curr >= 0) {
      const line = lines[curr].trim();
      if (line.startsWith('///')) {
        docLines.unshift(line.replace(/^\/\/\/\s?/, ''));
        curr--;
      } else if (line.startsWith('#[')) {
        // Skip attributes like #[contractimpl] or #[doc = "..."]
        curr--;
      } else {
        break;
      }
    }

    return docLines.length > 0 ? docLines.join('\n') : undefined;
  }

  /**
   * Match function signature header from preceding source.
   */
  private extractFunctionSignature(
    precedingSource: string,
    fnLine: number,
  ): { fullSignature: string; isPublic: boolean; rawParameters: string; returnType: string | null } | null {
    const lines = precedingSource.split('\n');
    const signatureLines: string[] = [];

    // Collect signature lines starting at the fn definition line
    const targetIdx = fnLine - 1;
    if (targetIdx < lines.length) {
      for (let i = targetIdx; i < lines.length; i++) {
        signatureLines.push(lines[i]);
        if (lines[i].includes('{') || lines[i].includes(';')) break;
      }
    }

    const fullSignature = signatureLines.join(' ').replace(/\s+/g, ' ').trim();
    const isPublic = /\bpub(?:\([^)]*\))?\s+fn\b/.test(fullSignature);

    const fnMatch = fullSignature.match(/\bfn\s+[A-Za-z0-9_]+\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*([^{;]+))?/);
    if (!fnMatch) {
      return {
        fullSignature,
        isPublic,
        rawParameters: '',
        returnType: null,
      };
    }

    const rawParameters = fnMatch[1] ?? '';
    const returnType = fnMatch[2] ? fnMatch[2].trim() : null;

    return {
      fullSignature,
      isPublic,
      rawParameters,
      returnType,
    };
  }

  /**
   * Detect contract struct name from contract definitions.
   */
  private detectContractName(source: string): string {
    const structMatch = source.match(/#\[contract\]\s*(?:pub\s+)?struct\s+([A-Za-z0-9_]+)/);
    if (structMatch) return structMatch[1];

    const implMatch = source.match(/#\[contractimpl\]\s*impl\s+([A-Za-z0-9_]+)/);
    if (implMatch) return implMatch[1];

    const traitImplMatch = source.match(/#\[contractimpl\]\s*impl\s+[A-Za-z0-9_]+\s+for\s+([A-Za-z0-9_]+)/);
    if (traitImplMatch) return traitImplMatch[1];

    const anyStructMatch = source.match(/(?:pub\s+)?struct\s+([A-Za-z0-9_]+)/);
    if (anyStructMatch) return anyStructMatch[1];

    const traitMatch = source.match(/pub\s+trait\s+([A-Za-z0-9_]+)/);
    if (traitMatch) return traitMatch[1];

    return 'SorobanContract';
  }

  /**
   * Detect contract impl and trait blocks to determine scopes.
   */
  private detectContractBlocks(source: string, masked: string): ContractBlockInfo[] {
    const blocks: ContractBlockInfo[] = [];

    // 1. #[contractimpl] impl <Contract> { ... }
    const contractImplRe = /#\[contractimpl\]\s*impl(?:\s*<[^>]*>)?\s+([A-Za-z0-9_]+)\s*\{/g;
    let m: RegExpExecArray | null;

    while ((m = contractImplRe.exec(masked)) !== null) {
      const contractName = m[1];
      const startOffset = m.index + m[0].length - 1;
      const endOffset = this.matchClosingBrace(masked, startOffset);
      if (endOffset !== -1) {
        blocks.push({
          type: 'contractimpl',
          contractName,
          startOffset,
          endOffset,
        });
      }
    }

    // 2. #[contractimpl] impl <Trait> for <Contract> { ... }
    const traitImplRe = /#\[contractimpl\]\s*impl(?:\s*<[^>]*>)?\s+([A-Za-z0-9_]+)\s+for\s+([A-Za-z0-9_]+)\s*\{/g;
    while ((m = traitImplRe.exec(masked)) !== null) {
      const traitName = m[1];
      const contractName = m[2];
      const startOffset = m.index + m[0].length - 1;
      const endOffset = this.matchClosingBrace(masked, startOffset);
      if (endOffset !== -1) {
        blocks.push({
          type: 'impl_trait',
          contractName,
          traitName,
          startOffset,
          endOffset,
        });
      }
    }

    // 3. standard impl <Contract> { ... } without #[contractimpl]
    const standardImplRe = /(?<!#\[contractimpl\]\s*)impl(?:\s*<[^>]*>)?\s+([A-Za-z0-9_]+)\s*\{/g;
    while ((m = standardImplRe.exec(masked)) !== null) {
      const contractName = m[1];
      const startOffset = m.index + m[0].length - 1;
      const endOffset = this.matchClosingBrace(masked, startOffset);
      if (endOffset !== -1) {
        blocks.push({
          type: 'impl_contract',
          contractName,
          startOffset,
          endOffset,
        });
      }
    }

    // 4. pub trait <Trait> { ... }
    const pubTraitRe = /pub\s+trait\s+([A-Za-z0-9_]+)\s*\{/g;
    while ((m = pubTraitRe.exec(masked)) !== null) {
      const traitName = m[1];
      const startOffset = m.index + m[0].length - 1;
      const endOffset = this.matchClosingBrace(masked, startOffset);
      if (endOffset !== -1) {
        blocks.push({
          type: 'pub_trait',
          contractName: traitName,
          traitName,
          startOffset,
          endOffset,
        });
      }
    }

    return blocks;
  }

  private findEnclosingBlock(offset: number, blocks: ContractBlockInfo[]): ContractBlockInfo | undefined {
    return blocks.find((b) => offset >= b.startOffset && offset <= b.endOffset);
  }

  private isConstructorName(name: string): boolean {
    return (
      name === 'new' ||
      name === 'init' ||
      name === 'initialize' ||
      name === '__constructor' ||
      name === 'constructor'
    );
  }

  private matchClosingBrace(masked: string, openBraceIdx: number): number {
    let depth = 0;
    for (let i = openBraceIdx; i < masked.length; i++) {
      if (masked[i] === '{') depth++;
      else if (masked[i] === '}') {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }

  private extractParens(source: string, openParenIdx: number): string | null {
    let depth = 0;
    for (let i = openParenIdx; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        depth--;
        if (depth === 0) return source.slice(openParenIdx + 1, i);
      }
    }
    return null;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Calculate aggregate metrics across all analyzed entry points.
   */
  private calculateAggregateMetrics(entryPoints: EntryPoint[]): EntryPointAggregateMetrics {
    let publicCount = 0;
    let constructorCount = 0;
    let internalCount = 0;
    let stateMutatingCount = 0;
    let readOnlyCount = 0;
    let totalAuthChecks = 0;
    let unprotectedMutatingCount = 0;
    let totalStorageReads = 0;
    let totalStorageWrites = 0;
    let totalExternalCalls = 0;
    let callsInLoopsCount = 0;
    let storageInLoopsCount = 0;
    let authInLoopsCount = 0;

    for (const ep of entryPoints) {
      if (ep.isExported || ep.visibility === 'public') publicCount++;
      if (ep.visibility === 'constructor' || ep.isConstructorOrInit) constructorCount++;
      if (!ep.isExported && ep.visibility !== 'public' && ep.visibility !== 'constructor') internalCount++;

      if (ep.isStateMutating) stateMutatingCount++;
      if (ep.isReadOnly) readOnlyCount++;

      totalAuthChecks += ep.authorization.checks.length;
      if (ep.isStateMutating && ep.authorization.isMissingRequiredAuth && (ep.isExported || ep.visibility === 'public')) {
        unprotectedMutatingCount++;
      }

      totalStorageReads += ep.storage.readsCount;
      totalStorageWrites += ep.storage.writesCount;
      totalExternalCalls += ep.externalCalls.totalCalls;

      callsInLoopsCount += ep.externalCalls.callsInLoopsCount;
      storageInLoopsCount += ep.storage.storageInLoopsCount;
      if (ep.authorization.hasLoopAuth) authInLoopsCount++;
    }

    return {
      totalEntryPoints: entryPoints.length,
      publicEntryPointsCount: publicCount,
      constructorCount,
      internalFunctionsCount: internalCount,
      stateMutatingCount,
      readOnlyCount,
      totalAuthChecks,
      unprotectedMutatingCount,
      totalStorageReads,
      totalStorageWrites,
      totalExternalCalls,
      callsInLoopsCount,
      storageInLoopsCount,
      authInLoopsCount,
    };
  }

  /**
   * Generate an executive summary.
   */
  private generateExecutiveSummary(
    contractName: string,
    entryPoints: EntryPoint[],
    metrics: EntryPointAggregateMetrics,
    findings: EntryPointFinding[],
  ): string {
    if (entryPoints.length === 0) {
      return `No entry points detected in contract '${contractName}'.`;
    }

    const criticalCount = findings.filter((f) => f.severity === 'critical').length;
    const highCount = findings.filter((f) => f.severity === 'high').length;

    let summary = `Contract '${contractName}' contains ${metrics.publicEntryPointsCount} public entry point(s) `;
    summary += `(${metrics.stateMutatingCount} state-mutating, ${metrics.readOnlyCount} read-only, ${metrics.totalAuthChecks} authorization checks). `;

    if (metrics.unprotectedMutatingCount > 0) {
      summary += `⚠️ CRITICAL: ${metrics.unprotectedMutatingCount} public state-mutating entry point(s) lack authorization checks. `;
    }

    if (metrics.callsInLoopsCount > 0) {
      summary += `⚠️ Detected ${metrics.callsInLoopsCount} external call(s) inside loop constructs. `;
    }

    if (metrics.storageInLoopsCount > 0) {
      summary += `⚠️ Detected ${metrics.storageInLoopsCount} storage access(es) inside loops. `;
    }

    if (criticalCount === 0 && highCount === 0 && metrics.unprotectedMutatingCount === 0) {
      summary += `All analyzed entry points have appropriate authorization and storage patterns.`;
    }

    return summary.trim();
  }
}

/**
 * Convenient standalone function to analyze Soroban entry points.
 */
export function analyzeEntryPoints(
  source: string,
  filePath = 'contract.rs',
  config?: Partial<EntryPointAnalyzerConfig>,
): EntryPointAnalysisReport {
  const analyzer = new SorobanEntryPointAnalyzer(config);
  return analyzer.analyze(source, filePath);
}
