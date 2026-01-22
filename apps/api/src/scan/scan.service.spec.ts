import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ScanService } from './scan.service';
import { ScanError } from './interfaces/scan.interface';

describe('ScanService', () => {
  let service: ScanService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'SCAN_MAX_EXECUTION_TIME_MS') {
                return 1000; // 1 second for testing
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ScanService>(ScanService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should complete scan within timeout', async () => {
    const result = await service.executeScan('contract code');
    expect(result).toBeDefined();
    expect(result.scanId).toBeDefined();
    expect(result.status).toBe('completed');
  });

  it('should timeout when scan exceeds max execution time', async () => {
    // Mock performScan to take longer than timeout
    jest.spyOn(service as any, 'performScan').mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              scanId: 'test',
              status: 'completed',
              findings: [],
              executionTime: Date.now(),
            });
          }, 2000); // 2 seconds, longer than 1 second timeout
        }),
    );

    await expect(
      service.executeScan('contract code', { timeoutMs: 1000 }),
    ).rejects.toMatchObject({
      code: 'SCAN_TIMEOUT',
      message: expect.stringContaining('exceeded maximum execution time'),
    });
  });

  it('should use default timeout from config', () => {
    const maxTime = service.getMaxExecutionTime();
    expect(maxTime).toBe(1000);
  });

  it('should allow custom timeout per scan', async () => {
    const customTimeout = 500;
    jest.spyOn(service as any, 'performScan').mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              scanId: 'test',
              status: 'completed',
              findings: [],
              executionTime: Date.now(),
            });
          }, 1000); // 1 second, longer than custom 500ms timeout
        }),
    );

    await expect(
      service.executeScan('contract code', { timeoutMs: customTimeout }),
    ).rejects.toMatchObject({
      code: 'SCAN_TIMEOUT',
      timeoutMs: customTimeout,
    });
  });
});
