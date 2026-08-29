import { detectUnsafeOperations } from '../../rules/stellar/security/unsafe-operations/detect-unsafe-operations';
import { FixtureLoader } from '../../libs/testing/src/fixture-loader';

describe('detectUnsafeOperations', () => {
  describe('unsafe blocks and functions', () => {
    it('flags an unsafe block', () => {
      const code = `unsafe { *ptr = 42; }`;
      const result = detectUnsafeOperations(code);
      expect(result.detected).toBe(true);
      expect(result.violations.some((v) => v.type === 'unsafe-block')).toBe(true);
    });

    it('flags an unsafe function declaration', () => {
      const code = `unsafe fn deref(ptr: *const u32) -> u32 { *ptr }`;
      const result = detectUnsafeOperations(code);
      expect(result.detected).toBe(true);
      expect(result.violations.some((v) => v.type === 'unsafe-function')).toBe(true);
    });
  });

  describe('unchecked unwrap', () => {
    it('flags .unwrap() usage', () => {
      const code = `let val = storage.get("key").unwrap();`;
      const result = detectUnsafeOperations(code);
      expect(result.detected).toBe(true);
      expect(result.violations.some((v) => v.type === 'unchecked-unwrap')).toBe(true);
      expect(result.violations.find((v) => v.type === 'unchecked-unwrap')!.recommendation).toMatch(/unwrap_or/);
    });
  });

  describe('panic and unreachable macros', () => {
    it('flags panic! macro', () => {
      const code = `panic!("not allowed");`;
      const result = detectUnsafeOperations(code);
      expect(result.detected).toBe(true);
      expect(result.violations.some((v) => v.type === 'panic-macro')).toBe(true);
    });

    it('flags unreachable! macro', () => {
      const code = `unreachable!("should never happen");`;
      const result = detectUnsafeOperations(code);
      expect(result.detected).toBe(true);
      expect(result.violations.some((v) => v.type === 'unreachable-macro')).toBe(true);
    });
  });

  describe('transmute', () => {
    it('flags std::mem::transmute', () => {
      const code = `let x: u64 = std::mem::transmute(val);`;
      const result = detectUnsafeOperations(code);
      expect(result.detected).toBe(true);
      expect(result.violations.some((v) => v.type === 'transmute')).toBe(true);
    });

    it('flags mem::transmute', () => {
      const code = `let x: u64 = mem::transmute(val);`;
      const result = detectUnsafeOperations(code);
      expect(result.detected).toBe(true);
      expect(result.violations.some((v) => v.type === 'transmute')).toBe(true);
    });
  });

  describe('raw pointers', () => {
    it('flags *const T pointer type', () => {
      const code = `let ptr: *const u32 = &val;`;
      const result = detectUnsafeOperations(code);
      expect(result.detected).toBe(true);
      expect(result.violations.some((v) => v.type === 'raw-pointer')).toBe(true);
    });

    it('flags *mut T pointer type', () => {
      const code = `let ptr: *mut u32 = &mut val;`;
      const result = detectUnsafeOperations(code);
      expect(result.detected).toBe(true);
      expect(result.violations.some((v) => v.type === 'raw-pointer')).toBe(true);
    });
  });

  describe('unchecked arithmetic operators', () => {
    it('flags raw addition operator', () => {
      const code = `let total = amount + fee;`;
      const result = detectUnsafeOperations(code);
      expect(result.detected).toBe(true);
      expect(result.violations.some((v) => v.type === 'unchecked-arithmetic-operator')).toBe(true);
    });

    it('flags raw subtraction operator', () => {
      const code = `let remaining = balance - amount;`;
      const result = detectUnsafeOperations(code);
      expect(result.detected).toBe(true);
      expect(result.violations.some((v) => v.type === 'unchecked-arithmetic-operator')).toBe(true);
    });

    it('flags raw multiplication operator', () => {
      const code = `let product = price * quantity;`;
      const result = detectUnsafeOperations(code);
      expect(result.detected).toBe(true);
      expect(result.violations.some((v) => v.type === 'unchecked-arithmetic-operator')).toBe(true);
    });
  });

  describe('safe cases', () => {
    it('does not flag checked arithmetic helpers', () => {
      const code = `let total = amount.checked_add(fee).unwrap_or(0);`;
      const result = detectUnsafeOperations(code);
      // Should not flag the arithmetic operator since checked_add is used
      const arithViolations = result.violations.filter((v) => v.type === 'unchecked-arithmetic-operator');
      expect(arithViolations).toHaveLength(0);
    });

    it('does not flag saturating helpers', () => {
      const code = `let total = amount.saturating_add(fee);`;
      const result = detectUnsafeOperations(code);
      const arithViolations = result.violations.filter((v) => v.type === 'unchecked-arithmetic-operator');
      expect(arithViolations).toHaveLength(0);
    });

    it('does not flag code without any unsafe patterns', () => {
      const code = `
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct Counter;

#[contractimpl]
impl Counter {
    pub fn increment(env: Env) -> u64 {
        let count: u64 = env.storage().instance().get("count").unwrap_or(0);
        let next = count.saturating_add(1);
        env.storage().instance().set("count", &next);
        next
    }
}
      `;
      const result = detectUnsafeOperations(code);
      // Only the use statement line with "Counter" - should have no unsafe violations
      const unsafeViolations = result.violations.filter(
        (v) => v.type !== 'unchecked-arithmetic-operator' || !code.includes('saturating_add'),
      );
      // unwrap_or is safe, saturating_add is safe, no unsafe blocks
      expect(result.violations.filter((v) => v.type === 'unsafe-block')).toHaveLength(0);
      expect(result.violations.filter((v) => v.type === 'panic-macro')).toHaveLength(0);
      expect(result.violations.filter((v) => v.type === 'unchecked-unwrap')).toHaveLength(0);
    });

    it('does not flag comments containing unsafe keywords', () => {
      const code = `// This function uses panic!("test") but it is just a comment\nlet x = 1;`;
      const result = detectUnsafeOperations(code);
      const panicViolations = result.violations.filter((v) => v.type === 'panic-macro');
      expect(panicViolations).toHaveLength(0);
    });
  });

  describe('multiple violations', () => {
    it('reports all violations in one result', () => {
      const code = `
let val = storage.get("key").unwrap();
panic!("bad state");
let total = a + b;
unsafe { *ptr = val; }
      `;
      const result = detectUnsafeOperations(code);
      expect(result.detected).toBe(true);
      expect(result.violations.length).toBeGreaterThanOrEqual(4);
      expect(result.message).toMatch(/unsafe operation/);
      expect(result.suggestion).toMatch(/safe alternatives/);
    });
  });

  describe('no violations', () => {
    it('returns detected false for clean code', () => {
      const code = `let x = 1;`;
      const result = detectUnsafeOperations(code);
      expect(result.detected).toBe(false);
      expect(result.violations).toHaveLength(0);
      expect(result.message).toMatch(/No unsafe operations/);
    });
  });

  describe('fixture validation', () => {
    it('fixture matches expected structure', () => {
      const fixture = FixtureLoader.loadFixture(
        './tests/rules/fixtures/stellar-unsafe-operations.json',
      );
      expect(fixture.id).toBe('stellar-unsafe-operations-1');
      expect(fixture.expectedFindings.length).toBeGreaterThan(0);
      expect(fixture.metadata?.category).toBe('security');
    });

    it('detector agrees with fixture violations', () => {
      const fixture = FixtureLoader.loadFixture(
        './tests/rules/fixtures/stellar-unsafe-operations.json',
      );
      const result = detectUnsafeOperations(fixture.input);
      expect(result.detected).toBe(true);
      expect(result.violations.length).toBeGreaterThanOrEqual(fixture.expectedFindings.length);
      for (const finding of fixture.expectedFindings) {
        expect(result.violations.some((v) => v.type === finding.type)).toBe(true);
      }
    });
  });
});
