import {
  calculateTotalSavings,
  COLLAPSE_THRESHOLD,
  formatPrComment,
  GasDiagnostic,
} from "./github-pr-formatter";

function makeDiagnostic(overrides: Partial<GasDiagnostic> = {}): GasDiagnostic {
  return {
    file: "contracts/Token.sol",
    line: 42,
    rule: "cached-array-length",
    gasImpact: 200,
    suggestedFix: "Cache array length in a local variable",
    ...overrides,
  };
}

describe("github-pr-formatter", () => {
  it("computes aggregate gas savings across multiple files", () => {
    const diagnostics = [
      makeDiagnostic({ file: "a.sol", gasImpact: 100 }),
      makeDiagnostic({ file: "b.sol", gasImpact: 250 }),
      makeDiagnostic({ file: "c.sol", gasImpact: 50 }),
    ];
    expect(calculateTotalSavings(diagnostics)).toBe(400);
  });

  it("produces a GitHub-flavored Markdown table with the expected columns", () => {
    const output = formatPrComment([makeDiagnostic()]);
    expect(output).toContain(
      "| File | Line | Rule | Gas Impact | Suggested Fix |",
    );
    expect(output).toContain("contracts/Token.sol");
    expect(output).toContain("cached-array-length");
    expect(output).toContain("200");
  });

  it("escapes pipe characters so cell content cannot break the table", () => {
    const output = formatPrComment([
      makeDiagnostic({ suggestedFix: "use a || b" }),
    ]);
    expect(output).toContain("use a \\|\\| b");
  });

  it("wraps large reports in a collapsible details block", () => {
    const many = Array.from({ length: COLLAPSE_THRESHOLD + 1 }, (_, i) =>
      makeDiagnostic({ line: i + 1 }),
    );
    const output = formatPrComment(many);
    expect(output).toContain("<details>");
    expect(output).toContain(`Show all ${many.length} findings`);
  });

  it("reports a success message when there are no diagnostics", () => {
    const output = formatPrComment([]);
    expect(output).toContain("No gas issues detected");
    expect(output).not.toContain("| File |");
  });
});
