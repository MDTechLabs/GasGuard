import { Test, TestingModule } from '@nestjs/testing';
import { IncrementalAnalyzerSimpleService } from '../apps/api-service/src/analyzer/incremental-analyzer-simple.service';
import { ScannerService } from '../apps/api-service/src/scanner/scanner.service';
import { RuleViolation } from '../apps/api-service/src/scanner/interfaces/scanner.interface';

describe('IncrementalAnalyzerService', () => {
  let service: IncrementalAnalyzerSimpleService;
  let scannerService: jest.Mocked<ScannerService>;

  const mockViolation: RuleViolation = {
    ruleName: 'unused-state-variable',
    severity: 'warning',
    lineNumber: 10,
    description: 'Unused state variable detected',
    suggestion: 'Remove the unused variable',
    variableName: 'unusedVar',
  };

  const mockScanResult = {
    source: 'test.sol',
    violations: [mockViolation],
    scanTime: new Date(),
  };

  beforeEach(async () => {
    const mockScannerService = {
      scanContent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncrementalAnalyzerSimpleService,
        {
          provide: ScannerService,
          useValue: mockScannerService,
        },
      ],
    }).compile();

    service = module.get<IncrementalAnalyzerSimpleService>(IncrementalAnalyzerSimpleService);
    scannerService = module.get<ScannerService>(ScannerService) as jest.Mocked<ScannerService>;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyzeCodeIncremental', () => {
    it('should analyze single file code', async () => {
      scannerService.scanContent.mockResolvedValue(mockScanResult);

      const result = await service.analyzeCodeIncremental('contract Test {}', 'test.sol');

      expect(result.source).toBe('test.sol');
      expect(result.violations).toHaveLength(1);
      expect(result.incrementalStats.totalFiles).toBe(1);
      expect(result.incrementalStats.filesAnalyzed).toBe(1);
      expect(result.incrementalStats.isIncremental).toBe(false);
      expect(scannerService.scanContent).toHaveBeenCalledWith('contract Test {}', 'test.sol');
    });

    it('should handle empty code', async () => {
      scannerService.scanContent.mockResolvedValue({ source: 'empty.sol', violations: [], scanTime: new Date() });

      const result = await service.analyzeCodeIncremental('', 'empty.sol');

      expect(result.violations).toHaveLength(0);
      expect(result.summary).toContain('No violations found');
    });
  });

  describe('analyzeRepositoryIncremental', () => {
    it('should analyze repository', async () => {
      scannerService.scanContent.mockResolvedValue(mockScanResult);

      const result = await service.analyzeRepositoryIncremental('/path/to/repo');

      expect(result.source).toBe('/path/to/repo');
      expect(result.incrementalStats.totalFiles).toBe(0); // Simplified implementation returns 0
      expect(result.incrementalStats.isIncremental).toBe(false);
    });

    it('should force full analysis when requested', async () => {
      scannerService.scanContent.mockResolvedValue(mockScanResult);

      const result = await service.analyzeRepositoryIncremental('/path/to/repo', {
        forceFull: true,
      });

      expect(result.incrementalStats.isIncremental).toBe(false);
    });

    it('should handle analysis errors gracefully', async () => {
      scannerService.scanContent.mockRejectedValue(new Error('Analysis failed'));

      await expect(service.analyzeRepositoryIncremental('/path/to/repo')).rejects.toThrow('Analysis failed');
    });
  });

  describe('cache operations', () => {
    it('should get cache stats', async () => {
      const stats = await service.getCacheStats('/path/to/repo');

      expect(stats.totalCachedFiles).toBe(0);
      expect(stats.cacheAge).toBeNull();
      expect(stats.dependencyNodes).toBe(0);
      expect(stats.dependencyEdges).toBe(0);
    });

    it('should clear cache', async () => {
      await service.clearCache('/path/to/repo');

      // Should not throw any errors
      expect(true).toBe(true);
    });

    it('should invalidate specific files', async () => {
      await service.invalidateFiles('/path/to/repo', ['file1.sol', 'file2.rs']);

      // Should not throw any errors
      expect(true).toBe(true);
    });
  });

  describe('violation formatting', () => {
    it('should format violations correctly', async () => {
      scannerService.scanContent.mockResolvedValue(mockScanResult);

      const result = await service.analyzeCodeIncremental('contract Test {}', 'test.sol');

      expect(result.violations[0].severityIcon).toBe('⚠️');
      expect(result.violations[0].formattedMessage).toContain('WARNING');
      expect(result.violations[0].formattedMessage).toContain('Line 10');
    });

    it('should generate summary correctly', async () => {
      const multipleViolations = [
        mockViolation,
        { ...mockViolation, severity: 'error' as const, lineNumber: 20 },
        { ...mockViolation, severity: 'info' as const, lineNumber: 30 },
      ];
      scannerService.scanContent.mockResolvedValue({
        source: 'test.sol',
        violations: multipleViolations,
        scanTime: new Date(),
      });

      const result = await service.analyzeCodeIncremental('contract Test {}', 'test.sol');

      expect(result.summary).toContain('3 total violations');
      expect(result.summary).toContain('1 errors');
      expect(result.summary).toContain('1 warnings');
      expect(result.summary).toContain('1 info');
    });

    it('should calculate storage savings', async () => {
      const storageViolation = {
        ...mockViolation,
        ruleName: 'unused-state-variables',
      };
      scannerService.scanContent.mockResolvedValue({
        source: 'test.sol',
        violations: [storageViolation],
        scanTime: new Date(),
      });

      const result = await service.analyzeCodeIncremental('contract Test {}', 'test.sol');

      expect(result.storageSavings.unusedVariables).toBe(1);
      expect(result.storageSavings.estimatedSavingsKb).toBe(2.5);
      expect(result.storageSavings.monthlyLedgerRentSavings).toBe(0.0025);
    });

    it('should generate recommendations', async () => {
      scannerService.scanContent.mockResolvedValue(mockScanResult);

      const result = await service.analyzeCodeIncremental('contract Test {}', 'test.sol');

      expect(result.recommendations).toContain('Remove 1 unused state variables to reduce storage costs');
      expect(result.recommendations).toContain('Consider using more efficient data types where possible');
    });

    it('should generate positive recommendations for clean code', async () => {
      scannerService.scanContent.mockResolvedValue({
        source: 'clean.sol',
        violations: [],
        scanTime: new Date(),
      });

      const result = await service.analyzeCodeIncremental('contract Clean {}', 'clean.sol');

      expect(result.recommendations).toContain('Your contract looks good! Consider regular audits to maintain code quality.');
    });
  });
});
