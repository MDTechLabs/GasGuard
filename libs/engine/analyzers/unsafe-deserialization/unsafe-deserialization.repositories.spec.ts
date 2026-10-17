import * as fs from 'fs';
import * as path from 'path';
import { UnsafeDeserializationAnalyzer, UNSAFE_DESERIALIZATION_RULES } from './unsafe-deserialization-analyzer';

describe('UnsafeDeserializationAnalyzer - Repository Fixtures', () => {
  const analyzer = new UnsafeDeserializationAnalyzer();
  const fixturesDir = path.resolve(__dirname, '../../../../tests/fixtures/unsafe-deserialization');

  it('detects multiple deserialization vulnerabilities in vulnerable-app', async () => {
    const filePath = path.join(fixturesDir, 'vulnerable-app/src/handlers/profile.js');
    const content = fs.readFileSync(filePath, 'utf8');
    const result = await analyzer.analyze(content, 'vulnerable-app/src/handlers/profile.js');

    expect(result.findings).toHaveLength(2);
    expect(result.findings.map(f => f.ruleId).sort()).toEqual([
      UNSAFE_DESERIALIZATION_RULES.NODE_SERIALIZE,
      UNSAFE_DESERIALIZATION_RULES.UNSAFE_YAML,
    ].sort());
  });

  it('produces zero findings for safe-app', async () => {
    const filePath = path.join(fixturesDir, 'safe-app/src/handlers/profile.js');
    const content = fs.readFileSync(filePath, 'utf8');
    const result = await analyzer.analyze(content, 'safe-app/src/handlers/profile.js');

    expect(result.findings).toHaveLength(0);
  });

  it('detects pickle and unconstrained yaml findings in regression-app', async () => {
    const filePath = path.join(fixturesDir, 'regression-app/src/service.py');
    const content = fs.readFileSync(filePath, 'utf8');
    const result = await analyzer.analyze(content, 'regression-app/src/service.py');

    expect(result.findings).toHaveLength(2);
    expect(result.findings.map(f => f.ruleId).sort()).toEqual([
      UNSAFE_DESERIALIZATION_RULES.PYTHON_PICKLE,
      UNSAFE_DESERIALIZATION_RULES.UNSAFE_YAML,
    ].sort());
  });
});
