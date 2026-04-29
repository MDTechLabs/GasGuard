/**
 * RuleTester - Core testing engine for GasGuard rules
 */

import { Analyzer, AnalysisResult, Finding } from '../../../engine/core/analyzer-interface';
import {
  RuleTestFixture,
  TestResult,
  ExpectedFinding,
  RuleTesterConfig,
} from './types';

const DEFAULT_CONFIG: RuleTesterConfig = {
  snapshotEnabled: false,
  strict: true,
  verbose: false,
};

export class RuleTester {
  private analyzer: Analyzer;
  private config: RuleTesterConfig;

  constructor(analyzer: Analyzer, config?: Partial<RuleTesterConfig>) {
    this.analyzer = analyzer;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run a single test fixture
   */
  async runFixture(fixture: RuleTestFixture): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      // Run the analyzer
      const result = await this.analyzer.analyze(
        fixture.input,
        `test-${fixture.id}.sol`
      );

      const actualFindings = result.findings;
      
      // Match expected findings
      const { matched, missed, unexpected } = this.matchFindings(
        fixture.expectedFindings,
        actualFindings
      );

      const executionTimeMs = Date.now() - startTime;
      const passed = missed.length === 0 && unexpected.length === 0;

      if (this.config.verbose) {
        this.logTestResult(fixture, passed, matched, missed, unexpected, executionTimeMs);
      }

      return {
        fixture,
        passed,
        actualFindings,
        matchedExpected: matched,
        missedExpected: missed,
        unexpectedFindings: unexpected,
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return {
        fixture,
        passed: false,
        actualFindings: [],
        matchedExpected: [],
        missedExpected: fixture.expectedFindings,
        unexpectedFindings: [],
        executionTimeMs,
        error: errorMessage,
      };
    }
  }

  /**
   * Run multiple fixtures in sequence
   */
  async runFixtures(fixtures: RuleTestFixture[]): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    for (const fixture of fixtures) {
      const result = await this.runFixture(fixture);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Run all fixtures and return summary
   */
  async runAll(fixtures: RuleTestFixture[]): Promise<{
    results: TestResult[];
    passed: number;
    failed: number;
    totalExecutionTime: number;
  }> {
    const results = await this.runFixtures(fixtures);
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const totalExecutionTime = results.reduce((sum, r) => sum + r.executionTimeMs, 0);
    
    return {
      results,
      passed,
      failed,
      totalExecutionTime,
    };
  }

  /**
   * Generate a test report
   */
  generateReport(results: TestResult[]): string {
    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = total - passed;
    
    let report = '\n' + '='.repeat(60) + '\n';
    report += 'RULE TEST REPORT\n';
    report += '='.repeat(60) + '\n\n';
    
    report += `Total: ${total} | Passed: ${passed} | Failed: ${failed}\n\n`;
    
    for (const result of results) {
      const status = result.passed ? '✓ PASS' : '✗ FAIL';
      report += `${status} ${result.fixture.name} (${result.executionTimeMs}ms)\n`;
      
      if (!result.passed) {
        if (result.missedExpected.length > 0) {
          report += `  Missed ${result.missedExpected.length} expected finding(s)\n`;
        }
        if (result.unexpectedFindings.length > 0) {
          report += `  Found ${result.unexpectedFindings.length} unexpected finding(s)\n`;
        }
        if (result.error) {
          report += `  Error: ${result.error}\n`;
        }
      }
    }
    
    report += '\n' + '='.repeat(60) + '\n';
    
    return report;
  }

  /**
   * Match expected findings with actual findings
   */
  private matchFindings(
    expected: ExpectedFinding[],
    actual: Finding[]
  ): {
    matched: ExpectedFinding[];
    missed: ExpectedFinding[];
    unexpected: Finding[];
  } {
    const matched: ExpectedFinding[] = [];
    const missed: ExpectedFinding[] = [];
    const matchedActualIndices = new Set<number>();

    // Try to match each expected finding
    for (const exp of expected) {
      let found = false;
      
      for (let i = 0; i < actual.length; i++) {
        if (matchedActualIndices.has(i)) continue;
        
        const act = actual[i];
        
        if (this.matchesExpected(act, exp)) {
          matched.push(exp);
          matchedActualIndices.add(i);
          found = true;
          break;
        }
      }
      
      if (!found) {
        missed.push(exp);
      }
    }

    // Find unexpected findings (not matched to any expected)
    const unexpected = actual.filter((_, i) => !matchedActualIndices.has(i));

    return { matched, missed, unexpected };
  }

  /**
   * Check if an actual finding matches an expected finding
   */
  private matchesExpected(actual: Finding, expected: ExpectedFinding): boolean {
    // Check rule ID
    if (actual.ruleId !== expected.ruleId) {
      return false;
    }

    // Check severity
    if (actual.severity !== expected.severity) {
      return false;
    }

    // Check message pattern (if provided)
    if (expected.messagePattern) {
      if (expected.messagePattern instanceof RegExp) {
        if (!expected.messagePattern.test(actual.message)) {
          return false;
        }
      } else {
        if (!actual.message.includes(expected.messagePattern)) {
          return false;
        }
      }
    }

    // Check line number (if provided, with tolerance of ±1)
    if (expected.line !== undefined) {
      const actualLine = actual.location.startLine;
      if (Math.abs(actualLine - expected.line) > 1) {
        return false;
      }
    }

    return true;
  }

  /**
   * Log test result details
   */
  private logTestResult(
    fixture: RuleTestFixture,
    passed: boolean,
    matched: ExpectedFinding[],
    missed: ExpectedFinding[],
    unexpected: Finding[],
    executionTimeMs: number
  ): void {
    const status = passed ? '✓ PASS' : '✗ FAIL';
    console.log(`\n${status} ${fixture.name} (${executionTimeMs}ms)`);
    
    if (matched.length > 0) {
      console.log(`  ✓ Matched ${matched.length} expected finding(s)`);
    }
    
    if (missed.length > 0) {
      console.log(`  ✗ Missed ${missed.length} expected finding(s):`);
      for (const m of missed) {
        console.log(`    - Rule: ${m.ruleId}, Severity: ${m.severity}`);
      }
    }
    
    if (unexpected.length > 0) {
      console.log(`  ✗ Found ${unexpected.length} unexpected finding(s):`);
      for (const u of unexpected) {
        console.log(`    - Rule: ${u.ruleId}, Line: ${u.location.startLine}`);
      }
    }
  }
}
