import * as fs from "fs";
import * as path from "path";
import { Severity } from "./analyzer-interface";
import {
  NORMALIZATION_SCHEMA_VERSION,
  normalizeAnalysisResult,
  normalizeFindingPath,
  normalizeFindings,
  normalizeSeverity,
} from "./result-normalizer";

const FIXTURES = path.resolve(__dirname, "../../../tests/fixtures/result-normalization");
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));

describe("normalizeFindingPath", () => {
  it("canonicalizes separators, dot segments and parent segments", () => {
    expect(normalizeFindingPath("src\\a\\b.ts")).toBe("src/a/b.ts");
    expect(normalizeFindingPath("./src//a/./b/../c.ts")).toBe("src/a/c.ts");
  });

  it("rejects traversal, empty, control-char and non-string input", () => {
    expect(normalizeFindingPath("../x.ts")).toBeUndefined();
    expect(normalizeFindingPath("a/../../x.ts")).toBeUndefined();
    expect(normalizeFindingPath("   ")).toBeUndefined();
    expect(normalizeFindingPath("a\u0000b")).toBeUndefined();
    expect(normalizeFindingPath(42)).toBeUndefined();
  });

  it("rejects absolute paths unless inside rootDir", () => {
    expect(normalizeFindingPath("/work/app/a.ts")).toBeUndefined();
    expect(normalizeFindingPath("/work/app/a.ts", "/work/app")).toBe("a.ts");
    expect(normalizeFindingPath("/work/other/a.ts", "/work/app")).toBeUndefined();
    expect(normalizeFindingPath("/work/application/a.ts", "/work/app")).toBeUndefined();
  });
});

describe("normalizeSeverity", () => {
  it("maps aliases case-insensitively and rejects unknown values", () => {
    expect(normalizeSeverity("ERROR")).toBe(Severity.HIGH);
    expect(normalizeSeverity(" Warning ")).toBe(Severity.MEDIUM);
    expect(normalizeSeverity("note")).toBe(Severity.INFO);
    expect(normalizeSeverity("bogus")).toBeUndefined();
    expect(normalizeSeverity(3)).toBeUndefined();
  });
});

