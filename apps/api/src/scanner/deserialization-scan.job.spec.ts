import {
  DeserializationScanJobHandler,
  DeserializationScanJobError,
  DeserializationScanJobPayload,
} from './deserialization-scan.job';
import { FindingsService } from '../findings/findings.service';
import { FindingsRepository } from '../findings/findings.repository';
import { UnsafeDeserializationAnalyzer } from '@engine/analyzers/unsafe-deserialization';

describe('DeserializationScanJobHandler', () => {
  let findingsService: FindingsService;
  let handler: DeserializationScanJobHandler;

  beforeEach(() => {
    const repository = new FindingsRepository();
    findingsService = new FindingsService(repository);
    handler = new DeserializationScanJobHandler({ findings: findingsService });
  });

  const validPayload = (overrides: Partial<DeserializationScanJobPayload> = {}): DeserializationScanJobPayload => ({
    organizationId: 'org-1',
    repositoryId: 'repo-1',
    analysisJobId: 'job-1',
    files: [
      {
        path: 'src/app.js',
        content: `
          const serialize = require("node-serialize");
          const obj = serialize.unserialize(payload);
        `,
      },
    ],
    ...overrides,
  });

  it('analyzes a repository and persists findings under the job tenant', async () => {
    const outcome = await handler.handle(validPayload());
    expect(outcome.status).toBe('completed');
    expect(outcome.findingsDetected).toBe(1);
    expect(outcome.findingsPersisted).toBe(1);

    const listed = findingsService.list({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].ruleId).toBe('deserialization-001');
    expect(listed.items[0].organizationId).toBe('org-1');
  });

  it('preserves tenant isolation across different organizations', async () => {
    await handler.handle(validPayload({ organizationId: 'tenant-a', repositoryId: 'repo-a' }));
    await handler.handle(validPayload({ organizationId: 'tenant-b', repositoryId: 'repo-b' }));

    const tenantA = findingsService.list({ organizationId: 'tenant-a' });
    const tenantB = findingsService.list({ organizationId: 'tenant-b' });

    expect(tenantA.items).toHaveLength(1);
    expect(tenantB.items).toHaveLength(1);
    expect(tenantA.items[0].organizationId).toBe('tenant-a');
    expect(tenantB.items[0].organizationId).toBe('tenant-b');
  });

  it('is idempotent across job retries without duplicating findings', async () => {
    const payload = validPayload();
    const first = await handler.handle(payload);
    expect(first.findingsPersisted).toBe(1);
    expect(first.findingsAlreadyPersisted).toBe(0);

    const second = await handler.handle(payload);
    expect(second.findingsPersisted).toBe(0);
    expect(second.findingsAlreadyPersisted).toBe(1);

    const all = findingsService.list({ organizationId: 'org-1' });
    expect(all.items).toHaveLength(1);
  });

  it('rejects payload missing organizationId as non-retryable INVALID_JOB', async () => {
    await expect(
      handler.handle(validPayload({ organizationId: '' })),
    ).rejects.toMatchObject({
      code: 'INVALID_JOB',
      retryable: false,
    });
  });

  it('rejects invalid analyzer options as non-retryable INVALID_CONFIG', async () => {
    await expect(
      handler.handle(
        validPayload({
          config: {
            options: {
              unsafeDeserialization: {
                maxFileBytes: -10, // Invalid
              },
            },
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
      retryable: false,
    });
  });

  it('handles analyzer failures gracefully as retryable ANALYZER_FAILED', async () => {
    const failingHandler = new DeserializationScanJobHandler({
      findings: findingsService,
      analyzerFactory: () => {
        const a = new UnsafeDeserializationAnalyzer();
        jest.spyOn(a, 'analyzeMultiple').mockRejectedValueOnce(new Error('crash'));
        return a;
      },
    });

    await expect(failingHandler.handle(validPayload())).rejects.toMatchObject({
      code: 'ANALYZER_FAILED',
      retryable: true,
    });
  });
});
