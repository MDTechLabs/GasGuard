import { detectFallbackOracleInconsistency } from '../detect-fallback-oracle-inconsistency';
import * as fx from './fallback-oracle.fixtures';

const run = (src: string) => detectFallbackOracleInconsistency(src);
const kinds = (src: string) => run(src).findings.map((f) => f.kind);

describe('detectFallbackOracleInconsistency', () => {
  it('flags a fallback path that drops the primary staleness policy (primary-failure path)', () => {
    const { findings } = run(fx.STALE_POLICY_MISMATCH);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.ruleId).toBe('GG-ORACLE-FALLBACK-001');
    expect(f.kind).toBe('fallback-stale-policy-mismatch');
    expect(f.severity).toBe('high');
    expect(f.confidence).toBe('high');
    expect(f.function).toBe('price');
    expect(f.message).toMatch(/falls back from primaryFeed to fallbackFeed/);
    expect(f.details).toMatchObject({
      primary: { feed: 'primaryFeed', stale: true, staleThreshold: 'HEARTBEAT' },
      fallback: { feed: 'fallbackFeed', stale: false },
      sharedSink: true,
    });
  });

  it('flags inconsistent decimals handling between primary and fallback', () => {
    const { findings } = run(fx.DECIMALS_MISMATCH);
    expect(findings.map((f) => f.kind)).toEqual(['fallback-decimals-mismatch']);
    expect(findings[0].details).toMatchObject({ primary: { normalized: true }, fallback: { normalized: false } });
  });

  it('flags an inverse-orientation fallback and accepts explicit inversion', () => {
    const [f] = run(fx.INVERSION_MISMATCH).findings;
    expect(f.kind).toBe('fallback-inversion-mismatch');
    expect(f.details).toMatchObject({ primary: { pair: ['ETH', 'USD'] }, fallback: { pair: ['USD', 'ETH'] } });
    expect(kinds(fx.SAFE_EXPLICIT_INVERSION)).toEqual([]);
  });

  it('flags a different quote asset', () => {
    const [f] = run(fx.QUOTE_ASSET_MISMATCH).findings;
    expect(f.kind).toBe('fallback-quote-asset-mismatch');
    expect(f.message).toMatch(/primary quotes ETH\/USD but the fallback quotes ETH\/EUR/);
  });

  it('recognizes explicit adapter normalization on both paths', () => {
    expect(kinds(fx.SAFE_EXPLICIT_ADAPTER)).toEqual([]);
  });

  it('reports differing staleness thresholds at medium severity', () => {
    const [f] = run(fx.STALE_THRESHOLD_DIFFERS).findings;
    expect(f.kind).toBe('fallback-stale-policy-mismatch');
    expect(f.severity).toBe('medium');
    expect(f.message).toMatch(/HEARTBEAT vs FALLBACK_HEARTBEAT/);
  });

  it('ignores multi-feed calculations that are not fallbacks, and single-source reads', () => {
    expect(kinds(fx.NOT_A_FALLBACK)).toEqual([]);
    expect(kinds(fx.SINGLE_SOURCE)).toEqual([]);
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [undefined, 7, '   ', 'try feed.latestRoundData() {} catch {}']) {
      const r = detectFallbackOracleInconsistency(bad as unknown as string);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('keeps analyzing truncated source and records a diagnostic', () => {
    const cut = fx.QUOTE_ASSET_MISMATCH.slice(0, fx.QUOTE_ASSET_MISMATCH.indexOf('p = uint256(b);') + 15);
    const r = run(cut);
    expect(r.diagnostics.map((d) => d.code)).toContain('unbalanced-delimiters');
    expect(r.findings.map((f) => f.kind)).toEqual(['fallback-quote-asset-mismatch']);
  });
});
