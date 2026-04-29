/**
 * Snapshot Manager - Handle snapshot testing for rules
 */

import * as fs from 'fs';
import * as path from 'path';
import { Finding } from '../../../engine/core/analyzer-interface';
import { TestSnapshot, ExpectedFinding } from './types';

export class SnapshotManager {
  private snapshotDir: string;

  constructor(snapshotDir: string = './__snapshots__') {
    this.snapshotDir = snapshotDir;
    
    if (!fs.existsSync(this.snapshotDir)) {
      fs.mkdirSync(this.snapshotDir, { recursive: true });
    }
  }

  /**
   * Load snapshot for a fixture
   */
  loadSnapshot(ruleId: string, fixtureId: string): TestSnapshot | null {
    const snapshotPath = this.getSnapshotPath(ruleId, fixtureId);
    
    if (!fs.existsSync(snapshotPath)) {
      return null;
    }

    const content = fs.readFileSync(snapshotPath, 'utf-8');
    return JSON.parse(content) as TestSnapshot;
  }

  /**
   * Save snapshot for a fixture
   */
  saveSnapshot(snapshot: TestSnapshot): void {
    const snapshotPath = this.getSnapshotPath(snapshot.ruleId, snapshot.fixtureId);
    const content = JSON.stringify(snapshot, null, 2);
    
    fs.writeFileSync(snapshotPath, content, 'utf-8');
  }

  /**
   * Compare actual findings with snapshot
   */
  compareWithSnapshot(
    ruleId: string,
    fixtureId: string,
    actualFindings: Finding[]
  ): { matches: boolean; snapshot: TestSnapshot | null; diff?: string } {
    const snapshot = this.loadSnapshot(ruleId, fixtureId);
    
    if (!snapshot) {
      return { matches: false, snapshot: null };
    }

    const matches = this.findingsMatch(snapshot.actualFindings, actualFindings);
    
    if (!matches) {
      const diff = this.generateDiff(snapshot.actualFindings, actualFindings);
      return { matches: false, snapshot, diff };
    }

    return { matches: true, snapshot };
  }

  /**
   * Update snapshot with new findings
   */
  updateSnapshot(
    ruleId: string,
    fixtureId: string,
    input: string,
    expectedFindings: ExpectedFinding[],
    actualFindings: Finding[],
    passed: boolean
  ): TestSnapshot {
    const snapshot: TestSnapshot = {
      fixtureId,
      ruleId,
      timestamp: new Date().toISOString(),
      input,
      expectedFindings,
      actualFindings,
      passed,
    };

    this.saveSnapshot(snapshot);
    return snapshot;
  }

  /**
   * Delete a snapshot
   */
  deleteSnapshot(ruleId: string, fixtureId: string): boolean {
    const snapshotPath = this.getSnapshotPath(ruleId, fixtureId);
    
    if (fs.existsSync(snapshotPath)) {
      fs.unlinkSync(snapshotPath);
      return true;
    }
    
    return false;
  }

  /**
   * List all snapshots for a rule
   */
  listSnapshotsForRule(ruleId: string): string[] {
    const ruleDir = path.join(this.snapshotDir, ruleId);
    
    if (!fs.existsSync(ruleDir)) {
      return [];
    }

    return fs.readdirSync(ruleDir).filter((f: string) => f.endsWith('.json'));
  }

  /**
   * Clear all snapshots for a rule
   */
  clearRuleSnapshots(ruleId: string): number {
    const ruleDir = path.join(this.snapshotDir, ruleId);
    
    if (!fs.existsSync(ruleDir)) {
      return 0;
    }

    const files = fs.readdirSync(ruleDir);
    let count = 0;
    
    for (const file of files) {
      fs.unlinkSync(path.join(ruleDir, file));
      count++;
    }
    
    return count;
  }

  /**
   * Get snapshot file path
   */
  private getSnapshotPath(ruleId: string, fixtureId: string): string {
    const ruleDir = path.join(this.snapshotDir, ruleId);
    
    if (!fs.existsSync(ruleDir)) {
      fs.mkdirSync(ruleDir, { recursive: true });
    }

    return path.join(ruleDir, `${fixtureId}.json`);
  }

  /**
   * Compare two sets of findings
   */
  private findingsMatch(expected: Finding[], actual: Finding[]): boolean {
    if (expected.length !== actual.length) {
      return false;
    }

    for (let i = 0; i < expected.length; i++) {
      const exp = expected[i];
      const act = actual[i];

      if (exp.ruleId !== act.ruleId) return false;
      if (exp.severity !== act.severity) return false;
      if (exp.message !== act.message) return false;
      if (exp.location.startLine !== act.location.startLine) return false;
    }

    return true;
  }

  /**
   * Generate a diff between expected and actual findings
   */
  private generateDiff(expected: Finding[], actual: Finding[]): string {
    let diff = '\nSnapshot Diff:\n';
    diff += '='.repeat(60) + '\n';

    diff += `\nExpected ${expected.length} finding(s), got ${actual.length}\n\n`;

    if (expected.length !== actual.length) {
      diff += 'Finding count mismatch\n';
    }

    const maxLen = Math.max(expected.length, actual.length);
    
    for (let i = 0; i < maxLen; i++) {
      const exp = expected[i];
      const act = actual[i];

      if (!exp) {
        diff += `+ Unexpected: ${act?.ruleId} at line ${act?.location.startLine}\n`;
      } else if (!act) {
        diff += `- Missing: ${exp.ruleId} at line ${exp.location.startLine}\n`;
      } else if (
        exp.ruleId !== act.ruleId ||
        exp.severity !== act.severity ||
        exp.message !== act.message
      ) {
        diff += `~ Mismatch at index ${i}:\n`;
        diff += `  Expected: ${exp.ruleId} (${exp.severity})\n`;
        diff += `  Actual:   ${act.ruleId} (${act.severity})\n`;
      }
    }

    diff += '='.repeat(60) + '\n';
    
    return diff;
  }
}
