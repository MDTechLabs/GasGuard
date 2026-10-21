/**
 * Language-specific analyzer capability registry.
 *
 * The existing `AnalyzerRegistry` maps languages to analyzers but does not
 * expose per-language capability metadata in a queryable, documented form.
 * This module adds that layer without touching the registry internals.
 *
 * Design
 * ──────
 * - Immutable after construction: snapshot semantics prevent subtle concurrency
 *   bugs and make output deterministic for the same inputs.
 * - Tenant-safe: no global state; callers construct one instance per scan context.
 * - Unsupported-language handling: queries for unregistered languages return
 *   `undefined` / empty arrays so callers never receive silent zero-findings.
 * - Partial failure: individual analyzer introspection errors are recorded as
 *   `RegistryIssue` entries rather than thrown, so one bad analyzer does not
 *   prevent the registry from being built.
 */

import type { Analyzer, AnalyzerCapabilities, Language, Rule } from "./analyzer-interface";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Capability summary for a single analyzer scoped to a specific language.
 * Fields that cannot be determined are omitted (rather than set to false/0)
 * so callers can distinguish "not supported" from "not reported".
 */
export interface LanguageAnalyzerCapability {
  /** Stable identifier for the analyzer. */
  analyzerName: string;
  /** Declared version string. */
  analyzerVersion: string;
  /** The language this entry describes. */
  language: string;
  /** Capabilities advertised by the analyzer (may be a subset of all caps). */
  capabilities: AnalyzerCapabilities;
  /** Rules active for this language (id + severity). */
  rules: Array<{ id: string; name: string; severity: string; enabled: boolean }>;
}

/**
 * All capability information for a single language.
 */
export interface LanguageCapabilityEntry {
  language: string;
  /** Analyzers that claim this language, in registration order. */
  analyzers: LanguageAnalyzerCapability[];
  /**
   * True when at least one registered analyzer covers this language.
   * A `false` entry for an expected language surfaces a coverage gap.
   */
  covered: boolean;
}

export type CapabilityRegistryIssueCode =
  | "INTROSPECTION_ERROR"
  | "UNCOVERED_LANGUAGE"
  | "NO_ANALYZERS_REGISTERED";

export interface CapabilityRegistryIssue {
  code: CapabilityRegistryIssueCode;
  message: string;
  analyzerName?: string;
  language?: string;
}

