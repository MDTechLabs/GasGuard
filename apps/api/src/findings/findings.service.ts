import { findingsRepository, FindingsRepository } from './findings.repository';
import {
  Finding,
  FindingListPage,
  FindingListQuery,
  FindingSeverity,
  FindingStatus,
  FindingExpirationNotification,
  FindingExpirationNotificationSink,
  MAX_PAGE_LIMIT,
} from './finding.types';
import { findingsToCsv } from './findings.csv';

export interface CreateFindingInput {
  organizationId: string;
  repositoryId: string;
  analysisJobId: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  status?: FindingStatus;
  ruleId: string;
  filePath?: string;
  line?: number;
  expiresAt?: string;
}

/** In-memory sink; replace with a Slack/email adapter in production. */
export class InMemoryExpirationNotificationSink
  implements FindingExpirationNotificationSink
{
  readonly outbox: FindingExpirationNotification[] = [];
  send(notification: FindingExpirationNotification): void {
    this.outbox.push(notification);
  }
}

export const DEFAULT_EXPIRATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function newId(): string {
  return `fnd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class FindingsService {
  constructor(
    private readonly repo: FindingsRepository = findingsRepository,
    private readonly expirationSink: FindingExpirationNotificationSink = new InMemoryExpirationNotificationSink(),
  ) {}

  /**
   * Send notifications for findings that are expiring within `windowMs` or
   * have expired. Idempotent: each finding is notified at most once per phase (#1037).
   */
  async notifyExpiringFindings(
    organizationId: string,
    windowMs: number = DEFAULT_EXPIRATION_WINDOW_MS,
    now: Date = new Date(),
  ): Promise<FindingExpirationNotification[]> {
    if (!organizationId || !organizationId.trim()) {
      throw Object.assign(new Error('organizationId is required'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    const sent: FindingExpirationNotification[] = [];
    for (const f of this.repo.listExpiring(organizationId, now, windowMs)) {
      const notification: FindingExpirationNotification = {
        findingId: f.id,
        organizationId: f.organizationId,
        kind: new Date(f.expiresAt!).getTime() <= now.getTime() ? 'expired' : 'expiring_soon',
        title: f.title,
        severity: f.severity,
        assignedTo: f.assignedTo,
        expiresAt: f.expiresAt!,
        createdAt: now.toISOString(),
      };
      try {
        await this.expirationSink.send(notification);
      } catch {
        continue; // leave un-notified so the next run retries
      }
      this.repo.markExpirationNotified(f.id, now.toISOString());
      sent.push(notification);
    }
    return sent;
  }

  create(input: CreateFindingInput): Finding {
    const now = new Date().toISOString();
    const finding: Finding = {
      id: newId(),
      organizationId: input.organizationId,
      repositoryId: input.repositoryId,
      analysisJobId: input.analysisJobId,
      title: input.title,
      description: input.description,
      severity: input.severity,
      status: input.status ?? 'open',
      ruleId: input.ruleId,
      filePath: input.filePath,
      line: input.line,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    return this.repo.upsert(finding);
  }

  /**
   * Persist findings produced by an analysis job (E2E workflow #994).
   */
  persistAnalysisFindings(
    organizationId: string,
    repositoryId: string,
    analysisJobId: string,
    issues: Array<{
      title: string;
      description: string;
      severity: FindingSeverity;
      ruleId: string;
      filePath?: string;
      line?: number;
    }>,
  ): Finding[] {
    return issues.map((issue) =>
      this.create({
        organizationId,
        repositoryId,
        analysisJobId,
        ...issue,
      }),
    );
  }

  list(query: FindingListQuery): FindingListPage {
    return this.repo.list(query);
  }

  getForTenant(id: string, organizationId: string): Finding | undefined {
    return this.repo.getForTenant(id, organizationId);
  }

  /** Export all findings matching the query (cursor/limit ignored) as CSV (#1039). */
  exportCsv(query: FindingListQuery): string {
    const all: Finding[] = [];
    let cursor: string | undefined;
    do {
      const page = this.repo.list({ ...query, limit: MAX_PAGE_LIMIT, cursor });
      all.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return findingsToCsv(all);
  }

  reassign(input: import('./finding.types').ReassignFindingInput): {
    finding: Finding;
    record: import('./finding.types').ReassignmentAuditRecord;
  } {
    if (!input.organizationId || !input.organizationId.trim()) {
      throw Object.assign(new Error('organizationId is required'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    if (!input.findingId || !input.findingId.trim()) {
      throw Object.assign(new Error('findingId is required'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    if (!input.newAssignee || !input.newAssignee.trim()) {
      throw Object.assign(new Error('newAssignee is required'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    if (!input.reassignedBy || !input.reassignedBy.trim()) {
      throw Object.assign(new Error('reassignedBy is required'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    if (!input.reason || input.reason.trim().length < 5) {
      throw Object.assign(
        new Error('Reassignment reason must be at least 5 characters'),
        { code: 'VALIDATION_ERROR', status: 400 },
      );
    }
    return this.repo.reassign(input);
  }

  batchReassign(input: import('./finding.types').BatchReassignInput): {
    total: number;
    successful: number;
    failed: number;
    records: import('./finding.types').ReassignmentAuditRecord[];
    errors: Array<{ findingId: string; error: string; code: string }>;
  } {
    if (!input.findingIds || !Array.isArray(input.findingIds) || input.findingIds.length === 0) {
      throw Object.assign(new Error('findingIds array is required and must not be empty'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    if (input.findingIds.length > 100) {
      throw Object.assign(new Error('Batch size cannot exceed 100 findings'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }

    const records: import('./finding.types').ReassignmentAuditRecord[] = [];
    const errors: Array<{ findingId: string; error: string; code: string }> = [];

    for (const findingId of input.findingIds) {
      try {
        const { record } = this.reassign({
          organizationId: input.organizationId,
          findingId,
          newAssignee: input.newAssignee,
          reassignedBy: input.reassignedBy,
          reason: input.reason,
          metadata: input.metadata,
        });
        records.push(record);
      } catch (err) {
        const e = err as { code?: string; message?: string };
        errors.push({
          findingId,
          error: e.message ?? 'Unknown error',
          code: e.code ?? 'INTERNAL_ERROR',
        });
      }
    }

    return {
      total: input.findingIds.length,
      successful: records.length,
      failed: errors.length,
      records,
      errors,
    };
  }

  getReassignmentHistory(
    findingId: string,
    organizationId: string,
  ): import('./finding.types').ReassignmentAuditRecord[] {
    return this.repo.getReassignmentHistory(findingId, organizationId);
  }
}

export const findingsService = new FindingsService();
