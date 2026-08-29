import { SorobanStorageLifetimeAnalyzer } from '../storage-lifetime-analyzer';
import { ContractDefinition } from '@gasguard/parser';

describe('SorobanStorageLifetimeAnalyzer', () => {
  let analyzer: SorobanStorageLifetimeAnalyzer;

  beforeEach(() => {
    analyzer = new SorobanStorageLifetimeAnalyzer();
  });

  it('should detect temporary data stored using persistent storage', () => {
    const mockAst: ContractDefinition = {
      type: 'Contract',
      name: 'TestContract',
      children: [
        {
          type: 'StorageDefinition',
          metadata: { storageType: 'persistent', usageContext: 'nonce' },
        },
      ],
    };

    const result = analyzer.analyze(mockAst, 'contracts/auth.rs');

    expect(result.metrics.temporaryStorageCandidates).toBe(1);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        ruleId: 'SOROBAN-STOR-06',
        severity: 'medium',
      }),
    );
  });
});