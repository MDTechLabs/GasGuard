import { RuleSandbox, SandboxResult, SandboxReport } from './rule-sandbox';
import { SAMPLE_CONTRACTS } from './sample-contracts';

describe('RuleSandbox', () => {
  let sandbox: RuleSandbox;

  beforeEach(() => {
    sandbox = new RuleSandbox({ verbose: false });
  });

  describe('createSandbox', () => {
    it('should create a sandbox with default config', async () => {
      const created = await sandbox.createSandbox();
      expect(created).toBeInstanceOf(RuleSandbox);
    });

    it('should create a sandbox with custom config', async () => {
      const created = await sandbox.createSandbox({
        contractId: 'auth',
        verbose: true,
      });
      expect(created).toBeInstanceOf(RuleSandbox);
    });
  });

  describe('runRule', () => {
    it('should run a rule against a sample contract and return results', async () => {
      const result = await sandbox.runRule('auth-check', {
        contractId: 'auth',
      });
      expect(result).toBeDefined();
      expect(result.ruleId).toBe('auth-check');
      expect(result.contractId).toBe('sample-auth');
    });

    it('should detect findings for matching rules', async () => {
      const result = await sandbox.runRule('auth-check', {
        contractId: 'auth',
      });
      expect(result.findings.length).toBeGreaterThan(0);
    });

    it('should return no findings for non-matching rules', async () => {
      const result = await sandbox.runRule('auth-check', {
        contractId: 'token',
      });
      expect(result.findings).toHaveLength(0);
    });

    it('should handle unknown contract IDs', async () => {
      const result = await sandbox.runRule('some-rule', {
        contractId: 'nonexistent',
      });
      expect(result.error).toBeDefined();
      expect(result.passed).toBe(false);
    });
  });

  describe('runAllRules', () => {
    it('should run all rules against a contract', async () => {
      // With no analyzers registered, runAllRules will have no rule IDs to run
      const report = await sandbox.runAllRules({
        ruleIds: ['auth-check', 'storage-check'],
        contractId: 'auth',
      });
      expect(report.totalRules).toBe(2);
      expect(report.results).toHaveLength(2);
    });

    it('should return a report summary', async () => {
      const report = await sandbox.runAllRules({
        ruleIds: ['auth-check', 'storage-check', 'event-check'],
        contractId: 'auth',
      });
      expect(report.totalRules).toBeGreaterThan(0);
      expect(typeof report.totalPassed).toBe('number');
      expect(typeof report.totalFailed).toBe('number');
      expect(typeof report.executionTimeMs).toBe('number');
    });

    it('should handle empty rule list gracefully', async () => {
      const report = await sandbox.runAllRules({ ruleIds: [] });
      expect(report.totalRules).toBe(0);
      expect(report.results).toHaveLength(0);
    });
  });

  describe('SandboxResult', () => {
    it('should contain execution time in milliseconds', async () => {
      const result = await sandbox.runRule('auth-check', {
        contractId: 'auth',
      });
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should indicate pass/fail status', async () => {
      const result = await sandbox.runRule('auth-check', {
        contractId: 'auth',
      });
      expect(typeof result.passed).toBe('boolean');
    });

    it('should include contract name', async () => {
      const result = await sandbox.runRule('auth-check', {
        contractId: 'auth',
      });
      expect(result.contractName).toBe('Authentication Test Contract');
    });
  });

  describe('SandboxReport', () => {
    it('should aggregate multiple results', async () => {
      const report = await sandbox.runAllRules({
        ruleIds: ['rule-a', 'rule-b', 'rule-c'],
        contractId: 'token',
      });
      expect(report.totalRules).toBe(3);
      expect(report.results).toHaveLength(3);
    });
  });

  describe('resetSandbox', () => {
    it('should clear all results', async () => {
      await sandbox.runRule('auth-check', { contractId: 'auth' });
      expect(sandbox.getResults().length).toBeGreaterThan(0);

      await sandbox.resetSandbox();
      expect(sandbox.getResults()).toHaveLength(0);
    });

    it('should clear registered analyzers', async () => {
      await sandbox.resetSandbox();
      // After reset, running all rules should produce empty report
      const report = await sandbox.runAllRules();
      expect(report.totalRules).toBe(0);
    });
  });

  describe('getAvailableContracts', () => {
    it('should return all sample contracts', () => {
      const contracts = sandbox.getAvailableContracts();
      expect(contracts.length).toBeGreaterThanOrEqual(5);
      expect(contracts.some((c) => c.id === 'sample-token')).toBe(true);
      expect(contracts.some((c) => c.id === 'sample-auth')).toBe(true);
    });

    it('should include contract metadata', () => {
      const contracts = sandbox.getAvailableContracts();
      const token = contracts.find((c) => c.id === 'sample-token');
      expect(token).toBeDefined();
      expect(token!.tags).toContain('token');
    });
  });

  describe('sample contracts', () => {
    it('should have valid source code for all contracts', () => {
      const contracts = sandbox.getAvailableContracts();
      for (const contract of contracts) {
        expect(contract.source).toBeDefined();
        expect(contract.source.length).toBeGreaterThan(0);
        expect(contract.source).toContain('soroban_sdk');
      }
    });
  });

  describe('edge cases', () => {
    it('should handle rapid rule execution', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        sandbox.runRule(`rule-${i}`, { contractId: 'token' }),
      );
      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);
      for (const result of results) {
        expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('should run rules with different contracts sequentially', async () => {
      const result1 = await sandbox.runRule('auth-check', {
        contractId: 'auth',
      });
      const result2 = await sandbox.runRule('storage-check', {
        contractId: 'storage',
      });
      expect(result1.contractId).toBe('sample-auth');
      expect(result2.contractId).toBe('sample-storage');
    });
  });
});
