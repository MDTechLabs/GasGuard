import { assessReadiness } from '../../../../analyzers/soroban/readiness/deployment-readiness-analyzer';
import { renderReadinessJson, renderReadinessMarkdown } from '../readiness-reporter';

describe('SorobanReadinessReporter (#931)', () => {
  const result = assessReadiness({
    resourceMetrics: { wasmSizeBytes: 40 * 1024, wasmSizeLimitBytes: 64 * 1024 },
    deploymentConfig: { network: 'mainnet', hasReleaseProfile: true, hasDeploymentConfig: true },
    securityStatus: { criticalFindings: 0 },
  });

  it('renders a markdown report that captures the status and checks', () => {
    const md = renderReadinessMarkdown(result);
    expect(md).toContain('# Soroban Deployment Readiness Report');
    expect(md).toContain('`PASS`');
    expect(md).toContain('| resources |');
    expect(md).toContain('| deployment |');
    expect(md).toContain('| security |');
    expect(md).toContain('Ready for deployment');
  });

  it('serializes a stable JSON representation', () => {
    const json = renderReadinessJson(result);
    const parsed = JSON.parse(json);
    expect(parsed.status).toBe('pass');
    expect(parsed.checks).toHaveLength(3);
    expect(parsed.passedChecks).toBe(3);
    expect(parsed.summary).toBeTruthy();
  });

  it('reflects a failing assessment in both renderers', () => {
    const failed = assessReadiness({
      resourceMetrics: { wasmSizeBytes: 300 * 1024, wasmSizeLimitBytes: 64 * 1024 },
      deploymentConfig: { network: 'mainnet', hasReleaseProfile: true, hasDeploymentConfig: true },
      securityStatus: { criticalFindings: 1 },
    });
    expect(renderReadinessMarkdown(failed)).toContain('`FAIL`');
    expect(renderReadinessMarkdown(failed)).toContain('Not ready');
    expect(JSON.parse(renderReadinessJson(failed)).status).toBe('fail');
  });
});