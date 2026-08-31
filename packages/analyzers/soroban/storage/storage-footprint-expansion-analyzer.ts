/**
 * Soroban Storage Footprint Expansion Detector
 *
 * Detects patterns that cause a contract's storage footprint to grow
 * unboundedly over time, leading to:
 * - Increasing transaction fees
 * - Higher ledger rent costs
 * - Potential resource exhaustion
 * - Degraded performance
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

export type ExpansionPattern =
  | "unbounded_collection_growth"
  | "unbounded_key_generation"
  | "no_cleanup_mechanism"
  | "growing_map_in_storage"
  | "dynamic_key_pattern"
  | "append_without_bound";

export interface FootprintExpansionFinding {
  ruleId: string;
  severity: "high" | "medium" | "low";
  line: number;
  functionName: string;
  pattern: ExpansionPattern;
  message: string;
  suggestion: string;
  growthRisk: "unbounded" | "bounded_but_high" | "moderate";
  estimatedImpact?: string;
}

export interface FootprintExpansionReport {
  findings: FootprintExpansionFinding[];
  summary: string;
  metrics: {
    totalExpansionRisks: number;
    unboundedRisks: number;
    highSeverityRisks: number;
    functionsAtRisk: number;
    patterns: Record<ExpansionPattern, number>;
  };
}

const GROWTH_METHODS = ["push_back", "push", "insert", "extend", "append"];
const COLLECTION_TYPES = ["Vec", "Map", "HashMap", "BTreeMap", "VecDeque", "LinkedList"];
const STORAGE_SET_REGEX =
  /\bstorage\s*\(\s*\)\s*\.\s*(instance|persistent|temporary)\s*\(\s*\)\s*\.\s*(?:set|put)\s*\(\s*&?([A-Za-z_]\w*)/g;

const SYMBOL_DEF_REGEX =
  /(?:let|const)\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=;]+)?=\s*(?:Symbol::new|symbol_short!)\s*\(&?env,\s*"([^"]+)"\)/g;

const DATAKEY_ENUM_REGEX =
  /enum\s+DataKey\s*\{([^}]+)\}/gs;

interface StorageWrite {
  key: string;
  tier: string;
  line: number;
  offset: number;
  fnName: string;
  fnBody: string;
  fnBodyStart: number;
  fnBodyEnd: number;
}

export function detectStorageFootprintExpansion(source: string): FootprintExpansionReport {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);
  const findings: FootprintExpansionFinding[] = [];

  const keyToName = new Map<string, string>();
  let symMatch: RegExpExecArray | null;
  const symRe = new RegExp(SYMBOL_DEF_REGEX.source, "g");
  while ((symMatch = symRe.exec(source)) !== null) {
    keyToName.set(symMatch[1], symMatch[2]);
  }

  const dataKeyVariants = new Set<string>();
  let dkMatch: RegExpExecArray | null;
  const dkRe = new RegExp(DATAKEY_ENUM_REGEX.source, "g");
  while ((dkMatch = dkRe.exec(masked)) !== null) {
    const body = dkMatch[1];
    const variantRe = /([A-Za-z_]\w*)\s*(?:\([^)]*\))?/g;
    let vMatch: RegExpExecArray | null;
    while ((vMatch = variantRe.exec(body)) !== null) {
      if (vMatch[1] !== "DataKey") {
        dataKeyVariants.add(vMatch[1]);
      }
    }
  }

  const storageWrites: StorageWrite[] = [];
  let m: RegExpExecArray | null;

  const writeRe = new RegExp(STORAGE_SET_REGEX.source, "g");
  while ((m = writeRe.exec(masked)) !== null) {
    const offset = m.index;
    const tier = m[1];
    const rawKey = m[3];
    const line = lineOf(offset);

    let key = rawKey;
    if (keyToName.has(key)) {
      key = keyToName.get(key)!;
    }

    let fnName = "unknown";
    let fnBody = "";
    let fnBodyStart = 0;
    let fnBodyEnd = masked.length;

    for (const fn of functions) {
      if (offset >= fn.bodyStart && offset < fn.bodyEnd) {
        fnName = fn.name;
        fnBodyStart = fn.bodyStart;
        fnBodyEnd = fn.bodyEnd;
        fnBody = masked.slice(fn.bodyStart, fn.bodyEnd);
        break;
      }
    }

    storageWrites.push({ key, tier, line, offset, fnName, fnBody, fnBodyStart, fnBodyEnd });
  }

  const fnWriteMap = new Map<string, StorageWrite[]>();
  for (const write of storageWrites) {
    const existing = fnWriteMap.get(write.fnName) || [];
    existing.push(write);
    fnWriteMap.set(write.fnName, existing);
  }

  for (const fn of functions) {
    const fnBody = masked.slice(fn.bodyStart, fn.bodyEnd);
    const fnLower = fnBody.toLowerCase();

    const hasGrowthOp = GROWTH_METHODS.some((method) => {
      const regex = new RegExp(`\\.${method}\\s*\\(`, "g");
      return regex.test(fnBody);
    });

    const hasCollectionType = COLLECTION_TYPES.some((type) => fnBody.includes(type));

    const hasStorageWrite = storageWrites.some(
      (w) => w.fnName === fn.name
    );

    if (hasGrowthOp && hasStorageWrite) {
      const stack = blockStackAt(masked, fn.bodyStart, fn.bodyStart + fnBody.length);
      const growthInLoop = GROWTH_METHODS.some((method) => {
        const regex = new RegExp(`\\.${method}\\s*\\(`, "g");
        let gm: RegExpExecArray | null;
        while ((gm = regex.exec(fnBody)) !== null) {
          const siteStack = blockStackAt(masked, fn.bodyStart, fn.bodyStart + gm.index);
          if (isInLoop(siteStack)) return true;
        }
        return false;
      });

      const hasRemoveOp = /\.remove\s*\(/.test(fnBody) || /\.pop\s*\(/.test(fnBody) || /\.clear\s*\(/.test(fnBody);
      const hasLenCheck = /\.len\s*\(/.test(fnBody) || /\.is_empty\s*\(/.test(fnBody);

      if (growthInLoop) {
        const growthLine = lineOf(fnBody.indexOf(".push") > -1 ? fnBody.indexOf(".push") : fnBody.indexOf(".insert"));
        findings.push({
          ruleId: "SOROBAN-EXP-01",
          severity: "high",
          line: growthLine > 0 ? growthLine : fn.line,
          functionName: fn.name,
          pattern: "unbounded_collection_growth",
          message: `Function '${fn.name}' performs collection growth inside a loop with storage writes. This can cause unbounded footprint expansion.`,
          suggestion: "Limit loop iterations or batch collection growth outside loops. Consider using fixed-size collections or implementing cleanup mechanisms.",
          growthRisk: "unbounded",
          estimatedImpact: "O(n) growth in storage footprint per transaction",
        });
      }

      if (!hasRemoveOp && !hasLenCheck) {
        findings.push({
          ruleId: "SOROBAN-EXP-02",
          severity: "high",
          line: fn.line,
          functionName: fn.name,
          pattern: "no_cleanup_mechanism",
          message: `Function '${fn.name}' grows collections in storage without any cleanup, removal, or length check mechanism.`,
          suggestion: "Implement a cleanup mechanism (e.g., remove old entries, enforce maximum size with length checks) to prevent unbounded storage growth.",
          growthRisk: "unbounded",
          estimatedImpact: "Storage footprint grows monotonically with each transaction",
        });
      }

      if (hasCollectionType && hasStorageWrite && !hasRemoveOp) {
        findings.push({
          ruleId: "SOROBAN-EXP-03",
          severity: "medium",
          line: fn.line,
          functionName: fn.name,
          pattern: "growing_map_in_storage",
          message: `Function '${fn.name}' uses collection types (${COLLECTION_TYPES.filter((t) => fnBody.includes(t)).join(", ")}) in storage without cleanup.`,
          suggestion: "Consider implementing TTL-based expiration or periodic cleanup for growing collections.",
          growthRisk: "bounded_but_high",
        });
      }
    }

    const dynamicKeyPattern = /format!\s*\(|format\s*\(|[a-zA-Z_]\w*\.to_string\s*\(\s*\)/.test(fnBody);
    if (dynamicKeyPattern && hasStorageWrite) {
      findings.push({
        ruleId: "SOROBAN-EXP-04",
        severity: "high",
        line: fn.line,
        functionName: fn.name,
        pattern: "dynamic_key_pattern",
        message: `Function '${fn.name}' appears to generate dynamic keys for storage writes, which can lead to unbounded key creation.`,
        suggestion: "Use a fixed set of storage keys or implement a key recycling mechanism to prevent unbounded key growth.",
        growthRisk: "unbounded",
        estimatedImpact: "New storage key created per transaction invocation",
      });
    }

    const dataKeyUsage = new Set<string>();
    for (const variant of dataKeyVariants) {
      if (fnBody.includes(`DataKey::${variant}`)) {
        dataKeyUsage.add(variant);
      }
    }

    if (dataKeyUsage.size > 0) {
      const hasParameterizedKey = Array.from(dataKeyUsage).some((v) => {
        const keyRegex = new RegExp(`DataKey::${v}\\s*\\(`, "g");
        return keyRegex.test(fnBody);
      });

      if (hasParameterizedKey && hasGrowthOp) {
        findings.push({
          ruleId: "SOROBAN-EXP-05",
          severity: "medium",
          line: fn.line,
          functionName: fn.name,
          pattern: "unbounded_key_generation",
          message: `Function '${fn.name}' uses parameterized DataKey variants with collection growth, potentially creating unbounded storage keys.`,
          suggestion: "Limit the range of parameters used in DataKey variants, or implement key expiration and cleanup.",
          growthRisk: "unbounded",
        });
      }
    }

    const hasConditionalGrowth = /if\s+.*\{[^}]*\.push|if\s+.*\{[^}]*\.insert/.test(fnBody);
    if (hasConditionalGrowth && hasStorageWrite) {
      const hasCorrespondingRemove = /if\s+.*\{[^}]*\.remove|if\s+.*\{[^}]*\.pop/.test(fnBody);
      if (!hasCorrespondingRemove) {
        findings.push({
          ruleId: "SOROBAN-EXP-06",
          severity: "medium",
          line: fn.line,
          functionName: fn.name,
          pattern: "append_without_bound",
          message: `Function '${fn.name}' conditionally appends to storage without a corresponding removal condition.`,
          suggestion: "Add a corresponding cleanup condition or enforce a maximum size limit to bound storage growth.",
          growthRisk: "bounded_but_high",
        });
      }
    }
  }

  const functionsAtRisk = new Set(findings.map((f) => f.functionName)).size;
  const unboundedRisks = findings.filter((f) => f.growthRisk === "unbounded").length;
  const highSeverityRisks = findings.filter((f) => f.severity === "high").length;

  const patterns: Record<ExpansionPattern, number> = {
    unbounded_collection_growth: 0,
    unbounded_key_generation: 0,
    no_cleanup_mechanism: 0,
    growing_map_in_storage: 0,
    dynamic_key_pattern: 0,
    append_without_bound: 0,
  };

  for (const finding of findings) {
    patterns[finding.pattern]++;
  }

  let summary: string;
  if (findings.length === 0) {
    summary = "No storage footprint expansion risks detected.";
  } else {
    summary = `Detected ${findings.length} footprint expansion risk(s) across ${functionsAtRisk} function(s). ${unboundedRisks} unbounded growth risk(s) found.`;
  }

  return {
    findings,
    summary,
    metrics: {
      totalExpansionRisks: findings.length,
      unboundedRisks,
      highSeverityRisks,
      functionsAtRisk,
      patterns,
    },
  };
}
