import { ScannerService } from '../src/scanner/scanner.service';

describe('BatchScan E2E Stress Test', () => {
  let scannerService: ScannerService;

  beforeAll(async () => {
    scannerService = new ScannerService();
    await scannerService.onModuleInit();
  });

  afterAll(async () => {
    await scannerService.onModuleDestroy();
  });

  it('should process a 50-contract repository in under 2 seconds across worker threads', async () => {
    const mockTasks = Array.from({ length: 50 }, (_, i) => ({
      filePath: `contracts/Contract_${i + 1}.sol`,
      content: `
        contract Contract_${i + 1} {
          uint256[] public data;
          function process() public {
            for (uint256 i = 0; i < data.length; i++) {}
          }
        }
      `,
    }));

    const progressUpdates: number[] = [];

    const startTime = Date.now();
    const report = await scannerService.scanBatch(mockTasks, (p) => {
      progressUpdates.push(p.percentage);
    });
    const totalDuration = Date.now() - startTime;

    expect(report.totalFiles).toBe(50);
    expect(report.results.length).toBe(50);
    expect(totalDuration).toBeLessThan(2000); // Must complete in under 2000ms
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
  });
});
