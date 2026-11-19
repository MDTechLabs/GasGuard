import { detectOracleDecimalMismatch } from '../detect-oracle-decimal-mismatch';
import * as fx from './decimal-mismatch.fixtures';

const run = (src: string, opts?: Parameters<typeof detectOracleDecimalMismatch>[1]) => detectOracleDecimalMismatch(src, opts);
const kinds = (src: string, opts?: Parameters<typeof detectOracleDecimalMismatch>[1]) => run(src, opts).findings.map((f) => f.kind);

describe('detectOracleDecimalMismatch', () => {
  it('flags a stablecoin/collateral ratio with different feed decimals and reports expected vs observed scale', () => {
    const { findings } = run(fx.STABLECOIN_COLLATERAL_UNNORMALIZED);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.ruleId).toBe('GG-ORACLE-DECIMALS-001');
    expect(f.kind).toBe('unnormalized-feed-decimals');
    expect(f.severity).toBe('high');
    expect(f.confidence).toBe('high');
    expect(f.details).toMatchObject({
      expectedResultScaleExponent: -10,
      appliedScaleExponent: 0,
      feeds: [
        expect.objectContaining({ feed: 'collateralFeed', decimals: 8 }),
        expect.objectContaining({ feed: 'stableFeed', decimals: 18 }),
      ],
    });
    expect(f.message).toMatch(/8 vs 18 decimals/);
  });

  it('flags an unnormalized cross rate', () => {
    const [f] = run(fx.CROSS_RATE_UNNORMALIZED).findings;
    expect(f.kind).toBe('unnormalized-feed-decimals');
    expect(f.details).toMatchObject({ expectedResultScaleExponent: 26, appliedScaleExponent: 0 });
  });

  it('accepts feeds normalized through decimals()', () => {
    expect(kinds(fx.SAFE_DECIMALS_QUERIED)).toEqual([]);
  });

  it('flags partial normalization', () => {
    const [f] = run(fx.PARTIAL_NORMALIZATION).findings;
    expect(f.kind).toBe('partial-normalization');
    expect(f.message).toMatch(/rescales only some operands \(pA\)/);
    expect(f.message).toMatch(/pB keeps its raw feed scale/);
  });

  it('does not flag a ratio of feeds with equal known decimals', () => {
    expect(kinds(fx.SAME_DECIMALS_RATIO)).toEqual([]);
  });

  it('notes decimals() that is queried but never applied (decimals not statically known)', () => {
    const [f] = run(fx.DECIMALS_QUERIED_UNUSED).findings;
    expect(f.kind).toBe('unnormalized-feed-decimals');
    expect(f.confidence).toBe('low');
    expect(f.details).toMatchObject({ decimalsQueriedButUnused: true });
  });

  it('reports a literal scale factor over mixed decimals as an advisory with the resulting precision', () => {
    const [f] = run(fx.LITERAL_SCALE_MIXED).findings;
    expect(f.kind).toBe('literal-scale-with-mixed-decimals');
    expect(f.severity).toBe('low');
    expect(f.details).toMatchObject({ expectedResultScaleExponent: 26, appliedScaleExponent: -8, resultScaleExponent: 18 });
  });

  it('ignores calculations that use a single feed', () => {
    expect(kinds(fx.SINGLE_FEED)).toEqual([]);
  });

  it('uses configured feed decimals', () => {
    const src = fx.CROSS_RATE_UNNORMALIZED.replace('uint8 constant TOKEN_ETH_DECIMALS = 18;', '').replace('uint8 constant ETH_USD_DECIMALS = 8;', '');
    expect(run(src).findings[0].confidence).toBe('low');
    const configured = run(src, { feedDecimals: { ethUsdFeed: 8, tokenEthFeed: 18 } }).findings[0];
    expect(configured.confidence).toBe('high');
    expect(configured.details).toMatchObject({ expectedResultScaleExponent: 26 });
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [undefined, {}, '', 'a * b / 1e8']) {
      const r = run(bad as unknown as string);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('keeps analyzing truncated source and records a diagnostic', () => {
    const cut = fx.CROSS_RATE_UNNORMALIZED.slice(0, fx.CROSS_RATE_UNNORMALIZED.indexOf('uint256(b);') + 11);
    const r = run(cut);
    expect(r.diagnostics.map((d) => d.code)).toContain('unbalanced-delimiters');
    expect(r.findings.map((f) => f.kind)).toEqual(['unnormalized-feed-decimals']);
  });
});
