/**
 * Example: Testing Soroban/Rust Rules with the GasGuard Testing Framework
 * 
 * This demonstrates how to use the testing framework for Rust-based rules
 */

import { RuleTester } from '../../libs/testing/src/rule-tester';
import { FixtureLoader } from '../../libs/testing/src/fixture-loader';
import { RuleAssertions } from '../../libs/testing/src/assertions';

describe('Soroban Rule Tests', () => {
  
  describe('soroban-unused-state-variables', () => {
    it('should detect unused state variables', () => {
      // This would be tested via Rust test runner
      // Example shows the fixture-based approach
      
      const fixture = FixtureLoader.loadFixture(
        './tests/rules/fixtures/soroban-unused-variable.json'
      );
      
      expect(fixture.id).toBe('soroban-unused-var-1');
      expect(fixture.expectedViolations).toBeDefined();
      expect(fixture.expectedViolations.length).toBeGreaterThan(0);
      
      // The actual rule testing happens in Rust tests
      // This validates the fixture structure
    });
  });

  describe('Fixture Validation', () => {
    it('should validate Soroban fixture structure', () => {
      const fixture = FixtureLoader.loadFixture(
        './tests/rules/fixtures/soroban-unused-variable.json'
      );
      
      // Verify required fields
      expect(fixture.id).toBeDefined();
      expect(fixture.name).toBeDefined();
      expect(fixture.description).toBeDefined();
      expect(fixture.input).toContain('soroban_sdk');
      expect(fixture.expectedViolations).toBeDefined();
      expect(fixture.metadata?.language).toBe('soroban');
    });
  });
});
