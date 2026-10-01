/**
 * Finding grouping by root cause tests (#1038).
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

describe('findings root cause grouping (#1038)', () => {
  const ORG_1 = 'org-acme-corp';
  const ORG_2 = 'org-other-corp';

  beforeEach(() => {
    findingsRepository.clear();
  });

  it('groups findings with different fingerprints/rules under a shared root cause', () => {
    const f1 = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-soroban',
      analysisJobId: 'job-1',
      title: 'Unbounded loop in transfer',
      description: 'Loop over caller-supplied vector',
      severity: 'high',
      ruleId: 'gas-loop-transfer',
      filePath: 'contracts/token/transfer.rs',
    });
    const f2 = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-soroban',
      analysisJobId: 'job-1',
      title: 'Unbounded loop in batch_transfer',
      description: 'Same shared iterator helper used unsafely',
      severity: 'high',
      ruleId: 'gas-loop-batch',
      filePath: 'contracts/token/batch.rs',
    });

    const group = findingsService.createRootCauseGroup({
      organizationId: ORG_1,
      title: 'Unsafe shared iterator helper',
      description: 'Both findings stem from lib/iter_helpers.rs not bounding input length',
      createdBy: 'auditor-dan',
    });

    const { finding: assigned1 } = findingsService.assignFindingToRootCauseGroup({
      organizationId: ORG_1,
      groupId: group.id,
      findingId: f1.id,
    });
    const { finding: assigned2 } = findingsService.assignFindingToRootCauseGroup({
      organizationId: ORG_1,
      groupId: group.id,
      findingId: f2.id,
    });

    expect(assigned1.rootCauseGroupId).toBe(group.id);
    expect(assigned2.rootCauseGroupId).toBe(group.id);
    expect(assigned1.fingerprint).not.toBe(assigned2.fingerprint);

    const members = findingsService.listRootCauseGroupMembers(group.id, ORG_1);
    expect(members.map((m) => m.id).sort()).toEqual([f1.id, f2.id].sort());

    const byFilter = findingsService.list({ organizationId: ORG_1, rootCauseGroupId: group.id });
    expect(byFilter.items).toHaveLength(2);
  });

  it('removing a finding from its group clears the association', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc',
      severity: 'low',
      ruleId: 'r-1',
    });
    const group = findingsService.createRootCauseGroup({
      organizationId: ORG_1,
      title: 'Group A',
      createdBy: 'lead',
    });

    findingsService.assignFindingToRootCauseGroup({
      organizationId: ORG_1,
      groupId: group.id,
      findingId: finding.id,
    });

    const removed = findingsService.removeFindingFromRootCauseGroup({
      organizationId: ORG_1,
      findingId: finding.id,
    });
    expect(removed.rootCauseGroupId).toBeUndefined();

    expect(() =>
      findingsService.removeFindingFromRootCauseGroup({
        organizationId: ORG_1,
        findingId: finding.id,
      }),
    ).toThrow(/not part of a root cause group/);
  });

  it('reassigning a finding to a different group moves it (a finding has one root cause at a time)', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc',
      severity: 'low',
      ruleId: 'r-1',
    });
    const groupA = findingsService.createRootCauseGroup({
      organizationId: ORG_1,
      title: 'Group A',
      createdBy: 'lead',
    });
    const groupB = findingsService.createRootCauseGroup({
      organizationId: ORG_1,
      title: 'Group B',
      createdBy: 'lead',
    });

    findingsService.assignFindingToRootCauseGroup({
      organizationId: ORG_1,
      groupId: groupA.id,
      findingId: finding.id,
    });
    const { finding: moved } = findingsService.assignFindingToRootCauseGroup({
      organizationId: ORG_1,
      groupId: groupB.id,
      findingId: finding.id,
    });

    expect(moved.rootCauseGroupId).toBe(groupB.id);
    expect(findingsService.listRootCauseGroupMembers(groupA.id, ORG_1)).toHaveLength(0);
    expect(findingsService.listRootCauseGroupMembers(groupB.id, ORG_1)).toHaveLength(1);
  });

  it('deleting a group detaches its member findings', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc',
      severity: 'low',
      ruleId: 'r-1',
    });
    const group = findingsService.createRootCauseGroup({
      organizationId: ORG_1,
      title: 'Group A',
      createdBy: 'lead',
    });
    findingsService.assignFindingToRootCauseGroup({
      organizationId: ORG_1,
      groupId: group.id,
      findingId: finding.id,
    });

    findingsService.deleteRootCauseGroup(group.id, ORG_1);

    const updated = findingsService.getForTenant(finding.id, ORG_1);
    expect(updated?.rootCauseGroupId).toBeUndefined();
    expect(findingsService.listRootCauseGroupMembers(group.id, ORG_1)).toEqual([]);

    expect(() => findingsService.deleteRootCauseGroup(group.id, ORG_1)).toThrow(/not found/);
  });

  it('rejects creating a group or assigning a finding without required fields', () => {
    expect(() =>
      findingsService.createRootCauseGroup({
        organizationId: ORG_1,
        title: '',
        createdBy: 'lead',
      }),
    ).toThrow(/title is required/);

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
      findingsService.assignFindingToRootCauseGroup({
        organizationId: ORG_1,
        groupId: 'rcg_nonexistent',
        findingId: finding.id,
      }),
    ).toThrow(/Root cause group not found/);
  });

  it('HTTP controller: createRootCauseGroup, assignFindingToRootCauseGroup, listRootCauseGroupMembers', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc',
      severity: 'medium',
      ruleId: 'r-1',
    });

    const reqCreate = {
      headers: { 'x-organization-id': ORG_1 },
      body: { title: 'Shared validation bug', createdBy: 'lead' },
    } as unknown as Request;
    const { res: resCreate, status: statusCreate, json: jsonCreate } = mockResponse();

    findingsController.createRootCauseGroup(reqCreate, resCreate);
    expect(statusCreate).toHaveBeenCalledWith(201);
    const createdGroup = (jsonCreate.mock.calls[0][0] as { data: { id: string } }).data;

    const reqAssign = {
      headers: { 'x-organization-id': ORG_1 },
      params: { id: finding.id, groupId: createdGroup.id },
    } as unknown as Request;
    const { res: resAssign, status: statusAssign, json: jsonAssign } = mockResponse();

    findingsController.assignFindingToRootCauseGroup(reqAssign, resAssign);
    expect(statusAssign).toHaveBeenCalledWith(200);
    expect(jsonAssign).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          finding: expect.objectContaining({ rootCauseGroupId: createdGroup.id }),
        }),
      }),
    );

    const reqMembers = {
      headers: { 'x-organization-id': ORG_1 },
      params: { groupId: createdGroup.id },
    } as unknown as Request;
    const { res: resMembers, status: statusMembers, json: jsonMembers } = mockResponse();

    findingsController.listRootCauseGroupMembers(reqMembers, resMembers);
    expect(statusMembers).toHaveBeenCalledWith(200);
    expect(jsonMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ id: finding.id })]),
      }),
    );
  });

  it('enforces tenant boundary isolation across organizations', () => {
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Org 1 finding',
      description: 'Desc',
      severity: 'high',
      ruleId: 'r-1',
    });
    const group = findingsService.createRootCauseGroup({
      organizationId: ORG_1,
      title: 'Group A',
      createdBy: 'lead',
    });

    expect(() =>
      findingsService.assignFindingToRootCauseGroup({
        organizationId: ORG_2,
        groupId: group.id,
        findingId: finding.id,
      }),
    ).toThrow(/Root cause group not found/);

    expect(findingsService.listRootCauseGroupMembers(group.id, ORG_2)).toEqual([]);
    expect(findingsService.listRootCauseGroups(ORG_2)).toEqual([]);
  });
});
