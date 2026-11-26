import * as fs from "fs";
import * as path from "path";
import { normalizeAnalysisResult } from "../core/result-normalizer";
import { SolidityAnalyzer } from "./solidity-analyzer";
import { detectUnsafeErc721SafeTransferCallbacks } from "./erc721-safe-transfer-callback-detector";

const fixtureDir = path.resolve(__dirname, "../../../tests/rules/fixtures");
const fixture = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, "sol-030-erc721-safe-transfer-callback.json"), "utf8"),
) as {
  expectedFindings: Array<{ ruleId: string; kind: string; line: number }>;
};
const source = fs.readFileSync(
  path.join(fixtureDir, "sol-030-erc721-safe-transfer-callback.sol"),
  "utf8",
);

describe("sol-030 unsafe ERC-721 safe-transfer callback assumptions", () => {
  it("reports state updates after safe transfers and stateful unauthenticated receiver callbacks", () => {
    const { findings, diagnostics } = detectUnsafeErc721SafeTransferCallbacks(source);

    expect(diagnostics).toEqual([]);
    expect(findings.map(({ kind, line }) => ({ ruleId: "sol-030", kind, line }))).toEqual(
      fixture.expectedFindings.map(({ kind, line }) => ({ ruleId: "sol-030", kind, line })),
    );
    expect(findings[0].evidence.join(" ")).toContain("reenter");
    expect(findings[1].evidence.join(" ")).toContain("directly");
  });

  it("accepts effects-before-interactions, authenticated receivers, guard modifiers, and library transfers", () => {
    const findings = detectUnsafeErc721SafeTransferCallbacks(source).findings;

    expect(findings.map((finding) => finding.kind)).toEqual([
      "post-transfer-state-update",
      "unauthenticated-stateful-receiver",
      "post-transfer-state-update",
    ]);
  });

  it("keeps the result stable for a supported pre-0.8 compiler pragma", () => {
    const olderCompiler = source.replace("^0.8.20", "^0.7.6");

    expect(
      detectUnsafeErc721SafeTransferCallbacks(olderCompiler).findings.map(({ kind, line }) => ({
        kind,
        line,
      })),
    ).toEqual(
      fixture.expectedFindings.map(({ kind, line }) => ({ kind, line })),
    );
  });

  it("reports diagnostics for malformed, unsupported, or non-string input", () => {
    expect(
      detectUnsafeErc721SafeTransferCallbacks("contract Broken { function f() {").diagnostics[0],
    ).toContain("unbalanced delimiters");
    expect(
      detectUnsafeErc721SafeTransferCallbacks("pragma solidity ^0.9.0; contract Future {}").diagnostics[0],
    ).toContain("0.4.x through 0.8.x");
    expect(detectUnsafeErc721SafeTransferCallbacks(null).diagnostics[0]).toContain(
      "requires Solidity source text",
    );
    expect(detectUnsafeErc721SafeTransferCallbacks(`contract C { ${"\0"} }`).diagnostics[0]).toContain(
      "Binary NUL byte",
    );
    expect(
      detectUnsafeErc721SafeTransferCallbacks("x".repeat(1024 * 1024 + 1)).diagnostics[0],
    ).toContain("exceeds the ERC-721 callback analyzer limit");
    const manyCallables = `contract C { ${Array.from(
      { length: 2501 },
      (_, index) => `function f${index}() external {}`,
    ).join(" ")} }`;
    expect(detectUnsafeErc721SafeTransferCallbacks(manyCallables).diagnostics[0]).toContain(
      "2500 callables",
    );
  });

  it("integrates with the analyzer and normalized finding schema", async () => {
    const analyzer = new SolidityAnalyzer();
    const file = "tests/rules/fixtures/sol-030-erc721-safe-transfer-callback.sol";
    const rules = Object.fromEntries(
      analyzer.getRules().map(({ id }) => [id, { enabled: id === "sol-030" }]),
    );
    const result = await analyzer.analyze(source, file, { rules });
    const normalized = normalizeAnalysisResult(result);

    expect(result.findings).toHaveLength(fixture.expectedFindings.length);
    expect(result.findings[0]).toMatchObject({
      ruleId: "sol-030",
      location: { file, startLine: 20 },
      metadata: {
        kind: "post-transfer-state-update",
        confidenceEvidence: expect.any(Array),
        severityRationale: expect.any(String),
        limitation: expect.any(String),
      },
    });
    expect(normalized.findings).toHaveLength(fixture.expectedFindings.length);
  });
});
