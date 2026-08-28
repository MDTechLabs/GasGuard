import { detectRedundantConversions } from '../redundant-numeric-conversions-rule';

describe('detectRedundantConversions', () => {
  it('returns no findings for clean type usage', () => {
    const source = `let amount: i128 = 1000_i128;`;
    const report = detectRedundantConversions(source);
    expect(report.findings).toHaveLength(0);
  });

  it('detects chained .into().into() calls', () => {
    const source = `let val = raw_value.into().into();`;
    const report = detectRedundantConversions(source);
    expect(report.findings.some((f) => f.patternId === 'into-into-chain')).toBe(true);
  });

  it('detects i128<->u128 round-trip cast', () => {
    const source = `let x = (amount as u128) as i128;`;
    const report = detectRedundantConversions(source);
    expect(report.findings.some((f) => f.patternId === 'i128-to-u128-back')).toBe(true);
  });

  it('includes correct line numbers', () => {
    const source = `fn foo() {\n    let x = val.into().into();\n}`;
    const report = detectRedundantConversions(source);
    const finding = report.findings.find((f) => f.patternId === 'into-into-chain');
    expect(finding?.line).toBe(2);
  });

  it('does not flag safe conversions', () => {
    const source = `let x = u32::from(my_u8_value);`;
    const report = detectRedundantConversions(source);
    expect(report.findings.filter(f => f.patternId === 'from-into-identity')).toHaveLength(0);
  });
});
