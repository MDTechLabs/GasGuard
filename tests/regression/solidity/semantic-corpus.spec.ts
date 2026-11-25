import { SolidityAnalyzer } from "../../../libs/engine/analyzers/solidity-analyzer";
import {
  loadAllSolidityFixtures,
  runAllSolidityFixtures,
  generateSolidityResultsTable,
} from "./regression-runner";

describe("Solidity Semantic Regression Corpus", () => {
  let analyzer: SolidityAnalyzer;
  const allFixtures = loadAllSolidityFixtures();

  beforeAll(async () => {
    analyzer = new SolidityAnalyzer();
    await analyzer.initialize();
  });

  test("all regression fixtures must be loadable and non-empty", () => {
    expect(allFixtures.length).toBeGreaterThan(0);
    for (const fixture of allFixtures) {
      expect(fixture.id).toBeDefined();
      expect(fixture.code).toBeDefined();
      expect(fixture.expected).toBeDefined();
      expect(fixture.metadata).toBeDefined();
    }
  });

  const grouped: Record<string, typeof allFixtures> = {};
  for (const f of allFixtures) {
    if (!grouped[f.ruleId]) grouped[f.ruleId] = [];
    grouped[f.ruleId].push(f);
  }

  for (const [ruleId, fixtures] of Object.entries(grouped)) {
    describe(`Rule ${ruleId}`, () => {
      let results: Awaited<ReturnType<typeof runAllSolidityFixtures>>;

      beforeAll(async () => {
        results = await runAllSolidityFixtures(analyzer, fixtures);
      });

      test(`all ${fixtures.length} regression checks pass for ${ruleId}`, () => {
        const failed = results.filter((r) => !r.passed);
        const table = generateSolidityResultsTable(results);
        console.log(table);

        if (failed.length > 0) {
          const detailLines = failed
            .map(
              (r) =>
                `  FAIL [${r.fixture.metadata.regressionType}] ${r.fixture.name}: ${r.detail}`,
            )
            .join("\n");
          throw new Error(
            `${failed.length}/${results.length} regression check(s) failed for ${ruleId}:\n${detailLines}`,
          );
        }
      });

      for (const fixture of fixtures) {
        test(`[${fixture.metadata.regressionType}] ${fixture.name}`, async () => {
          const result = results.find((r) => r.fixture.id === fixture.id);
          expect(result).toBeDefined();
          expect(result!.passed).toBe(true);
        });
      }
    });
  }
});
