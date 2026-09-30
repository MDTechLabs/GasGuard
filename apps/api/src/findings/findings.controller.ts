/**
 * Findings list/detail HTTP handlers (#992).
 * Works with Express-style (req, res) used by AnalysisController.
 */

import { Request, Response } from 'express';
import { findingsService } from './findings.service';
import {
  DEFAULT_PAGE_LIMIT,
  FindingListQuery,
  FindingSeverity,
  FindingStatus,
  FindingSortField,
  MAX_PAGE_LIMIT,
  SortDirection,
} from './finding.types';

const SEVERITIES: FindingSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
];
const STATUSES: FindingStatus[] = ['open', 'suppressed', 'resolved', 'accepted'];
const SORT_FIELDS: FindingSortField[] = [
  'createdAt',
  'severity',
  'status',
  'title',
];

function parseListQuery(req: Request): FindingListQuery {
  const organizationId =
    (req.headers['x-organization-id'] as string) ||
    (req.query.organizationId as string);
  if (!organizationId) {
    throw Object.assign(new Error('organizationId is required'), {
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  }

  const parseCsv = <T extends string>(raw: unknown, allowed: T[]): T[] | undefined => {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const parts = String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of parts) {
      if (!allowed.includes(p as T)) {
        throw Object.assign(new Error(`Invalid value: ${p}`), {
          code: 'VALIDATION_ERROR',
          status: 400,
        });
      }
    }
    return parts as T[];
  };

  let limit = Number(req.query.limit ?? DEFAULT_PAGE_LIMIT);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_PAGE_LIMIT;
  limit = Math.min(limit, MAX_PAGE_LIMIT);

  const sortByRaw = (req.query.sortBy as string) || 'createdAt';
  if (!SORT_FIELDS.includes(sortByRaw as FindingSortField)) {
    throw Object.assign(new Error('Invalid sortBy'), {
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  }
  const sortDirRaw = ((req.query.sortDir as string) || 'desc').toLowerCase();
  if (sortDirRaw !== 'asc' && sortDirRaw !== 'desc') {
    throw Object.assign(new Error('Invalid sortDir'), {
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  }

  return {
    organizationId,
    repositoryId: req.query.repositoryId as string | undefined,
    analysisJobId: req.query.analysisJobId as string | undefined,
    owner: req.query.owner as string | undefined,
    severity: parseCsv(req.query.severity, SEVERITIES),
    status: parseCsv(req.query.status, STATUSES),
    ruleId: req.query.ruleId as string | undefined,
    fingerprint: req.query.fingerprint as string | undefined,
    q: req.query.q as string | undefined,
    sortBy: sortByRaw as FindingSortField,
    sortDir: sortDirRaw as SortDirection,
    limit,
    cursor: req.query.cursor as string | undefined,
  };
}

function sendError(res: Response, err: unknown): void {
  const e = err as { status?: number; code?: string; message?: string };
  res.status(e.status ?? 500).json({
    error: {
      code: e.code ?? 'INTERNAL_ERROR',
      message: e.message ?? 'Unexpected error',
    },
  });
}

function requireOrg(req: Request, res: Response): string | undefined {
  const organizationId =
    (req.headers['x-organization-id'] as string) ||
    (req.query.organizationId as string) ||
    (req.body?.organizationId as string);
  if (!organizationId) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'organizationId is required' },
    });
    return undefined;
  }
  return organizationId;
}

export class FindingsController {
  getFingerprintHistory(req: Request, res: Response): void {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;
      const occurrences = findingsService.getFingerprintHistory(
        organizationId,
        req.params.fingerprint,
        req.query.repositoryId as string | undefined,
      );
      res.status(200).json({
        data: {
          fingerprint: req.params.fingerprint,
          occurrenceCount: occurrences.length,
          firstSeenAt: occurrences[0]?.firstSeenAt ?? occurrences[0]?.createdAt ?? null,
          occurrences,
        },
      });
    } catch (err) {
      sendError(res, err);
    }
  }

  addComment(req: Request, res: Response): void {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;
      const { author, body, type } = req.body ?? {};
      const comment = findingsService.addComment({
        organizationId,
        findingId: req.params.id,
        author,
        body,
        type,
      });
      res.status(201).json({ data: comment });
    } catch (err) {
      sendError(res, err);
    }
  }

  listComments(req: Request, res: Response): void {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;
      res.status(200).json({
        data: findingsService.listComments(req.params.id, organizationId),
      });
    } catch (err) {
      sendError(res, err);
    }
  }

  updateComment(req: Request, res: Response): void {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;
      const comment = findingsService.updateComment({
        organizationId,
        findingId: req.params.id,
        commentId: req.params.commentId,
        author: req.body?.author,
        body: req.body?.body,
      });
      res.status(200).json({ data: comment });
    } catch (err) {
      sendError(res, err);
    }
  }

  deleteComment(req: Request, res: Response): void {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;
      findingsService.deleteComment(
        organizationId,
        req.params.id,
        req.params.commentId,
        (req.body?.author as string) || (req.query.author as string),
      );
      res.status(204).send();
    } catch (err) {
      sendError(res, err);
    }
  }

  list(req: Request, res: Response): void {
    try {
      const query = parseListQuery(req);
      const page = findingsService.list(query);
      res.status(200).json({
        data: page.items,
        pagination: {
          nextCursor: page.nextCursor,
          limit: page.limit,
          totalEstimate: page.totalEstimate,
        },
      });
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      res.status(e.status ?? 500).json({
        error: {
          code: e.code ?? 'INTERNAL_ERROR',
          message: e.message ?? 'Unexpected error',
        },
      });
    }
  }

  async notifyExpiring(req: Request, res: Response): Promise<void> {
    try {
      const organizationId =
        (req.headers['x-organization-id'] as string) ||
        (req.body?.organizationId as string);
      if (!organizationId) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'organizationId is required',
          },
        });
        return;
      }
      const windowDays = req.body?.windowDays;
      const windowMs =
        windowDays === undefined ? undefined : Number(windowDays) * 24 * 60 * 60 * 1000;
      if (windowMs !== undefined && (!Number.isFinite(windowMs) || windowMs < 0)) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Invalid windowDays' },
        });
        return;
      }
      const sent = await findingsService.notifyExpiringFindings(organizationId, windowMs);
      res.status(200).json({ data: { sent: sent.length, notifications: sent } });
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      res.status(e.status ?? 500).json({
        error: {
          code: e.code ?? 'INTERNAL_ERROR',
          message: e.message ?? 'Unexpected error',
        },
      });
    }
  }

  exportCsv(req: Request, res: Response): void {
    try {
      const query = parseListQuery(req);
      const csv = findingsService.exportCsv(query);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="findings.csv"',
      );
      res.status(200).send(csv);
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      res.status(e.status ?? 500).json({
        error: {
          code: e.code ?? 'INTERNAL_ERROR',
          message: e.message ?? 'Unexpected error',
        },
      });
    }
  }

  getOne(req: Request, res: Response): void {
    try {
      const organizationId =
        (req.headers['x-organization-id'] as string) ||
        (req.query.organizationId as string);
      if (!organizationId) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'organizationId is required',
          },
        });
        return;
      }
      const finding = findingsService.getForTenant(
        req.params.id,
        organizationId,
      );
      if (!finding) {
        // Same response whether missing or other-tenant — no cross-tenant leak.
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Finding not found' },
        });
        return;
      }
      res.status(200).json({ data: finding });
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      res.status(e.status ?? 500).json({
        error: {
          code: e.code ?? 'INTERNAL_ERROR',
          message: e.message ?? 'Unexpected error',
        },
      });
    }
  }

  reassignOne(req: Request, res: Response): void {
    try {
      const organizationId =
        (req.headers['x-organization-id'] as string) ||
        (req.body?.organizationId as string);
      if (!organizationId) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'organizationId is required',
          },
        });
        return;
      }

      const { newAssignee, reassignedBy, reason, expectedPreviousAssignee, metadata } = req.body ?? {};
      const result = findingsService.reassign({
        organizationId,
        findingId: req.params.id,
        newAssignee,
        reassignedBy,
        reason,
        expectedPreviousAssignee,
        metadata,
      });

      res.status(200).json({ data: result });
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      res.status(e.status ?? 500).json({
        error: {
          code: e.code ?? 'INTERNAL_ERROR',
          message: e.message ?? 'Unexpected error',
        },
      });
    }
  }

  reassignBatch(req: Request, res: Response): void {
    try {
      const organizationId =
        (req.headers['x-organization-id'] as string) ||
        (req.body?.organizationId as string);
      if (!organizationId) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'organizationId is required',
          },
        });
        return;
      }

      const { findingIds, newAssignee, reassignedBy, reason, metadata } = req.body ?? {};
      const result = findingsService.batchReassign({
        organizationId,
        findingIds,
        newAssignee,
        reassignedBy,
        reason,
        metadata,
      });

      res.status(200).json({ data: result });
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      res.status(e.status ?? 500).json({
        error: {
          code: e.code ?? 'INTERNAL_ERROR',
          message: e.message ?? 'Unexpected error',
        },
      });
    }
  }

  transitionStatus(req: Request, res: Response): void {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;

      const { newStatus, changedBy, reason } = req.body ?? {};
      const result = findingsService.transitionStatus({
        organizationId,
        findingId: req.params.id,
        newStatus,
        changedBy,
        reason,
      });

      res.status(200).json({ data: result });
    } catch (err) {
      sendError(res, err);
    }
  }

  getStatusHistory(req: Request, res: Response): void {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;
      const history = findingsService.getStatusHistory(req.params.id, organizationId);
      res.status(200).json({ data: history });
    } catch (err) {
      sendError(res, err);
    }
  }

  acceptRisk(req: Request, res: Response): void {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;

      const { justification, acceptedBy, approvedBy, expiresAt } = req.body ?? {};
      const result = findingsService.acceptRisk({
        organizationId,
        findingId: req.params.id,
        justification,
        acceptedBy,
        approvedBy,
        expiresAt,
      });

      res.status(201).json({ data: result });
    } catch (err) {
      sendError(res, err);
    }
  }

  revokeRiskAcceptance(req: Request, res: Response): void {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;

      const { revokedBy, reason } = req.body ?? {};
      const result = findingsService.revokeRiskAcceptance({
        organizationId,
        findingId: req.params.id,
        revokedBy,
        reason,
      });

      res.status(200).json({ data: result });
    } catch (err) {
      sendError(res, err);
    }
  }

  listRiskAcceptances(req: Request, res: Response): void {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;
      const records = findingsService.listRiskAcceptances(req.params.id, organizationId);
      res.status(200).json({ data: records });
    } catch (err) {
      sendError(res, err);
    }
  }

  setOwnership(req: Request, res: Response): void {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;

      const { owner, ownerType, source, setBy, note } = req.body ?? {};
      const finding = findingsService.setOwnership({
        organizationId,
        findingId: req.params.id,
        owner,
        ownerType,
        source,
        setBy,
        note,
      });

      res.status(200).json({ data: finding });
    } catch (err) {
      sendError(res, err);
    }
  }

  getHistory(req: Request, res: Response): void {
    try {
      const organizationId =
        (req.headers['x-organization-id'] as string) ||
        (req.query.organizationId as string);
      if (!organizationId) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'organizationId is required',
          },
        });
        return;
      }

      const history = findingsService.getReassignmentHistory(
        req.params.id,
        organizationId,
      );
      res.status(200).json({ data: history });
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      res.status(e.status ?? 500).json({
        error: {
          code: e.code ?? 'INTERNAL_ERROR',
          message: e.message ?? 'Unexpected error',
        },
      });
    }
  }
}

export const findingsController = new FindingsController();
