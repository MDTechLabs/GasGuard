/**
 * Rule-level precision and recall reporting by vulnerability class (#1325).
 *
 * Input is a labelled corpus: for every case, the set of rule ids that fired
 * and the set of rule ids that should have fired. The report is computed per
 * rule and rolled up per vulnerability class, so a weak rule shows up even when
 * its class looks healthy overall.
 *
 * Pure and deterministic: no clock, no I/O, output sorted by id. A ratio with a
 * zero denominator is reported as `null`, never as 0 or 1, so "no data" is not
 * mistaken for "perfect" or "terrible".
 */

export interface LabelledCase {
  /** Stable fixture identifier. */
  caseId: string;
  /** Rule ids the analyzer reported for this case. */
  reported: readonly string[];
  /** Rule ids that a reviewer says apply to this case. */
  expected: readonly string[];
}

export interface RuleClassMap {
  /** rule id -> vulnerability class. */
  [ruleId: string]: string;
}

export interface AccuracyCounts {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface AccuracyMetrics extends AccuracyCounts {
  /** TP / (TP + FP), or null when nothing was reported. */
  precision: number | null;
  /** TP / (TP + FN), or null when nothing was expected. */
  recall: number | null;
  /** Harmonic mean, or null when precision or recall is null or both are 0. */
  f1: number | null;
}

export interface RuleAccuracy extends AccuracyMetrics {
  ruleId: string;
  vulnerabilityClass: string;
}

export interface ClassAccuracy extends AccuracyMetrics {
  vulnerabilityClass: string;
  rules: string[];
}

export interface AccuracyReport {
  rules: RuleAccuracy[];
  classes: ClassAccuracy[];
  overall: AccuracyMetrics;
  /** Rule ids with no entry in the class map, grouped under UNCLASSIFIED. */
  unclassifiedRules: string[];
  /** Case ids that appeared more than once; only the first is counted. */
  duplicateCaseIds: string[];
}

export const UNCLASSIFIED = "UNCLASSIFIED";

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function toMetrics(counts: AccuracyCounts): AccuracyMetrics {
  const precision = ratio(counts.truePositives, counts.truePositives + counts.falsePositives);
  const recall = ratio(counts.truePositives, counts.truePositives + counts.falseNegatives);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  return { ...counts, precision, recall, f1 };
}

const empty = (): AccuracyCounts => ({ truePositives: 0, falsePositives: 0, falseNegatives: 0 });

/** Build the per-rule, per-class and overall accuracy report. */
export function buildAccuracyReport(
  cases: readonly LabelledCase[],
  classMap: RuleClassMap,
): AccuracyReport {
  const perRule = new Map<string, AccuracyCounts>();
  const seen = new Set<string>();
  const duplicateCaseIds: string[] = [];

  const bump = (ruleId: string, key: keyof AccuracyCounts) => {
    const counts = perRule.get(ruleId) ?? empty();
    counts[key] += 1;
    perRule.set(ruleId, counts);
  };

  for (const labelled of cases) {
    if (seen.has(labelled.caseId)) {
      duplicateCaseIds.push(labelled.caseId);
      continue;
    }
    seen.add(labelled.caseId);

    // A rule reported twice in one case is still one report of that rule.
    const reported = new Set(labelled.reported);
    const expected = new Set(labelled.expected);

    for (const ruleId of reported) bump(ruleId, expected.has(ruleId) ? "truePositives" : "falsePositives");
    for (const ruleId of expected) if (!reported.has(ruleId)) bump(ruleId, "falseNegatives");
  }

  const classOf = (ruleId: string) => classMap[ruleId] ?? UNCLASSIFIED;

  const rules: RuleAccuracy[] = [...perRule.entries()]
    .map(([ruleId, counts]) => ({
      ruleId,
      vulnerabilityClass: classOf(ruleId),
      ...toMetrics(counts),
    }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  const perClass = new Map<string, { counts: AccuracyCounts; rules: string[] }>();
  const overall = empty();
  for (const rule of rules) {
    const entry = perClass.get(rule.vulnerabilityClass) ?? { counts: empty(), rules: [] };
    entry.counts.truePositives += rule.truePositives;
    entry.counts.falsePositives += rule.falsePositives;
    entry.counts.falseNegatives += rule.falseNegatives;
    entry.rules.push(rule.ruleId);
    perClass.set(rule.vulnerabilityClass, entry);

    overall.truePositives += rule.truePositives;
    overall.falsePositives += rule.falsePositives;
    overall.falseNegatives += rule.falseNegatives;
  }

  const classes: ClassAccuracy[] = [...perClass.entries()]
    .map(([vulnerabilityClass, entry]) => ({
      vulnerabilityClass,
      rules: entry.rules,
      ...toMetrics(entry.counts),
    }))
    .sort((a, b) => a.vulnerabilityClass.localeCompare(b.vulnerabilityClass));

  return {
    rules,
    classes,
    overall: toMetrics(overall),
    unclassifiedRules: rules.filter((rule) => rule.vulnerabilityClass === UNCLASSIFIED).map((rule) => rule.ruleId),
    duplicateCaseIds,
  };
}

const pct = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);

/** Render the report as a Markdown table for CI summaries and docs. */
export function renderAccuracyMarkdown(report: AccuracyReport): string {
  const lines = [
    "| Class | Rules | TP | FP | FN | Precision | Recall | F1 |",
    "|---|---|---|---|---|---|---|---|",
    ...report.classes.map(
      (entry) =>
        `| ${entry.vulnerabilityClass} | ${entry.rules.length} | ${entry.truePositives} | ${entry.falsePositives} | ${entry.falseNegatives} | ${pct(entry.precision)} | ${pct(entry.recall)} | ${pct(entry.f1)} |`,
    ),
    `| **Overall** | ${report.rules.length} | ${report.overall.truePositives} | ${report.overall.falsePositives} | ${report.overall.falseNegatives} | ${pct(report.overall.precision)} | ${pct(report.overall.recall)} | ${pct(report.overall.f1)} |`,
  ];
  return lines.join("\n");
}
