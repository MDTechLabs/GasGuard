/**
 * Finding status transition workflow tests (#1033).
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

describe('findings status transitions (#1033)', () => {
  const ORG_1 = 'org-acme-corp';
  const ORG_2 = 'org-other-corp';

  beforeEach(() => {
    findingsRepository.clear();
  });

  it('covers a normal lifecycle: open -> suppressed -> resolved -> reopen', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-soroban',
      analysisJobId: 'job-100',
      title: 'Unbounded loop in withdraw',
      description: 'Loop bound depends on user input',
      severity: 'high',
      ruleId: 'gas-loop-withdraw',
    });
    expect(finding.status).toBe('open');

    const { finding: suppressed, record: r1 } = findingsService.transitionStatus({
      organizationId: ORG_1,
      findingId: finding.id,
      newStatus: 'suppressed',
      changedBy: 'auditor-dan',
      reason: 'False positive pending confirmation',
    });
    expect(suppressed.status).toBe('suppressed');
    expect(r1.previousStatus).toBe('open');
    expect(r1.newStatus).toBe('suppressed');

    const { finding: resolved } = findingsService.transitionStatus({
      organizationId: ORG_1,
      findingId: finding.id,
      newStatus: 'resolved',
      changedBy: 'auditor-dan',
    });
    expect(resolved.status).toBe('resolved');

    const { finding: reopened } = findingsService.transitionStatus({
      organizationId: ORG_1,
      findingId: finding.id,
      newStatus: 'open',
      changedBy: 'auditor-dan',
      reason: 'Regression found in follow-up run',
    });
    expect(reopened.status).toBe('open');

    const history = findingsService.getStatusHistory(finding.id, ORG_1);
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.newStatus)).toEqual(['suppressed', 'resolved', 'open']);
  });

  it('rejects transitions not allowed by the state graph', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc',
      severity: 'medium',
      ruleId: 'r-1',
    });

    findingsService.transitionStatus({
      organizationId: ORG_1,
      findingId: finding.id,
      newStatus: 'resolved',
      changedBy: 'lead',
    });

    // resolved can only go back to open, not directly to suppressed.
    expect(() =>
      findingsService.transitionStatus({
        organizationId: ORG_1,
        findingId: finding.id,
        newStatus: 'suppressed',
        changedBy: 'lead',
      }),
    ).toThrow(/Invalid status transition/);
  });

  it('rejects a no-op transition to the current status', () => {
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
      findingsService.transitionStatus({
        organizationId: ORG_1,
        findingId: finding.id,
        newStatus: 'open',
        changedBy: 'lead',
      }),
    ).toThrow(/already in status/);
  });

  it('rejects missing required fields', () => {
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
      findingsService.transitionStatus({
        organizationId: ORG_1,
        findingId: finding.id,
        newStatus: 'resolved',
        changedBy: '',
      }),
    ).toThrow(/changedBy is required/);

    expect(() =>
      findingsService.transitionStatus({
        organizationId: ORG_1,
        findingId: finding.id,
        newStatus: 'not-a-status' as any,
        changedBy: 'lead',
      }),
    ).toThrow(/Invalid newStatus/);
  });

  it('HTTP controller: transitionStatus and getStatusHistory endpoints', () => {
    const f1 = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc',
      severity: 'medium',
      ruleId: 'r-1',
    });

    const req1 = {
      headers: { 'x-organization-id': ORG_1 },
      params: { id: f1.id },
      body: { newStatus: 'resolved', changedBy: 'triage-bot', reason: 'Patched in PR #42' },
    } as unknown as Request;
    const { res: res1, status: status1, json: json1 } = mockResponse();

    findingsController.transitionStatus(req1, res1);
    expect(status1).toHaveBeenCalledWith(200);
    expect(json1).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          finding: expect.objectContaining({ status: 'resolved' }),
        }),
      }),
    );

    const reqHist = {
      headers: { 'x-organization-id': ORG_1 },
      params: { id: f1.id },
    } as unknown as Request;
    const { res: resHist, status: statusHist, json: jsonHist } = mockResponse();

    findingsController.getStatusHistory(reqHist, resHist);
    expect(statusHist).toHaveBeenCalledWith(200);
    expect(jsonHist).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ previousStatus: 'open', newStatus: 'resolved' }),
        ]),
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
      findingsService.transitionStatus({
        organizationId: ORG_2,
        findingId: f1.id,
        newStatus: 'resolved',
        changedBy: 'attacker',
      }),
    ).toThrow(/Finding not found/);

    const history = findingsService.getStatusHistory(f1.id, ORG_2);
    expect(history).toEqual([]);
  });
});
