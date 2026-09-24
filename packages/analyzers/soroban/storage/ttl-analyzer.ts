/**
 * Soroban TTL Analyzer (Issues #886 + #887)
 *
 * Lexical analysis of storage writes and TTL extensions:
 *
 *  - #886 Detect Missing Soroban TTL Extensions — persistent storage entries
 *    that are written but never receive an `extend_ttl` may expire and leave
 *    important contract state unavailable. Intentionally temporary state
 *    (`env.storage().temporary()`) is excluded.
 *  - #887 Detect Excessive Soroban TTL Extensions — repeated or redundant
 *    `extend_ttl` calls on the same storage entry increase resource
 *    consumption and transaction overhead.
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
} from '../common/source-utils';

export type StorageTier = 'persistent' | 'instance' | 'temporary';

export interface StorageWriteSite {
  /** Normalized storage key expression (e.g. DataKey::Config). */
  key: string;
  tier: StorageTier;
  line: number;
  functionName: string;
}

export interface TtlExtensionSite {
  /** Normalized key the extension applies to. */
  key: string;
  tier: StorageTier;
  line: number;
  functionName: string;
  /** Raw threshold/bump arguments (may be named constants). */
  thresholdArg: string;
  bumpArg: string;
  inLoop: boolean;
}

export interface StorageEntryProfile {
  key: string;
  tier: StorageTier;
  writes: StorageWriteSite[];
  extensions: TtlExtensionSite[];
}

export interface MissingTtlExtensionFinding {
  rule: 'G1-missing-ttl-extend';
  line: number;
  key: string;
  functionName: string;
  message: string;
  suggestion: string;
  severity: 'high' | 'medium' | 'low';
}

export interface MissingTtlReport {
  findings: MissingTtlExtensionFinding[];
  summary: string;
  metrics: {
    persistentEntries: number;
    extendedEntries: number;
    unextendedEntries: number;
    temporaryEntriesExcluded: number;
  };
}

export interface ExcessiveTtlExtensionFinding {
  rule: 'G2-excessive-ttl-extend';
  line: number;
  key: string;
  functionName: string;
  /** Lines of every extension on this key within the reported scope. */
  extensionLines: number[];
  message: string;
  suggestion: string;
  severity: 'high' | 'medium' | 'low';
  kind: 'repeated_in_function' | 'redundant_same_args' | 'extension_in_loop';
}

export interface ExcessiveTtlReport {
  findings: ExcessiveTtlExtensionFinding[];
  summary: string;
  metrics: {
    extendedEntries: number;
    extensionCalls: number;
    redundantExtensions: number;
    extensionsInLoops: number;
  };
}

interface TtlScanResult {
  writes: StorageWriteSite[];
  extensions: TtlExtensionSite[];
}

function tierFromReceiver(receiver: string): StorageTier | null {
  if (/persistent\s*\(\s*\)/.test(receiver)) return 'persistent';
  if (/temporary\s*\(\s*\)/.test(receiver)) return 'temporary';
  if (/instance\s*\(\s*\)/.test(receiver)) return 'instance';
  return null;
}

/**
 * Collect every storage write and TTL extension call with normalized keys.
 */
function collectStorageSites(
  masked: string,
  original: string,
): { writes: StorageWriteSite[]; extensions: TtlExtensionSite[] } {
  const writes: StorageWriteSite[] = [];
  const extensions: TtlExtensionSite[] = [];
  const lineOf = createLineResolver(original);
  const functions = extractFunctions(masked, original);

  const callRe = /\.(set|extend_ttl)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(masked)) !== null) {
    const isExtend = m[1] === 'extend_ttl';
    const openParen = m.index + m[0].length - 1;
    const { text } = extractArgs(masked, original, openParen);
    const args = splitArgs(text);
    if (args.length === 0) continue;

    const receiver = receiverUpTo(masked, m.index);
    const tier = tierFromReceiver(receiver);
    if (!tier) continue;

    const fn = functions.find(
      (f) => f.bodyStart <= openParen && openParen <= f.bodyEnd,
    );
    const stack = fn ? blockStackAt(masked, fn.bodyStart, openParen) : [];
    const site = {
      key: args[0],
      tier,
      line: lineOf(m.index),
      functionName: fn?.name ?? '<unknown>',
    };

    if (isExtend) {
      if (args.length < 3) continue;
      extensions.push({
        ...site,
        thresholdArg: args[1],
        bumpArg: args[2],
        inLoop: isInLoop(stack),
      });
    } else {
      writes.push(site);
    }
  }

  return { writes, extensions };
}

