/**
 * Inefficient Soroban Temporary Storage Usage Detector
 *
 * Detects inefficient patterns in Soroban temporary storage usage:
 * - Using temporary storage for data that should be persistent
 * - Repeated reads/writes to same temporary key (should use local variables)
 * - Temporary storage used as a substitute for local variables
 * - Missing temporary storage where it should be used (ephemeral data in persistent)
 * - Over-fragmented temporary storage (many small keys vs. structured data)
 */

import {
  maskNonCode,
  createLineResolver,
  extractFunctions,
  extractArgs,
  splitArgs,
  normalizeExpr,
  blockStackAt,
  isInLoop,
} from "../common/source-utils";

export type InefficiencyPattern =
  | "repeated_access"
  | "should_be_local"
  | "should_be_persistent"
  | "over_fragmented"
  | "write_only_no_read"
  | "read_after_write_no_use";

export interface TemporaryStorageInefficiency {
  ruleId: string;
  severity: "high" | "medium" | "low";
  line: number;
  key: string;
  pattern: InefficiencyPattern;
  message: string;
  suggestion: string;
  functionName?: string;
  estimatedWaste?: string;
}

export interface TemporaryStorageAnalysisReport {
  inefficiencies: TemporaryStorageInefficiency[];
  summary: string;
  metrics: {
    totalTemporaryAccesses: number;
    uniqueTemporaryKeys: number;
    repeatedAccessCount: number;
    shouldBeLocalCount: number;
    shouldBePersistentCount: number;
    overFragmentedCount: number;
    writeOnlyCount: number;
  };
}

const STORAGE_ACCESS_REGEX =
  /\bstorage\s*\(\s*\)\s*\.\s*temporary\s*\(\s*\)\s*\.\s*([a-zA-Z0-9_]+)\s*\(/g;

const SYMBOL_DEF_REGEX =
  /(?:let|const)\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=;]+)?=\s*(?:Symbol::new|symbol_short!)\s*\(&?env,\s*"([^"]+)"\)/g;

