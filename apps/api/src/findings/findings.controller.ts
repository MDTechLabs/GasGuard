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
    severity: parseCsv(req.query.severity, SEVERITIES),
    status: parseCsv(req.query.status, STATUSES),
    ruleId: req.query.ruleId as string | undefined,
    q: req.query.q as string | undefined,
    sortBy: sortByRaw as FindingSortField,
    sortDir: sortDirRaw as SortDirection,
    limit,
    cursor: req.query.cursor as string | undefined,
  };
}

export class FindingsController {
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
