import { SolidityAnalyzer } from "../../../libs/engine/analyzers/solidity-analyzer";
import { POST_MORTEM_CASES, PostMortemCase } from "./post-mortem-cases";

interface CaseScore {
  id: string;
  kind: PostMortemCase["kind"];
  missed: string[];
  unexpected: string[];
  deterministic: boolean;
}

async function scoreCase(testCase: PostMortemCase): Promise<CaseScore> {
  const analyzer = new SolidityAnalyzer();
  const first = await analyzer.analyze(testCase.source, testCase.file);
  const second = await new SolidityAnalyzer().analyze(testCase.source, testCase.file);

  const reported = new Set(first.findings.map((finding) => finding.ruleId));
  const missed = testCase.expectedRules.filter((rule) => !reported.has(rule));
  const unexpected = testCase.forbiddenRules.filter((rule) => reported.has(rule));
  const deterministic =
    JSON.stringify(first.findings) === JSON.stringify(second.findings);

  return { id: testCase.id, kind: testCase.kind, missed, unexpected, deterministic };
}

describe("post-mortem benchmark", () => {
  let scores: CaseScore[];

  beforeAll(async () => {
    scores = [];
    for (const testCase of POST_MORTEM_CASES) {
      scores.push(await scoreCase(testCase));
    }
  });

  it("has at least one vulnerable reproduction and one control", () => {
    expect(POST_MORTEM_CASES.some((c) => c.kind === "vulnerable")).toBe(true);
    expect(POST_MORTEM_CASES.some((c) => c.kind === "control")).toBe(true);
  });

  it("reports every expected rule for each vulnerable reproduction (recall)", () => {
    const misses = scores.filter((s) => s.missed.length > 0);
    expect(misses).toEqual([]);
  });

  it("does not report forbidden rules on controls (false positives)", () => {
    const falsePositives = scores.filter((s) => s.unexpected.length > 0);
    expect(falsePositives).toEqual([]);
  });

  it("produces identical findings on repeated runs (determinism)", () => {
    expect(scores.filter((s) => !s.deterministic)).toEqual([]);
  });

  it("covers every case id exactly once", () => {
    const ids = POST_MORTEM_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(scores.map((s) => s.id).sort()).toEqual([...ids].sort());
  });
});
