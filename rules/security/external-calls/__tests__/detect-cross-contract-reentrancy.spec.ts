import { detectCrossContractReentrancy, RULE_ID } from '../detect-cross-contract-reentrancy';
import { toNormalizedFindings } from '../../lib/normalize';
import * as fx from './cross-contract-reentrancy.fixtures';

const run = (src: Parameters<typeof detectCrossContractReentrancy>[0], opts?: Parameters<typeof detectCrossContractReentrancy>[1]) =>
  detectCrossContractReentrancy(src, opts);

describe('detectCrossContractReentrancy', () => {
  it('flags a stale cross-contract read after an ETH call as critical', () => {
    const { findings } = run(fx.VULNERABLE_STALE_READ);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.ruleId).toBe(RULE_ID);
    expect(f.kind).toBe('cross-contract-stale-read');
    expect(f.severity).toBe('critical');
    expect(f.confidence).toBe('high');
    expect(f.contract).toBe('Vault');
    expect(f.function).toBe('withdraw');
    expect(f.line).toBe(12);
    expect(f.details!.sharedState).toEqual({ assets: ['balances', 'totalDeposits'], liabilities: [] });
    expect(f.details!.reentryPath).toEqual(['attacker → Lender.borrow() → Vault (balances)']);
    expect(f.confidenceEvidence.join('\n')).toMatch(/no lock covers the reached path/);
    expect(f.remediation).toMatch(/checks-effects-interactions/);
  });

  it('accepts effects-before-interactions', () => {
    expect(run(fx.SAFE_EFFECTS_FIRST).findings).toEqual([]);
  });

  it('accepts a late write when the lock covers a view that refuses to answer while locked', () => {
    expect(run(fx.SAFE_LOCKED_VIEW).findings).toEqual([]);
  });

  it('reports read-only reentrancy when the lock does not cover the exposed view', () => {
    const { findings } = run(fx.VULNERABLE_LOCKED_BUT_UNGUARDED_VIEW);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('cross-contract-stale-read');
    expect(findings[0].details!.lock).toEqual({ guarded: true, modifier: 'nonReentrant' });
    expect(findings[0].confidenceEvidence.join('\n')).toMatch(/holds lock nonReentrant, but it does not cover the reached view/);
  });

  it('reports a second contract that mutates shared liability state', () => {
    const { findings } = run(fx.VULNERABLE_SHARED_MUTATION);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('cross-contract-shared-mutation');
    expect(findings[0].details!.sharedState).toMatchObject({ liabilities: ['shares', 'totalShares'] });
    expect(findings[0].details!.reentryPath).toEqual(['attacker → Router.moveShares() → Pool (shares)']);
  });

  it('accepts a shared mutator that holds the same lock', () => {
    expect(run(fx.SAFE_SHARED_MUTATION_LOCKED).findings).toEqual([]);
  });

  it('follows internal helpers and inherited functions', () => {
    const { findings } = run(fx.VULNERABLE_INHERITED_HELPERS);
    expect(findings).toHaveLength(1);
    expect(findings[0].function).toBe('withdraw');
    expect(findings[0].details).toMatchObject({ interaction: { via: ['_pay'] } });
    expect(findings[0].details!.pendingWrites).toEqual([
      expect.objectContaining({ variable: 'balances', accounting: 'asset' }),
    ]);
  });

  it('resolves interface-typed consumers to the implementing contract', () => {
    const { findings } = run(fx.VULNERABLE_INTERFACE_CONSUMER);
    expect(findings).toHaveLength(1);
    expect(findings[0].details!.reentryPath).toEqual(['attacker → Lender.borrow() → Vault (_balances)']);
  });

  it('treats a token hook as a medium-confidence interaction and honors trusted targets', () => {
    const { findings } = run(fx.TOKEN_HOOK_STALE_READ);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].confidence).toBe('medium');
    expect(run(fx.TOKEN_HOOK_STALE_READ, { trustedTargets: ['IERC20'] }).findings).toEqual([]);
  });

  it('does not treat the 2300-gas transfer as a reentrant interaction', () => {
    expect(run(fx.SAFE_STIPEND_TRANSFER).findings).toEqual([]);
  });

  it('builds relationships across source files and reports the file of the interaction', () => {
    const { findings } = run(fx.MULTI_FILE);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('contracts/Vault.sol');
    expect(findings[0].details!.reentryPath).toEqual(['attacker → Lender.borrow() → Vault (balances)']);
  });

  it('reports nothing when no other contract can reach the state', () => {
    expect(run(fx.SINGLE_CONTRACT_ONLY).findings).toEqual([]);
  });

  it('reports unresolved dynamic-call boundaries as limitations', () => {
    const r = run(fx.SINGLE_CONTRACT_ONLY);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({ level: 'warning', code: 'unresolved-dynamic-call', line: 6 }),
    ]);
    expect(r.limitations!.some((l) => /unresolved dynamic-call boundar/.test(l))).toBe(true);
  });

  it('normalizes findings into the analyzer finding schema', () => {
    const [n] = toNormalizedFindings(run(fx.MULTI_FILE), { file: 'fallback.sol' });
    expect(n.ruleId).toBe(RULE_ID);
    expect(n.severity).toBe('high');
    expect(n.location).toMatchObject({ file: 'contracts/Vault.sol', startLine: 6 });
    expect(n.suggestedFix!.description).toMatch(/checks-effects-interactions/i);
    expect(n.metadata).toMatchObject({ kind: 'cross-contract-stale-read', confidence: 'high' });
    expect(n.metadata!.limitations.length).toBeGreaterThan(0);
  });

  it('never throws on malformed input', () => {
    for (const bad of [undefined, null, 42, '', '   ', 'not solidity', [], [{ path: '', content: 'contract A {}' }], [{ path: 'a.sol', content: 5 }]]) {
      const r = run(bad as never);
      expect(r.findings).toEqual([]);
    }
    expect(run('x'.repeat(1_000_001)).analyzed).toBe(false);
    expect(run('contract A { function f( {').analyzed).toBeDefined();
  });

  it('bounds the number of files', () => {
    const many = Array.from({ length: 205 }, (_, i) => ({ path: `c${i}.sol`, content: `contract C${i} {}` }));
    const r = run(many);
    expect(r.diagnostics.some((d) => d.code === 'too-many-files')).toBe(true);
    expect(r.limitations!.some((l) => /bounds were hit/.test(l))).toBe(true);
  });
});
