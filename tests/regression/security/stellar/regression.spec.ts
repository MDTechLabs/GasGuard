import { loadAllFixtures, runAllFixtures, generateResultsTable } from './regression-runner';

describe('Stellar Security Rule Regression Suite', () => {
  const allFixtures = loadAllFixtures();

  test('all regression fixtures must be loadable', () => {
    expect(allFixtures.length).toBeGreaterThan(0);
  });

  const grouped: Record<string, typeof allFixtures> = {};
  for (const f of allFixtures) {
    if (!grouped[f.ruleId]) grouped[f.ruleId] = [];
    grouped[f.ruleId].push(f);
  }

  for (const [ruleId, fixtures] of Object.entries(grouped)) {
    describe(ruleId, () => {
      let results: ReturnType<typeof runAllFixtures>;

      beforeAll(() => {
        results = runAllFixtures(fixtures);
      });

      test(`all ${fixtures.length} regression checks pass`, () => {
        const failed = results.filter(r => !r.passed);
        const table = generateResultsTable(results);
        console.log(table);

        if (failed.length > 0) {
          const detailLines = failed.map(r =>
            `  FAIL [${r.fixture.metadata.regressionType}] ${r.fixture.name}: ${r.detail}`
          ).join('\n');
          throw new Error(
            `${failed.length}/${results.length} regression check(s) failed for ${ruleId}:\n${detailLines}`
          );
        }
      });

      for (const fixture of fixtures) {
        test(`[${fixture.metadata.regressionType}] ${fixture.name}`, () => {
          const result = results!.find(r => r.fixture.id === fixture.id);
          expect(result).toBeDefined();
          expect(result!.passed).toBe(true);
        });
      }
    });
  }
});
