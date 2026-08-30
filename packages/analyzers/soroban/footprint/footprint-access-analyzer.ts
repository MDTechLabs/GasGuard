/**
 * Soroban Footprint Access Analyzer
 *
 * Analyzes access patterns within Soroban transaction footprints to identify:
 * - Read-heavy vs write-heavy footprint imbalances
 * - Access density (keys accessed per function)
 * - Footprint overlap between functions
 * - Hot vs cold key separation opportunities
 * - Unused or rarely-used footprint entries
 * - Access pattern anomalies that suggest optimization opportunities
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

export type AccessPatternType =
  | "read_heavy"
  | "write_heavy"
  | "hot_key"
  | "cold_key"
  | "unused_entry"
  | "high_overlap"
  | "loop_access"
  | "imbalanced_access";

export interface FootprintKeyAccess {
  key: string;
  storageTier: "instance" | "persistent" | "temporary";
  readCount: number;
  writeCount: number;
  functions: Set<string>;
  lines: number[];
  inLoop: boolean;
  accessDensity: number;
}

export interface FunctionFootprintProfile {
  functionName: string;
  keysAccessed: string[];
  readCount: number;
  writeCount: number;
  loopAccessCount: number;
  isReadHeavy: boolean;
  isWriteHeavy: boolean;
}

export interface FootprintAccessFinding {
  ruleId: string;
  severity: "high" | "medium" | "low" | "info";
  line: number;
  pattern: AccessPatternType;
  message: string;
  suggestion: string;
  affectedKeys?: string[];
  functionName?: string;
  estimatedImpact?: string;
}

export interface FootprintAccessReport {
  findings: FootprintAccessFinding[];
  keyAccessMap: Record<string, FootprintKeyAccess>;
  functionProfiles: FunctionFootprintProfile[];
  summary: string;
  metrics: {
    totalKeys: number;
    totalReads: number;
    totalWrites: number;
    hotKeys: number;
    coldKeys: number;
    loopAccesses: number;
    averageAccessDensity: number;
    footprintOverlapScore: number;
  };
}

const STORAGE_ACCESS_REGEX =
  /\bstorage\s*\(\s*\)\s*\.\s*(instance|persistent|temporary)\s*\(\s*\)\s*\.\s*([a-zA-Z0-9_]+)\s*\(/g;

const SYMBOL_DEF_REGEX =
  /(?:let|const)\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=;]+)?=\s*(?:Symbol::new|symbol_short!)\s*\(&?env,\s*"([^"]+)"\)/g;

const READ_METHODS = new Set(["get", "has", "get_unchecked"]);
const WRITE_METHODS = new Set(["set", "put"]);

const HOT_KEY_THRESHOLD = 5;
const COLD_KEY_THRESHOLD = 1;

export function analyzeFootprintAccess(source: string): FootprintAccessReport {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);
  const findings: FootprintAccessFinding[] = [];

  const keyToName = new Map<string, string>();
  let symMatch: RegExpExecArray | null;
  const symRe = new RegExp(SYMBOL_DEF_REGEX.source, "g");
  while ((symMatch = symRe.exec(source)) !== null) {
    keyToName.set(symMatch[1], symMatch[2]);
  }

  const keyAccessData = new Map<string, FootprintKeyAccess>();

  let m: RegExpExecArray | null;
  const accessRe = new RegExp(STORAGE_ACCESS_REGEX.source, "g");
  while ((m = accessRe.exec(masked)) !== null) {
    const offset = m.index;
    const tier = m[1] as "instance" | "persistent" | "temporary";
    const method = m[2];
    const line = lineOf(offset);

    const openParen = offset + m[0].length - 1;
    const argsText = extractArgs(masked, source, openParen).text;
    const args = splitArgs(argsText);
    const firstArg = args.length > 0 ? normalizeExpr(args[0]) : "";

    let key = firstArg;
    if (keyToName.has(key)) {
      key = keyToName.get(key)!;
    }

    let fnName = "global";
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

    const stack = blockStackAt(masked, fnBodyStart, offset);
    const inLoop = isInLoop(stack);

    const lookupKey = `${tier}:${key}`;
    let access = keyAccessData.get(lookupKey);

    if (!access) {
      access = {
        key,
        storageTier: tier,
        readCount: 0,
        writeCount: 0,
        functions: new Set<string>(),
        lines: [],
        inLoop: false,
        accessDensity: 0,
      };
      keyAccessData.set(lookupKey, access);
    }

    if (READ_METHODS.has(method)) {
      access.readCount++;
    } else if (WRITE_METHODS.has(method)) {
      access.writeCount++;
    }

    access.functions.add(fnName);
    access.lines.push(line);
    if (inLoop) access.inLoop = true;
  }

  let totalReads = 0;
  let totalWrites = 0;
  let loopAccesses = 0;
  let hotKeys = 0;
  let coldKeys = 0;

  for (const [lookupKey, access] of keyAccessData) {
    const totalAccesses = access.readCount + access.writeCount;
    access.accessDensity = totalAccesses;

    totalReads += access.readCount;
    totalWrites += access.writeCount;
    if (access.inLoop) loopAccesses++;

    if (totalAccesses >= HOT_KEY_THRESHOLD) {
      hotKeys++;
      findings.push({
        ruleId: "SOROBAN-FPA-01",
        severity: "info",
        line: access.lines[0],
        pattern: "hot_key",
        message: `Hot key detected: '${access.key}' (${totalAccesses} accesses across ${access.functions.size} function(s)).`,
        suggestion: `Key '${access.key}' is frequently accessed. Ensure it is optimally cached and consider keeping it in instance storage for fastest access.`,
        affectedKeys: [access.key],
        functionName: Array.from(access.functions)[0],
        estimatedImpact: `High-frequency access to '${access.key}' accounts for ${totalAccesses} of ${totalReads + totalWrites} total storage operations`,
      });
    }

    if (totalAccesses <= COLD_KEY_THRESHOLD && access.functions.size === 1) {
      coldKeys++;
      findings.push({
        ruleId: "SOROBAN-FPA-02",
        severity: "low",
        line: access.lines[0],
        pattern: "cold_key",
        message: `Cold key detected: '${access.key}' (only ${totalAccesses} access in ${Array.from(access.functions)[0]}).`,
        suggestion: `Key '${access.key}' is rarely accessed. Consider whether it needs to be in the active footprint or can be lazily loaded.`,
        affectedKeys: [access.key],
        functionName: Array.from(access.functions)[0],
      );
    }

    if (access.inLoop) {
      const totalAccesses = access.readCount + access.writeCount;
      findings.push({
        ruleId: "SOROBAN-FPA-03",
        severity: access.writeCount > 0 ? "high" : "medium",
        line: access.lines[0],
        pattern: "loop_access",
        message: `Key '${access.key}' is accessed inside a loop (${access.readCount} reads, ${access.writeCount} writes).`,
        suggestion: access.writeCount > 0
          ? `Buffer writes to '${access.key}' in a local collection and commit once after the loop.`
          : `Hoist reads of '${access.key}' outside the loop into a local variable.`,
        affectedKeys: [access.key],
        functionName: Array.from(access.functions)[0],
        estimatedImpact: `~${totalAccesses * 700} CPU instructions per loop execution`,
      });
    }

    if (access.readCount > 0 && access.writeCount > 0 && access.readCount > access.writeCount * 3) {
      findings.push({
        ruleId: "SOROBAN-FPA-04",
        severity: "low",
        line: access.lines[0],
        pattern: "imbalanced_access",
        message: `Key '${access.key}' has imbalanced access pattern: ${access.readCount} reads vs ${access.writeCount} writes.`,
        suggestion: `Consider caching '${access.key}' more aggressively since it is read ${Math.round(access.readCount / Math.max(access.writeCount, 1))}x more often than written.`,
        affectedKeys: [access.key],
        functionName: Array.from(access.functions)[0],
      });
    }
  }

  const functionProfiles: FunctionFootprintProfile[] = [];
  const fnAccessMap = new Map<string, { reads: number; writes: number; keys: Set<string>; loopAccesses: number }>();

  for (const [lookupKey, access] of keyAccessData) {
    for (const fn of access.functions) {
      let fnData = fnAccessMap.get(fn);
      if (!fnData) {
        fnData = { reads: 0, writes: 0, keys: new Set<string>(), loopAccesses: 0 };
        fnAccessMap.set(fn, fnData);
      }
      fnData.reads += access.readCount;
      fnData.writes += access.writeCount;
      fnData.keys.add(access.key);
      if (access.inLoop) fnData.loopAccesses++;
    }
  }

  for (const [fnName, data] of fnAccessMap) {
    const isReadHeavy = data.reads > data.writes * 2 && data.reads > 2;
    const isWriteHeavy = data.writes > data.reads * 2 && data.writes > 2;

    functionProfiles.push({
      functionName: fnName,
      keysAccessed: Array.from(data.keys),
      readCount: data.reads,
      writeCount: data.writes,
      loopAccessCount: data.loopAccesses,
      isReadHeavy,
      isWriteHeavy,
    });

    if (isReadHeavy) {
      findings.push({
        ruleId: "SOROBAN-FPA-05",
        severity: "low",
        line: 0,
        pattern: "read_heavy",
        message: `Function '${fnName}' is read-heavy (${data.reads} reads vs ${data.writes} writes across ${data.keys.size} keys).`,
        suggestion: `Consider batching reads or caching frequently accessed keys in local variables to reduce per-read overhead.`,
        functionName: fnName,
        affectedKeys: Array.from(data.keys),
      });
    }

    if (isWriteHeavy) {
      findings.push({
        ruleId: "SOROBAN-FPA-06",
        severity: "medium",
        line: 0,
        pattern: "write_heavy",
        message: `Function '${fnName}' is write-heavy (${data.writes} writes vs ${data.reads} reads across ${data.keys.size} keys).`,
        suggestion: `Consider consolidating writes or batching state changes to reduce ledger write fees.`,
        functionName: fnName,
        affectedKeys: Array.from(data.keys),
      });
    }
  }

  const fnOverlapPairs: { fn1: string; fn2: string; overlap: number; sharedKeys: string[] }[] = [];
  for (let i = 0; i < functionProfiles.length; i++) {
    for (let j = i + 1; j < functionProfiles.length; j++) {
      const a = functionProfiles[i];
      const b = functionProfiles[j];
      const shared = a.keysAccessed.filter((k) => b.keysAccessed.includes(k));
      if (shared.length > 0) {
        const overlap = shared.length / Math.min(a.keysAccessed.length, b.keysAccessed.length);
        fnOverlapPairs.push({ fn1: a.functionName, fn2: b.functionName, overlap, sharedKeys: shared });
      }
    }
  }

  const highOverlapPairs = fnOverlapPairs.filter((p) => p.overlap > 0.7);
  for (const pair of highOverlapPairs) {
    findings.push({
      ruleId: "SOROBAN-FPA-07",
      severity: "low",
      line: 0,
      pattern: "high_overlap",
      message: `Functions '${pair.fn1}' and '${pair.fn2}' have ${Math.round(pair.overlap * 100)}% footprint overlap (${pair.sharedKeys.length} shared keys).`,
      suggestion: `Consider consolidating these functions or sharing cached state to reduce redundant storage accesses.`,
      affectedKeys: pair.sharedKeys,
    });
  }

  const totalKeys = keyAccessData.size;
  const averageAccessDensity = totalKeys > 0
    ? (totalReads + totalWrites) / totalKeys
    : 0;

  const footprintOverlapScore = fnOverlapPairs.length > 0
    ? fnOverlapPairs.reduce((sum, p) => sum + p.overlap, 0) / fnOverlapPairs.length
    : 0;

  let summary: string;
  if (totalKeys === 0) {
    summary = "No footprint access patterns detected.";
  } else {
    summary = `Analyzed ${totalKeys} footprint keys with ${totalReads + totalWrites} total accesses. Found ${hotKeys} hot key(s), ${coldKeys} cold key(s), ${loopAccesses} loop access(es), and ${highOverlapPairs.length} high-overlap function pair(s).`;
  }

  const keyAccessMap: Record<string, FootprintKeyAccess> = {};
  for (const [k, v] of keyAccessData) {
    keyAccessMap[k] = v;
  }

  return {
    findings,
    keyAccessMap,
    functionProfiles,
    summary,
    metrics: {
      totalKeys,
      totalReads,
      totalWrites,
      hotKeys,
      coldKeys,
      loopAccesses,
      averageAccessDensity: Math.round(averageAccessDensity * 100) / 100,
      footprintOverlapScore: Math.round(footprintOverlapScore * 100) / 100,
    },
  };
}
