import * as fs from "fs";
import * as path from "path";
import { normalizeAnalysisResult } from "../core/result-normalizer";
import { SolidityAnalyzer } from "./solidity-analyzer";
import { detectAllowanceAdjustmentRisks } from "./allowance-adjustment-detector";

const fixtureDir = path.resolve(__dirname, "../../../tests/rules/fixtures");
const fixture = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, "sol-024-allowance-adjustment.json"), "utf8"),
) as { expectedFindings: Array<{ ruleId: string; kind: string; line: number }> };
const source = fs.readFileSync(path.join(fixtureDir, "sol-024-allowance-adjustment.sol"), "utf8");

describe("sol-024 unsafe allowance adjustment assumptions", () => {
  it("reports exactly the unsafe sites in the standard / non-standard / custom fixture", () => {
    const { findings, diagnostics } = detectAllowanceAdjustmentRisks(source);

    expect(diagnostics).toEqual([]);
    expect(findings.map(({ kind, line }) => ({ kind, line }))).toEqual(
      fixture.expectedFindings.map(({ kind, line }) => ({ kind, line })),
    );
  });

  it("models implementations by receiver type instead of trusting method names", () => {
    const lines = detectAllowanceAdjustmentRisks(source).findings.map((f) => f.line);

    expect(lines).toContain(53); // interface-typed receiver: no implementation to inspect
    expect(lines).not.toContain(81); // StandardToken is implemented in the source
    expect(lines).not.toContain(85); // this.increaseAllowance
  });

  it("finds an allowance-shrinking helper whatever it is called", () => {
    const kinds = detectAllowanceAdjustmentRisks(source).findings.map((f) => f.kind);

    expect(kinds).toContain("unchecked-decrease-underflow"); // WrappingToken.shrink
    expect(kinds).toContain("saturating-decrease"); // ClampingToken.trim
  });

  it("treats pre-0.8 arithmetic as unchecked and honours guards and SafeMath", () => {
    const legacy = (body: string) =>
      detectAllowanceAdjustmentRisks(`pragma solidity 0.7.6;
        contract T {
          mapping(address => mapping(address => uint256)) allowance_;
          function dec(address s, uint256 v) external { ${body} }
        }`).findings.map((f) => f.kind);

    expect(legacy("allowance_[msg.sender][s] = allowance_[msg.sender][s] - v;")).toEqual([
      "unchecked-decrease-underflow",
    ]);
    expect(
      legacy("require(allowance_[msg.sender][s] >= v); allowance_[msg.sender][s] = allowance_[msg.sender][s] - v;"),
    ).toEqual([]);
    expect(legacy("allowance_[msg.sender][s] = allowance_[msg.sender][s].sub(v);")).toEqual([]);
  });

  it("does not report exact approvals, reads, comments, or strings", () => {
    const { findings } = detectAllowanceAdjustmentRisks(`
      contract C {
        // token.increaseAllowance(s, 1);
        string note = "token.approve(s, token.allowance(a, s) + 1);";
        function f(IERC20 token, address s) external {
          token.approve(s, 100);
          uint256 current = token.allowance(address(this), s);
        }
      }
    `);

    expect(findings).toEqual([]);
  });

  it("reports diagnostics and skips malformed, unsupported, or non-string input", () => {
    expect(detectAllowanceAdjustmentRisks("contract B { function f() {").diagnostics[0]).toContain(
      "unbalanced delimiters",
    );
    expect(
      detectAllowanceAdjustmentRisks("pragma solidity ^0.9.0; contract F {}").diagnostics[0],
    ).toContain("0.4.x through 0.8.x");
    expect(detectAllowanceAdjustmentRisks(42).diagnostics[0]).toContain("requires Solidity source text");
  });

  it("integrates with the analyzer and the normalized finding schema", async () => {
    const analyzer = new SolidityAnalyzer();
    const file = "tests/rules/fixtures/sol-024-allowance-adjustment.sol";
    const rules = Object.fromEntries(
      analyzer.getRules().map(({ id }) => [id, { enabled: id === "sol-024" }]),
    );
    const result = await analyzer.analyze(source, file, { rules });
    const normalized = normalizeAnalysisResult(result);

    expect(result.findings).toHaveLength(fixture.expectedFindings.length);
    expect(result.findings[0]).toMatchObject({
      ruleId: "sol-024",
      location: { file, startLine: 35 },
      metadata: {
        kind: "unchecked-decrease-underflow",
        confidenceEvidence: expect.any(Array),
        severityRationale: expect.any(String),
        limitation: expect.any(String),
      },
    });
    expect(normalized.findings).toHaveLength(fixture.expectedFindings.length);
  });
});
