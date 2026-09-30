import { findingsRepository, FindingsRepository } from './findings.repository';
import {
  Finding,
  FindingListPage,
  FindingListQuery,
  FindingSeverity,
  FindingStatus,
  AddFindingCommentInput,
  FindingComment,
  MAX_COMMENT_LENGTH,
  UpdateFindingCommentInput,
  FindingExpirationNotification,
  FindingExpirationNotificationSink,
  MAX_PAGE_LIMIT,
  FindingStatusChangeRecord,
  TransitionFindingStatusInput,
  STATUS_TRANSITIONS,
  AcceptFindingRiskInput,
  RevokeRiskAcceptanceInput,
  RiskAcceptance,
  MIN_RISK_JUSTIFICATION_LENGTH,
} from './finding.types';
import { findingsToCsv } from './findings.csv';
import { computeFindingFingerprint } from './finding.fingerprint';

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
    const fingerprint = computeFindingFingerprint(input);
    // Link to earlier runs: same fingerprint in the same repository (#1031).
    const previous = this.repo.listByFingerprint(
      input.organizationId,
      input.repositoryId,
      fingerprint,
    );
    const finding: Finding = {
      fingerprint,
      firstSeenAt: previous.length ? previous[0].firstSeenAt ?? previous[0].createdAt : now,
      occurrenceCount: previous.length + 1,
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

  /** Every occurrence of a fingerprint across runs, oldest first (#1031). */
  getFingerprintHistory(
    organizationId: string,
    fingerprint: string,
    repositoryId?: string,
  ): Finding[] {
    return this.repo.listByFingerprint(organizationId, repositoryId, fingerprint);
  }

  addComment(input: AddFindingCommentInput): FindingComment {
    const type = input.type ?? 'comment';
    if (type !== 'comment' && type !== 'review_note') {
      throw Object.assign(new Error('Invalid comment type'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    if (!input.author || !input.author.trim()) {
      throw Object.assign(new Error('author is required'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    const body = (input.body ?? '').trim();
    if (!body) {
      throw Object.assign(new Error('body is required'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    if (body.length > MAX_COMMENT_LENGTH) {
      throw Object.assign(
        new Error(`body cannot exceed ${MAX_COMMENT_LENGTH} characters`),
        { code: 'VALIDATION_ERROR', status: 400 },
      );
    }
    const finding = this.repo.getForTenant(input.findingId, input.organizationId);
    if (!finding) {
      throw Object.assign(new Error('Finding not found'), {
        code: 'NOT_FOUND',
        status: 404,
      });
    }
    const now = new Date().toISOString();
    return this.repo.addComment({
      id: `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
      findingId: finding.id,
      organizationId: finding.organizationId,
      type,
      author: input.author.trim(),
      body,
      createdAt: now,
      updatedAt: now,
    });
  }

  listComments(findingId: string, organizationId: string): FindingComment[] {
    return this.repo.listComments(findingId, organizationId);
  }

  updateComment(input: UpdateFindingCommentInput): FindingComment {
    const comment = this.getOwnedComment(input.organizationId, input.findingId, input.commentId);
    if (comment.author !== (input.author ?? '').trim()) {
      throw Object.assign(new Error('Only the author can edit this comment'), {
        code: 'FORBIDDEN',
        status: 403,
      });
    }
    const body = (input.body ?? '').trim();
    if (!body || body.length > MAX_COMMENT_LENGTH) {
      throw Object.assign(
        new Error(`body is required and cannot exceed ${MAX_COMMENT_LENGTH} characters`),
        { code: 'VALIDATION_ERROR', status: 400 },
      );
    }
    const now = new Date().toISOString();
    comment.body = body;
    comment.updatedAt = now;
    comment.editedAt = now;
    return comment;
  }

  deleteComment(
    organizationId: string,
    findingId: string,
    commentId: string,
    author: string,
  ): void {
    const comment = this.getOwnedComment(organizationId, findingId, commentId);
    if (comment.author !== (author ?? '').trim()) {
      throw Object.assign(new Error('Only the author can delete this comment'), {
        code: 'FORBIDDEN',
        status: 403,
      });
    }
    this.repo.deleteComment(findingId, commentId);
  }

  private getOwnedComment(
    organizationId: string,
    findingId: string,
    commentId: string,
  ): FindingComment {
    const comment = this.repo.getForTenant(findingId, organizationId)
      ? this.repo.getComment(findingId, commentId)
      : undefined;
    if (!comment) {
      throw Object.assign(new Error('Comment not found'), {
        code: 'NOT_FOUND',
        status: 404,
      });
    }
    return comment;
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

  /** Validated status transition (open/suppressed/resolved/accepted) (#1033). */
  transitionStatus(
    input: TransitionFindingStatusInput,
  ): { finding: Finding; record: FindingStatusChangeRecord } {
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
    if (!Object.keys(STATUS_TRANSITIONS).includes(input.newStatus)) {
      throw Object.assign(new Error('Invalid newStatus'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    if (!input.changedBy || !input.changedBy.trim()) {
      throw Object.assign(new Error('changedBy is required'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    return this.repo.transitionStatus(input);
  }

  getStatusHistory(
    findingId: string,
    organizationId: string,
  ): FindingStatusChangeRecord[] {
    return this.repo.getStatusHistory(findingId, organizationId);
  }

  /** Formally accept a finding's risk instead of fixing it (#1036). */
  acceptRisk(input: AcceptFindingRiskInput): { finding: Finding; record: RiskAcceptance } {
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
    if (!input.acceptedBy || !input.acceptedBy.trim()) {
      throw Object.assign(new Error('acceptedBy is required'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    const justification = (input.justification ?? '').trim();
    if (justification.length < MIN_RISK_JUSTIFICATION_LENGTH) {
      throw Object.assign(
        new Error(
          `justification must be at least ${MIN_RISK_JUSTIFICATION_LENGTH} characters`,
        ),
        { code: 'VALIDATION_ERROR', status: 400 },
      );
    }
    if (input.expiresAt !== undefined && Number.isNaN(new Date(input.expiresAt).getTime())) {
      throw Object.assign(new Error('expiresAt must be a valid ISO date'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    return this.repo.acceptRisk({ ...input, justification });
  }

  /** Revoke an active risk acceptance and reopen the finding (#1036). */
  revokeRiskAcceptance(
    input: RevokeRiskAcceptanceInput,
  ): { finding: Finding; record: RiskAcceptance } {
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
    if (!input.revokedBy || !input.revokedBy.trim()) {
      throw Object.assign(new Error('revokedBy is required'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }
    return this.repo.revokeRiskAcceptance(input);
  }

  listRiskAcceptances(findingId: string, organizationId: string): RiskAcceptance[] {
    return this.repo.listRiskAcceptances(findingId, organizationId);
  }
}

export const findingsService = new FindingsService();