describe("normalizeAnalysisResult — realistic repository output", () => {
  const raw = load("realistic-mixed-output.json");
  const result = normalizeAnalysisResult(raw, { analyzerName: "mixed" });

  it("produces canonical paths, severities and line ranges", () => {
    expect(result.schemaVersion).toBe(NORMALIZATION_SCHEMA_VERSION);
    expect(result.analyzerName).toBe("mixed");
    const files = result.findings.map((f) => f.location.file);
    expect(files).toEqual([
      "contracts/Vault.sol",
      "scripts/deploy.py",
      "src/services/runner.ts",
      "src/services/runner.ts",
    ]);
    const tpl = result.findings.find((f) => f.ruleId === "cmd-004")!;
    expect(tpl.severity).toBe(Severity.HIGH);
    expect(tpl.location.startLine).toBe(57);
    expect(tpl.location.endLine).toBe(57);
    expect(tpl.message).toBe("Command built with template literal\nuse execFile with an argument array");
    expect(result.findings.find((f) => f.ruleId === "cmd-002")!.location.startLine).toBe(9);
  });

  it("collapses duplicates keeping the highest severity, and recomputes the summary", () => {
    const cmd001 = result.findings.filter((f) => f.ruleId === "cmd-001");
    expect(cmd001).toHaveLength(1);
    expect(cmd001[0].severity).toBe(Severity.CRITICAL);
    expect(result.counts.duplicates).toBe(1);
    expect(result.summary).toEqual({ critical: 1, high: 1, medium: 2, low: 0, info: 0 });
    expect(result.totalEstimatedGasSavings).toBe(2100);
  });

  it("keeps run-dependent data out of the deterministic body", () => {
    expect(result.telemetry.analysisTimeMs).toBe(183);
    expect(result).not.toHaveProperty("analysisTime");
    expect(result.errors).toEqual([{ file: "docs/broken.md", message: "unsupported encoding" }]);
  });

  it("is deterministic regardless of input order and timing", () => {
    const shuffled = { ...raw, analysisTime: 9999, findings: [...raw.findings].reverse() };
    const again = normalizeAnalysisResult(shuffled, { analyzerName: "mixed" });
    expect(JSON.stringify({ ...again, telemetry: undefined })).toBe(
      JSON.stringify({ ...result, telemetry: undefined }),
    );
    expect(again.findings.map((f) => f.key)).toEqual(result.findings.map((f) => f.key));
  });

  it("sorts metadata keys so serialization is stable", () => {
    const vault = result.findings.find((f) => f.ruleId === "gas-007")!;
    expect(JSON.stringify(vault.metadata)).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it("is idempotent", () => {
    const twice = normalizeAnalysisResult(result, { analyzerName: "mixed" });
    expect(twice.findings).toEqual(result.findings);
    expect(twice.summary).toEqual(result.summary);
  });
});

describe("normalizeAnalysisResult — malformed input regression", () => {
  const raw = load("regression-malformed-findings.json");
  const result = normalizeAnalysisResult(raw);

  it("never throws and keeps only the salvageable findings", () => {
    expect(result.findings.map((f) => f.ruleId)).toEqual(["r-3", "r-4"]);
    expect(result.counts.received).toBe(7);
    expect(result.counts.dropped).toBe(5);
    expect(result.findings.some((f) => f.location.file.includes("passwd"))).toBe(false);
    expect(result.findings.some((f) => f.location.file.includes("home"))).toBe(false);
  });

  it("repairs recoverable fields and reports what it changed", () => {
    const r3 = result.findings.find((f) => f.ruleId === "r-3")!;
    expect(r3.severity).toBe(Severity.INFO);
    expect(r3.message).toBe("r-3");
    expect(r3.location).toEqual({ file: "src/a.ts", startLine: 1, endLine: 1, startColumn: 9, endColumn: 9 });
    expect(r3.estimatedGasSavings).toBeUndefined();
    expect(result.findings.find((f) => f.ruleId === "r-4")!.location.startLine).toBe(7);

    const codes = result.issues.map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "MALFORMED_FINDING",
        "MISSING_RULE_ID",
        "INVALID_PATH",
        "UNKNOWN_SEVERITY",
        "INVALID_LINE",
        "EMPTY_MESSAGE",
        "INVALID_GAS_SAVINGS",
      ]),
    );
  });

  it("reports unusable file errors without leaking the path", () => {
    expect(result.errors).toEqual([{ file: "<unknown>", message: "bad" }]);
  });
});

describe("failure semantics and options", () => {
  it("returns an empty result with MALFORMED_RESULT for non-object input", () => {
    for (const bad of [null, undefined, 5, "x", []]) {
      const r = normalizeAnalysisResult(bad);
      expect(r.findings).toEqual([]);
      expect(r.issues[0].code).toBe("MALFORMED_RESULT");
      expect(r.analyzerVersion).toBe("unknown");
    }
  });

  it("flags a non-array findings field", () => {
    const r = normalizeAnalysisResult({ findings: "oops" });
    expect(r.findings).toEqual([]);
    expect(r.issues.map((i) => i.code)).toContain("MALFORMED_RESULT");
  });

  it("truncates long messages and honours fallbackSeverity / maxIssues", () => {
    const base = { ruleId: "r", location: { file: "a.ts", startLine: 1 } };
    const out = normalizeFindings(
      [
        { ...base, message: "x".repeat(50), severity: "high" },
        { ...base, ruleId: "s", message: "m", severity: "???" },
      ],
      { maxMessageLength: 10, fallbackSeverity: Severity.LOW, maxIssues: 1 },
    );
    expect(out.findings.find((f) => f.ruleId === "r")!.message).toHaveLength(10);
    expect(out.findings.find((f) => f.ruleId === "s")!.severity).toBe(Severity.LOW);
    expect(out.issues).toHaveLength(1);
    expect(out.counts.issues).toBe(2);
  });

  it("strips rootDir from absolute paths when configured", () => {
    const out = normalizeFindings(
      [{ ruleId: "r", message: "m", severity: "low", location: { file: "/ws/job1/src/a.ts", startLine: 3 } }],
      { rootDir: "/ws/job1" },
    );
    expect(out.findings[0].location.file).toBe("src/a.ts");
  });
});
