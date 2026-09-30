import { PolicyVersioningService } from '../versioning.service';

describe('Policy Versioning & Pinning Service (#1066)', () => {
  const policyId = 'POL_GAS_STANDARD';

  beforeAll(() => {
    // Register v1.0.0 (stricter limit)
    PolicyVersioningService.registerPolicyVersion(policyId, '1.0.0', {
      maxGasLimit: 1000000,
      allowlistEnabled: true,
    });

    // Register v2.0.0 (higher limit)
    PolicyVersioningService.registerPolicyVersion(policyId, '2.0.0', {
      maxGasLimit: 5000000,
      allowlistEnabled: true,
    });
  });

  it('evaluates against pinned version v1.0.0 correctly', () => {
    // 2,000,000 gas would pass v2.0.0, but should fail pinned v1.0.0
    const result = PolicyVersioningService.evaluatePolicy(
      policyId,
      { gasLimit: 2000000 },
      '1.0.0'
    );

    expect(result.compliant).toBe(false);
    expect(result.versionUsed).toBe('1.0.0');
  });

  it('evaluates against pinned version v2.0.0 successfully', () => {
    const result = PolicyVersioningService.evaluatePolicy(
      policyId,
      { gasLimit: 2000000 },
      '2.0.0'
    );

    expect(result.compliant).toBe(true);
    expect(result.versionUsed).toBe('2.0.0');
  });

  it('falls back to latest version when version is omitted', () => {
    const result = PolicyVersioningService.evaluatePolicy(
      policyId,
      { gasLimit: 4000000 }
      // no version pinned -> defaults to latest (2.0.0)
    );

    expect(result.compliant).toBe(true);
    expect(result.versionUsed).toBe('2.0.0');
  });

  it('throws an error for non-existent pinned versions', () => {
    expect(() => {
      PolicyVersioningService.evaluatePolicy(policyId, { gasLimit: 1000 }, '9.9.9');
    }).toThrow(`Policy ${policyId} version 9.9.9 not found`);
  });
});