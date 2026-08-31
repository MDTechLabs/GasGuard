/**
 * Soroban Storage Entry Classifier
 *
 * Classifies storage entries by their semantic purpose based on naming
 * conventions, usage patterns, and data flow analysis. Helps developers
 * understand the role of each storage entry and identify misclassified
 * entries (e.g., temporary data in persistent storage).
 */

import {
  maskNonCode,
  createLineResolver,
  extractFunctions,
  extractArgs,
  splitArgs,
  normalizeExpr,
} from "../common/source-utils";

export type EntryCategory =
  | "configuration"
  | "access_control"
  | "user_data"
  | "counter"
  | "cache"
  | "state"
  | "metadata"
  | "token"
  | "mapping"
  | "unknown";

export type StorageTier = "instance" | "persistent" | "temporary";

export interface ClassifiedStorageEntry {
  key: string;
  tier: StorageTier;
  category: EntryCategory;
  line: number;
  offset: number;
  accessTypes: Set<string>;
  declaredInFunction: string | null;
  writeCount: number;
  readCount: number;
  confidence: "high" | "medium" | "low";
  classificationReasons: string[];
}

export interface StorageEntryClassificationReport {
  entries: ClassifiedStorageEntry[];
  summary: string;
  metrics: {
    totalEntries: number;
    byCategory: Record<EntryCategory, number>;
    byTier: Record<StorageTier, number>;
    highConfidenceClassifications: number;
    potentialMisclassifications: number;
  };
  misclassificationWarnings: MisclassificationWarning[];
}

export interface MisclassificationWarning {
  ruleId: string;
  severity: "medium" | "low";
  line: number;
  key: string;
  currentTier: StorageTier;
  suggestedTier: StorageTier;
  message: string;
  suggestion: string;
}

const CONFIGURATION_KEYWORDS = [
  "admin",
  "owner",
  "config",
  "setting",
  "parameter",
  "param",
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
];

const ACCESS_CONTROL_KEYWORDS = [
  "role",
  "permission",
  "acl",
  "allow",
  "deny",
  "whitelist",
  "blacklist",
  "gate",
  "auth",
  "access",
  "freeze",
  "frozen",
  "paused",
];

const COUNTER_KEYWORDS = [
  "count",
  "counter",
  "nonce",
  "total",
  "num",
  "index",
  "sequence",
  "id_counter",
  "supply",
];

const CACHE_KEYWORDS = [
  "cache",
  "cached",
  "temp",
  "tmp",
  "buffer",
  "pending",
  "staging",
  "scratch",
  "ephemeral",
  "session",
];

const TOKEN_KEYWORDS = [
  "token",
  "balance",
  "allowance",
  "decimals",
  "name",
  "symbol",
  "asset",
  "issuer",
  "supply",
];

const METADATA_KEYWORDS = [
  "version",
  "impl",
  "hash",
  "uri",
  "metadata",
  "schema",
  "created",
  "updated",
  "timestamp",
  "block",
];

const MAPPING_KEYWORDS = ["map", "dict", "lookup", "by_", "from_", "to_"];

const STORAGE_READ_METHODS = new Set(["get", "has", "get_unchecked"]);
const STORAGE_WRITE_METHODS = new Set(["set", "put"]);

const STORAGE_ACCESS_REGEX =
  /\bstorage\s*\(\s*\)\s*\.\s*(instance|persistent|temporary)\s*\(\s*\)\s*\.\s*([a-zA-Z0-9_]+)\s*\(/g;

const SYMBOL_DEF_REGEX =
  /(?:let|const)\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=;]+)?=\s*(?:Symbol::new|symbol_short!)\s*\(&?env,\s*"([^"]+)"\)/g;

const DATAKEY_DEF_REGEX = /DataKey::([a-zA-Z0-9_]+)\s*[{)]/g;

