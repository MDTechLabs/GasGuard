/**
 * SQL query construction scan job (worker boundary).
 *
 * Runs the engine's SqlQueryAnalyzer over a repository snapshot and
 * persists findings under the job's tenant.
 */

import { runAnalyzerSafely } from '@engine/core/analyzer-runner';
import type { AnalyzerConfig, Finding as EngineFinding } from '@engine/core/analyzer-interface';
import {
  SqlQueryAnalysisMetrics,
  SqlQueryAnalysisMetricsSnapshot,
  SqlQueryAnalyzer,
  SqlQueryAnalyzerOptions,
} from '@engine/analyzers/sql-query';
import {
  FindingsService,
  findingsService as defaultFindingsService,
} from '../findings/findings.service';
import { FindingSeverity, MAX_PAGE_LIMIT } from '../findings/finding.types';
import type { MetricsCollector } from '../queue/metrics';

export const SQL_QUERY_SCAN_JOB_NAME = 'security.sql-query';
export const SQL_QUERY_SCAN_SCHEMA_VERSION = 1;
export const MAX_SQL_QUERY_SCAN_FILES = 5000;
export const MAX_SQL_QUERY_SCAN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ID_LENGTH = 256;
const RULE_PREFIX = 'sql-';

export interface SqlQueryScanFile {
  path: string;
  content: string;
}

export type SqlQueryScanConfig = Pick<
  AnalyzerConfig,
  'rules' | 'excludePaths' | 'includePaths' | 'maxFindings' | 'options'
>;

export interface SqlQueryScanJobPayload {
  schemaVersion?: number;
  organizationId: string;
  repositoryId: string;
  analysisJobId: string;
  files: SqlQueryScanFile[];
  config?: SqlQueryScanConfig;
  timeoutMs?: number;
}

export type SqlQueryScanErrorCode =
  | 'INVALID_JOB'
  | 'INVALID_CONFIG'
  | 'ANALYZER_TIMEOUT'
  | 'ANALYZER_FAILED'
  | 'PERSISTENCE_FAILED';

export class SqlQueryScanJobError extends Error {
  constructor(
    readonly code: SqlQueryScanErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SqlQueryScanJobError';
  }
}

export interface SqlQueryScanOutcome {
  status: 'completed' | 'partial';
  organizationId: string;
  repositoryId: string;
  analysisJobId: string;
  analyzerVersion: string;
  filesReceived: number;
  filesAnalyzed: number;
  filesSkipped: number;
  findingsDetected: number;
  findingsPersisted: number;
  findingsAlreadyPersisted: number;
  findingsByRule: Record<string, number>;
  fileErrors: Array<{ file: string; message: string }>;
  durationMs: number;
}

export interface SqlQueryScanLogger {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
}

const consoleLogger: SqlQueryScanLogger = {
  info: (event, fields) => console.log(JSON.stringify({ level: 'info', event, ...fields })),
  warn: (event, fields) => console.warn(JSON.stringify({ level: 'warn', event, ...fields })),
};

export interface SqlQueryScanJobDeps {
  findings?: FindingsService;
  analyzerFactory?: (options: SqlQueryAnalyzerOptions) => SqlQueryAnalyzer;
  metrics?: Pick<MetricsCollector, 'recordAnalyzerDuration'>;
  logger?: SqlQueryScanLogger;
  now?: () => number;
}

export class SqlQueryScanJobHandler {
  private readonly findings: FindingsService;
  private readonly analyzerFactory: (options: SqlQueryAnalyzerOptions) => SqlQueryAnalyzer;
  private readonly metrics?: Pick<MetricsCollector, 'recordAnalyzerDuration'>;
  private readonly logger: SqlQueryScanLogger;
  private readonly now: () => number;

  constructor(deps: SqlQueryScanJobDeps = {}) {
    this.findings = deps.findings ?? defaultFindingsService;
    this.analyzerFactory = deps.analyzerFactory ?? ((o) => new SqlQueryAnalyzer(o));
    this.metrics = deps.metrics;
    this.logger = deps.logger ?? consoleLogger;
    this.now = deps.now ?? (() => Date.now());
  }

