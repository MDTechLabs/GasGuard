import { classifyType, detectUnsafePackedHashing } from '../detect-unsafe-packed-hashing';
import * as fx from './packed-hashing.fixtures';

describe('detectUnsafePackedHashing', () => {
  it('demonstrates the underlying collision', () => {
    const d = fx.demonstrateCollision();
    expect(d.equal).toBe(true);
    expect(d.first).toBe('616263');
  });

  it('flags two dynamic strings in a signature digest as high severity', () => {
    const r = detectUnsafePackedHashing(fx.VULNERABLE_SIGNATURE_DIGEST);
    expect(r.analyzed).toBe(true);
    expect(r.findings).toHaveLength(2);
    for (const f of r.findings) {
      expect(f.ruleId).toBe('GG-SIG-PACKED-001');
      expect(f.kind).toBe('ambiguous-packed-preimage');
      expect(f.severity).toBe('high');
      expect(f.confidence).toBe('high');
      expect(f.remediation).toMatch(/abi\.encode/);
      expect(f.confidenceEvidence.join(' ')).toMatch(/2 dynamic operand/);
    }
    expect(r.findings.map((f) => f.function)).toEqual(['digestFor', 'verify']);
    expect(r.findings[0].line).toBe(5);
  });

  it('reports operand types in structured details', () => {
    const [f] = detectUnsafePackedHashing(fx.VULNERABLE_SIGNATURE_DIGEST).findings;
    const operands = f.details!.operands as { expression: string; type: string; class: string }[];
    expect(operands.map((o) => [o.expression, o.type, o.class])).toEqual([
      ['name', 'string', 'dynamic'],
      ['role', 'string', 'dynamic'],
    ]);
  });

  it('flags a dynamic array and bytes used as a mapping key as medium', () => {
    const r = detectUnsafePackedHashing(fx.VULNERABLE_MAPPING_KEY);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('medium');
    expect(r.findings[0].details).toMatchObject({ usage: 'mapping key' });
  });

  it('flags commitments as medium', () => {
    const r = detectUnsafePackedHashing(fx.VULNERABLE_COMMITMENT);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('medium');
    expect(r.findings[0].details).toMatchObject({ usage: 'commitment' });
  });

  it('accepts fixed-width encodings', () => {
    const r = detectUnsafePackedHashing(fx.SAFE_FIXED_WIDTH);
    expect(r.findings).toHaveLength(0);
    expect(r.safeEncodings.map((s) => s.reason)).toEqual(['fixed-width']);
  });

  it('accepts a single dynamic operand', () => {
    const r = detectUnsafePackedHashing(fx.SAFE_SINGLE_DYNAMIC);
    expect(r.findings).toHaveLength(0);
    expect(r.safeEncodings.map((s) => s.reason)).toEqual(['single-dynamic']);
  });

  it('accepts explicitly delimited dynamic operands', () => {
    const r = detectUnsafePackedHashing(fx.SAFE_DELIMITED);
    expect(r.findings).toHaveLength(0);
    expect(r.safeEncodings.map((s) => s.reason)).toEqual(['delimited']);
  });

  it('ignores abi.encode and commented-out code', () => {
    expect(detectUnsafePackedHashing(fx.SAFE_ABI_ENCODE).findings).toHaveLength(0);
    expect(detectUnsafePackedHashing(fx.COMMENTED_OUT).findings).toHaveLength(0);
  });

  it('reports only low confidence when an operand type cannot be resolved', () => {
    const r = detectUnsafePackedHashing(fx.UNRESOLVED_OPERAND);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].confidence).toBe('low');
    expect(r.findings[0].severity).toBe('low');
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [undefined, 5, '', 'not solidity at all']) {
      const r = detectUnsafePackedHashing(bad);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('still analyzes truncated source but records a diagnostic', () => {
    const r = detectUnsafePackedHashing(fx.UNBALANCED);
    expect(r.analyzed).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toContain('unbalanced-delimiters');
    expect(r.findings).toHaveLength(1);
  });

  describe('classifyType', () => {
    it.each([
      ['string', 'dynamic'],
      ['bytes', 'dynamic'],
      ['uint256[]', 'dynamic'],
      ['bytes32', 'fixed'],
      ['address', 'fixed'],
      ['uint8', 'fixed'],
      ['uint256[3]', 'fixed'],
      ['MyStruct', 'unknown'],
    ])('%s -> %s', (type, expected) => {
      expect(classifyType(type)).toBe(expected);
    });
  });
});
