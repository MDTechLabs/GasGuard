/**
 * Unsafe deserialization scan job (worker boundary).
 *
 * Runs the engine's UnsafeDeserializationAnalyzer over one repository snapshot
 * and persists the resulting findings under the job's tenant.
 *
 * Failure semantics:
 *  - Invalid payload or analyzer config  -> DeserializationScanJobError, retryable=false
 *  - Analyzer timeout / crash            -> DeserializationScanJobError, retryable=true
 *  - Per-file problems (too large, binary, unsupported) -> status "partial"
 *  - Persistence failure                 -> DeserializationScanJobError, retryable=true
 *
 * Retries are safe: persistence is idempotent per (organization, repository,
 * analysis job, rule, file, line, title).
 */

import { runAnalyzerSafely } from '@engine/core/analyzer-runner';
import type { AnalyzerConfig, Finding as EngineFinding } from '@engine/core/analyzer-interface';
import {
  DeserializationAnalysisMetrics,
  DeserializationAnalysisMetricsSnapshot,
  UnsafeDeserializationAnalyzer,
  UnsafeDeserializationAnalyzerOptions,
} from '@engine/analyzers/unsafe-deserialization';
import {
  FindingsService,
  findingsService as defaultFindingsService,
} from '../findings/findings.service';
import { FindingSeverity, MAX_PAGE_LIMIT } from '../findings/finding.types';
import type { MetricsCollector } from '../queue/metrics';

export const DESERIALIZATION_SCAN_JOB_NAME = 'security.unsafe-deserialization';
export const DESERIALIZATION_SCAN_SCHEMA_VERSION = 1;
export const MAX_DESERIALIZATION_SCAN_FILES = 5000;
export const MAX_DESERIALIZATION_SCAN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ID_LENGTH = 256;
const RULE_PREFIX = 'deserialization-';

export interface DeserializationScanFile {
  path: string;
  content: string;
}

export type DeserializationScanConfig = Pick<
  AnalyzerConfig,
  'rules' | 'excludePaths' | 'includePaths' | 'maxFindings' | 'options'
>;

export interface DeserializationScanJobPayload {
  schemaVersion?: number;
  organizationId: string;
  repositoryId: string;
  analysisJobId: string;
  files: DeserializationScanFile[];
  config?: DeserializationScanConfig;
  timeoutMs?: number;
}

export type DeserializationScanErrorCode =
  | 'INVALID_JOB'
  | 'INVALID_CONFIG'
  | 'ANALYZER_TIMEOUT'
  | 'ANALYZER_FAILED'
  | 'PERSISTENCE_FAILED';

export class DeserializationScanJobError extends Error {
  constructor(
    readonly code: DeserializationScanErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'DeserializationScanJobError';
  }
}

export interface DeserializationScanOutcome {
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

export interface DeserializationScanLogger {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
}

const consoleLogger: DeserializationScanLogger = {
  info: (event, fields) => console.log(JSON.stringify({ level: 'info', event, ...fields })),
  warn: (event, fields) => console.warn(JSON.stringify({ level: 'warn', event, ...fields })),
};

export interface DeserializationScanJobDeps {
  findings?: FindingsService;
  analyzerFactory?: (options: UnsafeDeserializationAnalyzerOptions) => UnsafeDeserializationAnalyzer;
  metrics?: Pick<MetricsCollector, 'recordAnalyzerDuration'>;
  logger?: DeserializationScanLogger;
  now?: () => number;
}

export class DeserializationScanJobHandler {
  private readonly findings: FindingsService;
  private readonly analyzerFactory: (options: UnsafeDeserializationAnalyzerOptions) => UnsafeDeserializationAnalyzer;
  private readonly metrics?: Pick<MetricsCollector, 'recordAnalyzerDuration'>;
  private readonly logger: DeserializationScanLogger;
  private readonly now: () => number;

  constructor(deps: DeserializationScanJobDeps = {}) {
    this.findings = deps.findings ?? defaultFindingsService;
    this.analyzerFactory = deps.analyzerFactory ?? ((o) => new UnsafeDeserializationAnalyzer(o));
    this.metrics = deps.metrics;
    this.logger = deps.logger ?? consoleLogger;
    this.now = deps.now ?? (() => Date.now());
  }