  async handle(payload: SqlQueryScanJobPayload): Promise<SqlQueryScanOutcome> {
    const started = this.now();
    validateSqlQueryPayload(payload);
    const { organizationId, repositoryId, analysisJobId } = payload;
    const logFields = { organizationId, repositoryId, analysisJobId };

    const telemetry = new SqlQueryAnalysisMetrics();
    const analyzer = this.analyzerFactory({ observer: telemetry });
    const config: AnalyzerConfig = { ...(payload.config ?? {}) };

    const configErrors = analyzer.validateConfig(config);
    if (configErrors.length > 0) {
      this.logger.warn('sql_query_scan.rejected', {
        ...logFields,
        code: 'INVALID_CONFIG',
        errorCount: configErrors.length,
      });
      throw new SqlQueryScanJobError(
        'INVALID_CONFIG',
        `Invalid configuration: ${configErrors.join(', ')}`,
        false,
      );
    }

    const files = new Map(payload.files.map((f) => [f.path, f.content]));
    let outcome;
    try {
      outcome = await runAnalyzerSafely(analyzer, files, { ...config, timeoutMs: payload.timeoutMs }, this.now);
    } finally {
      await analyzer.dispose();
    }

    if (outcome.diagnostic) {
      const { kind, elapsedMs, timeoutMs } = outcome.diagnostic;
      this.metrics?.recordAnalyzerDuration(analyzer.getName(), elapsedMs);
      this.logger.warn('sql_query_scan.analyzer_failed', {
        ...logFields,
        kind,
        elapsedMs,
        timeoutMs,
        fileCount: files.size,
      });
      throw new SqlQueryScanJobError(
        kind === 'timeout' ? 'ANALYZER_TIMEOUT' : 'ANALYZER_FAILED',
        kind === 'timeout'
          ? `${analyzer.getName()} exceeded its ${timeoutMs}ms budget`
          : `${analyzer.getName()} failed during analysis`,
        true,
      );
    }

    const result = outcome.result;
    let persisted: { created: number; existing: number };
    try {
      persisted = this.persist(payload, analyzer, result.findings);
    } catch {
      this.logger.warn('sql_query_scan.persistence_failed', {
        ...logFields,
        findingsDetected: result.findings.length,
      });
      throw new SqlQueryScanJobError('PERSISTENCE_FAILED', 'failed to persist sql query findings', true);
    }

    const snapshot: SqlQueryAnalysisMetricsSnapshot = telemetry.snapshot();
    const findingsByRule: Record<string, number> = {};
    for (const f of result.findings) findingsByRule[f.ruleId] = (findingsByRule[f.ruleId] ?? 0) + 1;
    const fileErrors = (result.errors ?? []).map(({ file, message }) => ({ file, message }));
    const durationMs = this.now() - started;

    this.metrics?.recordAnalyzerDuration(analyzer.getName(), durationMs);

    const scanOutcome: SqlQueryScanOutcome = {
      status: fileErrors.length > 0 ? 'partial' : 'completed',
      organizationId,
      repositoryId,
      analysisJobId,
      analyzerVersion: analyzer.getVersion(),
      filesReceived: files.size,
      filesAnalyzed: result.filesAnalyzed,
      filesSkipped: snapshot.filesSkipped,
      findingsDetected: result.findings.length,
      findingsPersisted: persisted.created,
      findingsAlreadyPersisted: persisted.existing,
      findingsByRule,
      fileErrors,
      durationMs,
    };

    this.logger.info('sql_query_scan.completed', {
      ...logFields,
      status: scanOutcome.status,
      analyzerVersion: scanOutcome.analyzerVersion,
      filesReceived: scanOutcome.filesReceived,
      filesAnalyzed: scanOutcome.filesAnalyzed,
      filesSkipped: scanOutcome.filesSkipped,
      skippedByReason: snapshot.skippedByReason,
      fileErrorCount: fileErrors.length,
      findingsDetected: scanOutcome.findingsDetected,
      findingsPersisted: scanOutcome.findingsPersisted,
      findingsAlreadyPersisted: scanOutcome.findingsAlreadyPersisted,
      findingsByRule,
      durationMs,
    });

    return scanOutcome;
  }

