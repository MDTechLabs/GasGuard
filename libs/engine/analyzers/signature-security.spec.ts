import { readFileSync } from "fs";
import { join } from "path";
import { SolidityAnalyzer } from "./solidity-analyzer";

const fixtureDirectory = join(
  __dirname,
  "../../../tests/fixtures/signature-authorization",
);
const expectedFindings = JSON.parse(
  readFileSync(join(fixtureDirectory, "expected-findings.json"), "utf8"),
) as Record<
  string,
  Array<{
    ruleId: string;
    severity: string;
    startLine: number;
    endLine: number;
    confidence: string;
    issueType?: string;
  }>
>;

describe("Solidity signature authorization rules", () => {
  const analyzer = new SolidityAnalyzer();

  it("matches the normalized golden findings for vulnerable and safe Solidity fixtures", async () => {
    for (const [fileName, expected] of Object.entries(expectedFindings)) {
      const source = readFileSync(join(fixtureDirectory, fileName), "utf8");
      const config =
        fileName === "ecdsa-only-authorization.sol"
          ? {
              rules: {
                "sol-022": {
                  enabled: true,
                  options: { expectedSignerTypes: ["eoa", "contract"] },
                },
              },
            }
          : undefined;
      const result = await analyzer.analyze(source, fileName, config);
      expect(result.errors).toBeUndefined();
      expect(
        result.findings
          .filter((finding) => ["sol-019", "sol-020", "sol-021", "sol-022"].includes(finding.ruleId))
          .map((finding) => ({
          ruleId: finding.ruleId,
          severity: finding.severity,
          startLine: finding.location.startLine,
          endLine: finding.location.endLine,
          confidence: finding.metadata?.confidence,
          ...(finding.metadata?.issueType
            ? { issueType: finding.metadata.issueType }
            : {}),
          })),
      ).toEqual(expected);
      for (const finding of result.findings.filter((entry) =>
        ["sol-019", "sol-020", "sol-021", "sol-022"].includes(entry.ruleId),
      )) {
        expect(finding.metadata?.evidence).toEqual(expect.any(Array));
        expect(finding.suggestedFix?.description).toBeTruthy();
      }
    }
  });

  it("does not report ERC-1271 compatibility gaps when only EOAs are expected", async () => {
    const source = readFileSync(
      join(fixtureDirectory, "ecdsa-only-authorization.sol"),
      "utf8",
    );
    const result = await analyzer.analyze(source, "ecdsa.sol", {
      options: { signatureSecurity: { expectedSignerTypes: ["eoa"] } },
    });
    expect(result.findings.some((finding) => finding.ruleId === "sol-022")).toBe(
      false,
    );
  });

  it("prefers per-rule expected signer types and validates invalid configuration", async () => {
    const source = readFileSync(
      join(fixtureDirectory, "ecdsa-only-authorization.sol"),
      "utf8",
    );
    const configured = await analyzer.analyze(source, "ecdsa.sol", {
      options: { signatureSecurity: { expectedSignerTypes: ["eoa"] } },
      rules: {
        "sol-022": {
          enabled: true,
          options: { expectedSignerTypes: ["contract"] },
        },
      },
    });
    expect(configured.findings.some((finding) => finding.ruleId === "sol-022")).toBe(
      true,
    );

    const invalid = await analyzer.analyze(source, "ecdsa.sol", {
      rules: {
        "sol-022": {
          enabled: true,
          options: { expectedSignerTypes: ["hardware-wallet"] },
        },
      },
    });
    expect(invalid.findings.some((finding) => finding.ruleId === "sol-022")).toBe(
      false,
    );
    expect(invalid.errors?.[0].message).toContain(
      "expectedSignerTypes must be a non-empty array",
    );
  });

  it("fails safely with useful diagnostics for malformed and unsupported Solidity", async () => {
    const malformed = await analyzer.analyze(
      "pragma solidity ^0.8.20; contract Broken { function f() public {",
      "broken.sol",
    );
    expect(
      malformed.findings.filter((finding) =>
        ["sol-019", "sol-020", "sol-021", "sol-022"].includes(finding.ruleId),
      ),
    ).toHaveLength(0);
    expect(malformed.errors?.[0].message).toContain("unclosed '{'");

    const unsupported = await analyzer.analyze(
      "pragma solidity ^0.4.24; contract Old {}",
      "old.sol",
    );
    expect(unsupported.errors?.[0].message).toContain("supports Solidity 0.5.x through 0.8.x");
  });

  it("integrates signature rules into multi-file analysis", async () => {
    const source = readFileSync(
      join(fixtureDirectory, "personal-sign.sol"),
      "utf8",
    );
    const result = await analyzer.analyzeMultiple(
      new Map([["personal-sign.sol", source]]),
    );
    expect(result.findings.map((finding) => finding.ruleId)).toContain("sol-021");
    expect(result.filesAnalyzed).toBe(1);
  });
});