export interface LanguageCapabilityRegistrySnapshot {
  /** Sorted list of all languages that have at least one analyzer. */
  coveredLanguages: string[];
  /**
   * Expected languages with no analyzer — populated only when
   * `expectedLanguages` was passed to `buildLanguageCapabilityRegistry`.
   */
  uncoveredLanguages: string[];
  /** Per-language capability entries, sorted by language. */
  entries: LanguageCapabilityEntry[];
  issues: CapabilityRegistryIssue[];
  /** ISO-8601 timestamp of when the snapshot was built. */
  builtAt: string;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Builds an immutable `LanguageCapabilityRegistrySnapshot` from a set of analyzers.
 *
 * @param analyzers         Analyzers to introspect.
 * @param expectedLanguages Languages the product claims to support; used to
 *                          surface coverage gaps as issues.
 * @param now               Injectable clock for deterministic snapshots in tests.
 */
export function buildLanguageCapabilityRegistry(
  analyzers: Analyzer[],
  expectedLanguages: Array<Language | string> = [],
  now: () => string = () => new Date().toISOString(),
): LanguageCapabilityRegistrySnapshot {
  const issues: CapabilityRegistryIssue[] = [];
  const languageMap = new Map<string, LanguageCapabilityEntry>();

  if (analyzers.length === 0) {
    issues.push({
      code: "NO_ANALYZERS_REGISTERED",
      message: "No analyzers are registered; no language coverage is possible.",
    });
  }

  for (const analyzer of analyzers) {
    let languages: string[];
    let capabilities: AnalyzerCapabilities;
    let rules: Rule[];

    try {
      languages = (analyzer.getSupportedLanguages() ?? []).map(String);
    } catch (err) {
      issues.push({
        code: "INTROSPECTION_ERROR",
        analyzerName: analyzer.getName(),
        message: `getSupportedLanguages() threw: ${String(err)}`,
      });
      continue;
    }

    try {
      capabilities = analyzer.getCapabilities?.() ?? {
        batchAnalysis: true,
        languages: analyzer.getSupportedLanguages(),
      };
    } catch (err) {
      issues.push({
        code: "INTROSPECTION_ERROR",
        analyzerName: analyzer.getName(),
        message: `getCapabilities() threw: ${String(err)}`,
      });
      capabilities = { batchAnalysis: true };
    }

    try {
      rules = analyzer.getRules();
    } catch (err) {
      issues.push({
        code: "INTROSPECTION_ERROR",
        analyzerName: analyzer.getName(),
        message: `getRules() threw: ${String(err)}`,
      });
      rules = [];
    }

    const ruleEntries = rules.map((r) => ({
      id: r.id,
      name: r.name,
      severity: r.severity as string,
      enabled: r.enabled,
    }));

    for (const lang of languages) {
      if (!languageMap.has(lang)) {
        languageMap.set(lang, {
          language: lang,
          analyzers: [],
          covered: true,
        });
      }

      languageMap.get(lang)!.analyzers.push({
        analyzerName: analyzer.getName(),
        analyzerVersion: analyzer.getVersion(),
        language: lang,
        capabilities,
        rules: ruleEntries,
      });
    }
  }

  // Expected-language gap detection.
  const uncoveredLanguages: string[] = [];
  for (const lang of expectedLanguages.map(String)) {
    if (!languageMap.has(lang)) {
      uncoveredLanguages.push(lang);
      issues.push({
        code: "UNCOVERED_LANGUAGE",
        language: lang,
        message:
          `Language "${lang}" has no registered analyzer. Scans will return ` +
          `zero findings for this language, which is indistinguishable from a clean result.`,
      });
      // Add a placeholder entry so callers can see it explicitly.
      languageMap.set(lang, {
        language: lang,
        analyzers: [],
        covered: false,
      });
    }
  }

  const entries = [...languageMap.values()].sort((a, b) =>
    a.language.localeCompare(b.language),
  );

  const coveredLanguages = entries
    .filter((e) => e.covered)
    .map((e) => e.language)
    .sort();

  return {
    coveredLanguages,
    uncoveredLanguages: [...uncoveredLanguages].sort(),
    entries,
    issues,
    builtAt: now(),
  };
}

// ─── Query helpers ────────────────────────────────────────────────────────────

/**
 * Returns the capability entry for a single language, or `undefined` when the
 * language is not present in the snapshot.
 */
export function getLanguageEntry(
  snapshot: LanguageCapabilityRegistrySnapshot,
  language: string,
): LanguageCapabilityEntry | undefined {
  return snapshot.entries.find((e) => e.language === language);
}

/**
 * Returns all analyzer names that cover a given language.
 * Returns an empty array (never throws) for unregistered languages.
 */
export function getAnalyzersForLanguage(
  snapshot: LanguageCapabilityRegistrySnapshot,
  language: string,
): string[] {
  return getLanguageEntry(snapshot, language)?.analyzers.map((a) => a.analyzerName) ?? [];
}

/**
 * Returns all distinct capabilities advertised across every analyzer that
 * covers the given language.
 */
export function getMergedCapabilitiesForLanguage(
  snapshot: LanguageCapabilityRegistrySnapshot,
  language: string,
): AnalyzerCapabilities {
  const entry = getLanguageEntry(snapshot, language);
  if (!entry) return {};

  const merged: AnalyzerCapabilities = {};
  for (const a of entry.analyzers) {
    for (const [key, value] of Object.entries(a.capabilities)) {
      // Capability is considered active for the language if any analyzer claims it.
      if (value) merged[key] = value;
    }
  }
  return merged;
}

/**
 * Returns all rules across analyzers that cover a specific language, deduped
 * by rule id (first declaration wins, matching registration order).
 */
export function getAllRulesForLanguage(
  snapshot: LanguageCapabilityRegistrySnapshot,
  language: string,
): Array<{ id: string; name: string; severity: string; enabled: boolean }> {
  const entry = getLanguageEntry(snapshot, language);
  if (!entry) return [];

  const seen = new Set<string>();
  const result: Array<{ id: string; name: string; severity: string; enabled: boolean }> = [];

  for (const analyzer of entry.analyzers) {
    for (const rule of analyzer.rules) {
      if (!seen.has(rule.id)) {
        seen.add(rule.id);
        result.push(rule);
      }
    }
  }

  return result;
}

/**
 * True when the snapshot has no coverage gaps or introspection errors.
 */
export function isRegistryHealthy(
  snapshot: LanguageCapabilityRegistrySnapshot,
): boolean {
  return snapshot.issues.length === 0 || snapshot.issues.every(
    (i) => i.code === "NO_ANALYZERS_REGISTERED" && snapshot.entries.length > 0,
  );
}
