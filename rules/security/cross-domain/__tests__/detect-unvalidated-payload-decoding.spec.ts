import { detectUnvalidatedPayloadDecoding } from '../detect-unvalidated-payload-decoding';
import * as fx from './payload-decoding.fixtures';

const run = (src: string, opts?: Parameters<typeof detectUnvalidatedPayloadDecoding>[1]) =>
  detectUnvalidatedPayloadDecoding(src, opts).findings;

describe('detectUnvalidatedPayloadDecoding', () => {
  it('flags an unversioned payload that reaches balances', () => {
    const [f] = run(fx.NO_VERSION);
    expect(f.ruleId).toBe('GG-XCHAIN-PAYLOAD-001');
    expect(f.kind).toBe('no-version-field');
    expect(f.severity).toBe('high');
    expect(f.function).toBe('handle');
    expect(f.details).toMatchObject({ decodedFields: ['to', 'amount'] });
    expect(f.details!.flow).toEqual([expect.objectContaining({ statement: 'balances[to] += amount' })]);
    expect(f.remediation).toMatch(/version\/type byte/);
  });

  it('flags a decoded but never validated version', () => {
    const [f] = run(fx.VERSION_UNCHECKED);
    expect(f.kind).toBe('unvalidated-version');
    expect(f.details).toMatchObject({ discriminator: 'version' });
  });

  it('flags version dispatch that falls through for unknown versions', () => {
    const findings = run(fx.FALLTHROUGH);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('unsupported-version-fallthrough');
    expect(findings[0].remediation).toMatch(/else revert/);
  });

  it('accepts explicit backward-compatible handling', () => {
    expect(run(fx.SAFE_REQUIRE_VERSION)).toEqual([]);
    expect(run(fx.SAFE_BACKWARD_COMPATIBLE)).toEqual([]);
    expect(run(fx.SAFE_VERSION_PREFIX)).toEqual([]);
  });

  it('accepts an exact payload-length check as schema validation', () => {
    expect(run(fx.SAFE_EXACT_LENGTH)).toEqual([]);
  });

  it('finds version members of decoded structs', () => {
    expect(run(fx.STRUCT_VERSION_UNCHECKED).map((f) => f.kind)).toEqual(['unvalidated-version']);
    expect(run(fx.STRUCT_VERSION_UNCHECKED)[0].details).toMatchObject({ discriminator: 'm.version' });
    expect(run(fx.STRUCT_VERSION_CHECKED)).toEqual([]);
  });

  it('flags ambiguous payload formats', () => {
    const findings = run(fx.AMBIGUOUS_FORMAT);
    expect(findings.map((f) => f.kind)).toEqual(['ambiguous-payload-format']);
    expect(findings[0].details!.signatures).toHaveLength(2);
  });

  it('does not report decoding that never reaches state', () => {
    expect(run(fx.DECODE_WITHOUT_EFFECT)).toEqual([]);
  });

  it('supports custom discriminator names', () => {
    expect(run(fx.CUSTOM_DISCRIMINATOR).map((f) => f.kind)).toEqual(['no-version-field']);
    expect(run(fx.CUSTOM_DISCRIMINATOR, { discriminatorNames: ['flavor'] }).map((f) => f.kind)).toEqual([
      'unvalidated-version',
    ]);
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [null, [], '', 'abi.decode(payload, (uint256))']) {
      const r = detectUnvalidatedPayloadDecoding(bad);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('survives a truncated payload handler (missing closing braces)', () => {
    const truncated = fx.NO_VERSION.slice(0, fx.NO_VERSION.indexOf('balances[to] += amount') + 22);
    const r = detectUnvalidatedPayloadDecoding(truncated);
    expect(r.analyzed).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toContain('unbalanced-delimiters');
    expect(r.findings.map((f) => f.kind)).toEqual(['no-version-field']);
  });
});
