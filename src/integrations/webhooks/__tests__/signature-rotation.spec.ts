import {
  WebhookSignatureRotation,
  DEFAULT_ROTATION_GRACE_MS,
} from '../signature-rotation';

describe('WebhookSignatureRotation', () => {
  const secretA = 'a'.repeat(32);
  const secretB = 'b'.repeat(32);
  const body = JSON.stringify({ event: 'scan.completed' });
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
  });

  it('signs and verifies with the current secret', () => {
    const rotation = new WebhookSignatureRotation(secretA, { now });
    const sig = rotation.sign(body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(rotation.verify(body, sig)).toEqual({ valid: true, matched: 'current' });
  });

  it('rejects a tampered body', () => {
    const rotation = new WebhookSignatureRotation(secretA, { now });
    expect(rotation.verify(body + ' ', rotation.sign(body))).toEqual({
      valid: false,
      reason: 'mismatch',
    });
  });

  it('signs with the new secret after rotation', () => {
    const rotation = new WebhookSignatureRotation(secretA, { now });
    const oldSig = rotation.sign(body);
    rotation.rotate(secretB);
    expect(rotation.sign(body)).not.toBe(oldSig);
    expect(rotation.verify(body, rotation.sign(body)).matched).toBe('current');
  });

  it('accepts the previous secret during the grace window', () => {
    const rotation = new WebhookSignatureRotation(secretA, { now, graceMs: 1000 });
    const oldSig = rotation.sign(body);
    const { previousExpiresAt } = rotation.rotate(secretB);
    expect(previousExpiresAt).toBe(clock + 1000);

    clock += 999;
    expect(rotation.verify(body, oldSig)).toEqual({ valid: true, matched: 'previous' });
    expect(rotation.getStatus()).toEqual({ hasPrevious: true, previousExpiresAt });
  });

  it('rejects the previous secret at and after the grace boundary', () => {
    const rotation = new WebhookSignatureRotation(secretA, { now, graceMs: 1000 });
    const oldSig = rotation.sign(body);
    rotation.rotate(secretB);

    clock += 1000;
    expect(rotation.verify(body, oldSig)).toEqual({ valid: false, reason: 'mismatch' });
    expect(rotation.getStatus()).toEqual({ hasPrevious: false });
  });

  it('only keeps one previous secret', () => {
    const rotation = new WebhookSignatureRotation(secretA, { now });
    const sigA = rotation.sign(body);
    rotation.rotate(secretB);
    rotation.rotate('c'.repeat(32));
    expect(rotation.verify(body, sigA).valid).toBe(false);
  });

  it('generates a secret when none is supplied', () => {
    const rotation = new WebhookSignatureRotation(secretA, { now });
    const { secret } = rotation.rotate();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses a 24h grace window by default', () => {
    const rotation = new WebhookSignatureRotation(secretA, { now });
    expect(rotation.rotate(secretB).previousExpiresAt).toBe(clock + DEFAULT_ROTATION_GRACE_MS);
  });

  it('flags malformed signatures', () => {
    const rotation = new WebhookSignatureRotation(secretA, { now });
    const bad = ['', 'sha256=', 'sha256=zz', 'md5=' + 'a'.repeat(64), 'a'.repeat(64)];
    for (const signature of bad) {
      expect(rotation.verify(body, signature)).toEqual({ valid: false, reason: 'malformed' });
    }
    expect(rotation.verify(body, undefined as any).reason).toBe('malformed');
  });

  it('rejects invalid secrets and options', () => {
    expect(() => new WebhookSignatureRotation('short')).toThrow(/at least 16/);
    expect(() => new WebhookSignatureRotation(secretA, { graceMs: -1 })).toThrow(/graceMs/);
    const rotation = new WebhookSignatureRotation(secretA, { now });
    expect(() => rotation.rotate('short')).toThrow(/at least 16/);
    expect(() => rotation.rotate(secretA)).toThrow(/differ/);
  });

  it('does not change state when rotation fails', () => {
    const rotation = new WebhookSignatureRotation(secretA, { now });
    const sig = rotation.sign(body);
    expect(() => rotation.rotate('short')).toThrow();
    expect(rotation.sign(body)).toBe(sig);
    expect(rotation.getStatus()).toEqual({ hasPrevious: false });
  });
});
