import { StellarRefactorSuggestionEngine } from "./refactor-suggestion-engine";
import { RefactorFindingInput } from "./types";

describe("StellarRefactorSuggestionEngine", () => {
  const engine = new StellarRefactorSuggestionEngine();

  it("detects repeated finding patterns and links them back to findings", () => {
    const findings: RefactorFindingInput[] = [
      {
        ruleId: "SOR-001",
        message: "Repeated state variable access in loop",
        filePath: "contracts/vault.rs",
        line: 10,
        confidence: 0.91,
      },
      {
        ruleId: "SOR-001",
        message: "Expensive state variable access in loop",
        filePath: "contracts/vault.rs",
        line: 20,
        confidence: 0.92,
      },
    ];

    const suggestions = engine.suggestForFindings(findings);

    const repeated = suggestions.find((suggestion) =>
      suggestion.title.includes("Consolidate repeated SOR-001"),
    );
    expect(repeated).toBeDefined();
    expect(repeated?.relatedFindingIds).toHaveLength(2);
    expect(repeated?.locations).toEqual([
      { file: "contracts/vault.rs", startLine: 10, endLine: undefined },
      { file: "contracts/vault.rs", startLine: 20, endLine: undefined },
    ]);
  });

  it("generates actionable suggestions from rule messages and suggested fixes", () => {
    const findings: RefactorFindingInput[] = [
      {
        ruleId: "SOR-AUTH",
        message: "Missing owner authorization check before admin action",
        location: {
          file: "contracts/admin.rs",
          startLine: 42,
          endLine: 44,
        },
        severity: "high",
        suggestedFix: {
          description:
            "Require owner authorization before mutating admin state.",
        },
      },
    ];

    const suggestions = engine.suggestForFindings(findings);

    expect(suggestions.map((suggestion) => suggestion.category)).toEqual(
      expect.arrayContaining(["authorization", "rule-fix"]),
    );
    expect(
      suggestions.every(
        (suggestion) => suggestion.relatedFindingIds.length > 0,
      ),
    ).toBe(true);
    expect(suggestions[0].reportText).toContain(suggestions[0].title);
  });

  it("attaches only related suggestions to each finding", () => {
    const findings: RefactorFindingInput[] = [
      {
        ruleId: "SOR-ERR",
        message: "unwrap can panic on invalid payload",
        filePath: "contracts/router.rs",
        line: 7,
      },
      {
        ruleId: "SOR-PERF",
        message: "cache expensive state variable access in loop",
        filePath: "contracts/router.rs",
        line: 15,
      },
    ];

    const augmented = engine.attachSuggestionsToFindings(findings);

    expect(
      augmented[0].refactorSuggestions.map((suggestion) => suggestion.category),
    ).toContain("error-handling");
    expect(
      augmented[0].refactorSuggestions.map((suggestion) => suggestion.category),
    ).not.toContain("performance");
    expect(
      augmented[1].refactorSuggestions.map((suggestion) => suggestion.category),
    ).toContain("performance");
  });
});
