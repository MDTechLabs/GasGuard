import {
  buildAccuracyReport,
  renderAccuracyMarkdown,
  toMetrics,
  UNCLASSIFIED,
  type LabelledCase,
} from "./rule-accuracy-report";

const classMap = {
  "SOL-REENTRANCY-001": "reentrancy",
  "SOL-REENTRANCY-002": "reentrancy",
  "SOL-OVERFLOW-001": "arithmetic",
};

describe("toMetrics", () => {
  it("computes precision, recall and F1", () => {
    const metrics = toMetrics({ truePositives: 3, falsePositives: 1, falseNegatives: 1 });
    expect(metrics.precision).toBeCloseTo(0.75);
    expect(metrics.recall).toBeCloseTo(0.75);
    expect(metrics.f1).toBeCloseTo(0.75);
  });

  it("reports null, not 0 or 1, when a denominator is zero", () => {
    expect(toMetrics({ truePositives: 0, falsePositives: 0, falseNegatives: 0 })).toMatchObject({
      precision: null,
      recall: null,
      f1: null,
    });
    expect(toMetrics({ truePositives: 0, falsePositives: 2, falseNegatives: 0 })).toMatchObject({
      precision: 0,
      recall: null,
      f1: null,
    });
  });

  it("gives a null F1 when precision and recall are both zero", () => {
    const metrics = toMetrics({ truePositives: 0, falsePositives: 1, falseNegatives: 1 });
    expect(metrics.precision).toBe(0);
    expect(metrics.recall).toBe(0);
    expect(metrics.f1).toBeNull();
  });
});

describe("buildAccuracyReport", () => {
  const cases: LabelledCase[] = [
    { caseId: "c1", reported: ["SOL-REENTRANCY-001"], expected: ["SOL-REENTRANCY-001"] },
    { caseId: "c2", reported: ["SOL-REENTRANCY-001"], expected: [] },
    { caseId: "c3", reported: [], expected: ["SOL-REENTRANCY-002"] },
    { caseId: "c4", reported: ["SOL-OVERFLOW-001"], expected: ["SOL-OVERFLOW-001"] },
  ];

  it("counts per rule", () => {
    const report = buildAccuracyReport(cases, classMap);
    const rule = (id: string) => report.rules.find((entry) => entry.ruleId === id)!;
    expect(rule("SOL-REENTRANCY-001")).toMatchObject({ truePositives: 1, falsePositives: 1, falseNegatives: 0 });
    expect(rule("SOL-REENTRANCY-002")).toMatchObject({ truePositives: 0, falsePositives: 0, falseNegatives: 1 });
    expect(rule("SOL-OVERFLOW-001")).toMatchObject({ precision: 1, recall: 1 });
  });

  it("rolls rules up into vulnerability classes", () => {
    const report = buildAccuracyReport(cases, classMap);
    const reentrancy = report.classes.find((entry) => entry.vulnerabilityClass === "reentrancy")!;
    expect(reentrancy.rules).toEqual(["SOL-REENTRANCY-001", "SOL-REENTRANCY-002"]);
    expect(reentrancy).toMatchObject({ truePositives: 1, falsePositives: 1, falseNegatives: 1 });
    expect(reentrancy.precision).toBeCloseTo(0.5);
    expect(reentrancy.recall).toBeCloseTo(0.5);
  });

  it("computes overall totals across every rule", () => {
    const { overall } = buildAccuracyReport(cases, classMap);
    expect(overall).toMatchObject({ truePositives: 2, falsePositives: 1, falseNegatives: 1 });
  });

  it("groups rules without a class under UNCLASSIFIED and lists them", () => {
    const report = buildAccuracyReport(
      [{ caseId: "c1", reported: ["SOL-NEW-001"], expected: ["SOL-NEW-001"] }],
      classMap,
    );
    expect(report.classes[0].vulnerabilityClass).toBe(UNCLASSIFIED);
    expect(report.unclassifiedRules).toEqual(["SOL-NEW-001"]);
  });

  it("counts a rule reported twice in one case once", () => {
    const report = buildAccuracyReport(
      [{ caseId: "c1", reported: ["SOL-OVERFLOW-001", "SOL-OVERFLOW-001"], expected: ["SOL-OVERFLOW-001"] }],
      classMap,
    );
    expect(report.rules[0]).toMatchObject({ truePositives: 1, falsePositives: 0 });
  });

  it("ignores duplicate case ids after the first and reports them", () => {
    const report = buildAccuracyReport(
      [
        { caseId: "c1", reported: ["SOL-OVERFLOW-001"], expected: ["SOL-OVERFLOW-001"] },
        { caseId: "c1", reported: ["SOL-OVERFLOW-001"], expected: [] },
      ],
      classMap,
    );
    expect(report.duplicateCaseIds).toEqual(["c1"]);
    expect(report.overall).toMatchObject({ truePositives: 1, falsePositives: 0 });
  });

  it("returns an empty, null-metric report for an empty corpus", () => {
    const report = buildAccuracyReport([], classMap);
    expect(report.rules).toEqual([]);
    expect(report.classes).toEqual([]);
    expect(report.overall.precision).toBeNull();
  });

  it("is deterministic regardless of case order", () => {
    const forward = buildAccuracyReport(cases, classMap);
    const backward = buildAccuracyReport([...cases].reverse(), classMap);
    expect(backward).toEqual(forward);
  });
});

describe("renderAccuracyMarkdown", () => {
  it("renders a table with n/a for missing ratios", () => {
    const markdown = renderAccuracyMarkdown(
      buildAccuracyReport(
        [
          { caseId: "c1", reported: ["SOL-REENTRANCY-001"], expected: ["SOL-REENTRANCY-001"] },
          { caseId: "c2", reported: ["SOL-OVERFLOW-001"], expected: [] },
        ],
        classMap,
      ),
    );
    expect(markdown).toContain("| reentrancy | 1 | 1 | 0 | 0 | 100.0% | 100.0% | 100.0% |");
    expect(markdown).toContain("| arithmetic | 1 | 0 | 1 | 0 | 0.0% | n/a | n/a |");
    expect(markdown).toContain("| **Overall** |");
  });
});
