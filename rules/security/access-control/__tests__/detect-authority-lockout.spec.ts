import { detectAuthorityLockout, RULE_ID } from '../detect-authority-lockout';
import { toNormalizedFindings } from '../../lib/normalize';
import * as fx from './ownership-lockout.fixtures';

const run = (src: Parameters<typeof detectAuthorityLockout>[0], opts?: Parameters<typeof detectAuthorityLockout>[1]) => detectAuthorityLockout(src, opts);
const kinds = (src: Parameters<typeof detectAuthorityLockout>[0]) => run(src).findings.map((f) => f.kind);

describe('detectAuthorityLockout', () => {
  it('flags a single-step transfer without zero-address check as high', () => {
    const [f] = run(fx.SINGLE_STEP_NO_ZERO_CHECK).findings;
    expect(f.ruleId).toBe(RULE_ID);
    expect(f.kind).toBe('single-step-owner-transfer');
    expect(f.severity).toBe('high');
    expect(f.function).toBe('transferOwnership');
    expect(f.details).toMatchObject({ zeroAddressChecked: false, recoveryPath: false });
  });

  it('flags acceptance that is not restricted to the pending owner as critical', () => {
    const findings = run(fx.PENDING_ACCEPT_UNRESTRICTED).findings;
    expect(findings.map((f) => f.kind)).toEqual(['pending-accept-unrestricted']);
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].function).toBe('acceptOwnership');
  });

  it('flags a pending owner that nothing can accept', () => {
    expect(kinds(fx.PENDING_NEVER_ACCEPTED)).toEqual(['pending-acceptance-missing']);
  });

  it('accepts a correct two-step flow', () => {
    expect(run(fx.SAFE_TWO_STEP).findings).toEqual([]);
  });

  it('flags renunciation that locks privileged functions', () => {
    const [f] = run(fx.RENOUNCE_LOCKS_WITHDRAW).findings;
    expect(f.kind).toBe('ownership-renounce-lockout');
    expect(f.severity).toBe('high');
    expect(f.details).toMatchObject({ privilegedFunctions: ['withdraw'], recoveryPath: false });
  });

  it('does not report documented intentional renounce or immutable designs and records a note', () => {
    const r = run(fx.RENOUNCE_DOCUMENTED);
    expect(r.findings).toEqual([]);
    expect(r.notes!.join('\n')).toMatch(/intent/i);
    const d = run(fx.DOCUMENTED_IMMUTABLE);
    expect(d.findings).toEqual([]);
    expect(d.notes!.join('\n')).toMatch(/intent documented/);
    expect(run(fx.SINGLE_STEP_NO_ZERO_CHECK, { intentionallyImmutable: ['Vault'] }).findings).toEqual([]);
  });

  it('treats contracts without privileged functions as permissionless', () => {
    const r = run(fx.PERMISSIONLESS);
    expect(r.findings).toEqual([]);
    expect(r.notes!.join('\n')).toMatch(/permissionless/);
  });

  it('lowers severity when another authority can restore the owner', () => {
    const [f] = run(fx.WITH_RECOVERY).findings.filter((x) => x.function === 'transferOwnership');
    expect(f.severity).toBe('low');
    expect(f.details).toMatchObject({ recoveryPath: true, zeroAddressChecked: true });
  });

  it('flags removal of the last administrator through custom admin mappings', () => {
    const findings = run(fx.LAST_ADMIN_REMOVAL).findings;
    expect(findings.map((f) => [f.kind, f.function])).toEqual([
      ['last-admin-removable', 'removeAdmin'],
      ['last-admin-renounceable', 'renounceAdmin'],
    ]);
  });

  it('accepts admin removal protected by a counter and a self-removal check', () => {
    expect(run(fx.LAST_ADMIN_SAFE).findings).toEqual([]);
  });

  it('flags inherited Ownable renounce and single-step transfer', () => {
    expect(kinds(fx.INHERITED_OWNABLE).sort()).toEqual(['ownership-renounce-lockout', 'single-step-owner-transfer']);
  });

  it('accepts Ownable2Step with renounce disabled', () => {
    expect(run(fx.INHERITED_OWNABLE2STEP_RENOUNCE_DISABLED).findings).toEqual([]);
  });

  it('reports inherited AccessControl last-admin removal at low severity, not DefaultAdminRules', () => {
    const [f] = run(fx.INHERITED_ACCESS_CONTROL).findings;
    expect(f.kind).toBe('last-admin-removable');
    expect(f.severity).toBe('low');
    expect(run(fx.INHERITED_DEFAULT_ADMIN_RULES).findings).toEqual([]);
  });

  it('resolves bases across files and normalizes findings', () => {
    const files = [
      { path: 'Base.sol', content: 'contract Base { address public owner; modifier onlyOwner() { require(msg.sender == owner); _; } function transferOwnership(address n) external onlyOwner { owner = n; } }' },
      { path: 'Vault.sol', content: 'contract Vault is Base { function withdraw() external onlyOwner { } }' },
    ];
    const r = run(files);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].file).toBe('Base.sol');
    const [n] = toNormalizedFindings(r, { file: 'x.sol', docsSlug: 'solidity-authorization' });
    expect(n.suggestedFix!.documentationUrl).toBe('https://docs.gasguard.dev/rules/solidity-authorization');
    expect(n.metadata).toMatchObject({ kind: 'single-step-owner-transfer', confidence: 'high' });
  });

  it('never throws on malformed input', () => {
    for (const bad of [undefined, null, 3, '', 'not solidity', [], [{ path: 'a', content: 1 }]]) expect(run(bad as never).findings).toEqual([]);
  });
});
