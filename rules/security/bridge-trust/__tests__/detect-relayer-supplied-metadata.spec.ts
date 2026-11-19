import { detectRelayerSuppliedMetadata } from '../detect-relayer-supplied-metadata';
import * as fx from './relayer-metadata.fixtures';

const run = (src: string, opts?: Parameters<typeof detectRelayerSuppliedMetadata>[1]) => detectRelayerSuppliedMetadata(src, opts);

describe('detectRelayerSuppliedMetadata', () => {
  it('flags spoofable chain/sender parameters used for authorization and minting', () => {
    const { findings } = run(fx.SPOOFABLE_PARAMETERS);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.ruleId).toBe('GG-XCHAIN-METADATA-001');
    expect(f.kind).toBe('spoofable-source-metadata');
    expect(f.severity).toBe('critical');
    expect(f.confidence).toBe('high');
    expect(f.function).toBe('receiveMessage');
    expect(f.details!.provenance).toEqual([
      expect.objectContaining({ name: 'srcChain', via: 'calldata parameter' }),
      expect.objectContaining({ name: 'sender', via: 'calldata parameter' }),
    ]);
    expect(f.details!.valueOperations).toEqual([expect.objectContaining({ statement: '_mint(to, amount)' })]);
  });

  it('recognizes authenticated endpoint-provided metadata and reports no finding', () => {
    const r = run(fx.AUTHENTICATED_ENDPOINT);
    expect(r.findings).toEqual([]);
    expect(r.authenticatedReceivers.map((a) => a.function)).toEqual(['receiveMessage']);
    expect(r.authenticatedReceivers[0].evidence.join(' ')).toMatch(/endpoint/);
  });

  it('treats an endpoint-supplied origin struct as trusted context', () => {
    const r = run(fx.ENDPOINT_PROVIDED_ORIGIN);
    expect(r.findings).toEqual([]);
    expect(r.authenticatedReceivers.map((a) => a.function)).toEqual(['lzReceive']);
  });

  it('tracks metadata provenance through aliases', () => {
    const [f] = run(fx.ALIASED_METADATA).findings;
    expect(f.kind).toBe('spoofable-source-metadata');
    expect(f.details!.provenance).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'chain', via: 'alias of srcChain' })]),
    );
  });

  it('tracks metadata decoded from a caller-supplied payload', () => {
    const [f] = run(fx.DECODED_METADATA).findings;
    expect(f.kind).toBe('spoofable-source-metadata');
    expect(f.function).toBe('receivePayload');
    expect(f.details!.provenance).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'srcChain', via: 'decoded from caller-supplied payload' })]),
    );
  });

  it('reports proof metadata that is never verified, and accepts verified proofs', () => {
    const ignored = run(fx.PROOF_IGNORED).findings;
    expect(ignored.map((f) => f.kind)).toEqual(['proof-not-verified']);
    expect(ignored[0].details).toMatchObject({ proofParameters: ['proof'] });
    expect(run(fx.PROOF_VERIFIED).findings).toEqual([]);
  });

  it('ignores non-bridge functions and receivers whose metadata only reaches events', () => {
    expect(run(fx.NOT_A_BRIDGE).findings).toEqual([]);
    expect(run(fx.EVENT_ONLY).findings).toEqual([]);
  });

  it('supports configured metadata parameter names', () => {
    expect(run(fx.CUSTOM_PARAMETER_NAMES).findings).toEqual([]);
    const f = run(fx.CUSTOM_PARAMETER_NAMES, { metadataNames: ['hop', 'emitter'] }).findings;
    expect(f.map((x) => x.kind)).toEqual(['spoofable-source-metadata']);
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [null, 0, '  ', 'function f(uint32 srcChain) external {}']) {
      const r = run(bad as unknown as string);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.authenticatedReceivers).toEqual([]);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('keeps analyzing truncated source and records a diagnostic', () => {
    const cut = fx.SPOOFABLE_PARAMETERS.slice(0, fx.SPOOFABLE_PARAMETERS.indexOf('_mint(to, amount);\n  }\n}') + 18);
    const r = run(cut);
    expect(r.diagnostics.map((d) => d.code)).toContain('unbalanced-delimiters');
    expect(r.findings.map((f) => f.kind)).toEqual(['spoofable-source-metadata']);
  });
});
