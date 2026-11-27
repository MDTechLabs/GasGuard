import { detectExternalCallOrdering, RULE_ID } from '../detect-external-call-ordering';
import { toNormalizedFindings } from '../../lib/normalize';
import * as fx from './call-ordering.fixtures';

const run = (src: Parameters<typeof detectExternalCallOrdering>[0], opts?: Parameters<typeof detectExternalCallOrdering>[1]) =>
  detectExternalCallOrdering(src, opts);

describe('detectExternalCallOrdering', () => {
  it('flags the classic check, send, clear drain as a critical check-effects violation', () => {
    const { findings } = run(fx.EXPLOIT_CLASSIC_DRAIN);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.ruleId).toBe(RULE_ID);
    expect(f.kind).toBe('check-effects-violation');
    expect(f.severity).toBe('critical');
    expect(f.confidence).toBe('high');
    expect(f.function).toBe('withdraw');
    expect(f.line).toBe(9);
    expect(f.details!.writesBefore).toEqual([]);
    expect(f.details!.writesAfter).toEqual([
      expect.objectContaining({ variable: 'balances', accounting: 'asset', relevance: ['check-then-act', 'accounting'] }),
    ]);
    expect(f.remediation).toMatch(/checks-effects-interactions/);
  });

  it('accepts effects before interactions', () => {
    expect(run(fx.SAFE_EFFECTS_BEFORE_INTERACTIONS).findings).toEqual([]);
  });

  it('flags accounting written after a payout even without a prior check', () => {
    const { findings } = run(fx.ACCOUNTING_AFTER_PAYOUT);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('accounting-after-interaction');
    expect(findings[0].severity).toBe('high');
    expect(findings[0].details!.writesAfter).toEqual([expect.objectContaining({ variable: 'totalPaid' })]);
  });

  it('follows internal helpers and inherited functions', () => {
    const { findings } = run(fx.HELPERS_AND_INHERITANCE);
    expect(findings).toHaveLength(1);
    expect(findings[0].contract).toBe('Pool');
    expect(findings[0].kind).toBe('check-effects-violation');
    expect(findings[0].details).toMatchObject({ interaction: { via: ['_payout'] } });
    expect(findings[0].details!.writesAfter).toEqual([expect.objectContaining({ variable: 'shares' })]);
  });

  it('treats code after the modifier placeholder as running after the body', () => {
    const { findings } = run(fx.MODIFIER_WRITES_AFTER_BODY);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('check-effects-violation');
    expect(findings[0].details!.writesAfter).toEqual([expect.objectContaining({ variable: 'pending' })]);
  });

  it('suppresses late writes protected by a lock when nothing else reads the state', () => {
    expect(run(fx.SAFE_LOCKED_NO_CONSUMERS).findings).toEqual([]);
  });

  it('still reports state observed by a consumer outside the lock', () => {
    const { findings } = run(fx.LOCKED_BUT_UNGUARDED_CONSUMER);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('observable-state-after-interaction');
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].details!.writesAfter).toEqual([
      expect.objectContaining({ variable: 'shares', relevance: ['observed'], readers: ['Pricer.sync()'] }),
    ]);
  });

  it('recognizes an inline mutex instead of reporting the protected write', () => {
    expect(run(fx.SAFE_INLINE_MUTEX).findings).toEqual([]);
  });

  it('ignores stipend transfers, view calls and leaf project contracts', () => {
    expect(run(fx.SAFE_NON_INTERACTIVE_CALLS).findings).toEqual([]);
  });

  it('records which calls were proven non-interactive when another call is reported', () => {
    const { findings } = run(fx.MIXED_TRUSTED_AND_UNTRUSTED);
    expect(findings).toHaveLength(1);
    expect(findings[0].details!.treatedAsNonInteractive).toEqual([
      expect.objectContaining({ expression: 'registry.record(...)', reason: expect.stringMatching(/resolved and cannot reach an untrusted call/) }),
    ]);
  });

  it('reports token transfers at medium confidence and honors trustedTargets', () => {
    const { findings } = run(fx.TOKEN_TRANSFER_THEN_ACCOUNTING);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('accounting-after-interaction');
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].confidence).toBe('medium');
    expect(run(fx.TOKEN_TRANSFER_THEN_ACCOUNTING, { trustedTargets: ['IERC20'] }).findings).toEqual([]);
  });

  it('resolves helpers across files and reports the interaction file', () => {
    const { findings } = run(fx.MULTI_FILE);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('contracts/Payable.sol');
    expect(findings[0].contract).toBe('Pool');
  });

  it('reports unresolved bases and dynamic-call boundaries as limitations', () => {
    const r = run(fx.UNRESOLVED_BASE);
    expect(r.limitations!.some((l) => /inherits Ownable/.test(l))).toBe(true);
    expect(r.limitations!.some((l) => /unresolved dynamic-call boundar/.test(l))).toBe(true);
    expect(r.diagnostics.some((d) => d.code === 'unresolved-dynamic-call')).toBe(true);
  });

  it('normalizes into the analyzer finding schema', () => {
    const [n] = toNormalizedFindings(run(fx.EXPLOIT_CLASSIC_DRAIN), { file: 'Bank.sol', docsSlug: 'solidity-call-safety' });
    expect(n.severity).toBe('critical');
    expect(n.location).toMatchObject({ file: 'source.sol', startLine: 9 });
    expect(n.suggestedFix!.documentationUrl).toBe('https://docs.gasguard.dev/rules/solidity-call-safety');
    expect(n.metadata).toMatchObject({ kind: 'check-effects-violation', function: 'withdraw' });
  });

  it('never throws on malformed input', () => {
    for (const bad of [undefined, null, 7, '', 'not solidity', [], [{ path: 'a.sol', content: null }]]) {
      expect(run(bad as never).findings).toEqual([]);
    }
  });
});
