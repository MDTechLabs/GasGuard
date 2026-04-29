/**
 * Core types for the Rule Testing Framework
 */

import { Severity, Finding, Rule } from '../../../engine/core/analyzer-interface';

/**
 * Test fixture representing a single test case
 */
export interface RuleTestFixture {
  /** Unique identifier for this fixture */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Description of what this test validates */
  description: string;
  
  /** Input source code to analyze */
  input: string;
  
  /** Expected findings (can be empty for negative tests) */
  expectedFindings: ExpectedFinding[];
  
  /** Optional metadata */
  metadata?: {
    language?: 'solidity' | 'vyper' | 'soroban' | 'rust';
    category?: string;
    tags?: string[];
    [key: string]: any;
  };
}

/**
 * Expected finding in a test fixture
 */
export interface ExpectedFinding {
  /** Rule ID that should trigger */
  ruleId: string;
  
  /** Expected severity level */
  severity: Severity;
  
  /** Expected message (can be partial match) */
  messagePattern?: string | RegExp;
  
  /** Expected line number (if applicable) */
  line?: number;
  
  /** Expected gas savings estimate */
  estimatedGasSavings?: number;
}

/**
 * Test case result after running a fixture
 */
export interface TestResult {
  /** Fixture that was tested */
  fixture: RuleTestFixture;
  
  /** Whether the test passed */
  passed: boolean;
  
  /** Actual findings from the rule */
  actualFindings: Finding[];
  
  /** Matched expected findings */
  matchedExpected: ExpectedFinding[];
  
  /** Unmatched expected findings (false negatives) */
  missedExpected: ExpectedFinding[];
  
  /** Unexpected findings (false positives) */
  unexpectedFindings: Finding[];
  
  /** Test execution time in ms */
  executionTimeMs: number;
  
  /** Error message if test failed */
  error?: string;
}

/**
 * Suite of test fixtures for a rule
 */
export interface RuleTestSuite {
  /** Rule ID being tested */
  ruleId: string;
  
  /** Suite name */
  name: string;
  
  /** Description */
  description: string;
  
  /** Test fixtures */
  fixtures: RuleTestFixture[];
}

/**
 * Configuration for rule tester
 */
export interface RuleTesterConfig {
  /** Enable snapshot testing */
  snapshotEnabled?: boolean;
  
  /** Snapshot directory */
  snapshotDir?: string;
  
  /** Strict mode: fail on any mismatch */
  strict?: boolean;
  
  /** Log test execution details */
  verbose?: boolean;
}

/**
 * Snapshot data for a test
 */
export interface TestSnapshot {
  /** Fixture ID */
  fixtureId: string;
  
  /** Rule ID */
  ruleId: string;
  
  /** Snapshot timestamp */
  timestamp: string;
  
  /** Input source code */
  input: string;
  
  /** Expected findings */
  expectedFindings: ExpectedFinding[];
  
  /** Actual findings from last run */
  actualFindings: Finding[];
  
  /** Test result */
  passed: boolean;
}