function classifyByKeyName(key: string): { category: EntryCategory; confidence: "high" | "medium" | "low"; reasons: string[] } {
  const lower = key.toLowerCase();
  const parts = lower.split(/[_]+/);

  const reasons: string[] = [];
  let bestCategory: EntryCategory = "unknown";
  let bestScore = 0;

  const scoreCategory = (keywords: string[], category: EntryCategory, weight: number): number => {
    let score = 0;
    for (const kw of keywords) {
      if (lower === kw) {
        score += weight * 3;
        reasons.push(`exact match with '${kw}'`);
      } else if (parts.includes(kw)) {
        score += weight * 2;
        reasons.push(`contains '${kw}' segment`);
      } else if (lower.includes(kw)) {
        score += weight;
        reasons.push(`contains '${kw}' substring`);
      }
    }
    return score;
  };

  const categories: [string[], EntryCategory, number][] = [
    [ACCESS_CONTROL_KEYWORDS, "access_control", 1.2],
    [CONFIGURATION_KEYWORDS, "configuration", 1.0],
    [TOKEN_KEYWORDS, "token", 1.1],
    [COUNTER_KEYWORDS, "counter", 1.0],
    [CACHE_KEYWORDS, "cache", 1.3],
    [METADATA_KEYWORDS, "metadata", 1.0],
    [MAPPING_KEYWORDS, "mapping", 0.9],
  ];

  for (const [keywords, category, weight] of categories) {
    const score = scoreCategory(keywords, category, weight);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  if (bestScore === 0) {
    if (/^(is_|has_|can_|should_)/.test(lower)) {
      bestCategory = "state";
      reasons.push("boolean state prefix pattern");
      bestScore = 1;
    } else if (lower.endsWith("_data") || lower.endsWith("_info") || lower.endsWith("_details")) {
      bestCategory = "user_data";
      reasons.push("data suffix pattern");
      bestScore = 1;
    }
  }

  const confidence: "high" | "medium" | "low" =
    bestScore >= 4 ? "high" : bestScore >= 2 ? "medium" : "low";

  return { category: bestCategory, confidence, reasons };
}

function classifyByUsage(
  entry: ClassifiedStorageEntry
): { category: EntryCategory; confidence: "high" | "medium" | "low"; reasons: string[] } {
  const reasons: string[] = [];
  const { accessTypes, writeCount, readCount, tier } = entry;

  if (tier === "temporary" && accessTypes.has("set") && !accessTypes.has("get")) {
    reasons.push("write-only access in temporary storage");
    return { category: "cache", confidence: "medium", reasons };
  }

  if (tier === "instance" && (entry.key.toLowerCase() === "instance" || writeCount <= 1)) {
    reasons.push("instance storage with limited writes");
    return { category: "configuration", confidence: "medium", reasons };
  }

  if (writeCount === 1 && readCount > 5) {
    reasons.push("write-once, read-many pattern");
    return { category: "configuration", confidence: "medium", reasons };
  }

  if (writeCount > readCount * 2 && readCount > 0) {
    reasons.push("write-heavy access pattern");
    return { category: "state", confidence: "low", reasons };
  }

  if (accessTypes.has("extend_ttl")) {
    reasons.push("explicit TTL extension detected");
    return { category: "user_data", confidence: "medium", reasons };
  }

  return { category: "unknown", confidence: "low", reasons };
}

export function classifyStorageEntries(source: string): StorageEntryClassificationReport {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);

  const keyToName = new Map<string, string>();
  let symMatch: RegExpExecArray | null;
  const symRe = new RegExp(SYMBOL_DEF_REGEX.source, "g");
  while ((symMatch = symRe.exec(source)) !== null) {
    keyToName.set(symMatch[1], symMatch[2]);
  }

  const dataKeyNames = new Set<string>();
  let dkMatch: RegExpExecArray | null;
  const dkRe = new RegExp(DATAKEY_DEF_REGEX.source, "g");
  while ((dkMatch = dkRe.exec(masked)) !== null) {
    dataKeyNames.add(dkMatch[1]);
  }

  interface RawEntry {
    key: string;
    tier: StorageTier;
    method: string;
    line: number;
    offset: number;
    fnName: string | null;
  }

  const rawEntries: RawEntry[] = [];
  let m: RegExpExecArray | null;

  const accessRe = new RegExp(STORAGE_ACCESS_REGEX.source, "g");
  while ((m = accessRe.exec(masked)) !== null) {
    const offset = m.index;
    const tier = m[1] as StorageTier;
    const method = m[2];
    const line = lineOf(offset);

    const openParen = offset + m[0].length - 1;
    const argsText = extractArgs(masked, source, openParen).text;
    const args = splitArgs(argsText);
    const firstArg = args.length > 0 ? normalizeExpr(args[0]) : "";

    let key = firstArg;
    if (keyToName.has(key)) {
      key = keyToName.get(key)!;
    } else if (dataKeyNames.has(key)) {
      key = key;
    }

    let fnName: string | null = null;
    for (const fn of functions) {
      if (offset >= fn.bodyStart && offset < fn.bodyEnd) {
        fnName = fn.name;
        break;
      }
    }

    rawEntries.push({ key, tier, method, line, offset, fnName });
  }

  const entryMap = new Map<string, ClassifiedStorageEntry>();

  for (const raw of rawEntries) {
    const lookupKey = `${raw.tier}:${raw.key}`;
    let entry = entryMap.get(lookupKey);

    if (!entry) {
      const nameClassification = classifyByKeyName(raw.key);
      entry = {
        key: raw.key,
        tier: raw.tier,
        category: nameClassification.category,
        line: raw.line,
        offset: raw.offset,
        accessTypes: new Set<string>(),
        declaredInFunction: raw.fnName,
        writeCount: 0,
        readCount: 0,
        confidence: nameClassification.confidence,
        classificationReasons: [...nameClassification.reasons],
      };
      entryMap.set(lookupKey, entry);
    }

    if (STORAGE_READ_METHODS.has(raw.method)) {
      entry.accessTypes.add("get");
      entry.readCount++;
    } else if (STORAGE_WRITE_METHODS.has(raw.method)) {
      entry.accessTypes.add("set");
      entry.writeCount++;
    } else if (raw.method === "extend_ttl") {
      entry.accessTypes.add("extend_ttl");
    } else if (raw.method === "remove" || raw.method === "delete") {
      entry.accessTypes.add("remove");
    }

    if (raw.fnName && !entry.declaredInFunction) {
      entry.declaredInFunction = raw.fnName;
    }
  }

  const entries = Array.from(entryMap.values());

  for (const entry of entries) {
    if (entry.confidence === "low" || entry.category === "unknown") {
      const usageClassification = classifyByUsage(entry);
      if (usageClassification.confidence !== "low" || entry.category === "unknown") {
        entry.category = usageClassification.category;
        entry.confidence = usageClassification.confidence;
        entry.classificationReasons.push(...usageClassification.reasons);
      }
    }
  }

  const misclassificationWarnings: MisclassificationWarning[] = [];

  for (const entry of entries) {
    if (entry.tier === "persistent" && entry.category === "cache") {
      misclassificationWarnings.push({
        ruleId: "SOROBAN-STOR-CLASS-01",
        severity: "medium",
        line: entry.line,
        key: entry.key,
        currentTier: "persistent",
        suggestedTier: "temporary",
        message: `Storage entry '${entry.key}' classified as cache but stored in persistent storage.`,
        suggestion: `Consider moving '${entry.key}' to temporary storage if it does not need to persist across transactions.`,
      });
    }

    if (entry.tier === "temporary" && entry.category === "configuration") {
      misclassificationWarnings.push({
        ruleId: "SOROBAN-STOR-CLASS-02",
        severity: "medium",
        line: entry.line,
        key: entry.key,
        currentTier: "temporary",
        suggestedTier: "persistent",
        message: `Storage entry '${entry.key}' classified as configuration but stored in temporary storage.`,
        suggestion: `Configuration entries like '${entry.key}' typically need to persist across transactions. Consider using persistent storage.`,
      });
    }

    if (entry.tier === "instance" && entry.category === "user_data") {
      misclassificationWarnings.push({
        ruleId: "SOROBAN-STOR-CLASS-03",
        severity: "low",
        line: entry.line,
        key: entry.key,
        currentTier: "instance",
        suggestedTier: "persistent",
        message: `Storage entry '${entry.key}' classified as user data but stored in instance storage.`,
        suggestion: `User data entries like '${entry.key}' may outlive the contract instance. Consider persistent storage with TTL management.`,
      });
    }

    if (entry.tier === "temporary" && entry.accessTypes.has("extend_ttl")) {
      misclassificationWarnings.push({
        ruleId: "SOROBAN-STOR-CLASS-04",
        severity: "low",
        line: entry.line,
        key: entry.key,
        currentTier: "temporary",
        suggestedTier: "persistent",
        message: `Temporary storage entry '${entry.key}' uses extend_ttl, suggesting it needs longer persistence.`,
        suggestion: `If '${entry.key}' needs explicit TTL management, consider using persistent storage instead.`,
      });
    }
  }

  const byCategory: Record<EntryCategory, number> = {
    configuration: 0,
    access_control: 0,
    user_data: 0,
    counter: 0,
    cache: 0,
    state: 0,
    metadata: 0,
    token: 0,
    mapping: 0,
    unknown: 0,
  };

  const byTier: Record<StorageTier, number> = {
    instance: 0,
    persistent: 0,
    temporary: 0,
  };

  let highConfidence = 0;

  for (const entry of entries) {
    byCategory[entry.category]++;
    byTier[entry.tier]++;
    if (entry.confidence === "high") highConfidence++;
  }

  const totalEntries = entries.length;
  const misclassCount = misclassificationWarnings.length;

  let summary: string;
  if (totalEntries === 0) {
    summary = "No storage entries detected for classification.";
  } else {
    const topCategory = (Object.entries(byCategory) as [EntryCategory, number][])
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])[0];
    summary = `Classified ${totalEntries} storage entries. Primary category: ${topCategory[0]} (${topCategory[1]} entries). ${misclassCount} potential misclassification(s) detected.`;
  }

  return {
    entries,
    summary,
    metrics: {
      totalEntries,
      byCategory,
      byTier,
      highConfidenceClassifications: highConfidence,
      potentialMisclassifications: misclassCount,
    },
    misclassificationWarnings,
  };
}
