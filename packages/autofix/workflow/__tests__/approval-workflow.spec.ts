import {
  approveFix,
  applyOnlyApprovedFixes,
  createPendingFix,
  rejectFix,
} from '../approval-workflow';

describe('Soroban autofix approval workflow', () => {
  it('keeps fixes pending until explicitly approved', () => {
    const fix = createPendingFix('contract.rs', 'pub fn transfer() {}', {
      startLine: 1,
      endLine: 1,
      replacement: ['pub fn transfer() { require_auth!(); }'],
      description: 'Add auth check',
    });

    expect(fix.status).toBe('pending');
    expect(fix.auditTrail).toHaveLength(1);
  });

  it('records reviewer decisions and only applies approved fixes', () => {
    const pending = createPendingFix('contract.rs', 'pub fn transfer() {}', {
      startLine: 1,
      endLine: 1,
      replacement: ['pub fn transfer() { require_auth!(); }'],
      description: 'Add auth check',
    });

    const approved = approveFix(pending, 'reviewer-a', 'Looks correct');
    expect(approved.status).toBe('approved');
    expect(approved.decisionReason).toBe('Looks correct');
    expect(approved.reviewer).toBe('reviewer-a');
    expect(approved.auditTrail.at(-1)?.decision).toBe('approved');

    const rejected = rejectFix({ ...approved }, 'reviewer-b', 'Unsafe change');
    expect(rejected.status).toBe('rejected');
    expect(rejected.auditTrail.at(-1)?.reason).toBe('Unsafe change');

    const result = applyOnlyApprovedFixes('pub fn transfer() {}', [approved, rejected]);
    expect(result.applied).toHaveLength(1);
    expect(result.source).toContain('require_auth');
    expect(result.skipped).toHaveLength(1);
    expect(result.applied[0].status).toBe('approved');
  });
});