  async handle(payload: DeserializationScanJobPayload): Promise<DeserializationScanOutcome> {
    const started = this.now();
    validatePayload(payload);
    const { organizationId, repositoryId, analysisJobId } = payload;
    const logFields = { organizationId, repositoryId, analysisJobId };

    const telemetry = new DeserializationAnalysisMetrics();
    const analyzer = this.analyzerFactory({ observer: telemetry });
    const config: AnalyzerConfig = { ...(payload.config ?? {}) };

    const configErrors = analyzer.validateConfig(config);
    if (configErrors.length > 0) {
      this.logger.warn('deserialization_scan.rejected', {
        ...logFields,
        code: 'INVALID_CONFIG',
        errorCount: configErrors.length,
      });
      throw new DeserializationScanJobError(
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
      this.logger.warn('deserialization_scan.analyzer_failed', {
        ...logFields,
        kind,
        elapsedMs,
        timeoutMs,
        fileCount: files.size,
      });
      throw new DeserializationScanJobError(
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
      this.logger.warn('deserialization_scan.persistence_failed', {
        ...logFields,
        findingsDetected: result.findings.length,
      });
      throw new DeserializationScanJobError(
        'PERSISTENCE_FAILED',
        'failed to persist deserialization findings',
        true,
      );
    }

    const snapshot: DeserializationAnalysisMetricsSnapshot = telemetry.snapshot();
    const findingsByRule: Record<string, number> = {};
    for (const f of result.findings) {
      findingsByRule[f.ruleId] = (findingsByRule[f.ruleId] ?? 0) + 1;
    }
    const fileErrors = (result.errors ?? []).map(({ file, message }) => ({ file, message }));
    const durationMs = this.now() - started;

    this.metrics?.recordAnalyzerDuration(analyzer.getName(), durationMs);

    const scanOutcome: DeserializationScanOutcome = {
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

    this.logger.info('deserialization_scan.completed', {
      ...logFields,
      status: scanOutcome.status,
      analyzerVersion: scanOutcome.analyzerVersion,
      filesReceived: scanOutcome.filesReceived,
      filesAnalyzed: scanOutcome.filesAnalyzed,
      filesSkipped: scanOutcome.filesSkipped,
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
    payload: DeserializationScanJobPayload,
    analyzer: UnsafeDeserializationAnalyzer,
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
      const rule = analyzer.getRule(f.ruleId);
      const title = rule?.name ?? f.ruleId;
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

function persistenceKey(ruleId: string, filePath: string, line: number, title: string): string {
  return `${ruleId}:${filePath}:${line}:${title}`;
}

function mapSeverity(engineSeverity: string): FindingSeverity {
  switch (engineSeverity.toLowerCase()) {
    case 'critical':
      return FindingSeverity.CRITICAL;
    case 'high':
      return FindingSeverity.HIGH;
    case 'medium':
      return FindingSeverity.MEDIUM;
    case 'low':
      return FindingSeverity.LOW;
    default:
      return FindingSeverity.INFO;
  }
}

function validatePayload(payload: DeserializationScanJobPayload): void {
  if (!payload || typeof payload !== 'object') {
    throw new DeserializationScanJobError('INVALID_JOB', 'Payload must be an object', false);
  }

  const { schemaVersion, organizationId, repositoryId, analysisJobId, files, config, timeoutMs } = payload;

  if (schemaVersion !== undefined && schemaVersion !== DESERIALIZATION_SCAN_SCHEMA_VERSION) {
    throw new DeserializationScanJobError(
      'INVALID_JOB',
      `Unsupported schemaVersion ${schemaVersion}; expected ${DESERIALIZATION_SCAN_SCHEMA_VERSION}`,
      false,
    );
  }

  assertValidId('organizationId', organizationId);
  assertValidId('repositoryId', repositoryId);
  assertValidId('analysisJobId', analysisJobId);

  if (!Array.isArray(files)) {
    throw new DeserializationScanJobError('INVALID_JOB', 'files must be an array', false);
  }
  if (files.length > MAX_DESERIALIZATION_SCAN_FILES) {
    throw new DeserializationScanJobError(
      'INVALID_JOB',
      `files array exceeds maximum ${MAX_DESERIALIZATION_SCAN_FILES}`,
      false,
    );
  }

  const seenPaths = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file || typeof file !== 'object') {
      throw new DeserializationScanJobError('INVALID_JOB', `files[${i}] must be an object`, false);
    }
    if (typeof file.path !== 'string' || file.path.trim().length === 0) {
      throw new DeserializationScanJobError('INVALID_JOB', `files[${i}].path must be a non-empty string`, false);
    }
    if (typeof file.content !== 'string') {
      throw new DeserializationScanJobError('INVALID_JOB', `files[${i}].content must be a string`, false);
    }
    if (seenPaths.has(file.path)) {
      throw new DeserializationScanJobError('INVALID_JOB', `Duplicate file path: ${file.path}`, false);
    }
    seenPaths.add(file.path);
  }

  if (config !== undefined) {
    if (typeof config !== 'object' || Array.isArray(config)) {
      throw new DeserializationScanJobError('INVALID_JOB', 'config must be an object', false);
    }
    const allowed = new Set(['rules', 'excludePaths', 'includePaths', 'maxFindings', 'options']);
    for (const key of Object.keys(config)) {
      if (!allowed.has(key)) {
        throw new DeserializationScanJobError('INVALID_JOB', `Disallowed config field: ${key}`, false);
      }
    }
  }

  if (timeoutMs !== undefined) {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_DESERIALIZATION_SCAN_TIMEOUT_MS) {
      throw new DeserializationScanJobError(
        'INVALID_JOB',
        `timeoutMs must be an integer between 1 and ${MAX_DESERIALIZATION_SCAN_TIMEOUT_MS}`,
        false,
      );
    }
  }
}

function assertValidId(name: string, value: unknown): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DeserializationScanJobError('INVALID_JOB', `${name} must be a non-empty string`, false);
  }
  if (value.length > MAX_ID_LENGTH) {
    throw new DeserializationScanJobError(
      'INVALID_JOB',
      `${name} length ${value.length} exceeds maximum ${MAX_ID_LENGTH}`,
      false,
    );
  }
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new DeserializationScanJobError('INVALID_JOB', `${name} contains control characters`, false);
  }
}
