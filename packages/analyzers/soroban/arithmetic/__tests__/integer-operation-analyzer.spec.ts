import { analyzeIntegerOperations } from '../integer-operation-analyzer';

describe('analyzeIntegerOperations', () => {
  it('returns no findings for clean arithmetic', () => {
    const source = `let result = amount.checked_add(fee).unwrap();`;
    const report = analyzeIntegerOperations(source);
    expect(report.findings.filter(f => f.patternId !== 'checked-vs-wrapping')).toHaveLength(0);
  });

  it('detects multiplication by 1', () => {
    const source = `let x = amount * 1;`;
    const report = analyzeIntegerOperations(source);
    expect(report.findings.some((f) => f.patternId === 'multiply-by-one')).toBe(true);
  });

  it('detects addition of 0', () => {
    const source = `let y = balance + 0;`;
    const report = analyzeIntegerOperations(source);
    expect(report.findings.some((f) => f.patternId === 'add-zero')).toBe(true);
  });

  it('detects power-of-two multiplication', () => {
    const source = `let scaled = value * 8;`;
    const report = analyzeIntegerOperations(source);
    expect(report.findings.some((f) => f.patternId === 'power-of-two-multiply')).toBe(true);
  });

  it('detects power-of-two division', () => {
    const source = `let half = total / 4;`;
    const report = analyzeIntegerOperations(source);
    expect(report.findings.some((f) => f.patternId === 'power-of-two-divide')).toBe(true);
  });

  it('includes source line numbers in findings', () => {
    const source = `fn calc() {\n    let x = amount * 1;\n}`;
    const report = analyzeIntegerOperations(source);
    const finding = report.findings.find((f) => f.patternId === 'multiply-by-one');
    expect(finding?.line).toBe(2);
  });
});
