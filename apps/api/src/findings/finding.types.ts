/**
 * Finding domain types and list query contract (#992).
 */

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingStatus = 'open' | 'suppressed' | 'resolved' | 'accepted';

export interface Finding {
  id: string;
  /** Tenant / organization scope — isolation boundary (#996). */
  organizationId: string;
  repositoryId: string;
  analysisJobId: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  status: FindingStatus;
  ruleId: string;
  filePath?: string;
  line?: number;
  /** Current assignee (user/team/module) (#1035). */
  assignedTo?: string;
  /** Actor who performed the last assignment/reassignment (#1035). */
  assignedBy?: string;
  /** ISO timestamp of the last reassignment (#1035). */
  reassignedAt?: string;
  /** Total number of times this finding has been reassigned (#1035). */
  reassignmentCount?: number;
  /** ISO timestamp after which the finding (e.g. suppression/acceptance) expires (#1037). */
  expiresAt?: string;
  /** ISO timestamp of the last expiration notification sent (#1037). */
  expirationNotifiedAt?: string;
  createdAt: string; // ISO
  updatedAt: string;
}

export type FindingExpirationNotificationKind = 'expiring_soon' | 'expired';

export interface FindingExpirationNotification {
  findingId: string;
  organizationId: string;
  kind: FindingExpirationNotificationKind;
  title: string;
  severity: FindingSeverity;
  assignedTo?: string;
  expiresAt: string;
  createdAt: string; // ISO
}

/** Delivery sink for expiration notifications (email/Slack/webhook adapters implement this). */
export interface FindingExpirationNotificationSink {
  send(notification: FindingExpirationNotification): void | Promise<void>;
}

export type FindingSortField = 'createdAt' | 'severity' | 'status' | 'title';
export type SortDirection = 'asc' | 'desc';

export interface FindingListQuery {
  organizationId: string;
  repositoryId?: string;
  analysisJobId?: string;
  assignedTo?: string;
  severity?: FindingSeverity | FindingSeverity[];
  status?: FindingStatus | FindingStatus[];
  ruleId?: string;
  /** Free-text search over title/description/filePath */
  q?: string;
  sortBy?: FindingSortField;
  sortDir?: SortDirection;
  /** Max items per page (capped server-side). */
  limit?: number;
  /**
   * Opaque stable cursor from a previous response.
   * Encodes sort key + id so pages do not skip/duplicate under inserts.
   */
  cursor?: string;
}

export interface ReassignFindingInput {
  organizationId: string;
  findingId: string;
  newAssignee: string;
  reassignedBy: string;
  reason: string;
  expectedPreviousAssignee?: string;
  metadata?: Record<string, unknown>;
}

export interface BatchReassignInput {
  organizationId: string;
  findingIds: string[];
  newAssignee: string;
  reassignedBy: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface ReassignmentAuditRecord {
  id: string;
  findingId: string;
  organizationId: string;
  previousAssignee?: string;
  newAssignee: string;
  reassignedBy: string;
  reason: string;
  timestamp: string; // ISO
  metadata?: Record<string, unknown>;
}

export interface FindingListPage {
  items: Finding[];
  nextCursor: string | null;
  /** Present when inexpensive to compute; may be omitted for very large sets. */
  totalEstimate?: number;
  limit: number;
}

/** Severity rank for sorting (higher = more severe). */
export const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 20;
