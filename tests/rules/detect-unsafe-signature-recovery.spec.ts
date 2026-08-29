import { detectUnsafeSignatureRecovery } from '../../rules/security/signatures/detect-unsafe-signature-recovery';

describe('detectUnsafeSignatureRecovery', () => {
  it('flags raw ecrecover usage', () => {
    const code = `address signer = ecrecover(hash, v, r, s);`;
    const result = detectUnsafeSignatureRecovery(code);
    expect(result.detected).toBe(true);
    expect(result.violations.some(v => v.type === 'ecrecover-usage')).toBe(true);
  });

  it('flags unchecked ecrecover result', () => {
    const code = `address recovered = ecrecover(hash, v, r, s);`;
    const result = detectUnsafeSignatureRecovery(code);
    expect(result.detected).toBe(true);
  });

  it('returns clean for proper ECDSA usage', () => {
    const code = `address signer = ECDSA.recover(hash, signature);`;
    const result = detectUnsafeSignatureRecovery(code);
    expect(result.detected).toBe(false);
  });
});
