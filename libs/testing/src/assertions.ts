/**
 * Custom assertion helpers for rule testing
 */

import { Finding, Severity } from '../../../engine/core/analyzer-interface';
import { ExpectedFinding } from './types';

export class RuleAssertions {
  /**
   * Assert that findings contain a specific rule violation
   */
  static assertHasFinding(
    findings: Finding[],
    ruleId: string,
    message?: string
  ): void {
    const found = findings.find(f => f.ruleId === ruleId);
    
    if (!found) {
      const availableRules = findings.map(f => f.ruleId).join(', ');
      throw new Error(
        message || 
        `Expected finding with ruleId "${ruleId}" but it was not found. Available: ${availableRules}`
      );
    }
  }

  /**
   * Assert that findings do NOT contain a specific rule violation
   */
  static assertNotHasFinding(
    findings: Finding[],
    ruleId: string,
    message?: string
  ): void {
    const found = findings.find(f => f.ruleId === ruleId);
    
    if (found) {
      throw new Error(
        message || 
        `Expected NOT to find ruleId "${ruleId}" but it was found at line ${found.location.startLine}`
      );
    }
  }

  /**
   * Assert finding count
   */
  static assertFindingCount(
    findings: Finding[],
    expectedCount: number,
    message?: string
  ): void {
    if (findings.length !== expectedCount) {
      throw new Error(
        message ||
        `Expected ${expectedCount} finding(s) but got ${findings.length}`
      );
    }
  }

  /**
   * Assert finding severity
   */
  static assertFindingSeverity(
    findings: Finding[],
    ruleId: string,
    expectedSeverity: Severity
  ): void {
    const finding = findings.find(f => f.ruleId === ruleId);
    
    if (!finding) {
      throw new Error(`Finding with ruleId "${ruleId}" not found`);
    }
    
    if (finding.severity !== expectedSeverity) {
      throw new Error(
        `Expected severity "${expectedSeverity}" for rule "${ruleId}" but got "${finding.severity}"`
      );
    }
  }

  /**
   * Assert finding at specific line
   */
  static assertFindingAtLine(
    findings: Finding[],
    ruleId: string,
    expectedLine: number,
    tolerance: number = 0
  ): void {
    const finding = findings.find(f => f.ruleId === ruleId);
    
    if (!finding) {
      throw new Error(`Finding with ruleId "${ruleId}" not found`);
    }
    
    const actualLine = finding.location.startLine;
    const diff = Math.abs(actualLine - expectedLine);
    
    if (diff > tolerance) {
      throw new Error(
        `Expected rule "${ruleId}" at line ${expectedLine} (±${tolerance}) but found at line ${actualLine}`
      );
    }
  }

  /**
   * Assert finding message contains pattern
   */
  static assertFindingMessage(
    findings: Finding[],
    ruleId: string,
    pattern: string | RegExp
  ): void {
    const finding = findings.find(f => f.ruleId === ruleId);
    
    if (!finding) {
      throw new Error(`Finding with ruleId "${ruleId}" not found`);
    }
    
    if (pattern instanceof RegExp) {
      if (!pattern.test(finding.message)) {
        throw new Error(
          `Expected message matching ${pattern} but got "${finding.message}"`
        );
      }
    } else {
      if (!finding.message.includes(pattern)) {
        throw new Error(
          `Expected message containing "${pattern}" but got "${finding.message}"`
        );
      }
    }
  }

  /**
   * Assert minimum gas savings
   */
  static assertMinGasSavings(
    findings: Finding[],
    minSavings: number
  ): void {
    const totalSavings = findings.reduce(
      (sum, f) => sum + (f.estimatedGasSavings || 0),
      0
    );
    
    if (totalSavings < minSavings) {
      throw new Error(
        `Expected minimum gas savings of ${minSavings} but got ${totalSavings}`
      );
    }
  }

  /**
   * Assert findings by severity count
   */
  static assertSeverityCount(
    findings: Finding[],
    severity: Severity,
    expectedCount: number
  ): void {
    const count = findings.filter(f => f.severity === severity).length;
    
    if (count !== expectedCount) {
      throw new Error(
        `Expected ${expectedCount} ${severity} finding(s) but got ${count}`
      );
    }
  }

  /**
   * Match expected findings against actual findings
   */
  static assertMatchExpected(
    actual: Finding[],
    expected: ExpectedFinding[]
  ): void {
    const errors: string[] = [];

    for (const exp of expected) {
      const matched = actual.find(act => {
        if (act.ruleId !== exp.ruleId) return false;
        if (act.severity !== exp.severity) return false;
        
        if (exp.messagePattern) {
          if (exp.messagePattern instanceof RegExp) {
            if (!exp.messagePattern.test(act.message)) return false;
          } else {
            if (!act.message.includes(exp.messagePattern)) return false;
          }
        }
        
        if (exp.line !== undefined) {
          if (Math.abs(act.location.startLine - exp.line) > 1) return false;
        }
        
        return true;
      });

      if (!matched) {
        errors.push(
          `Missing expected finding: ${exp.ruleId} (${exp.severity})${
            exp.line ? ` at line ~${exp.line}` : ''
          }`
        );
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `Expected findings not matched:\n${errors.join('\n')}`
      );
    }
  }
}
