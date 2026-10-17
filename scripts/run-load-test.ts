/**
 * Runs the scan-pipeline reliability scenarios and prints a report.
 *
 *   npm run load:report -- [--scenario <name>] [--seed <n>] [--scale <1-100>]
 *
 * Exits 1 when any invariant is violated or an SLO target is missed.
 */
import { runSimulation } from "../tests/load/scan-pipeline.simulator";
import { buildScenario, DEFAULT_SEED, SCENARIO_NAMES, ScenarioName } from "../tests/load/scenarios";
import { evaluateSlo, SLO_TARGETS } from "../tests/load/slo";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const scenarioArg = arg("scenario");
if (scenarioArg && !SCENARIO_NAMES.includes(scenarioArg as ScenarioName)) {
  console.error(`unknown scenario "${scenarioArg}". Choose from: ${SCENARIO_NAMES.join(", ")}`);
  process.exit(2);
}
const names = scenarioArg ? [scenarioArg as ScenarioName] : [...SCENARIO_NAMES];
const seed = arg("seed") === undefined ? DEFAULT_SEED : Number(arg("seed"));
const scale = arg("scale") === undefined ? 1 : Number(arg("scale"));

let failed = false;
for (const name of names) {
  const report = runSimulation(buildScenario(name, seed, scale));
  const slo = evaluateSlo(report, SLO_TARGETS[name]);
  failed = failed || !slo.passed;
  console.log(`\n${slo.passed ? "PASS" : "FAIL"}  ${name}  (seed ${seed}, scale ${scale})`);
  console.log(
    `  scans ${report.uniqueScans} unique / ${report.submitted} submitted, ${report.completed} completed, ` +
      `${report.deadLettered} dead-lettered, ${report.retries} retries`,
  );
  console.log(
    `  faults: ${report.crashes} crashes, ${report.stalls} stalls, ${report.fencedOut} fenced out, ` +
      `${report.reaped} reclaimed, ${report.replayedItems} items replayed`,
  );
  console.log(
    `  wait ms: quiet p50 ${report.quietWait.p50} / p95 ${report.quietWait.p95} / p99 ${report.quietWait.p99}; ` +
      `all p95 ${report.wait.p95}`,
  );
  console.log(
    `  queue: max depth ${report.maxQueueDepth}, age compliance ${report.queueAge.compliance}, ` +
      `utilization ${report.workerUtilization}, throughput ${report.throughputPerSec}/s`,
  );
  for (const f of slo.failures) console.log(`  ! ${f}`);
}
process.exit(failed ? 1 : 0);
