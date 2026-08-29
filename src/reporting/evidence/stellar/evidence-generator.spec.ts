import * as fs from 'fs';
import * as path from 'path';
import { SorobanEvidenceGenerator } from './evidence-generator';
import { Severity } from '@engine/core';

describe('SorobanEvidenceGenerator', () => {
  const tempFile = path.join(__dirname, 'dummy-contract.rs');
  const exportPath = path.join(__dirname, 'test-output', 'evidence.json');

  beforeAll(() => {
    fs.writeFileSync(tempFile, `fn main() {\n    let x = 1;\n    let y = 2;\n    // unsafe operation\n    let z = x + y;\n    return z;\n}\n`, 'utf8');
  });

  afterAll(() => {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    if (fs.existsSync(exportPath)) fs.unlinkSync(exportPath);
    if (fs.existsSync(path.dirname(exportPath))) fs.rmdirSync(path.dirname(exportPath));
  });

  it('should generate evidence with code snippets', () => {
    const generator = new SorobanEvidenceGenerator({ contextLines: 1 });
    const findings = [
      {
        ruleId: 'SOR-001',
        severity: Severity.HIGH,
        message: 'Unsafe operation detected',
        location: {
          file: tempFile,
          startLine: 4,
          endLine: 4
        }
      }
    ];

    const evidence = generator.generateEvidence(findings);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].ruleId).toBe('SOR-001');
    expect(evidence[0].codeSnippet).toBeDefined();
    expect(evidence[0].codeSnippet?.startLine).toBe(3);
    expect(evidence[0].codeSnippet?.endLine).toBe(5);
  });

  it('should export evidence to a JSON file', () => {
    const generator = new SorobanEvidenceGenerator({ contextLines: 1 });
    const findings = [
      {
        ruleId: 'SOR-001',
        severity: Severity.HIGH,
        message: 'Unsafe operation detected',
        location: {
          file: tempFile,
          startLine: 4,
          endLine: 4
        }
      }
    ];

    generator.generateAndExportEvidence(findings, exportPath);
    expect(fs.existsSync(exportPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].ruleId).toBe('SOR-001');
  });
});
