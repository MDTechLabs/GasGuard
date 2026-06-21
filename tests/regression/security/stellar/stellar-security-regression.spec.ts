import { detectMissingAccessControl } from '../../../rules/stellar/access-control/detect-missing-access-control';
import { detectWeakRoleHierarchies } from '../../../rules/stellar/access-control/detect-weak-role-hierarchies';
import { detectUnsafeCrossContractInvocation } from '../../../rules/stellar/cross-contract/detect-unsafe-cross-contract-invocation';
import { detectExcessiveEventTopics } from '../../../rules/stellar/events/detect-excessive-event-topics';
import { detectMissingUpgradeGuards } from '../../../rules/stellar/upgradeability/detect-missing-upgrade-guards';
import * as path from 'path';
import * as fs from 'fs';

type DetectorFn = (code: string) => { detected: boolean; message: string; [key: string]: any };

interface RegressionFixture {
  id: string;
  name: string;
  description: string;
  input: string;
  expectedFindings: { ruleId: string; severity: string; messagePattern: string; line?: number }[];
  metadata: {
    language: string;
    category: string;
    tags: string[];
    regressionType: string;
    expectedTotalViolations: number;
    safePatternsPresent: string[];
    targetRule: string;
  };
}

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

const DETECTOR_BY_RULE: Record<string, DetectorFn> = {
  'detect-missing-access-control': detectMissingAccessControl,
  'detect-weak-role-hierarchies': detectWeakRoleHierarchies,
  'detect-unsafe-cross-contract-invocation': detectUnsafeCrossContractInvocation,
  'detect-excessive-event-topics': detectExcessiveEventTopics,
  'detect-missing-upgrade-guards': detectMissingUpgradeGuards,
};

function loadAllFixtures(): RegressionFixture[] {
  if (!fs.existsSync(FIXTURES_DIR)) {
    throw new Error(`Regression fixtures directory not found: ${FIXTURES_DIR}`);
  }
  const files = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));
  return files
    .map(f => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf-8')))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function getDetector(fixture: RegressionFixture): DetectorFn {
  const targetRule = fixture.metadata?.targetRule;
  const detector = targetRule ? DETECTOR_BY_RULE[targetRule] : undefined;
  if (!detector) {
    throw new Error(
      `No detector for fixture "${fixture.id}" (targetRule="${targetRule}"). ` +
      `Available: ${Object.keys(DETECTOR_BY_RULE).join(', ')}`
    );
  }
  return detector;
}

describe('Stellar Security Rule Regression Suite', () => {
  const fixtures = loadAllFixtures();
  const positiveFixtures = fixtures.filter(f => f.metadata.expectedTotalViolations > 0);
  const safeFixtures = fixtures.filter(f => f.metadata.expectedTotalViolations === 0);

  it('has unique fixture IDs and valid target rules', () => {
    const ids = fixtures.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of fixtures) {
      expect(f.metadata.targetRule).toBeDefined();
      expect(DETECTOR_BY_RULE[f.metadata.targetRule]).toBeDefined();
    }
  });

  describe('fixture structure validation', () => {
    for (const fixture of fixtures) {
      it(`${fixture.id}: has valid structure`, () => {
        expect(fixture.id).toBeDefined();
        expect(fixture.name).toBeDefined();
        expect(fixture.description).toBeDefined();
        expect(fixture.input).toBeDefined();
        expect(Array.isArray(fixture.expectedFindings)).toBe(true);
        expect(fixture.metadata).toBeDefined();
        expect(fixture.metadata.language).toBe('soroban');
        expect(fixture.metadata.regressionType).toBe('cross-version');
        expect(fixture.metadata.expectedTotalViolations).toBe(fixture.expectedFindings.length);
        expect(Array.isArray(fixture.metadata.safePatternsPresent)).toBe(true);
        expect(fixture.metadata.safePatternsPresent.length).toBeGreaterThan(0);
      });
    }
  });

  describe('vulnerability detection (positive fixtures)', () => {
    for (const fixture of positiveFixtures) {
      it(`${fixture.id}: detects ${fixture.metadata.expectedTotalViolations} violation(s)`, () => {
        const detector = getDetector(fixture);
        const result = detector(fixture.input);
        expect(result.detected).toBe(true);
      });

      it(`${fixture.id}: all expected findings reflected in result message`, () => {
        const detector = getDetector(fixture);
        const result = detector(fixture.input);
        for (const finding of fixture.expectedFindings) {
          if (finding.messagePattern) {
            const escaped = finding.messagePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            expect(result.message).toMatch(new RegExp(escaped, 'i'));
          }
        }
      });
    }
  });

  describe('safe pattern validation (negative fixtures)', () => {
    for (const fixture of safeFixtures) {
      it(`${fixture.id}: does not flag safe patterns`, () => {
        const detector = getDetector(fixture);
        const result = detector(fixture.input);
        expect(result.detected).toBe(false);
      });

      it(`${fixture.id}: reports no violations in message`, () => {
        const detector = getDetector(fixture);
        const result = detector(fixture.input);
        expect(result.message).not.toMatch(/violation|vulnerability|lack|weak|unsafe|excessive|missing/i);
      });
    }
  });

  describe('cross-version baseline', () => {
    for (const fixture of fixtures) {
      const expectedDetected = fixture.metadata.expectedTotalViolations > 0;
      it(`${fixture.id}: maintains baseline detected=${expectedDetected}`, () => {
        const detector = getDetector(fixture);
        const result = detector(fixture.input);
        expect(result.detected).toBe(expectedDetected);
      });
    }
  });

  describe('regression report', () => {
    it('all regression checks pass', () => {
      let passCount = 0;
      let failCount = 0;
      for (const fixture of fixtures) {
        const detector = getDetector(fixture);
        const result = detector(fixture.input);
        const expectedDetected = fixture.metadata.expectedTotalViolations > 0;
        if (result.detected === expectedDetected) { passCount++; } else { failCount++; }
      }
      expect(failCount).toBe(0);
      expect(passCount).toBe(fixtures.length);
    });
  });
});
