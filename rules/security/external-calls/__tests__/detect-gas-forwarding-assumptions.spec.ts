import { detectGasForwardingAssumptions } from '../detect-gas-forwarding-assumptions';
import * as fx from './gas-forwarding.fixtures';

const run = (src: string) => detectGasForwardingAssumptions(src);
const kinds = (src: string) => run(src).findings.map((f) => f.kind);

describe('detectGasForwardingAssumptions', () => {
  it('flags transfer() to a third party and records the call site', () => {
    const r = run(fx.TRANSFER_THIRD_PARTY);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f.ruleId).toBe('GG-GAS-FORWARD-001');
    expect(f.kind).toBe('stipend-transfer');
    expect(f.severity).toBe('medium');
    expect(f.confidence).toBe('high');
    expect(f.message).toMatch(/pay a third party, forwarding a fixed 2300 gas and reverting on failure/);
    expect(r.callSites).toEqual([
      expect.objectContaining({
        function: 'payout',
        method: 'transfer',
        recipient: 'to',
        recipientKind: 'third-party',
        gas: { kind: 'stipend', expression: '2300 (implicit)' },
        inLoop: false,
        failure: 'reverts',
        stateWritesBefore: 0,
        stateWritesAfter: 0,
      }),
    ]);
  });

  it('rates a self-withdrawal low and traces state effects before and after the call', () => {
    const before = run(fx.TRANSFER_SELF_EFFECTS_FIRST);
    expect(before.findings.map((f) => f.severity)).toEqual(['low']);
    expect(before.callSites[0]).toMatchObject({ recipientKind: 'self', stateWritesBefore: 1, stateWritesAfter: 0 });
    const after = run(fx.TRANSFER_SELF_EFFECTS_AFTER);
    expect(after.callSites[0]).toMatchObject({ stateWritesBefore: 0, stateWritesAfter: 1 });
  });

  it('rates transfer() inside a loop high: one recipient blocks everyone', () => {
    const r = run(fx.TRANSFER_IN_LOOP);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('high');
    expect(r.findings[0].severityRationale).toMatch(/blocking every other recipient/);
    expect(r.callSites[0]).toMatchObject({ inLoop: true, recipient: 'payable(winners[i])' });
  });

  it('reports send() with an ignored result, especially after the books were updated', () => {
    const r = run(fx.SEND_UNCHECKED);
    expect(r.findings.map((f) => f.kind)).toEqual(['stipend-transfer', 'unchecked-low-level-send']);
    expect(r.findings[1].severity).toBe('high');
    expect(r.findings[1].message).toMatch(/after state was already updated/);
    expect(r.callSites[0]).toMatchObject({ method: 'send', failure: 'ignored', stateWritesBefore: 1 });
  });

  it('traces send() failure handling (required vs handled)', () => {
    const required = run(fx.SEND_REQUIRED);
    expect(required.findings.map((f) => f.kind)).toEqual(['stipend-transfer']);
    expect(required.callSites[0].failure).toBe('reverts');
    const handled = run(fx.SEND_HANDLED);
    expect(handled.findings.map((f) => [f.kind, f.severity])).toEqual([['stipend-transfer', 'low']]);
    expect(handled.callSites[0].failure).toBe('handled');
  });

  it('flags a literal gas ceiling that reverts on failure', () => {
    const r = run(fx.CALL_LITERAL_GAS_REVERTS);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].kind).toBe('fixed-gas-cap-reverts-on-failure');
    expect(r.findings[0].severity).toBe('high');
    expect(r.callSites[0]).toMatchObject({ method: 'call', gas: { kind: 'literal', expression: '2300' }, failure: 'reverts' });
  });

  it('flags a gas-capped call whose result is ignored', () => {
    const r = run(fx.CALL_LITERAL_GAS_UNCHECKED);
    expect(r.findings.map((f) => [f.kind, f.severity])).toEqual([['unchecked-low-level-send', 'medium']]);
  });

  it('distinguishes an intentional gas cap from an accidental liveness hazard', () => {
    const r = run(fx.INTENTIONAL_CAP);
    expect(r.findings.map((f) => [f.kind, f.severity])).toEqual([['intentional-gas-cap', 'low']]);
    expect(r.callSites[0]).toMatchObject({ gas: { kind: 'constant', expression: 'PAYOUT_GAS' }, failure: 'handled' });
  });

  it('supports pre-0.7 call.gas() syntax and low-confidence dynamic gas', () => {
    expect(run(fx.LEGACY_CALL_GAS).callSites[0]).toMatchObject({ gas: { kind: 'literal', expression: '2300' }, failure: 'reverts' });
    const dyn = run(fx.DYNAMIC_GAS);
    expect(dyn.callSites[0].gas.kind).toBe('dynamic');
    expect(dyn.findings[0].confidence).toBe('low');
  });

  it('ignores calls that forward all gas and ERC-20 transfers', () => {
    expect(run(fx.CALL_NO_CAP).callSites).toEqual([]);
    expect(kinds(fx.CALL_NO_CAP)).toEqual([]);
    expect(kinds(fx.ERC20_TRANSFER)).toEqual([]);
  });

  it('does not flag recipient fallback fixtures (they receive, they do not call)', () => {
    for (const r of Object.values(fx.RECIPIENTS)) {
      // The forwarder makes an uncapped call; that is not a gas-forwarding assumption.
      expect(run(r.source).findings).toEqual([]);
    }
    expect(fx.RECIPIENTS.emitOnly.approxGasNeeded).toBeLessThan(2300);
    expect(fx.RECIPIENTS.storageWrite.approxGasNeeded).toBeGreaterThan(2300);
    expect(fx.RECIPIENTS.forwarder.approxGasNeeded).toBeGreaterThan(fx.RECIPIENTS.storageWrite.approxGasNeeded);
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [undefined, 1, '', 'to.transfer(1);']) {
      const r = detectGasForwardingAssumptions(bad);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.callSites).toEqual([]);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('keeps analyzing truncated source and records a diagnostic', () => {
    const cut = fx.TRANSFER_THIRD_PARTY.slice(0, fx.TRANSFER_THIRD_PARTY.indexOf('to.transfer(amt);') + 17);
    const r = run(cut);
    expect(r.diagnostics.map((d) => d.code)).toContain('unbalanced-delimiters');
    expect(r.findings.map((f) => f.kind)).toEqual(['stipend-transfer']);
  });
});
