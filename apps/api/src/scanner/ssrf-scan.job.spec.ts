/**
 * Integration: SSRF scan job -> engine analyzer -> findings persistence.
 */
import * as fs from 'fs';
import * as path from 'path';
import { FindingsRepository } from '../findings/findings.repository';
import { FindingsService } from '../findings/findings.service';
import { MetricsCollector } from '../queue/metrics';
import {
  SsrfScanJobError,
  SsrfScanJobDeps,
  SsrfScanJobHandler,
  SsrfScanJobPayload,
  SsrfScanLogger,
} from './ssrf-scan.job';

const FIXTURES = path.resolve(__dirname, '../../../../tests/fixtures/ssrf');

function repoFiles(name: string): Array<{ path: string; content: string }> {
  const root = path.join(FIXTURES, name);
  const out: Array<{ path: string; content: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.push({ path: path.relative(root, full).split(path.sep).join('/'), content: fs.readFileSync(full, 'utf8') });
    }
  };
  walk(root);
  return out;
}

function captureLogger(): SsrfScanLogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (event, fields) => lines.push(JSON.stringify({ level: 'info', event, ...fields })),
    warn: (event, fields) => lines.push(JSON.stringify({ level: 'warn', event, ...fields })),
  };
}

function setup(overrides: SsrfScanJobDeps = {}) {
  const repo = new FindingsRepository();
  const findings = new FindingsService(repo);
  const logger = captureLogger();
  const metrics = new MetricsCollector();
  const handler = new SsrfScanJobHandler({ findings, logger, metrics, ...overrides });
  return { repo, findings, logger, metrics, handler };
}

const job = (over: Partial<SsrfScanJobPayload> = {}): SsrfScanJobPayload => ({
  organizationId: 'org-a',
  repositoryId: 'repo-1',
  analysisJobId: 'job-1',
  files: repoFiles('vulnerable-app'),
  ...over,
});

async function expectJobError(p: Promise<unknown>, code: string, retryable: boolean) {
  const err = await p.then(
    () => undefined,
    (e) => e,
  );
  expect(err).toBeInstanceOf(SsrfScanJobError);
  expect(err).toEqual(expect.objectContaining({ code, retryable }));
}

describe('SsrfScanJobHandler', () => {
  it('analyzes a repository and persists findings under the job tenant', async () => {
    const { handler, findings } = setup();
    const outcome = await handler.handle(job());

    expect(outcome.status).toBe('completed');
    expect(outcome.filesReceived).toBeGreaterThanOrEqual(3);
    expect(outcome.findingsDetected).toBeGreaterThan(0);
    expect(outcome.findingsPersisted).toBe(outcome.findingsDetected);
    expect(outcome.findingsAlreadyPersisted).toBe(0);

    const page = findings.list({ organizationId: 'org-a', repositoryId: 'repo-1', limit: 100 });
    expect(page.items.length).toBe(outcome.findingsPersisted);
    expect(page.items.every((f) => f.organizationId === 'org-a' && f.analysisJobId === 'job-1')).toBe(true);
  });

  it('is idempotent on retried jobs', async () => {
    const { handler } = setup();
    const first = await handler.handle(job());
    expect(first.findingsPersisted).toBeGreaterThan(0);

    const second = await handler.handle(job());
    expect(second.findingsPersisted).toBe(0);
    expect(second.findingsAlreadyPersisted).toBe(first.findingsPersisted);
  });

  it('rejects payloads with missing tenant IDs', async () => {
    const { handler } = setup();
    await expectJobError(handler.handle(job({ organizationId: '' })), 'INVALID_JOB', false);
    await expectJobError(handler.handle(job({ repositoryId: '' })), 'INVALID_JOB', false);
    await expectJobError(handler.handle(job({ analysisJobId: '' })), 'INVALID_JOB', false);
  });

  it('rejects invalid timeout values', async () => {
    const { handler } = setup();
    await expectJobError(handler.handle(job({ timeoutMs: -5 })), 'INVALID_JOB', false);
  });

  it('rejects invalid analyzer configurations', async () => {
    const { handler } = setup();
    await expectJobError(
      handler.handle(
        job({
          config: {
            rules: {
              'ssrf-001': { enabled: true, severity: 'nonexistent-severity' as any },
            },
          },
        }),
      ),
      'INVALID_CONFIG',
      false,
    );
  });
});
