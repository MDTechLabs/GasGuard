import {
  assessReadiness,
  ReadinessResult,
} from '../deployment-readiness-analyzer';

describe('SorobanDeploymentReadinessAnalyzer (#931)', () => {
  const passing = (): ReadinessResult =>
    assessReadiness({
      resourceMetrics: {
        wasmSizeBytes: 40 * 1024,
        wasmSizeLimitBytes: 64 * 1024,
        memoryPages: 1,
        memoryPageLimit: 4,
      },
      deploymentConfig: {
        network: 'mainnet',
        hasReleaseProfile: true,
        productionBuild: true,
        hasDeploymentConfig: true,
      },
      securityStatus: { criticalFindings: 0 },
    });

  it('returns a pass status when everything is healthy', () => {
    const result = passing();
    expect(result.status).toBe('pass');
    expect(result.checks).toHaveLength(3);
    expect(result.passedChecks).toBe(3);
  });

  it('fails when resource thresholds are exceeded', () => {
    const result = assessReadiness({
      resourceMetrics: {
        wasmSizeBytes: 200 * 1024,
        wasmSizeLimitBytes: 64 * 1024,
      },
      deploymentConfig: { network: 'mainnet', hasReleaseProfile: true, hasDeploymentConfig: true },
      securityStatus: { criticalFindings: 0 },
    });
    expect(result.status).toBe('fail');
    expect(result.checks.find((c) => c.name === 'resources')?.status).toBe('fail');
    expect(result.summary).toContain('Not ready');
  });

  it('fails when critical (high) findings remain', () => {
    const result = assessReadiness({
      resourceMetrics: {
        wasmSizeBytes: 40 * 1024,
        wasmSizeLimitBytes: 64 * 1024,
      },
      deploymentConfig: { network: 'mainnet', hasReleaseProfile: true, hasDeploymentConfig: true },
      securityStatus: { criticalFindings: 2 },
    });
    expect(result.checks.find((c) => c.name === 'security')?.status).toBe('fail');
    expect(result.status).toBe('fail');
    expect(result.criticalFindings).toBe(2);
  });

  it('derives critical findings from the aggregated findings list', () => {
    const result = assessReadiness({
      findings: [
        { id: 'x', category: 'security', severity: 'high', message: 'unsafe unwrap' },
        { id: 'y', category: 'resource', severity: 'low', message: 'minor clone' },
      ],
      deploymentConfig: { network: 'testnet', hasReleaseProfile: true, hasDeploymentConfig: true },
    });
    expect(result.criticalFindings).toBe(1);
    expect(result.checks.find((c) => c.name === 'security')?.status).toBe('fail');
  });

  it('returns warn for a non-production network', () => {
    const result = assessReadiness({
      resourceMetrics: {
        wasmSizeBytes: 40 * 1024,
        wasmSizeLimitBytes: 64 * 1024,
      },
      deploymentConfig: { network: 'testnet', hasReleaseProfile: true, hasDeploymentConfig: true },
      securityStatus: { criticalFindings: 0 },
    });
    expect(result.status).toBe('warn');
    expect(result.checks.find((c) => c.name === 'deployment')?.status).toBe('warn');
    expect(result.summary).toContain('Conditionally ready');
  });

  it('fails cleanly when the debug configuration is present', () => {
    const result = assessReadiness({
      deploymentConfig: { network: 'mainnet', hasReleaseProfile: true, hasDeploymentConfig: true },
      securityStatus: { criticalFindings: 0, debugConfigPresent: true },
    });
    expect(result.checks.find((c) => c.name === 'security')?.status).toBe('warn');
    expect(result.status).toBe('warn');
  });

  it('evaluates the security check independently', () => {
    const result = passing();
    const security = result.checks.find((c) => c.name === 'security');
    expect(security).toBeDefined();
    expect(security?.status).toBe('pass');
  });
});