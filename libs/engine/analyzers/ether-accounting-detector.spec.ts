import * as fs from "fs";
import * as path from "path";
import { normalizeAnalysisResult } from "../core/result-normalizer";
import { SolidityAnalyzer } from "./solidity-analyzer";
import { detectEtherAccountingAssumptions } from "./ether-accounting-detector";

const fixturePath = path.resolve(
  __dirname,
  "../../../tests/rules/fixtures/sol-019-ether-accounting.json",
);
const normalizedFixturePath = path.resolve(
  __dirname,
  "../../../tests/rules/fixtures/sol-019-expected-normalized.json",
);

describe("sol-019 exact Ether balance accounting", () => {
  it("integrates with Solidity analysis and emits the fixture's normalized finding", async () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
      input: string;
      expectedFindings: Array<{
        ruleId: string;
        severity: string;
        messagePattern: string;
        line: number;
      }>;
    };
    const analyzer = new SolidityAnalyzer();
    const file = "tests/rules/fixtures/sol-019-ether-accounting.sol";
    const rules = Object.fromEntries(
      analyzer.getRules().map(({ id }) => [id, { enabled: id === "sol-019" }]),
    );
    const result = await analyzer.analyze(fixture.input, file, { rules });
    const actual = result.findings.filter((finding) => finding.ruleId === "sol-019");

    expect(actual).toHaveLength(1);
    expect(actual[0]).toMatchObject({
      ruleId: fixture.expectedFindings[0].ruleId,
      severity: fixture.expectedFindings[0].severity,
      message: expect.stringContaining(fixture.expectedFindings[0].messagePattern),
      location: { startLine: fixture.expectedFindings[0].line },
    });

    const normalized = normalizeAnalysisResult(result);
    const expected = JSON.parse(fs.readFileSync(normalizedFixturePath, "utf8"));
    expect(normalized.findings).toEqual(expected);
  });

  it("does not report surplus-aware checks, non-guard comparisons, comments, or strings", () => {
    const source = `
      contract SafeAccounting {
        uint256 totalLiabilities;
        function solvent() external view returns (bool) {
          return address(this).balance >= totalLiabilities;
        }
        function reconcile() external {
          if (address(this).balance > totalLiabilities) {
            totalLiabilities += address(this).balance - totalLiabilities;
          }
        }
        function note() external pure returns (string memory) {
          return "require(address(this).balance == totalDeposits)";
        }
        // require(address(this).balance == totalDeposits);
      }
    `;

    expect(detectEtherAccountingAssumptions(source).assumptions).toEqual([]);
  });

  it("reports useful diagnostics and safely skips malformed or unsupported source", () => {
    const malformed = detectEtherAccountingAssumptions(
      "contract Broken { function f() external {",
    );
    const unterminated = detectEtherAccountingAssumptions(
      'contract Broken { string value = "unfinished;',
    );
    const unsupported = detectEtherAccountingAssumptions(
      "pragma solidity ^0.9.0; contract Future { }",
    );

    expect(malformed.assumptions).toEqual([]);
    expect(malformed.diagnostics[0]).toContain("unbalanced delimiters");
    expect(unterminated.assumptions).toEqual([]);
    expect(unterminated.diagnostics[0]).toContain("unterminated comment or string");
    expect(unsupported.assumptions).toEqual([]);
    expect(unsupported.diagnostics[0]).toContain("0.4.x through 0.8.x");
  });

  it("returns a diagnostic instead of throwing for non-string input", () => {
    expect(detectEtherAccountingAssumptions(null)).toMatchObject({
      assumptions: [],
      diagnostics: ["Ether accounting analysis requires Solidity source text."],
    });
  });
});
