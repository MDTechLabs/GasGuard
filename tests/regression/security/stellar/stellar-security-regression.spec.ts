import { FixtureLoader } from '../../../libs/testing/src/fixture-loader';
import { RuleTestFixture, ExpectedFinding } from '../../../libs/testing/src/types';
import { detectMissingAccessControl } from '../../../rules/stellar/access-control/detect-missing-access-control';
import { detectWeakRoleHierarchies } from '../../../rules/stellar/access-control/detect-weak-role-hierarchies';
import { detectUnsafeCrossContractInvocation } from '../../../rules/stellar/cross-contract/detect-unsafe-cross-contract-invocation';
import { detectExcessiveEventTopics } from '../../../rules/stellar/events/detect-excessive-event-topics';
import { detectMissingUpgradeGuards } from '../../../rules/stellar/upgradeability/detect-missing-upgrade-guards';
import * as path from 'path';
import * as fs from 'fs';

type DetectorFn = (code: string) => { detected: boolean; message: string; [key: string]: any };

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const SNAPSHOT_DIR = path.resolve(__dirname, '__snapshots__');

const DETECTOR_BY_RULE: Record<string, DetectorFn> = {
  'detect-missing-access-control': detectMissingAccessControl,
  'detect-weak-role-hierarchies': detectWeakRoleHierarchies,
  'detect-unsafe-cross-contract-invocation': detectUnsafeCrossContractInvocation,
  'detect-excessive-event-topics': detectExcessiveEventTopics,
  'detect-missing-upgrade-guards': detectMissingUpgradeGuards,
};

function loadAllFixtures(): RuleTestFixture[] {
  if (!fs.existsSync(FIXTURES_DIR)) {
    throw new Error(`Regression fixtures directory not found: ${FIXTURES_DIR}`);
  }
  return FixtureLoader.loadFixturesFromDir(FIXTURES_DIR);
}

function getDetector(fixture: RuleTestFixture): DetectorFn {
  const targetRule = fixture.metadata?.targetRule as string;
  if (targetRule && DETECTOR_BY_RULE[targetRule]) {
    return DETECTOR_BY_RULE[targetRule];
  }
  throw new Error(
    `No detector found for fixture "${fixture.id}". Expected metadata.targetRule in: ${Object.keys(DETECTOR_BY_RULE).join(', ')}`
  );
}

describe('Stellar Security Rule Regression Suite', () => {
  const fixtures = loadAllFixtures();
  const positiveFixtures = fixtures.filter(f => (f.metadata?.expectedTotalViolations as number) > 0);
  const safeFixtures = fixtures.filter(f => (f.metadata?.expectedTotalViolations as number) === 0);

  it('all regression fixtures have valid unique IDs and target rules', () => {
    const ids = fixtures.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of fixtures) {
      expect(f.metadata?.targetRule).toBeDefined();
      expect(DETECTOR_BY_RULE[f.metadata?.targetRule as string]).toBeDefined();
    }
  });

  describe('fixture structure validation', () => {
    for (const fixture of fixtures) {
      it(`${fixture.id}: has valid fixture structure`, () => {
        expect(fixture.id).toBeDefined();
        expect(fixture.name).toBeDefined();
        expect(fixture.description).toBeDefined();
        expect(fixture.input).toBeDefined();
        expect(Array.isArray(fixture.expectedFindings)).toBe(true);
        expect(fixture.metadata).toBeDefined();
        expect(fixture.metadata?.language).toBe('soroban');
        expect(fixture.metadata?.regressionType).toBe('cross-version');
        expect(fixture.metadata?.expectedTotalViolations).toBeDefined();
        expect(fixture.metadata?.expectedTotalViolations).toBe(fixture.expectedFindings.length);
        expect(fixture.metadata?.safePatternsPresent).toBeDefined();
        expect(Array.isArray(fixture.metadata?.safePatternsPresent)).toBe(true);
        expect(fixture.metadata?.targetRule).toBeDefined();
      });
    }
  });

  describe('vulnerability detection (positive fixtures)', () => {
    for (const fixture of positiveFixtures) {
      const expectedCount = fixture.metadata?.expectedTotalViolations as number;

      it(`${fixture.id}: detects ${expectedCount} violation(s)`, () => {
        const detector = getDetector(fixture);
        const result = detector(fixture.input);
        expect(result.detected).toBe(true);
      });

      it(`${fixture.id}: all expected findings are reflected in result message`, () => {
        const detector = getDetector(fixture);
        const result = detector(fixture.input);

        for (const finding of fixture.expectedFindings) {
          if (finding.messagePattern) {
            const patternStr = typeof finding.messagePattern === 'string'
              ? finding.messagePattern
              : finding.messagePattern.source;
            const escaped = patternStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            expect(result.message).toMatch(new RegExp(escaped, 'i'));
          }
        }
      });
    }
  });

  describe('safe pattern validation (negative fixtures)', () => {
    for (const fixture of safeFixtures) {
      it(`${fixture.id}: does not flag safe patterns (detected=false)`, () => {
        const detector = getDetector(fixture);
        const result = detector(fixture.input);
        expect(result.detected).toBe(false);
      });

      it(`${fixture.id}: reports no violations`, () => {
        const detector = getDetector(fixture);
        const result = detector(fixture.input);
        expect(result.message).not.toMatch(/violation|vulnerability|lack|weak|unsafe|excessive|missing/i);
      });
    }
  });

  describe('cross-version regression baseline', () => {
    for (const fixture of fixtures) {
      const expectedDetected = (fixture.metadata?.expectedTotalViolations as number) > 0;

      it(`${fixture.id}: maintains baseline detection status (expectedDetected=${expectedDetected})`, () => {
        const detector = getDetector(fixture);
        const result = detector(fixture.input);
        expect(result.detected).toBe(expectedDetected);
      });
    }
  });

  describe('snapshot regression detection', () => {
    for (const fixture of fixtures) {
      const snapshotPath = path.join(SNAPSHOT_DIR, `${fixture.id}.json`);

      it(`${fixture.id}: matches snapshot when available`, () => {
        if (!fs.existsSync(snapshotPath)) {
          return;
        }
        const detector = getDetector(fixture);
        const result = detector(fixture.input);
        const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
        expect(result.detected).toBe(snapshot.detected);
        expect(result.message).toBe(snapshot.message);
      });
    }
  });

  describe('batch validation', () => {
    it('every fixture has at least one safe pattern listed', () => {
      for (const fixture of fixtures) {
        expect((fixture.metadata?.safePatternsPresent as any[])?.length).toBeGreaterThan(0);
      }
    });

    it('all detectors referenced by fixtures exist', () => {
      for (const fixture of fixtures) {
        const targetRule = fixture.metadata?.targetRule as string;
        expect(DETECTOR_BY_RULE[targetRule]).toBeDefined();
      }
    });
  });

  describe('regression report summary', () => {
    it('all regression checks pass', () => {
      let passCount = 0;
      let failCount = 0;

      for (const fixture of fixtures) {
        const detector = getDetector(fixture);
        const result = detector(fixture.input);
        const expectedDetected = (fixture.metadata?.expectedTotalViolations as number) > 0;
        const isPass = result.detected === expectedDetected;
        if (isPass) { passCount++; } else { failCount++; }
      }

      expect(failCount).toBe(0);
      expect(passCount).toBe(fixtures.length);
    });
  });
});
