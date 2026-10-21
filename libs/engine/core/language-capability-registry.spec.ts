import {
  buildLanguageCapabilityRegistry,
  getLanguageEntry,
  getAnalyzersForLanguage,
  getMergedCapabilitiesForLanguage,
  getAllRulesForLanguage,
  isRegistryHealthy,
} from "./language-capability-registry";
import {
  BaseAnalyzer,
  Language,
  Severity,
  type AnalysisResult,
  type AnalyzerConfig,
} from "./analyzer-interface";

// ─── Test stubs ───────────────────────────────────────────────────────────────

class StubAnalyzer extends BaseAnalyzer {
  constructor(
    private readonly _name: string,
    private readonly _version: string,
    private readonly _languages: Language[],
    private readonly _rules: Array<{ id: string; name: string; severity: Severity; enabled: boolean }> = [],
  ) {
    super();
  }

  getName() { return this._name; }
  getVersion() { return this._version; }
  getSupportedLanguages() { return this._languages; }
  supportsLanguage(lang: Language | string) { return (this._languages as string[]).includes(lang as string); }
  getRules() {
    return this._rules.map((r) => ({
      ...r,
      description: `${r.name} description`,
      category: "test",
    }));
  }

  async analyze(_code: string, filePath: string, _config?: AnalyzerConfig): Promise<AnalysisResult> {
    return {
      findings: [],
      filesAnalyzed: 1,
      analysisTime: 0,
      analyzerVersion: this._version,
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    };
  }
}

class ThrowingAnalyzer extends StubAnalyzer {
  getSupportedLanguages(): Language[] {
    throw new Error("introspection failure");
  }
}

const FIXED_NOW = "2024-06-01T00:00:00.000Z";
const clock = () => FIXED_NOW;

// ─── buildLanguageCapabilityRegistry ─────────────────────────────────────────

describe("buildLanguageCapabilityRegistry", () => {
  it("returns an empty snapshot with NO_ANALYZERS_REGISTERED issue when called with no analyzers", () => {
    const snap = buildLanguageCapabilityRegistry([], [], clock);

    expect(snap.coveredLanguages).toHaveLength(0);
    expect(snap.entries).toHaveLength(0);
    expect(snap.issues[0]?.code).toBe("NO_ANALYZERS_REGISTERED");
    expect(snap.builtAt).toBe(FIXED_NOW);
  });

  it("builds correct coverage entries for a single-language analyzer", () => {
    const analyzer = new StubAnalyzer("sol-analyzer", "1.0.0", [Language.SOLIDITY]);
    const snap = buildLanguageCapabilityRegistry([analyzer], [], clock);

    expect(snap.coveredLanguages).toContain(Language.SOLIDITY);
    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0]!.covered).toBe(true);
    expect(snap.entries[0]!.analyzers[0]!.analyzerName).toBe("sol-analyzer");
  });

  it("surfaces an UNCOVERED_LANGUAGE issue for an expected language with no analyzer", () => {
    const analyzer = new StubAnalyzer("sol-analyzer", "1.0.0", [Language.SOLIDITY]);
    const snap = buildLanguageCapabilityRegistry(
      [analyzer],
      [Language.SOLIDITY, Language.RUST],
      clock,
    );

    expect(snap.uncoveredLanguages).toContain(Language.RUST);
    expect(snap.issues.some((i) => i.code === "UNCOVERED_LANGUAGE" && i.language === Language.RUST)).toBe(true);
    // Covered entry still exists for RUST so callers can see it.
    const rustEntry = snap.entries.find((e) => e.language === Language.RUST);
    expect(rustEntry?.covered).toBe(false);
  });

  it("records INTROSPECTION_ERROR and continues when an analyzer throws", () => {
    const good = new StubAnalyzer("good", "1.0.0", [Language.SOLIDITY]);
    const bad = new ThrowingAnalyzer("bad", "1.0.0", []);
    const snap = buildLanguageCapabilityRegistry([good, bad], [], clock);

    // good analyzer still produces its entry
    expect(snap.coveredLanguages).toContain(Language.SOLIDITY);
    expect(snap.issues.some((i) => i.code === "INTROSPECTION_ERROR" && i.analyzerName === "bad")).toBe(true);
  });

  it("entries are sorted alphabetically by language", () => {
    const a = new StubAnalyzer("z", "1.0.0", [Language.TYPESCRIPT]);
    const b = new StubAnalyzer("a", "1.0.0", [Language.SOLIDITY]);
    const snap = buildLanguageCapabilityRegistry([a, b], [], clock);

    const languages = snap.entries.map((e) => e.language);
    expect(languages).toEqual([...languages].sort());
  });

  it("realistic: two analyzers covering different languages plus one expected gap", () => {
    const solAnalyzer = new StubAnalyzer(
      "solidity-analyzer",
      "2.1.0",
      [Language.SOLIDITY],
      [
        { id: "sol-001", name: "Reentrancy", severity: Severity.CRITICAL, enabled: true },
        { id: "sol-002", name: "tx.origin", severity: Severity.HIGH, enabled: true },
      ],
    );
    const rustAnalyzer = new StubAnalyzer(
      "rust-analyzer",
      "1.0.0",
      [Language.RUST],
      [
        { id: "rust-001", name: "UnsafeBlock", severity: Severity.MEDIUM, enabled: true },
      ],
    );

    const snap = buildLanguageCapabilityRegistry(
      [solAnalyzer, rustAnalyzer],
      [Language.SOLIDITY, Language.RUST, Language.VYPER],
      clock,
    );

    expect(snap.coveredLanguages).toEqual([Language.RUST, Language.SOLIDITY].sort());
    expect(snap.uncoveredLanguages).toEqual([Language.VYPER]);
    expect(snap.issues.some((i) => i.code === "UNCOVERED_LANGUAGE")).toBe(true);
    expect(snap.issues.filter((i) => i.code === "UNCOVERED_LANGUAGE")).toHaveLength(1);
  });
});

