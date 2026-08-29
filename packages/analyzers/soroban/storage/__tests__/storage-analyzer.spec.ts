import { SorobanStorageAnalyzer } from '../storage-analyzer';
import { ContractDefinition } from '@gasguard/parser';

describe('SorobanStorageAnalyzer', () => {
  let analyzer: SorobanStorageAnalyzer;

  beforeEach(() => {
    analyzer = new SorobanStorageAnalyzer();
  });

  it('should detect frequent storage writes inside loops', () => {
    const mockAst: ContractDefinition = {
      type: 'Contract',
      name: 'TestContract',
      children: [
        {
          type: 'ForStatement',
          children: [
            {
              type: 'MethodCall',
              value: 'set',
            },
          ],
        },
      ],
    };

    const result = analyzer.analyze(mockAst, 'contracts/test.rs');

    expect(result.metrics.frequentWritesDetected).toBe(1);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        ruleId: 'SOROBAN-STOR-01',
        severity: 'high',
      }),
    );
  });

  it('should identify unnecessary redundant reads', () => {
    const mockAst: ContractDefinition = {
      type: 'Contract',
      name: 'TestContract',
      children: [
        {
          type: 'MethodCall',
          value: 'get',
          metadata: { isRepeatedLookup: true },
        },
      ],
    };

    const result = analyzer.analyze(mockAst, 'contracts/test.rs');

    expect(result.metrics.unnecessaryReadsDetected).toBe(1);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        ruleId: 'SOROBAN-STOR-02',
        severity: 'medium',
      }),
    );
  });
});

import { SorobanRedundantReadAnalyzer } from '../redundant-read-analyzer';
import { ContractDefinition } from '@gasguard/parser';

describe('SorobanRedundantReadAnalyzer', () => {
  let analyzer: SorobanRedundantReadAnalyzer;

  beforeEach(() => {
    analyzer = new SorobanRedundantReadAnalyzer();
  });

  it('should detect repeated storage reads in the same function scope', () => {
    const mockAst: ContractDefinition = {
      type: 'Contract',
      name: 'TestContract',
      children: [
        {
          type: 'FunctionDefinition',
          name: 'checkBalance',
          children: [
            {
              type: 'MethodCall',
              value: 'get',
              metadata: { storageKey: 'BALANCE' },
            },
            {
              type: 'MethodCall',
              value: 'get',
              metadata: { storageKey: 'BALANCE' },
            },
          ],
        },
      ],
    };

    const result = analyzer.analyze(mockAst, 'contracts/balance.rs');

    expect(result.metrics.redundantReadsDetected).toBe(1);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        ruleId: 'SOROBAN-STOR-04',
        severity: 'medium',
      }),
    );
  });

  it('should avoid false positives when storage value is modified between reads', () => {
    const mockAst: ContractDefinition = {
      type: 'Contract',
      name: 'TestContract',
      children: [
        {
          type: 'FunctionDefinition',
          name: 'updateAndCheck',
          children: [
            {
              type: 'MethodCall',
              value: 'get',
              metadata: { storageKey: 'BALANCE' },
            },
            {
              type: 'MethodCall',
              value: 'set',
              metadata: { storageKey: 'BALANCE' },
            },
            {
              type: 'MethodCall',
              value: 'get',
              metadata: { storageKey: 'BALANCE' },
            },
          ],
        },
      ],
    };

    const result = analyzer.analyze(mockAst, 'contracts/balance.rs');

    expect(result.metrics.redundantReadsDetected).toBe(0);
    expect(result.findings).toHaveLength(0);
  });
});
