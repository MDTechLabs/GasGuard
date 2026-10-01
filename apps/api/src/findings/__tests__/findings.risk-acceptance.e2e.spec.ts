/**
 * Finding risk acceptance record tests (#1036).
 */

import { findingsRepository } from '../findings.repository';
import { findingsService } from '../findings.service';
import { findingsController } from '../findings.controller';
import { Request, Response } from 'express';

const fn = typeof vi !== 'undefined' ? vi.fn : (typeof jest !== 'undefined' ? jest.fn : () => {});

function mockResponse(): {
  res: Response;
  status: any;
  json: any;
} {
  const json = fn();
  const status = fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

describe('findings risk acceptance (#1036)', () => {
  const ORG_1 = 'org-acme-corp';
  const ORG_2 = 'org-other-corp';

  beforeEach(() => {
    findingsRepository.clear();
  });

  it('covers accept -> list -> revoke lifecycle and reopens the finding', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-soroban',
      analysisJobId: 'job-100',
      title: 'Unbounded gas in batch transfer',
      description: 'Loop bound depends on caller-supplied array length',
      severity: 'medium',
      ruleId: 'gas-loop-batch',
    });

    const { finding: accepted, record } = findingsService.acceptRisk({
      organizationId: ORG_1,
      findingId: finding.id,
      justification: 'Caller array length is capped by contract config elsewhere',
      acceptedBy: 'auditor-dan',
      approvedBy: 'security-lead-may',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });

    expect(accepted.status).toBe('accepted');
    expect(accepted.expiresAt).toBe('2027-01-01T00:00:00.000Z');
    expect(record.acceptedBy).toBe('auditor-dan');
    expect(record.approvedBy).toBe('security-lead-may');
    expect(record.revokedAt).toBeUndefined();

    const records = findingsService.listRiskAcceptances(finding.id, ORG_1);
    expect(records).toHaveLength(1);

    const statusHistory = findingsService.getStatusHistory(finding.id, ORG_1);
    expect(statusHistory).toHaveLength(1);
    expect(statusHistory[0]?.previousStatus).toBe('open');
    expect(statusHistory[0]?.newStatus).toBe('accepted');

    const { finding: reopened, record: revoked } = findingsService.revokeRiskAcceptance({
      organizationId: ORG_1,
      findingId: finding.id,
      revokedBy: 'security-lead-may',
      reason: 'New exploit path discovered',
    });

    expect(reopened.status).toBe('open');
    expect(revoked.revokedBy).toBe('security-lead-may');
    expect(revoked.revokedReason).toBe('New exploit path discovered');

    const historyAfterRevoke = findingsService.getStatusHistory(finding.id, ORG_1);
    expect(historyAfterRevoke).toHaveLength(2);
    expect(historyAfterRevoke[1]?.newStatus).toBe('open');
  });

  it('rejects accepting risk twice while a record is active', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc',
      severity: 'low',
      ruleId: 'r-1',
    });

    findingsService.acceptRisk({
      organizationId: ORG_1,
      findingId: finding.id,
      justification: 'Accepted low severity noise for now',
      acceptedBy: 'auditor-dan',
    });

    expect(() =>
      findingsService.acceptRisk({
        organizationId: ORG_1,
        findingId: finding.id,
        justification: 'Trying to accept again',
        acceptedBy: 'auditor-dan',
      }),
    ).toThrow(/already has an active risk acceptance/);
  });

  it('rejects a justification that is too short', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc',
      severity: 'low',
      ruleId: 'r-1',
    });

    expect(() =>
      findingsService.acceptRisk({
        organizationId: ORG_1,
        findingId: finding.id,
        justification: 'too short',
        acceptedBy: 'auditor-dan',
      }),
    ).toThrow(/justification must be at least/);
  });

  it('rejects accepting risk for a finding that cannot transition to accepted', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc',
      severity: 'low',
      ruleId: 'r-1',
    });

    findingsService.transitionStatus({
      organizationId: ORG_1,
      findingId: finding.id,
      newStatus: 'resolved',
      changedBy: 'lead',
    });

    expect(() =>
      findingsService.acceptRisk({
        organizationId: ORG_1,
        findingId: finding.id,
        justification: 'Attempting to accept a resolved finding',
        acceptedBy: 'auditor-dan',
      }),
    ).toThrow(/Cannot accept risk for a finding in status 'resolved'/);
  });

  it('rejects revoking when there is no active risk acceptance', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc',
      severity: 'low',
      ruleId: 'r-1',
    });

    expect(() =>
      findingsService.revokeRiskAcceptance({
        organizationId: ORG_1,
        findingId: finding.id,
        revokedBy: 'auditor-dan',
      }),
    ).toThrow(/No active risk acceptance found/);
  });

  it('HTTP controller: acceptRisk, listRiskAcceptances, revokeRiskAcceptance endpoints', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc',
      severity: 'medium',
      ruleId: 'r-1',
    });

    const reqAccept = {
      headers: { 'x-organization-id': ORG_1 },
      params: { id: finding.id },
      body: {
        justification: 'Compensating control already in place upstream',
        acceptedBy: 'auditor-dan',
      },
    } as unknown as Request;
    const { res: resAccept, status: statusAccept, json: jsonAccept } = mockResponse();

    findingsController.acceptRisk(reqAccept, resAccept);
    expect(statusAccept).toHaveBeenCalledWith(201);
    expect(jsonAccept).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          finding: expect.objectContaining({ status: 'accepted' }),
        }),
      }),
    );

    const reqList = {
      headers: { 'x-organization-id': ORG_1 },
      params: { id: finding.id },
    } as unknown as Request;
    const { res: resList, status: statusList, json: jsonList } = mockResponse();

    findingsController.listRiskAcceptances(reqList, resList);
    expect(statusList).toHaveBeenCalledWith(200);
    expect(jsonList).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ acceptedBy: 'auditor-dan' }),
        ]),
      }),
    );

    const reqRevoke = {
      headers: { 'x-organization-id': ORG_1 },
      params: { id: finding.id },
      body: { revokedBy: 'security-lead-may' },
    } as unknown as Request;
    const { res: resRevoke, status: statusRevoke, json: jsonRevoke } = mockResponse();

    findingsController.revokeRiskAcceptance(reqRevoke, resRevoke);
    expect(statusRevoke).toHaveBeenCalledWith(200);
    expect(jsonRevoke).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          finding: expect.objectContaining({ status: 'open' }),
        }),
      }),
    );
  });

  it('enforces tenant boundary isolation across organizations', () => {
    const f1 = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Org 1 finding',
      description: 'Desc',
      severity: 'high',
      ruleId: 'r-1',
    });

    expect(() =>
      findingsService.acceptRisk({
        organizationId: ORG_2,
        findingId: f1.id,
        justification: 'Cross-tenant risk acceptance attempt',
        acceptedBy: 'attacker',
      }),
    ).toThrow(/Finding not found/);

    const records = findingsService.listRiskAcceptances(f1.id, ORG_2);
    expect(records).toEqual([]);
  });
});
