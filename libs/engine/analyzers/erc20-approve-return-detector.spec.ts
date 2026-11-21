import * as fs from "fs";
import * as path from "path";
import { normalizeAnalysisResult } from "../core/result-normalizer";
import { SolidityAnalyzer } from "./solidity-analyzer";
import { detectUncheckedApproveReturns } from "./erc20-approve-return-detector";

const fixtureDir = path.resolve(__dirname, "../../../tests/rules/fixtures");
const fixture = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, "sol-023-approve-return.json"), "utf8"),
) as { expectedFindings: Array<{ ruleId: string; kind: string; line: number }> };
const source = fs.readFileSync(path.join(fixtureDir, "sol-023-approve-return.sol"), "utf8");

describe("sol-023 unchecked ERC-20 approve return values", () => {
  it("reports each unsafe call site in the token-behaviour fixture and nothing else", () => {
    const { findings, diagnostics } = detectUncheckedApproveReturns(source);

    expect(diagnostics).toEqual([]);
    expect(findings.map(({ kind, line }) => ({ kind, line }))).toEqual(
      fixture.expectedFindings.map(({ kind, line }) => ({ kind, line })),
    );
  });

  it("distinguishes ignored false returns from no-return token incompatibility", () => {
    const kinds = Object.fromEntries(
      detectUncheckedApproveReturns(source).findings.map((f) => [f.line, f.kind]),
    );

    expect(kinds[40]).toBe("discarded-return");
    expect(kinds[48]).toBe("assumes-bool-return");
    expect(kinds[65]).toBe("decode-without-length-check");
  });

  it("does not report tolerant low-level handling, established wrappers, or the contract's own approve", () => {
    const { findings } = detectUncheckedApproveReturns(source);
    const reportedLines = findings.map((f) => f.line);

    expect(reportedLines).not.toContain(72); // data.length == 0 || decode
    expect(reportedLines).not.toContain(77); // SafeERC20 imported
    expect(reportedLines).not.toContain(81); // this.approve
  });

  it("ignores approvals in comments and string literals and non-ERC-20 receivers", () => {
    const { findings } = detectUncheckedApproveReturns(`
      contract C {
        // token.approve(spender, 1);
        string s = "token.approve(spender, 1);";
        function f(address nft, address spender) external { nftCollection.approve(spender, 1); }
      }
    `);

    expect(findings).toEqual([]);
  });

  it("reports a safe wrapper only when its implementation is unavailable", () => {
    const unavailable = detectUncheckedApproveReturns(
      "contract C { function f(address t) external { t.forceApprove(address(1), 1); } }",
    );
    const imported = detectUncheckedApproveReturns(
      'import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";\ncontract C { function f(address t) external { t.forceApprove(address(1), 1); } }',
    );

    expect(unavailable.findings.map((f) => f.kind)).toEqual(["wrapper-unavailable"]);
    expect(imported.findings).toEqual([]);
  });

  it("flags an unsafe local wrapper at its inner approve call", () => {
    const { findings } = detectUncheckedApproveReturns(`
      library SafeERC20 {
        function safeApprove(address token, address spender, uint256 value) internal {
          IERC20(token).approve(spender, value);
        }
      }
    `);

    expect(findings.map((f) => f.kind)).toEqual(["discarded-return"]);
  });

  it("reports diagnostics and skips malformed, unterminated, unsupported, or non-string input", () => {
    expect(detectUncheckedApproveReturns("contract B { function f() {").diagnostics[0]).toContain(
      "unbalanced delimiters",
    );
    expect(detectUncheckedApproveReturns('contract B { string s = "x;').diagnostics[0]).toContain(
      "unterminated",
    );
    expect(
      detectUncheckedApproveReturns("pragma solidity ^0.9.0; contract F {}").diagnostics[0],
    ).toContain("0.4.x through 0.8.x");
    expect(detectUncheckedApproveReturns(undefined).diagnostics[0]).toContain("requires Solidity source text");
  });

  it("integrates with the analyzer and the normalized finding schema", async () => {
    const analyzer = new SolidityAnalyzer();
    const file = "tests/rules/fixtures/sol-023-approve-return.sol";
    const rules = Object.fromEntries(
      analyzer.getRules().map(({ id }) => [id, { enabled: id === "sol-023" }]),
    );
    const result = await analyzer.analyze(source, file, { rules });
    const normalized = normalizeAnalysisResult(result);

    expect(result.findings).toHaveLength(fixture.expectedFindings.length);
    expect(result.findings[0]).toMatchObject({
      ruleId: "sol-023",
      location: { file, startLine: 40 },
      metadata: {
        kind: "discarded-return",
        confidenceEvidence: expect.any(Array),
        severityRationale: expect.any(String),
        limitation: expect.any(String),
      },
    });
    expect(normalized.findings).toHaveLength(fixture.expectedFindings.length);
  });
});