const PERSISTENT_EPHEMERAL_REGEX =
  /\bstorage\s*\(\s*\)\s*\.\s*persistent\s*\(\s*\)\s*\.\s*(?:set|put)\s*\(\s*&?(?:Symbol::new\s*\(&env,\s*"([^"]+)"\)|([A-Za-z_]\w*))/g;

const EPHEMERAL_KEYWORDS = [
  "nonce",
  "counter",
  "session",
  "temp",
  "tmp",
  "ephemeral",
  "cache",
  "scratch",
  "buffer",
  "pending",
  "staging",
  "transient",
  "short_lived",
  "expiring",
];

const PERSISTENT_KEYWORDS = [
  "config",
  "setting",
  "admin",
  "owner",
  "parameter",
  "fee",
  "rate",
  "threshold",
  "limit",
  "cap",
  "base",
  "min",
  "max",
  "decay",
  "coeff",
  "precision",
  "scale",
  "allowance",
  "balance",
  "total_supply",
  "decimals",
  "name",
  "symbol",
];

interface TemporaryAccess {
  key: string;
  method: string;
  line: number;
  offset: number;
  fnName: string | null;
  isInLoop: boolean;
}

export function detectInefficientTemporaryStorage(source: string): TemporaryStorageAnalysisReport {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);
  const inefficiencies: TemporaryStorageInefficiency[] = [];

  const keyToName = new Map<string, string>();
  let symMatch: RegExpExecArray | null;
  const symRe = new RegExp(SYMBOL_DEF_REGEX.source, "g");
  while ((symMatch = symRe.exec(source)) !== null) {
    keyToName.set(symMatch[1], symMatch[2]);
  }

  const temporaryAccesses: TemporaryAccess[] = [];
  let m: RegExpExecArray | null;

  const accessRe = new RegExp(STORAGE_ACCESS_REGEX.source, "g");
  while ((m = accessRe.exec(masked)) !== null) {
    const offset = m.index;
    const method = m[1];
    const line = lineOf(offset);

    const openParen = offset + m[0].length - 1;
    const argsText = extractArgs(masked, source, openParen).text;
    const args = splitArgs(argsText);
    const firstArg = args.length > 0 ? normalizeExpr(args[0]) : "";

    let key = firstArg;
    if (keyToName.has(key)) {
      key = keyToName.get(key)!;
    }

    let fnName: string | null = null;
    let fnBodyStart = 0;
    let fnBodyEnd = masked.length;
    for (const fn of functions) {
      if (offset >= fn.bodyStart && offset < fn.bodyEnd) {
        fnName = fn.name;
        fnBodyStart = fn.bodyStart;
        fnBodyEnd = fn.bodyEnd;
        break;
      }
    }

    const stack = fnName
      ? blockStackAt(masked, fnBodyStart, offset)
      : [];
    const inLoop = isInLoop(stack);

    temporaryAccesses.push({ key, method, line, offset, fnName, isInLoop });
  }

  const keyAccessMap = new Map<string, TemporaryAccess[]>();
  for (const access of temporaryAccesses) {
    const existing = keyAccessMap.get(access.key) || [];
    existing.push(access);
    keyAccessMap.set(access.key, existing);
  }

  for (const [key, accesses] of keyAccessMap.entries()) {
    const reads = accesses.filter((a) => a.method === "get" || a.method === "has" || a.method === "get_unchecked");
    const writes = accesses.filter((a) => a.method === "set" || a.method === "put");
    const hasExtendTtl = accesses.some((a) => a.method === "extend_ttl");
    const anyInLoop = accesses.some((a) => a.isInLoop);

    if (accesses.length > 2 && (reads.length > 1 || writes.length > 1)) {
      const fnName = accesses[0].fnName || "unknown";
      inefficiencies.push({
        ruleId: "SOROBAN-TMP-01",
        severity: "medium",
        line: accesses[0].line,
        key,
        pattern: "repeated_access",
        message: `Temporary storage key '${key}' is accessed ${accesses.length} times in function '${fnName}'. This defeats the purpose of temporary storage and wastes CPU.`,
        suggestion: `Cache the value of '${key}' in a local variable instead of repeatedly accessing temporary storage.`,
        functionName: fnName,
        estimatedWaste: `~${(accesses.length - 1) * 500} CPU instructions per transaction`,
      });
    }

    if (writes.length === 1 && reads.length === 0 && !hasExtendTtl) {
      const write = writes[0];
      const fnName = write.fnName || "unknown";
      inefficiencies.push({
        ruleId: "SOROBAN-TMP-02",
        severity: "medium",
        line: write.line,
        key,
        pattern: "write_only_no_read",
        message: `Temporary storage key '${key}' is written but never read within the same transaction in function '${fnName}'.`,
        suggestion: `Use a local variable instead of temporary storage for '${key}' if the value is not read back within the same transaction.`,
        functionName: fnName,
        estimatedWaste: "~300 CPU instructions for unnecessary storage write",
      });
    }

    if (hasExtendTtl) {
      const ttlAccess = accesses.find((a) => a.method === "extend_ttl")!;
      const fnName = ttlAccess.fnName || "unknown";
      inefficiencies.push({
        ruleId: "SOROBAN-TMP-03",
        severity: "medium",
        line: ttlAccess.line,
        key,
        pattern: "should_be_persistent",
        message: `Temporary storage key '${key}' uses extend_ttl, indicating it needs longer persistence than temporary storage provides.`,
        suggestion: `Consider using persistent storage for '${key}' if it requires explicit TTL management.`,
        functionName: fnName,
      });
    }

    if (anyInLoop && (reads.length > 0 || writes.length > 0)) {
      const loopAccess = accesses.find((a) => a.isInLoop)!;
      const fnName = loopAccess.fnName || "unknown";
      inefficiencies.push({
        ruleId: "SOROBAN-TMP-04",
        severity: "high",
        line: loopAccess.line,
        key,
        pattern: "should_be_local",
        message: `Temporary storage key '${key}' is accessed inside a loop in function '${fnName}'. This causes expensive per-iteration storage operations.`,
        suggestion: `Read '${key}' into a local variable before the loop, or write to a local variable and persist once after the loop.`,
        functionName: fnName,
        estimatedWaste: `~${accesses.length * 800} CPU instructions per loop iteration`,
      });
    }

    const lowerKey = key.toLowerCase();
    for (const kw of PERSISTENT_KEYWORDS) {
      if (lowerKey === kw || lowerKey.includes(kw)) {
        const access = accesses[0];
        const fnName = access.fnName || "unknown";
        inefficiencies.push({
          ruleId: "SOROBAN-TMP-05",
          severity: "medium",
          line: access.line,
          key,
          pattern: "should_be_persistent",
          message: `Temporary storage key '${key}' appears to be configuration-like data that should use persistent storage.`,
          suggestion: `Move '${key}' to persistent storage to ensure it persists across transactions and contract invocations.`,
          functionName: fnName,
        });
        break;
      }
    }
  }

  const uniqueKeys = new Set(temporaryAccesses.map((a) => a.key));
  if (uniqueKeys.size > 8) {
    const firstAccess = temporaryAccesses[0];
    inefficiencies.push({
      ruleId: "SOROBAN-TMP-06",
      severity: "low",
      line: firstAccess.line,
      key: Array.from(uniqueKeys).join(", "),
      pattern: "over_fragmented",
      message: `Contract uses ${uniqueKeys.size} unique temporary storage keys, which may indicate over-fragmentation.`,
      suggestion: "Consider consolidating related temporary data into structured types (e.g., a single Map or Vec) to reduce key management overhead.",
    });
  }

  const persistentEphemeralKeys: string[] = [];
  let ephemeralMatch: RegExpExecArray | null;
  const ephemeralRe = new RegExp(PERSISTENT_EPHEMERAL_REGEX.source, "g");
  while ((ephemeralMatch = ephemeralRe.exec(masked)) !== null) {
    const key = ephemeralMatch[1] || ephemeralMatch[2] || "";
    if (key) {
      const lowerKey = key.toLowerCase();
      for (const kw of EPHEMERAL_KEYWORDS) {
        if (lowerKey.includes(kw)) {
          persistentEphemeralKeys.push(key);
          break;
        }
      }
    }
  }

  for (const key of persistentEphemeralKeys) {
    const line = lineOf(masked.indexOf(`"${key}"`));
    inefficiencies.push({
      ruleId: "SOROBAN-TMP-07",
      severity: "medium",
      line: line > 0 ? line : 1,
      key,
      pattern: "should_be_local",
      message: `Ephemeral key '${key}' is stored in persistent storage but appears to be temporary data.`,
      suggestion: `Use temporary storage for '${key}' to reduce ledger rent costs for short-lived data.`,
      estimatedWaste: "~80% ledger rent fee reduction possible",
    });
  }

  const repeatedAccessCount = inefficiencies.filter((i) => i.pattern === "repeated_access").length;
  const shouldBeLocalCount = inefficiencies.filter((i) => i.pattern === "should_be_local").length;
  const shouldBePersistentCount = inefficiencies.filter((i) => i.pattern === "should_be_persistent").length;
  const overFragmentedCount = inefficiencies.filter((i) => i.pattern === "over_fragmented").length;
  const writeOnlyCount = inefficiencies.filter((i) => i.pattern === "write_only_no_read").length;

  let summary: string;
  if (temporaryAccesses.length === 0) {
    summary = "No temporary storage usage detected.";
  } else {
    summary = `Analyzed ${temporaryAccesses.length} temporary storage accesses across ${uniqueKeys.size} unique keys. Found ${inefficiencies.length} inefficiency pattern(s).`;
  }

  return {
    inefficiencies,
    summary,
    metrics: {
      totalTemporaryAccesses: temporaryAccesses.length,
      uniqueTemporaryKeys: uniqueKeys.size,
      repeatedAccessCount,
      shouldBeLocalCount,
      shouldBePersistentCount,
      overFragmentedCount,
      writeOnlyCount,
    },
  };
}
