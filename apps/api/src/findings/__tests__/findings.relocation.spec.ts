import * as fs from 'fs';
import * as path from 'path';
import { createLocationAnchor } from '@engine/core/location-mapper';
import { findingsRepository } from '../findings.repository';
import { FindingsService } from '../findings.service';

const FIXTURES = path.resolve(__dirname, '../../../../../tests/fixtures/location-mapping');
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const v1 = read('runner.v1.ts');
const v2 = read('runner.v2.ts');
const v4 = read('runner.v4-rewritten.ts');

const FILE = 'src/runner.ts';

function seed(service: FindingsService, org: string, repo: string, line: number) {
  return service.create({
    organizationId: org,
    repositoryId: repo,
    analysisJobId: 'job-1',
    title: `exec at ${line}`,
    description: 'd',
    severity: 'high',
    ruleId: 'cmd-001',
    filePath: FILE,
    line,
    locationAnchor: createLocationAnchor(v1, { startLine: line }),
  });
}

describe('finding location relocation', () => {
  const service = new FindingsService(findingsRepository);

  beforeEach(() => findingsRepository.clear());

  it('stores the anchor and marks new findings exact', () => {
    const f = seed(service, 'org-a', 'repo-1', 9);
    expect(f.locationAnchor?.startLine).toBe(9);
    expect(f.locationStatus).toBe('exact');
  });

  it('leaves findings created without an anchor unchanged (backward compatible)', () => {
    const f = service.create({
      organizationId: 'org-a', repositoryId: 'repo-1', analysisJobId: 'j',
      title: 't', description: 'd', severity: 'low', ruleId: 'r', filePath: FILE, line: 3,
    });
    expect(f.locationAnchor).toBeUndefined();
    expect(f.locationStatus).toBeUndefined();
    const res = service.relocateFindings({ organizationId: 'org-a', repositoryId: 'repo-1', files: { [FILE]: v2 } });
    expect(res).toMatchObject({ examined: 1, skippedNoAnchor: 1, relocated: 0 });
    expect(service.getForTenant(f.id, 'org-a')!.line).toBe(3);
  });

  it('moves each finding to its new line without touching its fingerprint', () => {
    const lookup = seed(service, 'org-a', 'repo-1', 9);
    const tail = seed(service, 'org-a', 'repo-1', 14);
    const fingerprints = [lookup.fingerprint, tail.fingerprint];

    const res = service.relocateFindings({
      organizationId: 'org-a', repositoryId: 'repo-1', files: new Map([[`./${FILE}`, v2]]),
    });

    expect(res).toMatchObject({ examined: 2, relocated: 2, lost: 0, unchanged: 0 });
    const lines = v2.split('\n');
    const execLines = lines.map((l, i) => (l.trim() === 'return exec(cmd);' ? i + 1 : 0)).filter(Boolean);
    expect(service.getForTenant(lookup.id, 'org-a')!.line).toBe(execLines[0]);
    expect(service.getForTenant(tail.id, 'org-a')!.line).toBe(execLines[1]);
    expect(service.getForTenant(lookup.id, 'org-a')!.locationStatus).toBe('moved');
    expect([lookup.fingerprint, tail.fingerprint]).toEqual(fingerprints);
  });

  it('is idempotent: a second run over the same contents changes nothing', () => {
    seed(service, 'org-a', 'repo-1', 9);
    const input = { organizationId: 'org-a', repositoryId: 'repo-1', files: { [FILE]: v2 } };
    service.relocateFindings(input);
    expect(service.relocateFindings(input)).toMatchObject({ relocated: 0, unchanged: 1, lost: 0 });
  });

  it('marks findings lost when their code is gone, then recovers them when it returns', () => {
    const f = seed(service, 'org-a', 'repo-1', 9);
    const base = { organizationId: 'org-a', repositoryId: 'repo-1' };

    expect(service.relocateFindings({ ...base, files: { [FILE]: v4 } })).toMatchObject({ lost: 1 });
    let current = service.getForTenant(f.id, 'org-a')!;
    expect(current.locationStatus).toBe('lost');
    expect(current.line).toBe(9);

    service.relocateFindings({ ...base, files: { [FILE]: v2 } });
    current = service.getForTenant(f.id, 'org-a')!;
    expect(current.locationStatus).toBe('moved');
    expect(current.line).not.toBe(9);
  });

  it('marks findings in deleted files lost, but ignores files missing from a partial snapshot', () => {
    const f = seed(service, 'org-a', 'repo-1', 9);
    const base = { organizationId: 'org-a', repositoryId: 'repo-1' };

    expect(service.relocateFindings({ ...base, files: {} })).toMatchObject({ skippedFileNotProvided: 1, lost: 0 });
    expect(service.getForTenant(f.id, 'org-a')!.locationStatus).toBe('exact');

    expect(service.relocateFindings({ ...base, files: {}, deletedFiles: [FILE] })).toMatchObject({ lost: 1 });
    expect(service.getForTenant(f.id, 'org-a')!.locationStatus).toBe('lost');
  });

  it('never touches another organization or repository', () => {
    const own = seed(service, 'org-a', 'repo-1', 9);
    const otherOrg = seed(service, 'org-b', 'repo-1', 9);
    const otherRepo = seed(service, 'org-a', 'repo-2', 9);

    const res = service.relocateFindings({ organizationId: 'org-a', repositoryId: 'repo-1', files: { [FILE]: v2 } });

    expect(res.examined).toBe(1);
    expect(service.getForTenant(own.id, 'org-a')!.line).not.toBe(9);
    expect(service.getForTenant(otherOrg.id, 'org-b')!.line).toBe(9);
    expect(service.getForTenant(otherRepo.id, 'org-a')!.line).toBe(9);
  });

  it('ignores corrupt anchors and unsafe paths instead of throwing', () => {
    const f = seed(service, 'org-a', 'repo-1', 9);
    (f as { locationAnchor: unknown }).locationAnchor = { version: 99 };
    const res = service.relocateFindings({
      organizationId: 'org-a', repositoryId: 'repo-1', files: { '../escape.ts': v2, [FILE]: v2 },
    });
    expect(res).toMatchObject({ examined: 1, skippedNoAnchor: 1 });
  });

  it('validates tenant scope', () => {
    expect(() => service.relocateFindings({ organizationId: ' ', repositoryId: 'r', files: {} })).toThrow(
      'organizationId is required',
    );
    expect(() => service.relocateFindings({ organizationId: 'o', repositoryId: '', files: {} })).toThrow(
      'repositoryId is required',
    );
  });
});
