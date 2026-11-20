import { detectMissingFinalityAssumptions } from '../detect-missing-finality-assumptions';
import * as fx from './finality.fixtures';

const run = (src: string, opts?: Parameters<typeof detectMissingFinalityAssumptions>[1]) => detectMissingFinalityAssumptions(src, opts);
const kinds = (src: string) => run(src).findings.map((f) => f.kind);

describe('detectMissingFinalityAssumptions', () => {
  it('flags application-managed proof verification without a finality policy', () => {
    const { findings } = run(fx.APP_MANAGED_NO_FINALITY);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.ruleId).toBe('GG-XCHAIN-FINALITY-001');
    expect(f.kind).toBe('missing-finality-policy');
    expect(f.severity).toBe('high');
    expect(f.confidence).toBe('high');
    expect(f.details).toMatchObject({ mode: 'application-managed', proofVerified: true });
    expect(f.remediation).toMatch(/confirmationsByChain|requiredConfirmations/);
  });

  it('lowers confidence when the event is only claimed by the caller', () => {
    const [f] = run(fx.UNVERIFIED_CLAIM).findings;
    expect(f.kind).toBe('missing-finality-policy');
    expect(f.confidence).toBe('medium');
    expect(f.details).toMatchObject({ proofVerified: false });
  });

  it('accepts a handler that enforces configured confirmations and locates the config path', () => {
    const r = run(fx.SAFE_CONFIRMATIONS);
    expect(r.findings).toEqual([]);
    expect(r.finalityConfig).toEqual([
      expect.objectContaining({
        name: 'requiredConfirmations',
        kind: 'variable',
        setter: 'setRequiredConfirmations',
        setterValidated: true,
        chainSpecific: false,
      }),
    ]);
  });

  it('reports a finality setter without a lower bound', () => {
    const r = run(fx.UNBOUNDED_SETTER);
    expect(r.findings.map((f) => f.kind)).toEqual(['finality-config-unbounded']);
    expect(r.findings[0].function).toBe('setRequiredConfirmations');
    expect(r.findings[0].severity).toBe('low');
  });

  it('differentiates transport-managed finality from application-managed finality', () => {
    const [f] = run(fx.TRANSPORT_MANAGED).findings;
    expect(f.kind).toBe('finality-delegated-to-transport');
    expect(f.severity).toBe('low');
    expect(f.details).toMatchObject({ mode: 'transport-managed', chainSpecificConfigurationDependency: true });
  });

  it('flags a single scalar policy shared across source chains and accepts per-chain config', () => {
    const [f] = run(fx.SINGLE_POLICY_MANY_CHAINS).findings;
    expect(f.kind).toBe('single-finality-policy-for-multiple-chains');
    expect(f.details).toMatchObject({ chainSpecificConfigurationDependency: true });
    const safe = run(fx.SAFE_PER_CHAIN);
    expect(safe.findings).toEqual([]);
    expect(safe.finalityConfig).toEqual([expect.objectContaining({ name: 'confirmationsByChain', kind: 'mapping', chainSpecific: true })]);
  });

  it('accepts finality enforced by a modifier', () => {
    expect(kinds(fx.SAFE_MODIFIER)).toEqual([]);
  });

  it('ignores functions that do not consume source events', () => {
    expect(kinds(fx.NOT_A_CONSUMER)).toEqual([]);
  });

  it('always documents that off-chain finality services cannot be verified statically', () => {
    const r = run(fx.APP_MANAGED_NO_FINALITY);
    expect(r.assumptions.join(' ')).toMatch(/cannot independently verify off-chain finality services/);
    expect(r.findings[0].details!.assumptions).toEqual(r.assumptions);
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [undefined, [], '', 'uint256 confirmations = 1;']) {
      const r = run(bad as unknown as string);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.finalityConfig).toEqual([]);
      expect(r.assumptions.length).toBeGreaterThan(0);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('keeps analyzing truncated source and records a diagnostic', () => {
    const cut = fx.UNVERIFIED_CLAIM.slice(0, fx.UNVERIFIED_CLAIM.indexOf('balances[to] += amount') + 22);
    const r = run(cut);
    expect(r.diagnostics.map((d) => d.code)).toContain('unbalanced-delimiters');
    expect(r.findings.map((f) => f.kind)).toEqual(['missing-finality-policy']);
  });
});