// ─── Query helpers ────────────────────────────────────────────────────────────

describe("getLanguageEntry", () => {
  it("returns the entry for a covered language", () => {
    const a = new StubAnalyzer("a", "1.0.0", [Language.SOLIDITY]);
    const snap = buildLanguageCapabilityRegistry([a], [], clock);
    const entry = getLanguageEntry(snap, Language.SOLIDITY);

    expect(entry).toBeDefined();
    expect(entry!.language).toBe(Language.SOLIDITY);
  });

  it("returns undefined for an unknown language", () => {
    const snap = buildLanguageCapabilityRegistry([], [], clock);
    expect(getLanguageEntry(snap, "unknown-lang")).toBeUndefined();
  });
});

describe("getAnalyzersForLanguage", () => {
  it("returns all analyzer names for a covered language", () => {
    const a = new StubAnalyzer("alpha", "1.0.0", [Language.SOLIDITY]);
    const b = new StubAnalyzer("beta", "1.0.0", [Language.SOLIDITY]);
    const snap = buildLanguageCapabilityRegistry([a, b], [], clock);

    expect(getAnalyzersForLanguage(snap, Language.SOLIDITY)).toEqual(["alpha", "beta"]);
  });

  it("returns empty array for an unregistered language", () => {
    const snap = buildLanguageCapabilityRegistry([], [], clock);
    expect(getAnalyzersForLanguage(snap, "cobol")).toEqual([]);
  });
});

describe("getMergedCapabilitiesForLanguage", () => {
  it("merges capabilities from multiple analyzers covering the same language", () => {
    const a = new StubAnalyzer("a", "1.0.0", [Language.SOLIDITY]);
    const b = new StubAnalyzer("b", "1.0.0", [Language.SOLIDITY]);
    // Default getCapabilities from BaseAnalyzer includes batchAnalysis, incremental, etc.
    const snap = buildLanguageCapabilityRegistry([a, b], [], clock);
    const merged = getMergedCapabilitiesForLanguage(snap, Language.SOLIDITY);

    expect(merged.batchAnalysis).toBe(true);
    expect(merged.incremental).toBe(true);
  });

  it("returns empty object for unknown language", () => {
    const snap = buildLanguageCapabilityRegistry([], [], clock);
    expect(getMergedCapabilitiesForLanguage(snap, "unknown")).toEqual({});
  });
});

describe("getAllRulesForLanguage", () => {
  it("returns deduplicated rules for a language", () => {
    const sharedRule = { id: "shared-001", name: "Shared", severity: Severity.LOW, enabled: true };
    const a = new StubAnalyzer("a", "1.0.0", [Language.SOLIDITY], [sharedRule]);
    const b = new StubAnalyzer("b", "1.0.0", [Language.SOLIDITY], [sharedRule]);
    const snap = buildLanguageCapabilityRegistry([a, b], [], clock);

    const rules = getAllRulesForLanguage(snap, Language.SOLIDITY);
    expect(rules.filter((r) => r.id === "shared-001")).toHaveLength(1);
  });

  it("returns empty array for unknown language", () => {
    const snap = buildLanguageCapabilityRegistry([], [], clock);
    expect(getAllRulesForLanguage(snap, "fortran")).toEqual([]);
  });
});

describe("isRegistryHealthy", () => {
  it("returns true when there are no issues", () => {
    const a = new StubAnalyzer("a", "1.0.0", [Language.SOLIDITY]);
    const snap = buildLanguageCapabilityRegistry([a], [], clock);
    expect(isRegistryHealthy(snap)).toBe(true);
  });

  it("returns false when there are uncovered expected languages", () => {
    const a = new StubAnalyzer("a", "1.0.0", [Language.SOLIDITY]);
    const snap = buildLanguageCapabilityRegistry([a], [Language.RUST], clock);
    expect(isRegistryHealthy(snap)).toBe(false);
  });
});
