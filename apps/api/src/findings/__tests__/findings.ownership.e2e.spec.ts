/**
 * Finding ownership metadata tests (#1032).
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

describe('findings ownership metadata (#1032)', () => {
  const ORG_1 = 'org-acme-corp';
  const ORG_2 = 'org-other-corp';

  beforeEach(() => {
    findingsRepository.clear();
  });

  it('sets manual ownership distinct from the active assignee, and allows filtering by owner', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-soroban',
      analysisJobId: 'job-100',
      title: 'Reentrancy risk in withdraw',
      description: 'External call before state update',
      severity: 'critical',
      ruleId: 'reentrancy-withdraw',
    });

    const updated = findingsService.setOwnership({
      organizationId: ORG_1,
      findingId: finding.id,
      owner: 'team-token-core',
      ownerType: 'team',
      setBy: 'triage-bot',
    });

    expect(updated.ownership?.owner).toBe('team-token-core');
    expect(updated.ownership?.ownerType).toBe('team');
    expect(updated.ownership?.source).toBe('manual');
    expect(updated.ownership?.setBy).toBe('triage-bot');
    expect(updated.assignedTo).toBeUndefined();

    // Also assign a different individual to actively work it — ownership and
    // assignment are independent concepts.
    const { finding: reassigned } = findingsService.reassign({
      organizationId: ORG_1,
      findingId: finding.id,
      newAssignee: 'developer-eva',
      reassignedBy: 'team-token-core',
      reason: 'Delegated to Eva for remediation',
    });
    expect(reassigned.assignedTo).toBe('developer-eva');
    expect(reassigned.ownership?.owner).toBe('team-token-core');

    const byOwner = findingsService.list({ organizationId: ORG_1, owner: 'team-token-core' });
    expect(byOwner.items).toHaveLength(1);
    expect(byOwner.items[0]?.id).toBe(finding.id);

    const byOtherOwner = findingsService.list({ organizationId: ORG_1, owner: 'team-frontend' });
    expect(byOtherOwner.items).toHaveLength(0);
  });

  it('supports auto-detected ownership without a setBy actor', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc',
      severity: 'low',
      ruleId: 'r-1',
      filePath: 'contracts/token/transfer.rs',
    });

    const updated = findingsService.setOwnership({
      organizationId: ORG_1,
      findingId: finding.id,
      owner: 'team-token-core',
      ownerType: 'team',
      source: 'codeowners',
      note: 'Matched /contracts/token/* in CODEOWNERS',
    });

    expect(updated.ownership?.source).toBe('codeowners');
    expect(updated.ownership?.setBy).toBeUndefined();
    expect(updated.ownership?.note).toBe('Matched /contracts/token/* in CODEOWNERS');
  });

  it('replacing ownership overwrites the previous owner', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc',
      severity: 'low',
      ruleId: 'r-1',
    });

    findingsService.setOwnership({
      organizationId: ORG_1,
      findingId: finding.id,
      owner: 'team-a',
      ownerType: 'team',
      setBy: 'admin',
    });
    const updated = findingsService.setOwnership({
      organizationId: ORG_1,
      findingId: finding.id,
      owner: 'team-b',
      ownerType: 'team',
      setBy: 'admin',
    });

    expect(updated.ownership?.owner).toBe('team-b');
  });

  it('rejects invalid ownerType and missing owner', () => {
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
      findingsService.setOwnership({
        organizationId: ORG_1,
        findingId: finding.id,
        owner: 'team-a',
        ownerType: 'department' as any,
        setBy: 'admin',
      }),
    ).toThrow(/Invalid ownerType/);

    expect(() =>
      findingsService.setOwnership({
        organizationId: ORG_1,
        findingId: finding.id,
        owner: '',
        ownerType: 'team',
        setBy: 'admin',
      }),
    ).toThrow(/owner is required/);
  });

  it('requires setBy when source is manual (default)', () => {
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
      findingsService.setOwnership({
        organizationId: ORG_1,
        findingId: finding.id,
        owner: 'team-a',
        ownerType: 'team',
      }),
    ).toThrow(/setBy is required when source is manual/);
  });

  it('HTTP controller: setOwnership endpoint', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc',
      severity: 'medium',
      ruleId: 'r-1',
    });

    const req = {
      headers: { 'x-organization-id': ORG_1 },
      params: { id: finding.id },
      body: { owner: 'service-indexer', ownerType: 'service', setBy: 'admin' },
    } as unknown as Request;
    const { res, status, json } = mockResponse();

    findingsController.setOwnership(req, res);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownership: expect.objectContaining({ owner: 'service-indexer', ownerType: 'service' }),
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
      findingsService.setOwnership({
        organizationId: ORG_2,
        findingId: f1.id,
        owner: 'attacker-team',
        ownerType: 'team',
        setBy: 'attacker',
      }),
    ).toThrow(/Finding not found/);
  });
});
