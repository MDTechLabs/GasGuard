/**
 * In-memory findings store with tenant + repository isolation (#992, #996).
 * Swap for TypeORM/Prisma in production; interface stays the same.
 */

import {
  DEFAULT_PAGE_LIMIT,
  Finding,
  FindingListPage,
  FindingListQuery,
  FindingSeverity,
  FindingSortField,
  FindingStatus,
  MAX_PAGE_LIMIT,
  SEVERITY_RANK,
  SortDirection,
} from './finding.types';
import { decodeCursor, encodeCursor } from './cursor';

function asArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

function sortKey(f: Finding, field: FindingSortField): string {
  switch (field) {
    case 'severity':
      return String(SEVERITY_RANK[f.severity]).padStart(2, '0');
    case 'status':
      return f.status;
    case 'title':
      return f.title.toLowerCase();
    case 'createdAt':
    default:
      return f.createdAt;
  }
}

function compareFindings(
  a: Finding,
  b: Finding,
  field: FindingSortField,
  dir: SortDirection,
): number {
  const ka = sortKey(a, field);
  const kb = sortKey(b, field);
  let cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
  if (cmp === 0) {
    cmp = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  return dir === 'desc' ? -cmp : cmp;
}

/** True when `item` is strictly after the cursor position in sort order. */
function isAfterCursor(
  item: Finding,
  field: FindingSortField,
  dir: SortDirection,
  cursorKey: string,
  cursorId: string,
): boolean {
  const itemKey = sortKey(item, field);
  if (dir === 'asc') {
    if (itemKey > cursorKey) return true;
    if (itemKey < cursorKey) return false;
    return item.id > cursorId;
  }
  // desc
  if (itemKey < cursorKey) return true;
  if (itemKey > cursorKey) return false;
  return item.id < cursorId;
}

export class FindingsRepository {
  private readonly byId = new Map<string, Finding>();

  clear(): void {
    this.byId.clear();
  }

  upsert(finding: Finding): Finding {
    this.byId.set(finding.id, finding);
    return finding;
  }

  upsertMany(findings: Finding[]): void {
    for (const f of findings) this.upsert(f);
  }

  getById(id: string): Finding | undefined {
    return this.byId.get(id);
  }

  /**
   * Tenant-scoped get: returns undefined if the finding exists but belongs to
   * another organization (no existence oracle across tenants).
   */
  getForTenant(id: string, organizationId: string): Finding | undefined {
    const f = this.byId.get(id);
    if (!f || f.organizationId !== organizationId) return undefined;
    return f;
  }

  list(query: FindingListQuery): FindingListPage {
    if (!query.organizationId) {
      throw Object.assign(new Error('organizationId is required'), {
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    }

    const sortBy: FindingSortField = query.sortBy ?? 'createdAt';
    const sortDir: SortDirection = query.sortDir ?? 'desc';
    const limit = Math.min(
      Math.max(1, query.limit ?? DEFAULT_PAGE_LIMIT),
      MAX_PAGE_LIMIT,
    );

    const severities = asArray(query.severity);
    const statuses = asArray(query.status);
    const q = query.q?.trim().toLowerCase();

    let rows = Array.from(this.byId.values()).filter(
      (f) => f.organizationId === query.organizationId,
    );

    if (query.repositoryId) {
      rows = rows.filter((f) => f.repositoryId === query.repositoryId);
    }
    if (query.analysisJobId) {
      rows = rows.filter((f) => f.analysisJobId === query.analysisJobId);
    }
    if (severities?.length) {
      const set = new Set(severities);
      rows = rows.filter((f) => set.has(f.severity));
    }
    if (statuses?.length) {
      const set = new Set(statuses);
      rows = rows.filter((f) => set.has(f.status));
    }
    if (query.assignedTo) {
      rows = rows.filter((f) => f.assignedTo === query.assignedTo);
    }
    if (query.ruleId) {
      rows = rows.filter((f) => f.ruleId === query.ruleId);
    }
    if (query.fingerprint) {
      rows = rows.filter((f) => f.fingerprint === query.fingerprint);
    }
    if (q) {
      rows = rows.filter(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q) ||
          (f.filePath?.toLowerCase().includes(q) ?? false),
      );
    }

    rows.sort((a, b) => compareFindings(a, b, sortBy, sortDir));

    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      rows = rows.filter((f) =>
        isAfterCursor(f, sortBy, sortDir, cursor.k, cursor.id),
      );
    }

    const pageItems = rows.slice(0, limit);
    let nextCursor: string | null = null;
    if (rows.length > limit && pageItems.length > 0) {
      const last = pageItems[pageItems.length - 1];
      nextCursor = encodeCursor({
        v: 1,
        k: sortKey(last, sortBy),
        id: last.id,
      });
    }

    return {
      items: pageItems,
      nextCursor,
      totalEstimate: rows.length + (query.cursor ? limit : 0), // approximate when cursor used
      limit,
    };
  }

  /** All occurrences of a fingerprint in a repository, oldest first (#1031). */
  listByFingerprint(
    organizationId: string,
    repositoryId: string | undefined,
    fingerprint: string,
  ): Finding[] {
    return Array.from(this.byId.values())
      .filter(
        (f) =>
          f.organizationId === organizationId &&
          f.fingerprint === fingerprint &&
          (repositoryId === undefined || f.repositoryId === repositoryId),
      )
      .sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1,
      );
  }

  /**
   * Findings whose expiration falls before `now + windowMs` (or already passed)
   * and that have not yet been notified for the current expiry (#1037).
   */
  listExpiring(organizationId: string, now: Date, windowMs: number): Finding[] {
    const horizon = now.getTime() + windowMs;
    return Array.from(this.byId.values()).filter((f) => {
      if (f.organizationId !== organizationId || !f.expiresAt) return false;
      if (f.status === 'resolved') return false;
      if (new Date(f.expiresAt).getTime() > horizon) return false;
      const expired = new Date(f.expiresAt).getTime() <= now.getTime();
      // Notify once while expiring soon, and once more after it expires.
      if (!f.expirationNotifiedAt) return true;
      return expired && new Date(f.expirationNotifiedAt).getTime() < new Date(f.expiresAt).getTime();
    });
  }

  markExpirationNotified(id: string, at: string): void {
    const f = this.byId.get(id);
    if (f) f.expirationNotifiedAt = at;
  }

  private readonly comments = new Map<string, import('./finding.types').FindingComment[]>();

  addComment(
    comment: import('./finding.types').FindingComment,
  ): import('./finding.types').FindingComment {
    const list = this.comments.get(comment.findingId) ?? [];
    list.push(comment);
    this.comments.set(comment.findingId, list);
    return comment;
  }

  /** Comments for a finding, oldest first. Empty for cross-tenant/unknown findings. */
  listComments(
    findingId: string,
    organizationId: string,
  ): import('./finding.types').FindingComment[] {
    if (!this.getForTenant(findingId, organizationId)) return [];
    return [...(this.comments.get(findingId) ?? [])];
  }

  getComment(
    findingId: string,
    commentId: string,
  ): import('./finding.types').FindingComment | undefined {
    return this.comments.get(findingId)?.find((c) => c.id === commentId);
  }

  deleteComment(findingId: string, commentId: string): boolean {
    const list = this.comments.get(findingId);
    if (!list) return false;
    const idx = list.findIndex((c) => c.id === commentId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    return true;
  }

  private readonly auditHistory = new Map<string, import('./finding.types').ReassignmentAuditRecord[]>();

  reassign(
    input: import('./finding.types').ReassignFindingInput,
  ): { finding: Finding; record: import('./finding.types').ReassignmentAuditRecord } {
    const finding = this.getForTenant(input.findingId, input.organizationId);
    if (!finding) {
      throw Object.assign(new Error('Finding not found'), {
        code: 'NOT_FOUND',
        status: 404,
      });
    }

    const trimmedNew = input.newAssignee.trim();
    if (finding.assignedTo && finding.assignedTo.trim() === trimmedNew) {
      throw Object.assign(
        new Error(`Finding is already assigned to '${trimmedNew}'`),
        { code: 'ALREADY_ASSIGNED', status: 409 },
      );
    }

    if (
      input.expectedPreviousAssignee !== undefined &&
      finding.assignedTo !== undefined &&
      input.expectedPreviousAssignee.trim() !== finding.assignedTo.trim()
    ) {
      throw Object.assign(
        new Error(
          `Reassignment failed: expected previous assignee '${input.expectedPreviousAssignee}', but finding is currently assigned to '${finding.assignedTo}'`,
        ),
        { code: 'CONCURRENCY_CONFLICT', status: 409 },
      );
    }

    const now = new Date().toISOString();
    const record: import('./finding.types').ReassignmentAuditRecord = {
      id: `reas_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
      findingId: finding.id,
      organizationId: finding.organizationId,
      previousAssignee: finding.assignedTo,
      newAssignee: trimmedNew,
      reassignedBy: input.reassignedBy.trim(),
      reason: input.reason.trim(),
      timestamp: now,
      metadata: input.metadata,
    };

    finding.assignedTo = trimmedNew;
    finding.assignedBy = input.reassignedBy.trim();
    finding.reassignedAt = now;
    finding.reassignmentCount = (finding.reassignmentCount ?? 0) + 1;
    finding.updatedAt = now;

    this.upsert(finding);

    const history = this.auditHistory.get(finding.id) ?? [];
    history.push(record);
    this.auditHistory.set(finding.id, history);

    return { finding, record };
  }

  getReassignmentHistory(
    findingId: string,
    organizationId: string,
  ): import('./finding.types').ReassignmentAuditRecord[] {
    const finding = this.getForTenant(findingId, organizationId);
    if (!finding) {
      return [];
    }
    const history = this.auditHistory.get(findingId) ?? [];
    return [...history].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }
}

/** Process-wide singleton for non-DI call sites / tests. */
export const findingsRepository = new FindingsRepository();
