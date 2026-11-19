import { detectUnvalidatedOracleAnswers } from '../detect-unvalidated-oracle-answers';
import * as fx from './oracle-answer.fixtures';

const run = (src: string, opts?: Parameters<typeof detectUnvalidatedOracleAnswers>[1]) => detectUnvalidatedOracleAnswers(src, opts);
const kinds = (src: string, opts?: Parameters<typeof detectUnvalidatedOracleAnswers>[1]) => run(src, opts).findings.map((f) => f.kind);

describe('detectUnvalidatedOracleAnswers', () => {
  it('flags a consumer that validates nothing (zero, negative, incomplete and stale answers)', () => {
    const { findings } = run(fx.NO_CHECKS);
    expect(findings.map((f) => f.kind)).toEqual([
      'missing-answer-sign-check',
      'missing-round-completeness-check',
      'missing-staleness-check',
    ]);
    expect(findings.map((f) => f.severity)).toEqual(['high', 'medium', 'high']);
    expect(findings[0].ruleId).toBe('GG-ORACLE-ANSWER-001');
    expect(findings[0].function).toBe('price');
    expect(findings[0].details).toMatchObject({ feed: 'feed', method: 'latestRoundData', roundData: { answer: 'answer' } });
    expect(findings[2].message).toMatch(/updatedAt is discarded/);
  });

  it('flags a stale answer when updatedAt is captured but never compared', () => {
    const { findings } = run(fx.STALE_ANSWER);
    expect(findings.map((f) => f.kind)).toEqual(['missing-staleness-check']);
    expect(findings[0].message).toMatch(/updatedAt is never compared with block.timestamp/);
  });

  it('flags an incomplete round when neither answeredInRound nor updatedAt is checked', () => {
    expect(kinds(fx.INCOMPLETE_ROUND)).toEqual(['missing-round-completeness-check']);
  });

  it('flags weak sign checks that allow zero or negative answers', () => {
    expect(kinds(fx.ZERO_ANSWER_ALLOWED)).toEqual(['weak-answer-sign-check']);
    expect(kinds(fx.NEGATIVE_ANSWER_ALLOWED)).toEqual(['weak-answer-sign-check']);
    expect(run(fx.ZERO_ANSWER_ALLOWED).findings[0].severity).toBe('medium');
  });

  it('accepts full validation in both common idioms', () => {
    expect(kinds(fx.SAFE_FULL_VALIDATION)).toEqual([]);
    expect(kinds(fx.SAFE_ALTERNATIVE_IDIOMS)).toEqual([]);
  });

  it('does not flag sequencer-uptime feeds or answers that never reach financial logic', () => {
    expect(kinds(fx.SEQUENCER_FEED)).toEqual([]);
    expect(kinds(fx.NOT_FINANCIAL_USE)).toEqual([]);
  });

  it('flags the deprecated latestAnswer, which cannot be validated', () => {
    const [f] = run(fx.DEPRECATED_LATEST_ANSWER).findings;
    expect(f.kind).toBe('deprecated-latest-answer');
    expect(f.severity).toBe('high');
    expect(f.remediation).toMatch(/latestRoundData/);
  });

  it('reports unvalidated custom adapters with low confidence and accepts validated ones', () => {
    const [f] = run(fx.UNVALIDATED_ADAPTER).findings;
    expect(f.kind).toBe('unvalidated-adapter-price');
    expect(f.confidence).toBe('low');
    expect(kinds(fx.VALIDATED_ADAPTER)).toEqual([]);
  });

  it('recognizes configured adapter method names', () => {
    expect(kinds(fx.CUSTOM_ADAPTER_METHOD)).toEqual([]);
    expect(kinds(fx.CUSTOM_ADAPTER_METHOD, { adapterMethods: ['priceOf'] })).toEqual(['unvalidated-adapter-price']);
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [undefined, 1, '', 'feed.latestRoundData();']) {
      const r = run(bad as unknown as string);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('keeps analyzing truncated source and records a diagnostic', () => {
    const cut = fx.NO_CHECKS.slice(0, fx.NO_CHECKS.indexOf('* 1e10') + 7);
    const r = run(cut);
    expect(r.diagnostics.map((d) => d.code)).toContain('unbalanced-delimiters');
    expect(r.findings.map((f) => f.kind)).toContain('missing-answer-sign-check');
  });
});
