import { describe, expect, it } from '@jest/globals';
import { SorobanCoverageReporter } from './coverage-reporter';
import { RuleCoverageEntry } from './types';

describe('SorobanCoverageReporter', () => {
  const sampleRules: RuleCoverageEntry[] = [
    { ruleId: 'GG001', ruleName: 'Reentrancy Guard', category: 'security', executed: true, findingsCount: 2, executionTime: 45, suppressedCount: 0 },
    { ruleId: 'GG002', ruleName: 'Unchecked Transfer', category: 'security', executed: true, findingsCount: 1, executionTime: 30, suppressedCount: 1 },
    { ruleId: 'GG003', ruleName: 'Gas Loop Limit', category: 'gas', executed: false, findingsCount: 0, executionTime: 0, suppressedCount: 0 },
    { ruleId: 'GG004', ruleName: 'Storage Bloat', category: 'gas', executed: true, findingsCount: 3, executionTime: 55, suppressedCount: 0 },
    { ruleId: 'GG005', ruleName: 'Error Handling', category: 'quality', executed: true, findingsCount: 0, executionTime: 20, suppressedCount: 0 },
  ];

  it('calculates overall coverage percentage', () => {
    const reporter = new SorobanCoverageReporter();
    const report = reporter.generateReport(sampleRules);

    expect(report.totalRules).toBe(5);
    expect(report.executedRules).toBe(4);
    expect(report.coveragePercentage).toBe(80);
  });

  it('groups coverage by category', () => {
    const reporter = new SorobanCoverageReporter();
    const report = reporter.generateReport(sampleRules);

    expect(report.byCategory.security.total).toBe(2);
    expect(report.byCategory.security.executed).toBe(2);
    expect(report.byCategory.gas.total).toBe(2);
    expect(report.byCategory.gas.executed).toBe(1);
  });

  it('generates markdown output', () => {
    const reporter = new SorobanCoverageReporter();
    const report = reporter.generateReport(sampleRules);
    const md = reporter.formatMarkdown(report);

    expect(md).toContain('Soroban Rule Coverage Report');
    expect(md).toContain('80%');
    expect(md).toContain('GG001');
  });

  it('handles empty rule set', () => {
    const reporter = new SorobanCoverageReporter();
    const report = reporter.generateReport([]);

    expect(report.totalRules).toBe(0);
    expect(report.coveragePercentage).toBe(0);
  });
});