/** Walk backwards from a `.method(` dot to capture the receiver expression. */
function receiverUpTo(masked: string, dotIndex: number): string {
  let depth = 0;
  let i = dotIndex - 1;
  const parts: string[] = [];
  let current = '';

  while (i >= 0) {
    const ch = masked[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) break;
      depth--;
    }
    if (depth === 0 && !/[A-Za-z0-9_.()&\s]/.test(ch)) break;
    if (ch === '.' && depth === 0) {
      parts.unshift(current);
      current = '';
    } else {
      current = ch + current;
    }
    i--;
  }
  if (current) parts.unshift(current);
  return parts.join('.');
}

/**
 * Merge write/extension sites into per-key storage entry profiles.
 * Temporary entries are always profiled so #886 can exclude them.
 */
function profileEntries(masked: string, original: string): StorageEntryProfile[] {
  const { writes, extensions } = collectStorageSites(masked, original);
  const byKey = new Map<string, StorageEntryProfile>();

  const record = (site: StorageWriteSite | TtlExtensionSite, isWrite: boolean) => {
    const composite = `${site.tier}\u0000${site.key}`;
    let profile = byKey.get(composite);
    if (!profile) {
      profile = { key: site.key, tier: site.tier, writes: [], extensions: [] };
      byKey.set(composite, profile);
    }
    if (isWrite) profile.writes.push(site as StorageWriteSite);
    else profile.extensions.push(site as TtlExtensionSite);
  };

  for (const w of writes) record(w, true);
  for (const e of extensions) record(e, false);

  return [...byKey.values()];
}

/**
 * #886 — Persistent entries that are written but never TTL-extended.
 * Temporary state is intentionally excluded.
 */
export function analyzeMissingTtlExtensions(source: string): MissingTtlReport {
  const masked = maskNonCode(source);
  const profiles = profileEntries(masked, source);

  const persistent = profiles.filter((p) => p.tier === 'persistent');
  const temporaryCount = profiles.filter((p) => p.tier === 'temporary' && p.writes.length > 0)
    .length;

  const findings: MissingTtlExtensionFinding[] = [];
  for (const entry of persistent) {
    const written = entry.writes.length > 0;
    const extended = entry.extensions.length > 0;
    if (!written || extended) continue;

    const first = entry.writes[0];
    findings.push({
      rule: 'G1-missing-ttl-extend',
      line: first.line,
      key: entry.key,
      functionName: first.functionName,
      message:
        `Persistent storage entry '${entry.key}' is written in ${entry.writes.length} place(s) ` +
        `but never receives an extend_ttl call — it may expire and become unavailable.`,
      suggestion:
        `Call \`env.storage().persistent().extend_ttl(&${entry.key}, THRESHOLD, BUMP)\` after ` +
        `writing '${entry.key}' (or during a dedicated maintenance entrypoint). If this entry is ` +
        `short-lived, move it to \`env.storage().temporary()\` to exclude it from archival requirements.`,
      severity: 'medium',
    });
  }

  const unextended = persistent.filter((p) => p.writes.length > 0 && p.extensions.length === 0)
    .length;
  const summary =
    unextended === 0
      ? 'Every written persistent storage entry has at least one TTL extension.'
      : `Found ${unextended} persistent storage entry/entries without any TTL extension.`;

  return {
    findings,
    summary,
    metrics: {
      persistentEntries: persistent.length,
      extendedEntries: persistent.filter((p) => p.extensions.length > 0).length,
      unextendedEntries: unextended,
      temporaryEntriesExcluded: temporaryCount,
    },
  };
}

