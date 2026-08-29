import { SorobanRedundantWriteAnalyzer } from '../redundant-write-analyzer';
import { ContractDefinition } from '@gasguard/parser';

describe('SorobanRedundantWriteAnalyzer', () => {
  let analyzer: SorobanRedundantWriteAnalyzer;

  beforeEach(() => {
    analyzer = new SorobanRedundantWriteAnalyzer();
  });

  it('should detect consecutive identical storage writes', () => {
    const mockAst: ContractDefinition = {
      type: 'Contract',
      name: 'TestContract',
      children: [
        {
          type: 'FunctionDefinition',
          name: 'setStatus',
          children: [
            {
              type: 'MethodCall',
              value: 'set',
              metadata: { storageKey: 'STATUS', storageValue: '1' },
            },
            {
              type: 'MethodCall',
              value: 'set',
              metadata: { storageKey: 'STATUS', storageValue: '1' },
            },
          ],
        },
      ],
    };

    const result = analyzer.analyze(mockAst, 'contracts/status.rs');

    expect(result.metrics.redundantWritesDetected).toBe(1);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        ruleId: 'SOROBAN-STOR-05',
        severity: 'medium',
      }),
    );
  });
});