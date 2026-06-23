import { Finding, Severity } from '@engine/core';
import { FunctionRiskScoringEngine, calculateFunctionRiskScores } from './function-risk-scorer';

describe('FunctionRiskScoringEngine', () => {
  const exampleFindings: Finding[] = [
    {
      ruleId: 'access-control-missing',
      message: 'External function transferFunds lacks access control.',
      severity: Severity.CRITICAL,
      location: {
        file: 'contracts/Bank.sol',
        startLine: 45,
        endLine: 45,
      },
      metadata: {
        functionName: 'transferFunds',
      },
    },
    {
      ruleId: 'gas-inefficient-loop',
      message: 'Function transferFunds uses an expensive loop.',
      severity: Severity.HIGH,
      location: {
        file: 'contracts/Bank.sol',
        startLine: 45,
        endLine: 45,
      },
      metadata: {
        functionName: 'transferFunds',
      },
    },
    {
      ruleId: 'event-missing',
      message: 'Function approveTransaction should emit an event after state change.',
      severity: Severity.MEDIUM,
      location: {
        file: 'contracts/Bank.sol',
        startLine: 72,
        endLine: 72,
      },
      metadata: {
        functionName: 'approveTransaction',
      },
    },
  ];

  it('groups findings by function and returns a score for each function', () => {
    const scores = calculateFunctionRiskScores(exampleFindings);

    expect(scores).toHaveLength(2);
    expect(scores[0].functionName).toBe('transferFunds');
    expect(scores[0].overallScore).toBeGreaterThan(scores[1].overallScore);
    expect(scores[0].riskLevel).toBe('critical');
    expect(scores[0].severityBreakdown[Severity.CRITICAL]).toBe(1);
    expect(scores[0].severityBreakdown[Severity.HIGH]).toBe(1);
    expect(scores[1].functionName).toBe('approveTransaction');
    expect(scores[1].severityBreakdown[Severity.MEDIUM]).toBe(1);
  });

  it('uses unknown function label when function name is missing', () => {
    const findingsWithoutFunctionName: Finding[] = [
      {
        ruleId: 'access-control-missing',
        message: 'External function should have access controls.',
        severity: Severity.HIGH,
        location: {
          file: 'contracts/Bank.sol',
          startLine: 45,
          endLine: 45,
        },
      },
    ];

    const scores = calculateFunctionRiskScores(findingsWithoutFunctionName);
    expect(scores).toHaveLength(1);
    expect(scores[0].functionName).toBe('unknown');
    expect(scores[0].riskLevel).toBe('high');
  });

  it('extracts a function name from a finding message when metadata is absent', () => {
    const findingsWithMessageFunction: Finding[] = [
      {
        ruleId: 'gas-inefficient-loop',
        message: 'Function withdrawBalance uses an expensive loop.',
        severity: Severity.MEDIUM,
        location: {
          file: 'contracts/Bank.sol',
          startLine: 90,
          endLine: 90,
        },
      },
    ];

    const scores = calculateFunctionRiskScores(findingsWithMessageFunction);
    expect(scores).toHaveLength(1);
    expect(scores[0].functionName).toBe('withdrawBalance');
    expect(scores[0].riskLevel).toBe('medium');
  });
});