  private persist(
    payload: SqlQueryScanJobPayload,
    analyzer: SqlQueryAnalyzer,
    engineFindings: EngineFinding[],
  ): { created: number; existing: number } {
    const { organizationId, repositoryId, analysisJobId } = payload;
    const existingKeys = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = this.findings.list({
        organizationId,
        repositoryId,
        analysisJobId,
        limit: MAX_PAGE_LIMIT,
        cursor,
      });
      for (const f of page.items) {
        if (f.ruleId.startsWith(RULE_PREFIX)) {
          existingKeys.add(persistenceKey(f.ruleId, f.filePath, f.line, f.title));
        }
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    let created = 0;
    let existing = 0;
    for (const f of engineFindings) {
      const title = analyzer.getRule(f.ruleId)?.name ?? f.ruleId;
      const key = persistenceKey(f.ruleId, f.location.file, f.location.startLine, title);
      if (existingKeys.has(key)) {
        existing++;
        continue;
      }
      this.findings.create({
        organizationId,
        repositoryId,
        analysisJobId,
        title,
        description: f.message,
        severity: f.severity as FindingSeverity,
        ruleId: f.ruleId,
        filePath: f.location.file,
        line: f.location.startLine,
      });
      existingKeys.add(key);
      created++;
    }
    return { created, existing };
  }
}

function persistenceKey(ruleId: string, filePath: string | undefined, line: number | undefined, title: string): string {
  return [ruleId, filePath ?? '', line ?? 0, title].join('\u0000');
}

function invalid(message: string): never {
  throw new SqlQueryScanJobError('INVALID_JOB', message, false);
}

function checkId(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') invalid(`${field} is required`);
  if ((value as string).length > MAX_ID_LENGTH) invalid(`${field} exceeds ${MAX_ID_LENGTH} characters`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value as string)) invalid(`${field} contains control characters`);
}

export function validateSqlQueryPayload(payload: SqlQueryScanJobPayload): void {
  if (payload === null || typeof payload !== 'object') invalid('payload must be an object');
  if (
    payload.schemaVersion !== undefined &&
    payload.schemaVersion !== SQL_QUERY_SCAN_SCHEMA_VERSION
  ) {
    invalid(`unsupported schemaVersion ${String(payload.schemaVersion)}`);
  }
  checkId(payload.organizationId, 'organizationId');
  checkId(payload.repositoryId, 'repositoryId');
  checkId(payload.analysisJobId, 'analysisJobId');

  if (!Array.isArray(payload.files)) invalid('files must be an array');
  if (payload.files.length > MAX_SQL_QUERY_SCAN_FILES) {
    invalid(`files exceeds ${MAX_SQL_QUERY_SCAN_FILES} entries`);
  }
  const seen = new Set<string>();
  payload.files.forEach((file, idx) => {
    if (!file || typeof file.path !== 'string' || file.path.trim() === '') {
      invalid(`files[${idx}].path is required`);
    }
    if (typeof file.content !== 'string') invalid(`files[${idx}].content must be a string`);
    if (seen.has(file.path)) invalid(`files[${idx}].path is duplicated`);
    seen.add(file.path);
  });

  if (payload.config !== undefined) {
    if (payload.config === null || typeof payload.config !== 'object' || Array.isArray(payload.config)) {
      invalid('config must be an object');
    }
    const allowed = new Set(['rules', 'excludePaths', 'includePaths', 'maxFindings', 'options']);
    for (const key of Object.keys(payload.config)) {
      if (!allowed.has(key)) invalid(`config.${key} is not allowed for ${SQL_QUERY_SCAN_JOB_NAME} jobs`);
    }
  }

  if (
    payload.timeoutMs !== undefined &&
    (!Number.isInteger(payload.timeoutMs) ||
      payload.timeoutMs <= 0 ||
      payload.timeoutMs > MAX_SQL_QUERY_SCAN_TIMEOUT_MS)
  ) {
    invalid(`timeoutMs must be an integer between 1 and ${MAX_SQL_QUERY_SCAN_TIMEOUT_MS}`);
  }
}
