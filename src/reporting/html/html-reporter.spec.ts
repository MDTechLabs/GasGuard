import { HtmlReporter } from "./html-reporter";
import { ReportIssue } from "./types";

describe("HtmlReporter refactor suggestions", () => {
  const reporter = new HtmlReporter();

  const sampleIssues: ReportIssue[] = [
    {
      ruleId: "SOR-PERF",
      filePath: "contracts/vault.rs",
      line: 42,
      message: "Expensive state variable access in loop should be cached.",
      confidence: 0.95,
    },
    {
      ruleId: "SOR-AUTH",
      filePath: "contracts/admin.rs",
      line: 12,
      message: "Missing owner authorization check before admin action.",
      confidence: 0.88,
    },
  ];

  it("adds linked refactor suggestions to report data", () => {
    const data = reporter.createReportData(
      "GasGuard Soroban Scan",
      "v1.0.0",
      sampleIssues,
      12,
      140,
    );

    expect(
      data.refactorSuggestions?.map((suggestion) => suggestion.category),
    ).toEqual(expect.arrayContaining(["authorization", "performance"]));
    expect(
      data.issues[0].refactorSuggestions?.map(
        (suggestion) => suggestion.category,
      ),
    ).toContain("performance");
    expect(
      data.issues[1].refactorSuggestions?.map(
        (suggestion) => suggestion.category,
      ),
    ).toContain("authorization");
  });

  it("renders refactor suggestions in the HTML report", () => {
    const data = reporter.createReportData(
      "GasGuard Soroban Scan",
      "v1.0.0",
      sampleIssues,
      12,
      140,
    );

    const html = reporter.generate(data);

    expect(html).toContain("Refactor Suggestions");
    expect(html).toContain("Extract hot-path computation into a cached helper");
    expect(html).toContain("Centralize authorization policy checks");
    expect(html).toContain("Related refactors");
  });
});
