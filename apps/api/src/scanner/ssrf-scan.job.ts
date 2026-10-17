/**
 * SSRF validation scan job (worker boundary).
 *
 * Runs the engine's SsrfAnalyzer over a repository snapshot and
 * persists findings under the job's tenant.
 */

import { runAnalyzerSafely } from '@engine/core/analyzer-runner';
import type { AnalyzerConfig, Finding as EngineFinding } from '@engine/core/analyzer-interface';
import {
  SsrfAnalysisMetrics,
  SsrfAnalysisMetricsSnapshot,
  SsrfAnalyzer,
  SsrfAnalyzerOptions,
} from '@engine/analyzers/ssrf';
import {
  FindingsService,
  findingsService as defaultFindingsService,
} from '../findings/findings.service';
import { FindingSeverity, MAX_PAGE_LIMIT } from '../findings/finding.types';
import type { MetricsCollector } from '../queue/metrics';

export const SSRF_SCAN_JOB_NAME = 'security.ssrf';
export const SSRF_SCAN_SCHEMA_VERSION = 1;
export const MAX_SSRF_SCAN_FILES = 5000;
export const MAX_SSRF_SCAN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ID_LENGTH = 256;
const RULE_PREFIX = 'ssrf-';

export interface SsrfScanFile {
  path: string;
  content: string;
}

export type SsrfScanConfig = Pick<
  AnalyzerConfig,
  'rules' | 'excludePaths' | 'includePaths' | 'maxFindings' | 'options'
>;

export interface SsrfScanJobPayload {
  schemaVersion?: number;
  organizationId: string;
  repositoryId: string;
  analysisJobId: string;
  files: SsrfScanFile[];
  config?: SsrfScanConfig;
  timeoutMs?: number;
}

export type SsrfScanErrorCode =
  | 'INVALID_JOB'
  | 'INVALID_CONFIG'
  | 'ANALYZER_TIMEOUT'
  | 'ANALYZER_FAILED'
  | 'PERSISTENCE_FAILED';

export class SsrfScanJobError extends Error {
  constructor(
    readonly code: SsrfScanErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SsrfScanJobError';
  }
}

export interface SsrfScanOutcome {
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

export interface SsrfScanLogger {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
}

const consoleLogger: SsrfScanLogger = {
  info: (event, fields) => console.log(JSON.stringify({ level: 'info', event, ...fields })),
  warn: (event, fields) => console.warn(JSON.stringify({ level: 'warn', event, ...fields })),
};

export interface SsrfScanJobDeps {
  findings?: FindingsService;
  analyzerFactory?: (options: SsrfAnalyzerOptions) => SsrfAnalyzer;
  metrics?: Pick<MetricsCollector, 'recordAnalyzerDuration'>;
  logger?: SsrfScanLogger;
  now?: () => number;
}

export class SsrfScanJobHandler {
  private readonly findings: FindingsService;
  private readonly analyzerFactory: (options: SsrfAnalyzerOptions) => SsrfAnalyzer;
  private readonly metrics?: Pick<MetricsCollector, 'recordAnalyzerDuration'>;
  private readonly logger: SsrfScanLogger;
  private readonly now: () => number;

  constructor(deps: SsrfScanJobDeps = {}) {
    this.findings = deps.findings ?? defaultFindingsService;
    this.analyzerFactory = deps.analyzerFactory ?? ((o) => new SsrfAnalyzer(o));
    this.metrics = deps.metrics;
    this.logger = deps.logger ?? consoleLogger;
    this.now = deps.now ?? (() => Date.now());
  }

  async handle(payload: SsrfScanJobPayload): Promise<SsrfScanOutcome> {
    const started = this.now();
    validateSsrfPayload(payload);
    const { organizationId, repositoryId, analysisJobId } = payload;
    const logFields = { organizationId, repositoryId, analysisJobId };

    const telemetry = new SsrfAnalysisMetrics();
    const analyzer = this.analyzerFactory({ observer: telemetry });
    const config: AnalyzerConfig = { ...(payload.config ?? {}) };

    const configErrors = analyzer.validateConfig(config);
    if (configErrors.length > 0) {
      this.logger.warn('ssrf_scan.rejected', { ...logFields, code: 'INVALID_CONFIG', errorCount: configErrors.length });
      throw new SsrfScanJobError('INVALID_CONFIG', `Invalid configuration: ${configErrors.join(', ')}`, false);
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
      this.logger.warn('ssrf_scan.analyzer_failed', {
        ...logFields,
        kind,
        elapsedMs,
        timeoutMs,
        fileCount: files.size,
      });
      throw new SsrfScanJobError(
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
      this.logger.warn('ssrf_scan.persistence_failed', { ...logFields, findingsDetected: result.findings.length });
      throw new SsrfScanJobError('PERSISTENCE_FAILED', 'failed to persist ssrf findings', true);
    }

    const snapshot: SsrfAnalysisMetricsSnapshot = telemetry.snapshot();
    const findingsByRule: Record<string, number> = {};
    for (const f of result.findings) findingsByRule[f.ruleId] = (findingsByRule[f.ruleId] ?? 0) + 1;
    const fileErrors = (result.errors ?? []).map(({ file, message }) => ({ file, message }));
    const durationMs = this.now() - started;

    this.metrics?.recordAnalyzerDuration(analyzer.getName(), durationMs);

    const scanOutcome: SsrfScanOutcome = {
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

    this.logger.info('ssrf_scan.completed', {
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
    payload: SsrfScanJobPayload,
    analyzer: SsrfAnalyzer,
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
  throw new SsrfScanJobError('INVALID_JOB', message, false);
}

function checkId(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') invalid(`${field} is required`);
  if ((value as string).length > MAX_ID_LENGTH) invalid(`${field} exceeds ${MAX_ID_LENGTH} characters`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value as string)) invalid(`${field} contains control characters`);
}

export function validateSsrfPayload(payload: SsrfScanJobPayload): void {
  if (payload === null || typeof payload !== 'object') invalid('payload must be an object');
  if (
    payload.schemaVersion !== undefined &&
    payload.schemaVersion !== SSRF_SCAN_SCHEMA_VERSION
  ) {
    invalid(`unsupported schemaVersion ${String(payload.schemaVersion)}`);
  }
  checkId(payload.organizationId, 'organizationId');
  checkId(payload.repositoryId, 'repositoryId');
  checkId(payload.analysisJobId, 'analysisJobId');

  if (!Array.isArray(payload.files)) invalid('files must be an array');
  if (payload.files.length > MAX_SSRF_SCAN_FILES) {
    invalid(`files exceeds ${MAX_SSRF_SCAN_FILES} entries`);
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
      if (!allowed.has(key)) invalid(`config.${key} is not allowed for ${SSRF_SCAN_JOB_NAME} jobs`);
    }
  }

  if (
    payload.timeoutMs !== undefined &&
    (!Number.isInteger(payload.timeoutMs) ||
      payload.timeoutMs <= 0 ||
      payload.timeoutMs > MAX_SSRF_SCAN_TIMEOUT_MS)
  ) {
    invalid(`timeoutMs must be an integer between 1 and ${MAX_SSRF_SCAN_TIMEOUT_MS}`);
  }
}
