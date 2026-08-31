import {
  analyzeDeploymentConfig,
  detectDeploymentConfigFindings,
} from '../deployment-config-analyzer';

const VALID_MAINNET = `
network = "mainnet"
rpc_url = "https://rpc.stellar.org"
owner = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
wasm_hash = "b9f0b8cbe0b79bca"
fee = 100
`;

const MISSING_REQUIRED = `
[deploy]
rpc_url = "https://rpc.stellar.org"
owner = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
`;

const INVALID_SETTINGS = `
network = "not-a-real-network"
rpc_url = "localhost:8000"
owner = "bob"
wasm_hash = "0x1234"
fee_bump = 500
max_fee = "lots"
`;

const TESTNET_FRAGMENT = `
network = "testnet"
wasm = "target/wasm32-unknown-unknown/release/contract.wasm"
`;

describe('SorobanDeploymentConfigAnalyzer (#927)', () => {
  it('parses settings from a flat deployment configuration', () => {
    const report = analyzeDeploymentConfig(VALID_MAINNET);
    const keys = report.parsedSettings.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining(['network', 'rpc_url', 'owner', 'wasm_hash', 'fee']),
    );
    expect(report.network).toBe('mainnet');
    expect(report.rpcUrl).toBe('https://rpc.stellar.org');
    expect(report.owner).toBe('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  });

  it('passes a complete, valid production configuration', () => {
    const report = analyzeDeploymentConfig(VALID_MAINNET);
    expect(report.valid).toBe(true);
    expect(report.findings).toHaveLength(0);
    expect(report.missingRequired).toHaveLength(0);
  });

  it('detects missing network, rpc_url and owner', () => {
    const report = analyzeDeploymentConfig(MISSING_REQUIRED);
    expect(report.valid).toBe(false);
    expect(report.network).toBeUndefined();
    // network is missing -> critical; owner missing here but no production target.
    const missingKey = report.findings
      .filter((f) => f.title.startsWith('Missing deployment configuration:'))
      .map((f) => f.key);
    expect(missingKey).toEqual(expect.arrayContaining(['network', 'owner']));
    const networkFinding = report.findings.find((f) => f.key === 'network');
    expect(networkFinding?.severity).toBe('critical');
  });

  it('flags unsupported keys and invalid values', () => {
    const report = analyzeDeploymentConfig(INVALID_SETTINGS);
    const unsupported = report.findings.find((f) => f.key === 'fee_bump');
    expect(unsupported).toBeDefined();
    expect(unsupported?.severity).toBe('low');
    expect(unsupported?.title).toBe('Unsupported deployment setting');

    const badNetwork = report.findings.find((f) => f.key === 'network');
    expect(badNetwork?.severity).toBe('high');

    const badRpc = report.findings.find((f) => f.key === 'rpc_url');
    expect(badRpc?.severity).toBe('high');

    const badFee = report.findings.find((f) => f.key === 'max_fee');
    expect(badFee?.severity).toBe('medium');

    const badOwner = report.findings.find((f) => f.key === 'owner');
    expect(badOwner?.severity).toBe('medium');
    expect(report.valid).toBe(false);
  });

  it('accepts non-production fragments without a production owner requirement', () => {
    const report = analyzeDeploymentConfig(TESTNET_FRAGMENT);
    const hasConfigFindings = report.findings.filter((f) => f.key === 'owner');
    // Owner missing on testnet is only 'low', not blocking.
    const ownerFinding = hasConfigFindings.find((f) => f.title.includes('owner'));
    expect(ownerFinding).toBeDefined();
    expect(['low', 'medium']).toContain(ownerFinding?.severity);
    // An artifact (wasm) is declared, so no "no deploy artifact" info finding.
    expect(report.findings.some((f) => f.title === 'No deploy artifact specified')).toBe(false);
  });

  it('exposes the findings via the convenience wrapper', () => {
    const findings = detectDeploymentConfigFindings(MISSING_REQUIRED);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].ruleId).toBe('soroban-deployment-config');
  });
});