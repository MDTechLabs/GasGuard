import * as fs from "fs";
import * as path from "path";
import { normalizeAnalysisResult } from "../core/result-normalizer";
import { SolidityAnalyzer } from "./solidity-analyzer";
import { detectMissingZeroAddressChecks } from "./zero-address-config-detector";

const fixtureDir = path.resolve(__dirname, "../../../tests/rules/fixtures");
const fixture = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, "sol-026-zero-address.json"), "utf8"),
) as {
  expectedFindings: Array<{
    entryPoint: string;
    category: string;
    parameter: string;
    line: number;
  }>;
};
const source = fs.readFileSync(path.join(fixtureDir, "sol-026-zero-address.sol"), "utf8");

describe("sol-026 missing zero-address checks", () => {
  it("reports constructor, initializer, setter, and factory configuration in the fixture", () => {
    const { findings, diagnostics } = detectMissingZeroAddressChecks(source);

    expect(diagnostics).toEqual([]);
    expect(
      findings.map(({ entryPoint, category, parameter, line }) => ({ entryPoint, category, parameter, line })),
    ).toEqual(
      fixture.expectedFindings.map(({ entryPoint, category, parameter, line }) => ({
        entryPoint,
        category,
        parameter,
        line,
      })),
    );
  });

  it("does not report validated, helper-validated, modifier-validated, or sentinel configuration", () => {
    const lines = detectMissingZeroAddressChecks(source).findings.map((f) => f.line);

    expect(lines.filter((l) => l >= 22 && l <= 36)).toEqual([]); // CheckedConstructor
    expect(lines.filter((l) => l >= 55 && l <= 66)).toEqual([]); // CheckedInitializer (local helper)
    expect(lines).not.toContain(98); // notZero modifier
    expect(lines).not.toContain(103); // documented zero sentinel
    expect(lines).not.toContain(110); // body branches on address(0)
    expect(lines).not.toContain(148); // constructor of CheckedVault validates
  });

  it("explains the downstream impact and marks privileged-role-restricted entry points", () => {
    const { findings } = detectMissingZeroAddressChecks(source);
    const oracle = findings.find((f) => f.line === 94)!;
    const initializer = findings.find((f) => f.line === 50)!;
    const unrestricted = findings.find((f) => f.line === 17)!;

    expect(oracle.impact).toMatch(/price read revert/);
    expect(initializer.impact).toMatch(/proxy delegating to empty code/);
    expect(oracle.restricted).toBe(true);
    expect(unrestricted.restricted).toBe(false);
    expect(oracle.confidence).toBeLessThan(unrestricted.confidence);
  });

  it("ignores non-critical addresses, internal functions, comments, and strings", () => {
    const { findings } = detectMissingZeroAddressChecks(`
      contract C {
        address public hook;
        address public other;
        // function setOwner(address owner) external { owner_ = owner; }
        string note = "owner = _owner;";
        function setHook(address newHook) external { hook = newHook; }
        function _setOwner(address newOwner) internal { other = newOwner; }
      }
    `);

    expect(findings).toEqual([]);
  });

  it("accepts isContract and code-length checks and base-constructor delegation", () => {
    const { findings } = detectMissingZeroAddressChecks(`
      contract C is Ownable {
        address public token;
        address public oracle;
        constructor(address initialOwner, address _token, address _oracle) Ownable(initialOwner) {
          require(_token.code.length > 0, "not a contract");
          require(isContract(_oracle), "not a contract");
          token = _token;
          oracle = _oracle;
        }
      }
    `);

    expect(findings).toEqual([]);
  });

  it("reports diagnostics and skips malformed, unsupported, or non-string input", () => {
    expect(detectMissingZeroAddressChecks("contract B { constructor(address a) {").diagnostics[0]).toContain(
      "unbalanced delimiters",
    );
    expect(
      detectMissingZeroAddressChecks("pragma solidity ^0.9.0; contract F {}").diagnostics[0],
    ).toContain("0.4.x through 0.8.x");
    expect(detectMissingZeroAddressChecks({}).diagnostics[0]).toContain("requires Solidity source text");
  });

  it("integrates with the analyzer and the normalized finding schema", async () => {
    const analyzer = new SolidityAnalyzer();
    const file = "tests/rules/fixtures/sol-026-zero-address.sol";
    const rules = Object.fromEntries(
      analyzer.getRules().map(({ id }) => [id, { enabled: id === "sol-026" }]),
    );
    const result = await analyzer.analyze(source, file, { rules });
    const normalized = normalizeAnalysisResult(result);

    expect(result.findings).toHaveLength(fixture.expectedFindings.length);
    expect(result.findings[0]).toMatchObject({
      ruleId: "sol-026",
      location: { file, startLine: 17 },
      metadata: {
        entryPoint: "constructor",
        addressCategory: "authorization",
        confidenceEvidence: expect.any(Array),
        severityRationale: expect.any(String),
        limitation: expect.any(String),
      },
    });
    expect(normalized.findings.length).toBeGreaterThan(0);
  });
});
