/**
 * Soroban Rule Validator
 *
 * Runs analysis rules against known-good and known-bad contract samples
 * and verifies that expected findings match actual results.
 */

import { TestDataset, TestSample, ExpectedFinding } from "./test-datasets";

/**
 * Represents a single validation result for a rule against a test sample.
 */
export interface ValidationResult {
  /** The test sample that was validated */
  sample: TestSample;

  /** Whether the validation passed */
  passed: boolean;

  /** Expected findings that were correctly matched */
  matched: ExpectedFinding[];

  /** Expected findings that were not found (false negatives) */
  missed: ExpectedFinding[];

  /** Unexpected findings that were produced (false positives) */
  unexpected: { ruleId: string; message: string; severity: string }[];

  /** Error message if validation failed due to an exception */
  error?: string;

  /** Execution time in milliseconds */
  executionTimeMs: number;
}

/**
 * Function signature for a rule that can be run against contract source code.
 */
export type RuleFn = (
  source: string,
) => { ruleId: string; message: string; severity: string; line?: number }[];

/**
 * Validates Soroban analysis rules against test datasets.
 */
export class RuleValidator {
  private rules: Map<string, RuleFn> = new Map();

  constructor(rules?: Record<string, RuleFn>) {
    if (rules) {
      for (const [id, fn] of Object.entries(rules)) {
        this.registerRule(id, fn);
      }
    }
  }

  /**
   * Register a rule with the validator.
   */
  registerRule(id: string, ruleFn: RuleFn): void {
    this.rules.set(id, ruleFn);
  }

  /**
   * Validate a single test sample against the registered rules.
   */
  validateSample(sample: TestSample): ValidationResult {
    const startTime = Date.now();

    try {
      const actualFindings: {
        ruleId: string;
        message: string;
        severity: string;
        line?: number;
      }[] = [];

      for (const [, ruleFn] of this.rules) {
        const findings = ruleFn(sample.input);
        actualFindings.push(...findings);
      }

      return this.matchFindings(sample, actualFindings, startTime);
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      return {
        sample,
        passed: false,
        matched: [],
        missed: sample.expectedFindings,
        unexpected: [],
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs,
      };
    }
  }

  /**
   * Validate all samples in a dataset.
   */
  validateDataset(dataset: TestDataset): ValidationResult[] {
    return dataset.samples.map((sample) => this.validateSample(sample));
  }

  /**
   * Validate all samples across multiple datasets.
   */
  validateAll(datasets: TestDataset[]): ValidationResult[] {
    const results: ValidationResult[] = [];
    for (const dataset of datasets) {
      results.push(...this.validateDataset(dataset));
    }
    return results;
  }

  /**
   * Generate a summary report from validation results.
   */
  generateReport(results: ValidationResult[]): string {
    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const failed = total - passed;

    let report = `\n${"=".repeat(60)}\n`;
    report += `SOROBAN RULE VALIDATION REPORT\n`;
    report += `${"=".repeat(60)}\n\n`;
    report += `Total: ${total} | Passed: ${passed} | Failed: ${failed}\n\n`;

    if (failed > 0) {
      report += `FAILED SAMPLES:\n`;
      report += `${"-".repeat(40)}\n`;
      for (const result of results.filter((r) => !r.passed)) {
        report += `\n  [FAIL] ${result.sample.name} (${result.sample.id})\n`;
        if (result.error) {
          report += `    Error: ${result.error}\n`;
        }
        if (result.missed.length > 0) {
          report += `    Missed ${result.missed.length} expected finding(s):\n`;
          for (const m of result.missed) {
            report += `      - Rule: ${m.ruleId}, Pattern: "${m.messagePattern}"\n`;
          }
        }
        if (result.unexpected.length > 0) {
          report += `    Found ${result.unexpected.length} unexpected finding(s):\n`;
          for (const u of result.unexpected) {
            report += `      - Rule: ${u.ruleId}, Message: "${u.message}"\n`;
          }
        }
      }
    }

    report += `\n${"=".repeat(60)}\n`;
    return report;
  }

  private matchFindings(
    sample: TestSample,
    actualFindings: {
      ruleId: string;
      message: string;
      severity: string;
      line?: number;
    }[],
    startTime: number,
  ): ValidationResult {
    const matched: ExpectedFinding[] = [];
    const missed: ExpectedFinding[] = [];
    const matchedIndices = new Set<number>();

    for (const expected of sample.expectedFindings) {
      let found = false;

      for (let i = 0; i < actualFindings.length; i++) {
        if (matchedIndices.has(i)) continue;

        const actual = actualFindings[i];
        if (
          actual.ruleId === expected.ruleId &&
          actual.severity === expected.severity &&
          actual.message.includes(expected.messagePattern)
        ) {
          if (expected.line !== undefined) {
            if (Math.abs(actual.line! - expected.line) > 1) continue;
          }
          matched.push(expected);
          matchedIndices.add(i);
          found = true;
          break;
        }
      }

      if (!found) {
        missed.push(expected);
      }
    }

    const unexpected = actualFindings
      .filter((_, i) => !matchedIndices.has(i))
      .map((f) => ({
        ruleId: f.ruleId,
        message: f.message,
        severity: f.severity,
      }));

    const passed = missed.length === 0 && unexpected.length === 0;
    const executionTimeMs = Date.now() - startTime;

    return {
      sample,
      passed,
      matched,
      missed,
      unexpected,
      executionTimeMs,
    };
  }
}
