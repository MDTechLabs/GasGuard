import {
  maskNonCode,
  createLineResolver,
  extractFunctions,
  extractArgs,
  splitArgs,
  blockStackAt,
  isInLoop,
} from '../common/source-utils';
export type LoopBoundType = 'bounded_range' | 'collection_iterator' | 'unbounded' | 'dynamic_condition';

export interface LoopContext {
  loopType: 'for' | 'while' | 'loop';
  boundType: LoopBoundType;
  boundExpression: string;
  line: number;
}

export function classifyLoopHeader(precedingSource: string): LoopContext {
  const forMatch = precedingSource.match(/for\s+([A-Za-z0-9_(),\s]+)\s+in\s+([^{]+)/);
  if (forMatch) {
    const expr = forMatch[2].trim();
    const isRange = /\d+\s*\.\.\s*=?\s*\d+/.test(expr);
    return {
      loopType: 'for',
      boundType: isRange ? 'bounded_range' : 'collection_iterator',
      boundExpression: expr,
      line: 0,
    };
  }

  const whileMatch = precedingSource.match(/while\s+([^{]+)/);
  if (whileMatch) {
    const expr = whileMatch[1].trim();
    const isTrue = expr === 'true';
    return {
      loopType: 'while',
      boundType: isTrue ? 'unbounded' : 'dynamic_condition',
      boundExpression: expr,
      line: 0,
    };
  }

  return {
    loopType: 'loop',
    boundType: 'unbounded',
    boundExpression: 'unbounded loop',
    line: 0,
  };
}

export type StorageOpType = 'read' | 'write';
export type StorageScope = 'instance' | 'persistent' | 'temporary' | 'unknown';

export interface StorageInLoopSite {
  fn: string;
  opType: StorageOpType;
  scope: StorageScope;
  method: string;
  key: string;
  line: number;
  offset: number;
  loopContext: LoopContext;
  severity: 'critical' | 'high' | 'medium';
  estimatedResourceImpact: {
    cpuInstructions: number;
    storageBytes: number;
  };
  message: string;
  suggestion: string;
}

export interface StorageInLoopReport {
  sites: StorageInLoopSite[];
  totalReadsInLoops: number;
  totalWritesInLoops: number;
  estimatedTotalCpuMultiplier: number;
  recommendations: string[];
}

const STORAGE_WRITE_METHODS = new Set(['set', 'put', 'extend_ttl']);
const STORAGE_READ_METHODS = new Set(['get', 'has', 'get_unchecked']);

// Regex targeting Soroban storage calls: e.g. env.storage().instance().set(...) or storage().persistent().get(...)
const STORAGE_CALL_REGEX = /\bstorage\s*\(\s*\)\s*\.\s*(instance|persistent|temporary)\s*\(\s*\)\s*\.\s*([a-zA-Z0-9_]+)\s*\(/g;

/**
 * Detect storage read and write operations inside loops and compute resource estimates.
 */
export function detectStorageInLoops(source: string): StorageInLoopSite[] {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);
  const sites: StorageInLoopSite[] = [];

  for (const fn of functions) {
    const body = masked.slice(fn.bodyStart, fn.bodyEnd);
    let m: RegExpExecArray | null;

    while ((m = STORAGE_CALL_REGEX.exec(body)) !== null) {
      const offset = fn.bodyStart + m.index;
      const stack = blockStackAt(masked, fn.bodyStart, offset);

      if (!isInLoop(stack)) {
        continue;
      }

      const scope = (m[1] as StorageScope) || 'unknown';
      const method = m[2];
      const isWrite = STORAGE_WRITE_METHODS.has(method);
      const isRead = STORAGE_READ_METHODS.has(method);

      if (!isWrite && !isRead) {
        continue;
      }

      const opType: StorageOpType = isWrite ? 'write' : 'read';

      // Find enclosing loop frame and classify bounds
      const loopFrame = stack.slice().reverse().find((f) => f.kind === 'loop');
      const loopHeaderSnippet = loopFrame
        ? source.slice(Math.max(fn.bodyStart, loopFrame.start - 80), loopFrame.start)
        : '';

      const loopContext = classifyLoopHeader(loopHeaderSnippet);
      loopContext.line = loopFrame ? lineOf(loopFrame.start) : lineOf(offset);

      // Extract storage key argument
      const openParen = offset + m[0].length - 1;
      const argsText = extractArgs(masked, source, openParen).text;
      const args = splitArgs(argsText);
      const key = args.length > 0 ? args[0] : 'unknown_key';

      // Severity and resource estimation
      const isUnbounded = loopContext.boundType === 'unbounded' || loopContext.boundType === 'dynamic_condition';
      const severity = isWrite
        ? (isUnbounded ? 'critical' : 'high')
        : (isUnbounded ? 'high' : 'medium');

      const multiplier = loopContext.boundType === 'bounded_range' ? 5 : 20;
      const baseCpu = isWrite ? 25_000 : 10_000;
      const baseBytes = isWrite ? 1_000 : 500;

      sites.push({
        fn: fn.name,
        opType,
        scope,
        method,
        key,
        line: lineOf(offset),
        offset,
        loopContext,
        severity,
        estimatedResourceImpact: {
          cpuInstructions: baseCpu * multiplier,
          storageBytes: baseBytes * multiplier,
        },
        message: `Storage ${opType} (env.storage().${scope}().${method}('${key}')) detected inside a '${loopContext.loopType}' loop (${loopContext.boundType}) in '${fn.name}'.`,
        suggestion: isWrite
          ? `Buffer state modifications in a local Map or Vec in memory, and perform a single batched storage write after the loop.`
          : `Hoist the storage query outside the loop into a local variable if key '${key}' does not change per iteration.`,
      });
    }
  }

  return sites.sort((a, b) => a.line - b.line);
}

/**
 * Full analysis entry point.
 */
export function analyzeStorageInLoops(source: string): StorageInLoopReport {
  const sites = detectStorageInLoops(source);
  const reads = sites.filter((s) => s.opType === 'read');
  const writes = sites.filter((s) => s.opType === 'write');

  const recommendations: string[] = [];
  if (writes.length > 0) {
    recommendations.push(
      `Detected ${writes.length} storage write(s) inside loops. Batch storage updates to avoid expensive ledger write serialization and rent growth.`,
    );
  }
  if (reads.length > 0) {
    recommendations.push(
      `Detected ${reads.length} storage read(s) inside loops. Cache read values in local memory before entering loop bodies.`,
    );
  }

  return {
    sites,
    totalReadsInLoops: reads.length,
    totalWritesInLoops: writes.length,
    estimatedTotalCpuMultiplier: sites.reduce((sum, s) => sum + s.estimatedResourceImpact.cpuInstructions, 0),
    recommendations,
  };
}
