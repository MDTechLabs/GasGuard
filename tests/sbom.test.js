const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('SBOM Generation', () => {
  let tempDir;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbom-test-'));
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('generate-sbom.sh generates valid SPDX and CycloneDX files', () => {
    const scriptPath = path.resolve(__dirname, '../scripts/generate-sbom.sh');
    execSync(`bash "${scriptPath}" "${tempDir}"`, { stdio: 'pipe' });

    const nodeSbomPath = path.join(tempDir, 'gasguard-node-sbom.spdx.json');
    const rustSbomPath = path.join(tempDir, 'gasguard-rust-sbom.spdx.json');
    const cycloneDxPath = path.join(tempDir, 'gasguard-sbom.cyclonedx.json');

    expect(fs.existsSync(nodeSbomPath)).toBe(true);
    expect(fs.existsSync(rustSbomPath)).toBe(true);
    expect(fs.existsSync(cycloneDxPath)).toBe(true);

    const nodeSbom = JSON.parse(fs.readFileSync(nodeSbomPath, 'utf8'));
    expect(nodeSbom.spdxVersion).toBe('SPDX-2.3');
    expect(nodeSbom.name).toBe('GasGuard-NodeJS-Workspace');
    expect(nodeSbom.packages.length).toBeGreaterThan(0);

    const rustSbom = JSON.parse(fs.readFileSync(rustSbomPath, 'utf8'));
    expect(rustSbom.spdxVersion).toBe('SPDX-2.3');
    expect(rustSbom.name).toBe('GasGuard-Rust-Engine');

    const cycloneDx = JSON.parse(fs.readFileSync(cycloneDxPath, 'utf8'));
    expect(cycloneDx.bomFormat).toBe('CycloneDX');
    expect(cycloneDx.specVersion).toBe('1.5');
  });
});
