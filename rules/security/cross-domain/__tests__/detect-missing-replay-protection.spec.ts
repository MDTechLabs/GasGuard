import { detectMissingReplayProtection } from '../detect-missing-replay-protection';
import * as fx from './replay-protection.fixtures';

const kinds = (src: string, opts?: Parameters<typeof detectMissingReplayProtection>[1]) =>
  detectMissingReplayProtection(src, opts).findings.map((f) => f.kind);

describe('detectMissingReplayProtection', () => {
  it('flags a handler that never records consumed messages (duplicate delivery)', () => {
    const r = detectMissingReplayProtection(fx.DUPLICATE_DELIVERY);
    expect(r.analyzed).toBe(true);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f.ruleId).toBe('GG-XCHAIN-REPLAY-001');
    expect(f.kind).toBe('missing-replay-protection');
    expect(f.severity).toBe('high');
    expect(f.confidence).toBe('high');
    expect(f.function).toBe('executeMessage');
    expect(f.contract).toBe('Bridge');
    expect(f.confidenceEvidence.join(' ')).toMatch(/messageId/);
    expect(f.remediation).toMatch(/keccak256\(abi\.encode\(sourceDomain, remoteSender, messageId\)\)/);
  });

  it('flags a nonce-only replay key for cross-domain replay', () => {
    const r = detectMissingReplayProtection(fx.CROSS_DOMAIN_REPLAY);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].kind).toBe('replay-scope-incomplete');
    expect(r.findings[0].severity).toBe('high');
    expect(r.findings[0].details).toMatchObject({ mapping: 'processed', missing: ['source domain', 'remote sender'] });
  });

  it('reports only the missing component when the key covers the source chain', () => {
    const r = detectMissingReplayProtection(fx.MISSING_SENDER_IN_KEY);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].details).toMatchObject({ missing: ['remote sender'] });
  });

  it('accepts a hashed key covering domain, sender and nonce', () => {
    expect(kinds(fx.SAFE_HASHED_KEY)).toEqual([]);
  });

  it('accepts a nested mapping covering domain, sender and nonce', () => {
    expect(kinds(fx.SAFE_NESTED_MAPPING)).toEqual([]);
  });

  it('follows one level of same-file internal helpers', () => {
    expect(kinds(fx.SAFE_VIA_HELPER)).toEqual([]);
  });

  it('distinguishes transport-level replay protection from application-level checks', () => {
    const r = detectMissingReplayProtection(fx.TRANSPORT_GUARANTEED);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].kind).toBe('relies-on-transport-replay-protection');
    expect(r.findings[0].severity).toBe('low');
    expect(r.findings[0].details).toMatchObject({ transportGuaranteed: true });
  });

  it('treats an unauthenticated framework receiver as unprotected, not transport-guaranteed', () => {
    const unauthenticated = fx.TRANSPORT_GUARANTEED.replace('require(msg.sender == endpoint, "only endpoint");', '');
    expect(kinds(unauthenticated)).toEqual(['missing-replay-protection']);
  });

  it('flags a consumed-message record that is written but never checked', () => {
    expect(kinds(fx.WRITE_WITHOUT_CHECK)).toEqual(['consumed-state-not-checked']);
  });

  it('honours custom receiver names and ignores non-handlers', () => {
    expect(kinds(fx.NOT_A_HANDLER)).toEqual([]);
    const custom = fx.DUPLICATE_DELIVERY.replace('executeMessage', 'pullIn');
    expect(kinds(custom)).toEqual([]);
    expect(kinds(custom, { receiverNames: ['pullIn'] })).toEqual(['missing-replay-protection']);
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [null, 12, '', 'function f() {}']) {
      const r = detectMissingReplayProtection(bad);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.diagnostics[0].level).toBe('error');
    }
  });

  it('keeps analyzing truncated source and records a diagnostic', () => {
    const truncated = fx.DUPLICATE_DELIVERY.slice(0, fx.DUPLICATE_DELIVERY.lastIndexOf('}') - 2);
    const r = detectMissingReplayProtection(truncated);
    expect(r.analyzed).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toContain('unbalanced-delimiters');
  });
});
