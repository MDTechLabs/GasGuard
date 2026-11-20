import { detectDuplicateMessageIdentifiers } from '../detect-duplicate-message-identifiers';
import * as fx from './duplicate-identifiers.fixtures';

const kinds = (src: string) => detectDuplicateMessageIdentifiers(src).findings.map((f) => f.kind).sort();

describe('detectDuplicateMessageIdentifiers', () => {
  it('flags a caller-supplied replay identifier', () => {
    const r = detectDuplicateMessageIdentifiers(fx.CALLER_SUPPLIED_ID);
    expect(r.analyzed).toBe(true);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f.ruleId).toBe('GG-XCHAIN-DUPID-001');
    expect(f.kind).toBe('caller-supplied-message-id');
    expect(f.severity).toBe('high');
    expect(f.details).toMatchObject({ identity: 'messageId', executedFields: ['to', 'amount'] });
    expect(f.remediation).toMatch(/keccak256\(abi\.encode\(sourceDomain, remoteSender/);
  });

  it('flags raw-payload identity combined with decoded execution (padded / alternate encodings)', () => {
    const r = detectDuplicateMessageIdentifiers(fx.RAW_PAYLOAD_IDENTITY);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f.kind).toBe('raw-payload-identity');
    expect(f.severity).toBe('high');
    expect(f.message).toMatch(/keccak256\(payload\)/);
    expect(f.message).toMatch(/alternate/);
    expect(f.details).toMatchObject({ rawPayload: 'payload', decodedFields: ['to', 'amount'] });
  });

  it('explains when the id omits executed fields and is not domain bound', () => {
    expect(kinds(fx.ID_OMITS_EXECUTED_FIELDS)).toEqual(['id-not-domain-bound', 'id-omits-executed-fields']);
    const omit = detectDuplicateMessageIdentifiers(fx.ID_OMITS_EXECUTED_FIELDS).findings.find(
      (f) => f.kind === 'id-omits-executed-fields',
    )!;
    expect(omit.details).toMatchObject({ missingFields: ['to', 'amount'] });
    expect(omit.message).toMatch(/executes to, amount but the replay key preimage does not include them/);
  });

  it('flags identity fields that execution ignores', () => {
    const r = detectDuplicateMessageIdentifiers(fx.ID_INCLUDES_SALT);
    expect(r.findings.map((f) => f.kind)).toEqual(['id-includes-unexecuted-fields']);
    expect(r.findings[0].details).toMatchObject({ unexecutedFields: ['salt'] });
    expect(r.findings[0].severity).toBe('high');
  });

  it('flags ambiguous abi.encodePacked identities over dynamic operands', () => {
    expect(kinds(fx.PACKED_DYNAMIC_ID)).toContain('non-canonical-id-encoding');
  });

  it('accepts a canonical, domain-bound identity regardless of field order', () => {
    expect(kinds(fx.SAFE_CANONICAL_ID)).toEqual([]);
    expect(kinds(fx.SAFE_REORDERED_FIELDS)).toEqual([]);
  });

  it('accepts transport-supplied and recomputed identifiers', () => {
    expect(kinds(fx.TRANSPORT_SUPPLIED_ID)).toEqual([]);
    expect(kinds(fx.SUPPLIED_ID_RECOMPUTED)).toEqual([]);
  });

  it('treats a transport-style receiver without endpoint authentication as caller-supplied', () => {
    const unauth = fx.TRANSPORT_SUPPLIED_ID.replace('require(msg.sender == endpoint, "only endpoint");', '');
    expect(kinds(unauth)).toEqual(['caller-supplied-message-id']);
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [undefined, 3, '', 'keccak256(abi.encode(x))']) {
      const r = detectDuplicateMessageIdentifiers(bad);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('keeps analyzing truncated source and records a diagnostic', () => {
    const cut = fx.CALLER_SUPPLIED_ID.slice(0, fx.CALLER_SUPPLIED_ID.indexOf('balances[to] += amount') + 22);
    const r = detectDuplicateMessageIdentifiers(cut);
    expect(r.diagnostics.map((d) => d.code)).toContain('unbalanced-delimiters');
    expect(r.findings.map((f) => f.kind)).toEqual(['caller-supplied-message-id']);
  });
});
