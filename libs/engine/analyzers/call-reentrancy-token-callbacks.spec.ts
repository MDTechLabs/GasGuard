import * as fs from "fs";
import * as path from "path";
import { normalizeAnalysisResult } from "../core/result-normalizer";
import { SolidityAnalyzer } from "./solidity-analyzer";

const fixturePath = path.resolve(
  __dirname,
  "../../../tests/rules/fixtures/call-reentrancy-token-callbacks.json",
);
const normalizedFixturePath = path.resolve(
  __dirname,
  "../../../tests/rules/expected/call-reentrancy-token-callbacks-normalized.json",
);

describe("call-reentrancy-token-callbacks analyzer integration", () => {
  it("integrates with SolidityAnalyzer and produces normalized findings matching expected fixture", async () => {
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
    const file = "tests/rules/fixtures/call-reentrancy-token-callbacks.sol";
    const rules = Object.fromEntries(
      analyzer
        .getRules()
        .map(({ id }) => [
          id,
          { enabled: id === "call-reentrancy-token-callbacks" },
        ]),
    );

    const result = await analyzer.analyze(fixture.input, file, { rules });
    const actual = result.findings.filter(
      (finding) => finding.ruleId === "call-reentrancy-token-callbacks",
    );

    expect(actual).toHaveLength(1);
    expect(actual[0]).toMatchObject({
      ruleId: fixture.expectedFindings[0].ruleId,
      severity: fixture.expectedFindings[0].severity,
      message: expect.stringContaining(
        fixture.expectedFindings[0].messagePattern,
      ),
      location: { startLine: fixture.expectedFindings[0].line },
    });

    const normalized = normalizeAnalysisResult(result);

    if (!fs.existsSync(normalizedFixturePath)) {
      fs.writeFileSync(
        normalizedFixturePath,
        JSON.stringify(normalized.findings, null, 2),
        "utf8",
      );
    }

    const expected = JSON.parse(fs.readFileSync(normalizedFixturePath, "utf8"));
    expect(normalized.findings).toEqual(expected);
  });
});
