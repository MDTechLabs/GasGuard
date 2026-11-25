import * as fs from "fs";
import * as path from "path";
import { SolidityAnalyzer } from "../../../libs/engine/analyzers/solidity-analyzer";
import {
  SolidityRegressionFixture,
  SolidityRegressionResult,
} from "./regression-types";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

export function loadAllSolidityFixtures(
  dir: string = FIXTURES_DIR,
): SolidityRegressionFixture[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const fixtures: SolidityRegressionFixture[] = [];

  for (const file of files) {
    const fullPath = path.join(dir, file);
    try {
      const content = fs.readFileSync(fullPath, "utf8");
      const parsed = JSON.parse(content) as
        | SolidityRegressionFixture
        | SolidityRegressionFixture[];
      if (Array.isArray(parsed)) {
        fixtures.push(...parsed);
      } else {
        fixtures.push(parsed);
      }
    } catch (err) {
      console.error(`Failed to load fixture ${file}:`, err);
    }
  }

  return fixtures;
}

export async function runSolidityFixture(
  analyzer: SolidityAnalyzer,
  fixture: SolidityRegressionFixture,
): Promise<SolidityRegressionResult> {
  try {
    const analysis = await analyzer.analyze(fixture.code, `${fixture.id}.sol`);
    const relevantFindings = analysis.findings.filter(
      (f) => f.ruleId === fixture.ruleId,
    );
    const actualDetected = relevantFindings.length > 0;

    let passed = actualDetected === fixture.expected.detected;
    let detail = passed
      ? "OK"
      : `Expected detected=${fixture.expected.detected}, but got ${actualDetected}`;

    if (passed && fixture.expected.count !== undefined) {
      if (relevantFindings.length !== fixture.expected.count) {
        passed = false;
        detail = `Expected finding count=${fixture.expected.count}, got ${relevantFindings.length}`;
      }
    }

    if (
      passed &&
      fixture.expected.flaggedKinds &&
      fixture.expected.flaggedKinds.length > 0
    ) {
      const actualKinds = relevantFindings.map(
        (f) => (f.metadata?.kind as string) || "",
      );
      for (const expectedKind of fixture.expected.flaggedKinds) {
        if (!actualKinds.includes(expectedKind)) {
          passed = false;
          detail = `Expected finding kind '${expectedKind}', but found [${actualKinds.join(", ")}]`;
          break;
        }
      }
    }

    return {
      fixture,
      passed,
      actualDetected,
      findingCount: relevantFindings.length,
      detail,
    };
  } catch (error) {
    return {
      fixture,
      passed: false,
      actualDetected: false,
      findingCount: 0,
      detail: `Execution crashed with error: ${(error as Error).message}`,
    };
  }
}

export async function runAllSolidityFixtures(
  analyzer: SolidityAnalyzer,
  fixtures: SolidityRegressionFixture[],
): Promise<SolidityRegressionResult[]> {
  const results: SolidityRegressionResult[] = [];
  for (const fixture of fixtures) {
    const res = await runSolidityFixture(analyzer, fixture);
    results.push(res);
  }
  return results;
}

export function generateSolidityResultsTable(
  results: SolidityRegressionResult[],
): string {
  const lines: string[] = [];
  lines.push(
    "| Status | ID | Type | Audit Source | Rule | Findings | Detail |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");

  for (const r of results) {
    const status = r.passed ? "PASS" : "FAIL";
    lines.push(
      `| ${status} | ${r.fixture.id} | ${r.fixture.metadata.regressionType} | ${r.fixture.auditSource} | ${r.fixture.ruleId} | ${r.findingCount} | ${r.detail} |`,
    );
  }

  return lines.join("\n");
}
