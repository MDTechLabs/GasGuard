import * as fs from 'fs';
import * as path from 'path';
import { StellarRegressionFixture, RegressionResult } from './regression-types';
import { detectMissingAccessControl, AccessControlResult } from '../../../../rules/stellar/access-control/detect-missing-access-control';
import { detectWeakRoleHierarchies, WeakRoleHierarchyResult } from '../../../../rules/stellar/access-control/detect-weak-role-hierarchies';
import { detectUnsafeCrossContractInvocation, CrossContractResult } from '../../../../rules/stellar/cross-contract/detect-unsafe-cross-contract-invocation';
import { detectExcessiveEventTopics, ExcessiveEventTopicsResult } from '../../../../rules/stellar/events/detect-excessive-event-topics';
import { detectMissingUpgradeGuards, UpgradeGuardResult } from '../../../../rules/stellar/upgradeability/detect-missing-upgrade-guards';

const RULE_REGISTRY: Record<string, (code: string) => any> = {
  'detect-missing-access-control': detectMissingAccessControl,
  'detect-weak-role-hierarchies': detectWeakRoleHierarchies,
  'detect-unsafe-cross-contract-invocation': detectUnsafeCrossContractInvocation,
  'detect-excessive-event-topics': detectExcessiveEventTopics,
  'detect-missing-upgrade-guards': detectMissingUpgradeGuards,
};

export function getRuleFn(ruleId: string): (code: string) => any {
  const fn = RULE_REGISTRY[ruleId];
  if (!fn) {
    throw new Error(`Unknown rule ID: ${ruleId}. Available: ${Object.keys(RULE_REGISTRY).join(', ')}`);
  }
  return fn;
}

export function loadAllFixtures(): StellarRegressionFixture[] {
  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json') && !f.startsWith('suite'));
  const all: StellarRegressionFixture[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(fixturesDir, file), 'utf-8');
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      all.push(...parsed);
    } else {
      all.push(parsed);
    }
  }

  return all;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function getViolationSummary(violations: Array<{ topicCount?: number; hasLargePayload?: boolean }>): string {
  return violations.map((v, i) =>
    `[${i}] topics=${v.topicCount ?? '?'} largePayload=${v.hasLargePayload}`
  ).join('; ');
}

export function runFixture(fixture: StellarRegressionFixture): RegressionResult {
  const ruleFn = getRuleFn(fixture.ruleId);
  const result = ruleFn(fixture.input);

  const actualDetected = result.detected;
  const expectedDetected = fixture.expected.detected;

  if (actualDetected !== expectedDetected) {
    return {
      fixture,
      passed: false,
      actualDetected,
      detail: `Expected detected=${expectedDetected} but got detected=${actualDetected}. Message: ${result.message}`,
    };
  }

  if (!actualDetected) {
    return { fixture, passed: true, actualDetected, detail: 'Correctly not detected' };
  }

  const exp = fixture.expected;

  if ('flaggedFunctions' in exp && Array.isArray(exp.flaggedFunctions)) {
    const actual = (result as AccessControlResult).flaggedFunctions;
    const missing = exp.flaggedFunctions.filter(f => !actual.includes(f));
    const extra = actual.filter(f => !exp.flaggedFunctions!.includes(f));
    if (missing.length > 0 || extra.length > 0) {
      return {
        fixture,
        passed: false,
        actualDetected,
        detail: `Flagged functions mismatch. Expected: [${exp.flaggedFunctions.join(', ')}] Actual: [${actual.join(', ')}]${missing.length ? ` Missing: [${missing.join(', ')}]` : ''}${extra.length ? ` Extra: [${extra.join(', ')}]` : ''}`,
      };
    }
  }

  if ('weakRoles' in exp && Array.isArray(exp.weakRoles)) {
    const actual = (result as WeakRoleHierarchyResult).weakRoles;
    const missing = exp.weakRoles.filter(r => !actual.includes(r));
    const extra = actual.filter(r => !exp.weakRoles!.includes(r));
    if (missing.length > 0 || extra.length > 0) {
      return {
        fixture,
        passed: false,
        actualDetected,
        detail: `Weak roles mismatch. Expected: [${exp.weakRoles.join(', ')}] Actual: [${actual.join(', ')}]${missing.length ? ` Missing: [${missing.join(', ')}]` : ''}${extra.length ? ` Extra: [${extra.join(', ')}]` : ''}`,
      };
    }
  }

  if ('violations' in exp && Array.isArray(exp.violations)) {
    const actual = (result as ExcessiveEventTopicsResult).violations;
    if (actual.length !== exp.violations.length) {
      return {
        fixture,
        passed: false,
        actualDetected,
        detail: `Expected ${exp.violations.length} violation(s) but got ${actual.length}. Expected: [${getViolationSummary(exp.violations)}] Actual: [${getViolationSummary(actual)}]`,
      };
    }
    for (let i = 0; i < exp.violations.length; i++) {
      const ev = exp.violations[i];
      const av = actual[i];
      if (ev.topicCount !== undefined && av.topicCount !== ev.topicCount) {
        return {
          fixture,
          passed: false,
          actualDetected,
          detail: `Violation[${i}] topicCount mismatch: expected ${ev.topicCount} got ${av.topicCount}`,
        };
      }
      if (ev.hasLargePayload !== undefined && av.hasLargePayload !== ev.hasLargePayload) {
        return {
          fixture,
          passed: false,
          actualDetected,
          detail: `Violation[${i}] hasLargePayload mismatch: expected ${ev.hasLargePayload} got ${av.hasLargePayload}`,
        };
      }
    }
  }

  return { fixture, passed: true, actualDetected, detail: 'All checks passed' };
}

export function runAllFixtures(fixtures: StellarRegressionFixture[]): RegressionResult[] {
  return fixtures.map(runFixture);
}

export function generateResultsTable(results: RegressionResult[]): string {
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  let output = `\n${'='.repeat(72)}\n`;
  output += `  STELLAR SECURITY REGRESSION REPORT\n`;
  output += `${'='.repeat(72)}\n`;
  output += `  Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}\n`;
  output += `${'-'.repeat(72)}\n`;

  const grouped: Record<string, RegressionResult[]> = {};
  for (const r of results) {
    const key = r.fixture.ruleId;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }

  for (const [ruleId, group] of Object.entries(grouped)) {
    const gPassed = group.filter(r => r.passed).length;
    const gFailed = group.filter(r => !r.passed).length;
    output += `\n  ${ruleId}  [${gPassed}/${gPassed + gFailed} passed]\n`;

    for (const r of group) {
      const marker = r.passed ? '  ✓' : '  ✗';
      const tag = r.fixture.metadata.regressionType;
      output += `  ${marker} [${tag}] ${r.fixture.name}\n`;
      if (!r.passed) {
        output += `       ${r.detail}\n`;
      }
    }
  }

  output += `${'='.repeat(72)}\n`;
  return output;
}
