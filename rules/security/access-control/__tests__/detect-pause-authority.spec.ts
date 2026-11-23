import { detectPauseAuthority, RULE_ID } from '../detect-pause-authority';
import { toNormalizedFindings } from '../../lib/normalize';
import * as fx from './pause-authority.fixtures';

const POLICY = { pauseAuthorities: ['PAUSER_ROLE'], unpauseAuthorities: ['UNPAUSER_ROLE'] };
const run = (src: Parameters<typeof detectPauseAuthority>[0], opts?: Parameters<typeof detectPauseAuthority>[1]) => detectPauseAuthority(src, opts);
const kinds = (src: Parameters<typeof detectPauseAuthority>[0], opts?: Parameters<typeof detectPauseAuthority>[1]) => run(src, opts).findings.map((f) => f.kind);

describe('detectPauseAuthority', () => {
  it('flags an unrestricted unpause as critical without needing a policy', () => {
    const [f] = run(fx.UNPAUSE_OPEN).findings;
    expect(f.ruleId).toBe(RULE_ID);
    expect(f.kind).toBe('unpause-unrestricted');
    expect(f.severity).toBe('critical');
    expect(f.function).toBe('unpause');
  });

  it('flags an unrestricted pause as high', () => {
    expect(kinds(fx.PAUSE_OPEN)).toEqual(['pause-unrestricted']);
  });

  it('accepts separated pause and unpause roles that match the policy', () => {
    expect(run(fx.SEPARATED_SAFE, { policy: { ...POLICY, requireSeparation: true } }).findings).toEqual([]);
  });

  it('flags unpause granted more broadly than the documented policy', () => {
    const [f] = run(fx.UNPAUSE_BROADER, { policy: POLICY }).findings;
    expect(f.kind).toBe('unpause-broader-than-policy');
    expect(f.severity).toBe('high');
    expect(f.details).toMatchObject({ unexpected: ['PAUSER_ROLE'] });
    // Without a documented policy there is nothing to compare with.
    expect(run(fx.UNPAUSE_BROADER).findings).toEqual([]);
  });

  it('flags a pause-only authority that administers the unpause role', () => {
    expect(kinds(fx.UNPAUSE_ROLE_ADMIN_BROAD, { policy: POLICY })).toEqual(['unpause-role-admin-broad']);
  });

  it('resolves and explains the role graph', () => {
    const r = run(fx.UNPAUSE_ROLE_ADMIN_BROAD, { policy: POLICY });
    expect(r.notes).toEqual(expect.arrayContaining([
      expect.stringContaining('UNPAUSER_ROLE: admin PAUSER_ROLE; holders msg.sender (Vault constructor)'),
      expect.stringContaining('unpause() requires UNPAUSER_ROLE'),
    ]));
    expect(r.findings[0].details!.roleGraph).toMatchObject({ admins: { UNPAUSER_ROLE: 'PAUSER_ROLE' } });
  });

  it('flags emergency authority that nobody can ever hold', () => {
    expect(kinds(fx.PAUSE_AUTHORITY_LOST).sort()).toEqual(['pause-authority-lost', 'unpause-authority-lost']);
  });

  it('reports an ungranted role as low when its admin can grant it', () => {
    const [f] = run(fx.UNPAUSE_UNASSIGNED).findings;
    expect(f.kind).toBe('unpause-authority-unassigned');
    expect(f.severity).toBe('low');
  });

  it('flags a missing pause only when the policy requires it', () => {
    expect(run(fx.NO_PAUSE).findings).toEqual([]);
    const [f] = run(fx.NO_PAUSE, { policy: { requirePause: true } }).findings;
    expect(f.kind).toBe('missing-emergency-pause');
    expect(f.severity).toBe('medium');
  });

  it('reports shared pause/unpause authority only when separation is required', () => {
    expect(run(fx.NOT_SEPARATED).findings).toEqual([]);
    const [f] = run(fx.NOT_SEPARATED, { policy: { requireSeparation: true } }).findings;
    expect(f.kind).toBe('pause-unpause-not-separated');
    expect(f.details).toMatchObject({ shared: ['PAUSER_ROLE'] });
  });

  it('normalizes findings into the analyzer finding schema', () => {
    const [n] = toNormalizedFindings(run(fx.UNPAUSE_OPEN), { file: 'Vault.sol', docsSlug: 'solidity-authorization' });
    expect(n.severity).toBe('critical');
    expect(n.metadata).toMatchObject({ kind: 'unpause-unrestricted', confidence: 'high' });
    expect(n.metadata!.limitations.length).toBeGreaterThan(0);
  });

  it('never throws on malformed input', () => {
    for (const bad of [undefined, null, 1, '', 'nope', [], [{ path: 'a', content: 2 }]]) expect(run(bad as never).findings).toEqual([]);
  });
});
