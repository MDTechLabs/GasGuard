import { detectMissingRemoteSenderAuth } from '../detect-remote-sender-authentication';
import * as fx from './remote-sender.fixtures';

const run = (src: string, opts?: Parameters<typeof detectMissingRemoteSenderAuth>[1]) =>
  detectMissingRemoteSenderAuth(src, opts).findings;

describe('detectMissingRemoteSenderAuth', () => {
  it('flags a receiver that authenticates neither identity as critical', () => {
    const [f] = run(fx.NO_AUTHENTICATION);
    expect(f.ruleId).toBe('GG-XCHAIN-SENDER-001');
    expect(f.kind).toBe('unauthenticated-receiver');
    expect(f.severity).toBe('critical');
    expect(f.confidence).toBe('high');
    expect(f.function).toBe('receiveMessage');
    expect(f.details!.untrustedPath).toMatch(/^any caller → receiveMessage\(\)/);
    expect(f.details!.affectedOperations).toEqual([
      expect.objectContaining({ kind: 'state-write', text: 'balances[to] += amount' }),
    ]);
  });

  it('detects a check of only the endpoint', () => {
    const findings = run(fx.ENDPOINT_ONLY);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('remote-sender-unchecked');
    expect(findings[0].severity).toBe('high');
    expect(findings[0].details).toMatchObject({ endpointAuthenticated: true, remoteSenderChecked: false });
  });

  it('detects a check of only the remote sender', () => {
    const findings = run(fx.REMOTE_ONLY);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('endpoint-unauthenticated');
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].details).toMatchObject({ endpointAuthenticated: false, remoteSenderChecked: true });
  });

  it('accepts receivers that check both identities', () => {
    expect(run(fx.SAFE_BOTH_INLINE)).toEqual([]);
    expect(run(fx.SAFE_MODIFIER_AND_ORIGIN)).toEqual([]);
    expect(run(fx.SAFE_NATIVE_MESSENGER)).toEqual([]);
  });

  it('supports configurable endpoint names without trusting unknown names by default', () => {
    expect(run(fx.CUSTOM_ENDPOINT_NAME).map((f) => f.kind)).toEqual(['endpoint-unauthenticated']);
    expect(run(fx.CUSTOM_ENDPOINT_NAME, { endpointNames: ['hub'] })).toEqual([]);
  });

  it('notes (but does not verify) framework base authentication', () => {
    const [note] = run(fx.FRAMEWORK_HOOK);
    expect(note.kind).toBe('framework-authentication-assumed');
    expect(note.severity).toBe('low');
    expect(note.details).toMatchObject({ frameworkBase: 'OApp', assumed: true });
  });

  it('analyzes the hook directly when framework assumptions are disabled', () => {
    const findings = run(fx.FRAMEWORK_HOOK, { assumeFrameworkBases: false });
    expect(findings.map((f) => f.kind)).toEqual(['unauthenticated-receiver']);
  });

  it('ignores receivers without state or value effects', () => {
    expect(run(fx.NO_EFFECTS)).toEqual([]);
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [undefined, {}, '   ', 'receive() external payable {}']) {
      const r = detectMissingRemoteSenderAuth(bad);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('keeps analyzing truncated source and records a diagnostic', () => {
    const truncated = fx.NO_AUTHENTICATION.slice(0, fx.NO_AUTHENTICATION.lastIndexOf('balances[to]') + 22);
    const r = detectMissingRemoteSenderAuth(truncated);
    expect(r.analyzed).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toContain('unbalanced-delimiters');
    expect(r.findings).toHaveLength(1);
  });
});
