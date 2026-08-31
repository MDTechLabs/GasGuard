import {
  detectDeploymentConfigurationFindings,
  analyzeSorobanDeploymentConfig,
} from '../src/deployment/deployment-config-rule';

describe('Soroban Deployment Configuration Rules (#927)', () => {
  const VALID = `
network = "mainnet"
rpc_url = "https://rpc.stellar.org"
owner = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
wasm_hash = "b9f0b8cbe0b79bca"
`;

  const BROKEN = `
network = "rinkeby"
owner = "bob"
max_fee = "lots"
unknown_option = true
`;

  test('detectDeploymentConfigurationFindings passes a valid config', () => {
    const findings = detectDeploymentConfigurationFindings(VALID);
    expect(findings).toHaveLength(0);
  });

  test('detectDeploymentConfigurationFindings flags invalid settings and gaps', () => {
    const findings = detectDeploymentConfigurationFindings(BROKEN);
    const network = findings.find((f) => f.key === 'network');
    expect(network).toBeDefined();
    expect(network?.ruleId).toBe('soroban-deployment-config');
    expect(network?.severity).toBe('high');

    const maxFee = findings.find((f) => f.key === 'max_fee');
    expect(maxFee?.severity).toBe('medium');

    const rpcMissing = findings.find((f) => f.key === 'rpc_url' && f.title.includes('Missing'));
    expect(rpcMissing).toBeDefined();

    const unknown = findings.find((f) => f.key === 'unknown_option');
    expect(unknown).toBeDefined();
    expect(unknown?.severity).toBe('low');
  });

  test('analyzeSorobanDeploymentConfig reports parsed settings and validity', () => {
    const report = analyzeSorobanDeploymentConfig(VALID);
    expect(report.valid).toBe(true);
    expect(report.network).toBe('mainnet');
    expect(report.rpcUrl).toBe('https://rpc.stellar.org');
  });
});