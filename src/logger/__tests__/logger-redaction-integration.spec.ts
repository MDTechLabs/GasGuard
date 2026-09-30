/**
 * Integration tests: log redaction through LoggerService
 *
 * Verifies that redaction is applied to messages and metadata **before**
 * entries reach registered providers (console, file, external drains), and
 * that configuration plumbing works end to end. Issue #1102.
 */

import { LoggerService } from '../logger.service';
import { LoggerConfigManager } from '../logger.config';
import { ILoggerProvider, LogEntry, LogLevel, LogCategory, LogFilter, LoggerMetrics, LogSearchResult } from '../logger.types';
import { REDACTED_MARKER } from '../log-redaction';

/** In-memory provider capturing every written entry. */
class CapturingProvider implements ILoggerProvider {
  public entries: LogEntry[] = [];

  async write(entry: LogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async query(filter: LogFilter, limit?: number, offset?: number): Promise<LogSearchResult> {
    let filtered = this.entries;
    if (filter.levels) filtered = filtered.filter((e) => filter.levels!.includes(e.level));
    if (filter.categories) filtered = filtered.filter((e) => filter.categories!.includes(e.category));
    if (filter.messagePattern) {
      const re = new RegExp(filter.messagePattern, 'i');
      filtered = filtered.filter((e) => re.test(e.message));
    }
    const total = filtered.length;
    const start = offset ?? 0;
    return {
      entries: filtered.slice(start, start + (limit ?? 100)),
      total,
      hasMore: start + (limit ?? 100) < total,
    };
  }

  async getMetrics(): Promise<LoggerMetrics> {
    return {
      totalLogs: this.entries.length,
      logsByLevel: { [LogLevel.INFO]: this.entries.length } as Record<LogLevel, number>,
      logsByCategory: { [LogCategory.SYSTEM]: this.entries.length } as Record<LogCategory, number>,
      errorRate: 0,
      averageLogSize: 0,
      storageUsage: 0,
    };
  }

  async cleanup(_retentionDays: number): Promise<number> {
    const removed = this.entries.length;
    this.entries = [];
    return removed;
  }
}

describe('LoggerService log redaction integration', () => {
  let service: LoggerService;
  let provider: CapturingProvider;
  let configManager: LoggerConfigManager;
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  beforeAll(() => {
    // Keep test output clean; provider errors are logged to console by design.
    consoleErrorSpy.mockClear();
  });

  beforeEach(() => {
    configManager = LoggerConfigManager.getInstance();
    configManager.resetToDefaults();
    service = LoggerService.getInstance();
    provider = new CapturingProvider();
    service.registerProvider('test', provider);
  });

  afterEach(() => {
    service.unregisterProvider('test');
    service.clearContext();
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('redacts sensitive metadata keys before providers receive the entry', async () => {
    await service.info('user login', { password: 'hunter2', apiKey: 'sk-live-1', userId: 42 });

    await new Promise((resolve) => setImmediate(resolve));
    expect(provider.entries).toHaveLength(1);
    const entry = provider.entries[0];
    expect(entry.metadata!.password).toBe(REDACTED_MARKER);
    expect(entry.metadata!.apiKey).toBe(REDACTED_MARKER);
    expect(entry.metadata!.userId).toBe(42);
  });

  it('redacts secret-looking values in the message itself', async () => {
    await service.info('auth failed with Bearer supersecretvalue');
    await new Promise((resolve) => setImmediate(resolve));

    const entry = provider.entries[0];
    expect(entry.message).not.toContain('supersecretvalue');
    expect(entry.message).toContain(REDACTED_MARKER);
  });

  it('redacts nested and array metadata', async () => {
    await service.warn('batch op', {
      users: [{ name: 'a', password: 'p1' }],
      config: { deep: { secret: 's' } },
    });
    await new Promise((resolve) => setImmediate(resolve));

    const entry = provider.entries[0];
    expect(entry.metadata!.users[0].password).toBe(REDACTED_MARKER);
    expect(entry.metadata!.config.deep.secret).toBe(REDACTED_MARKER);
  });

  it('redacts error() and fatal() payloads, including error.message', async () => {
    // Assembled at runtime so secret scanners never see a token-shaped literal.
    const ghToken = `ghp_${'z9Y8'.repeat(9)}`;
    await service.error('request failed', new Error(`401 from upstream token ${ghToken}`), {
      password: 'hunter2',
    });
    await service.fatal('shutdown', new Error('Bearer leaked'), {});
    await new Promise((resolve) => setImmediate(resolve));

    const serialized = JSON.stringify(provider.entries);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain(ghToken);
    expect(serialized).not.toContain('Bearer leaked');
  });

  it('redacts audit() entries (message + metadata)', async () => {
    await service.audit({
      level: LogLevel.INFO,
      eventType: 'API_REQUEST',
      action: 'POST /login',
      resource: '/login',
      outcome: 'failure',
      message: 'login failed password=hunter2',
      metadata: { password: 'hunter2' },
    });
    await new Promise((resolve) => setImmediate(resolve));

    const entry = provider.entries[0];
    expect(entry.message).not.toContain('hunter2');
    expect(entry.metadata!.password).toBe(REDACTED_MARKER);
  });

  it('keeps non-sensitive metadata untouched (backward compatible)', async () => {
    await service.info('scan complete', { repositoryId: 'r-1', files: 12, findings: 0 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(provider.entries[0].metadata).toEqual({
      repositoryId: 'r-1',
      files: 12,
      findings: 0,
    });
  });

  it('respects redactionExtraKeys from logger configuration', async () => {
    configManager.updateConfig({ redactionExtraKeys: ['walletMnemonic'] });
    service.refreshRedactionConfig();

    await service.info('wallet op', { walletMnemonic: 'never log this' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(provider.entries[0].metadata!.walletMnemonic).toBe(REDACTED_MARKER);
  });

  it('can be disabled via enableRedaction=false for local debugging', async () => {
    configManager.updateConfig({ enableRedaction: false });
    service.refreshRedactionConfig();

    await service.info('debug', { password: 'hunter2' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(provider.entries[0].metadata!.password).toBe('hunter2');

    // Restore secure default for other tests.
    configManager.updateConfig({ enableRedaction: true });
    service.refreshRedactionConfig();
  });

  it('still writes entries when a provider rejects (redaction not coupled to delivery)', async () => {
    service.registerProvider('boom', {
      write: jest.fn().mockRejectedValue(new Error('sink down')),
      query: jest.fn(),
      getMetrics: jest.fn(),
      cleanup: jest.fn(),
    });

    await service.info('hello', { password: 'x' });
    // writeLog awaits Promise.allSettled, so one flush cycle settles everything.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(provider.entries).toHaveLength(1);
    expect(provider.entries[0].metadata!.password).toBe(REDACTED_MARKER);
    service.unregisterProvider('boom');
  });

  it('does not leak secrets through the real-time log event emitter', async () => {
    const seen: LogEntry[] = [];
    service.on('log', (entry: LogEntry) => seen.push(entry));

    await service.info('event path', { apiKey: 'sk-live-9' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toContain('sk-live-9');
  });
});