/**
 * #887 — Excessive or redundant extend_ttl usage.
 *
 * Flags:
 *  - repeated extensions of the same key within one function (>= 2),
 *  - redundant extensions with identical threshold/bump args anywhere,
 *  - extensions performed inside loops.
 */
export function analyzeExcessiveTtlExtensions(
  source: string,
): ExcessiveTtlReport {
  const masked = maskNonCode(source);
  const profiles = profileEntries(masked, source).filter(
    (p) => p.extensions.length > 0,
  );

  const findings: ExcessiveTtlExtensionFinding[] = [];
  let redundant = 0;
  let inLoops = 0;

  for (const entry of profiles) {
    // Group extensions by function for repeated-extension detection.
    const byFunction = new Map<string, TtlExtensionSite[]>();
    for (const ext of entry.extensions) {
      const list = byFunction.get(ext.functionName) ?? [];
      list.push(ext);
      byFunction.set(ext.functionName, list);
    }

    for (const [fn, exts] of byFunction.entries()) {
      if (exts.length >= 2) {
        findings.push({
          rule: 'G2-excessive-ttl-extend',
          line: exts[0].line,
          key: entry.key,
          functionName: fn,
          extensionLines: exts.map((e) => e.line),
          message: `Storage entry '${entry.key}' is TTL-extended ${exts.length} times in '${fn}'.`,
          suggestion:
            `Consolidate TTL extensions for '${entry.key}': extend once after the final write ` +
            `(or bump lazily on read) instead of extending at every write site.`,
          severity: 'medium',
          kind: 'repeated_in_function',
        });
      }

      // Redundant extensions: identical threshold and bump args.
      const byArgs = new Map<string, TtlExtensionSite>();
      for (const ext of exts) {
        const first = byArgs.get(argArgsKey(ext));
        if (first && first !== ext) {
          redundant++;
          findings.push({
            rule: 'G2-excessive-ttl-extend',
            line: ext.line,
            key: entry.key,
            functionName: fn,
            extensionLines: [first.line, ext.line],
            message:
              `Redundant extend_ttl on '${entry.key}' — identical call already made at line ${first.line}.`,
            suggestion:
              `Remove the duplicate extension at line ${ext.line}; one extend_ttl with ` +
              `(${ext.thresholdArg}, ${ext.bumpArg}) per write is sufficient.`,
            severity: 'medium',
            kind: 'redundant_same_args',
          });
        } else if (!first) {
          byArgs.set(argArgsKey(ext), ext);
        }
      }

      for (const ext of exts) {
        if (ext.inLoop) {
          inLoops++;
          findings.push({
            rule: 'G2-excessive-ttl-extend',
            line: ext.line,
            key: entry.key,
            functionName: fn,
            extensionLines: [ext.line],
            message:
              `extend_ttl on '${entry.key}' is executed inside a loop — repeated ledger bumps per iteration.`,
            suggestion:
              `Hoist the extend_ttl for '${entry.key}' out of the loop, or extend once after the loop.`,
            severity: 'medium',
            kind: 'extension_in_loop',
          });
        }
      }
    }
  }

  const summary =
    findings.length === 0
      ? 'No excessive or redundant TTL extensions detected.'
      : `Found ${findings.length} excessive TTL extension issue(s) across ${profiles.length} storage entry/entries.`;

  return {
    findings,
    summary,
    metrics: {
      extendedEntries: profiles.length,
      extensionCalls: profiles.reduce((acc, p) => acc + p.extensions.length, 0),
      redundantExtensions: redundant,
      extensionsInLoops: inLoops,
    },
  };
}

function argArgsKey(ext: TtlExtensionSite): string {
  return `${ext.thresholdArg}|${ext.bumpArg}`;
}

export class MissingTtlExtensionAnalyzer {
  public static readonly RULE_ID = 'soroban-missing-ttl-extension';

  analyze(source: string): MissingTtlReport {
    return analyzeMissingTtlExtensions(source);
  }
}

export class ExcessiveTtlExtensionAnalyzer {
  public static readonly RULE_ID = 'soroban-excessive-ttl-extension';

  analyze(source: string): ExcessiveTtlReport {
    return analyzeExcessiveTtlExtensions(source);
  }
}
