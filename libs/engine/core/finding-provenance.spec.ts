import type { Finding } from "./analyzer-interface";
import { Severity } from "./analyzer-interface";
import { annotateFindings } from "./finding-metadata";
import { resolveProvenance } from "./finding-provenance";

const FLATTENED = [
  "// SPDX-License-Identifier: MIT",
  "pragma solidity ^0.8.20;",
  "// File: contracts/Token.sol",
  "contract Token {",
  "    function ping() external {}",
  "}",
  "// File: contracts/Vault.sol",
  "contract Vault {",
  "    function withdraw() external {}",
  "}",
].join("\n");

describe("resolveProvenance", () => {
  it("maps a line in a flattened bundle to its original file and line", () => {
    // Line 9 is "    function withdraw() external {}". Its header is line 7, so it is original line 2.
    const result = resolveProvenance("build/flat.sol", FLATTENED, 9);
    expect(result).toMatchObject({
      origin: "generated",
      originalFile: "contracts/Vault.sol",
      originalLine: 2,
      mapping: "flatten-marker",
    });
  });

  it("uses the nearest preceding header when a bundle has several files", () => {
    // Line 5 is inside Token.sol, whose header is line 3, so it is original line 2.
    const result = resolveProvenance("flat.sol", FLATTENED, 5);
    expect(result.originalFile).toBe("contracts/Token.sol");
    expect(result.originalLine).toBe(2);
  });

  it("does not treat a header on the flagged line itself as a mapping", () => {
    const result = resolveProvenance("flat.sol", FLATTENED, 3);
    expect(result.mapping).toBe("none");
    expect(result.originalLine).toBe(3);
  });

  it("marks files under build-output paths as generated without inventing a mapping", () => {
    const plain = "contract A {\n    function f() external {}\n}";
    for (const file of [
      "artifacts/contracts/A.sol",
      "typechain/A.sol",
      "src/generated/A.sol",
      "contracts/A.generated.sol",
    ]) {
      expect(resolveProvenance(file, plain, 2)).toMatchObject({
        origin: "generated",
        originalFile: file,
        originalLine: 2,
        mapping: "none",
      });
    }
  });

  it("leaves a hand-written source as original", () => {
    expect(resolveProvenance("contracts/A.sol", "contract A {}", 1)).toMatchObject({
      origin: "original",
      originalFile: "contracts/A.sol",
      mapping: "none",
    });
  });

  it("uses an exact source-map entry before the flatten header", () => {
    const result = resolveProvenance("flat.sol", FLATTENED, 9, {
      sourceMap: [{ generatedLine: 9, sourceFile: "contracts/Real.sol", sourceLine: 40 }],
    });
    expect(result).toMatchObject({
      originalFile: "contracts/Real.sol",
      originalLine: 40,
      mapping: "source-map",
    });
  });

  it("does not guess from a source-map entry for a different line", () => {
    const result = resolveProvenance("flat.sol", FLATTENED, 9, {
      sourceMap: [{ generatedLine: 8, sourceFile: "contracts/Real.sol", sourceLine: 40 }],
    });
    expect(result.mapping).toBe("flatten-marker");
  });

  it("ignores malformed source-map entries", () => {
    const result = resolveProvenance("flat.sol", FLATTENED, 9, {
      sourceMap: [
        { generatedLine: 9, sourceFile: "", sourceLine: 1 },
        { generatedLine: 9.5, sourceFile: "x.sol", sourceLine: 1 },
        null as unknown as { generatedLine: number; sourceFile: string; sourceLine: number },
      ],
    });
    expect(result.mapping).toBe("flatten-marker");
  });

  it("returns a safe result for malformed input and never throws", () => {
    expect(() => resolveProvenance(undefined as unknown as string, undefined as unknown as string, 0)).not.toThrow();
    const result = resolveProvenance("a.sol", "", Number.NaN);
    expect(result.mapping).toBe("none");
    expect(result.originalLine).toBeNaN();
  });
});

describe("annotateFindings", () => {
  const finding = (file: string, startLine: number): Finding => ({
    ruleId: "sol-006",
    message: "m",
    severity: Severity.CRITICAL,
    location: { file, startLine, endLine: startLine },
  });

  it("adds fingerprint and provenance metadata and keeps existing keys", () => {
    const files = new Map([["contracts/Vault.sol", "contract Vault {\n    function f() external {\n        x.transfer(1);\n    }\n}"]]);
    const findings: Finding[] = [{ ...finding("contracts/Vault.sol", 2), metadata: { keep: true } }];
    annotateFindings(findings, files);
    expect(findings[0].metadata).toMatchObject({
      keep: true,
      fingerprint: { version: 1 },
      provenance: { origin: "original", mapping: "none" },
    });
    expect(findings[0].metadata?.fingerprint.value).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gives provenance but no fingerprint when the file content is unavailable", () => {
    const findings = [finding("missing.sol", 1)];
    annotateFindings(findings, new Map());
    expect(findings[0].metadata?.fingerprint).toBeUndefined();
    expect(findings[0].metadata?.provenance).toMatchObject({ originalFile: "missing.sol" });
  });

  it("is not called by the analyzer unless the option is set", async () => {
    const { BaseAnalyzer } = await import("./analyzer-interface");
    class Probe extends BaseAnalyzer {
      getName() { return "probe"; }
      getVersion() { return "0"; }
      supportsLanguage() { return true; }
      getSupportedLanguages() { return []; }
      getRules() { return []; }
      async analyze(code: string, filePath: string) {
        return {
          findings: [finding(filePath, 1)],
          filesAnalyzed: 1,
          analysisTime: 0,
          analyzerVersion: "0",
          summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
        };
      }
    }
    const files = new Map([["a.sol", "contract A {}"]]);
    const off = await new Probe().analyzeMultiple(files, {});
    expect(off.findings[0].metadata).toBeUndefined();
    const on = await new Probe().analyzeMultiple(files, { options: { findingMetadata: true } });
    expect(on.findings[0].metadata?.fingerprint).toBeDefined();
  });
});
