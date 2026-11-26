import { detectPermitDomainSeparator } from '../detect-permit-domain-separator';

const TYPE = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';
const wrap = (expr: string) => `pragma solidity ^0.8.20;
contract Token {
  bytes32 constant TYPEHASH = keccak256("${TYPE}");
  function DOMAIN_SEPARATOR() public view returns (bytes32) {
    return ${expr};
  }
}`;
const encode = (...values: string[]) => `keccak256(abi.encode(${values.join(', ')}))`;
const N = 'keccak256(bytes("Token"))';
const V = 'keccak256(bytes("1"))';
const kinds = (src: string) => detectPermitDomainSeparator(src).findings.map((f) => `${f.kind}:${f.severity}`);

describe('detectPermitDomainSeparator', () => {
  it('accepts a correct four-field domain separator', () => {
    const r = detectPermitDomainSeparator(wrap(encode('TYPEHASH', N, V, 'block.chainid', 'address(this)')));
    expect(r.findings).toEqual([]);
    expect(r.domains).toEqual([{ contract: 'Token', line: 5, fields: ['name', 'version', 'chainId', 'verifyingContract'], status: 'ok' }]);
  });

  it('flags a domain type without chainId (high) or verifyingContract (medium)', () => {
    const noChain = encode('keccak256("EIP712Domain(string name,string version,address verifyingContract)")', N, V, 'address(this)');
    const r = detectPermitDomainSeparator(wrap(noChain));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ ruleId: 'GG-SIG-PERMIT-001', kind: 'domain-type-missing-field', severity: 'high', confidence: 'high', contract: 'Token' });
    expect(r.findings[0].line).toBe(5);
    const noVerifying = encode('keccak256("EIP712Domain(string name,string version,uint256 chainId)")', N, V, 'block.chainid');
    expect(kinds(wrap(noVerifying))).toEqual(['domain-type-missing-field:medium']);
  });

  it('flags a value count that does not match the declared fields', () => {
    expect(kinds(wrap(encode('TYPEHASH', N, V, 'block.chainid')))).toEqual(['domain-encoding-mismatch:medium']);
  });

  it('flags a verifyingContract that is not this contract', () => {
    expect(kinds(wrap(encode('TYPEHASH', N, V, 'block.chainid', 'msg.sender')))).toEqual(['domain-encoding-mismatch:medium']);
  });

  it('flags a hardcoded chain id', () => {
    expect(kinds(wrap(encode('TYPEHASH', N, V, '1', 'address(this)')))).toEqual(['hardcoded-chain-id:medium']);
  });

  it('flags unhashed dynamic fields but accepts precomputed hashes', () => {
    expect(kinds(wrap(encode('TYPEHASH', 'name', V, 'block.chainid', 'address(this)')))).toEqual(['unhashed-dynamic-field:medium']);
    expect(kinds(wrap(encode('TYPEHASH', '_hashedName', '_hashedVersion', 'block.chainid', 'address(this)')))).toEqual([]);
  });

  it('flags a separator cached with block.chainid and accepts one recomputed on chain-id change', () => {
    const cached = `pragma solidity ^0.8.20;
contract Token {
  bytes32 constant TYPEHASH = keccak256("${TYPE}");
  bytes32 public immutable DOMAIN_SEPARATOR;
  constructor() {
    DOMAIN_SEPARATOR = ${encode('TYPEHASH', N, V, 'block.chainid', 'address(this)')};
  }
}`;
    const r = detectPermitDomainSeparator(cached);
    expect(r.findings.map((f) => `${f.kind}:${f.severity}`)).toEqual(['cached-domain-separator-chainid:medium']);
    expect(r.findings[0].details).toEqual({ variable: 'DOMAIN_SEPARATOR' });
    const safe = cached.replace('constructor() {', `uint256 internal immutable INITIAL_CHAIN_ID = block.chainid;
  function domainSeparator() public view returns (bytes32) {
    return block.chainid == INITIAL_CHAIN_ID ? DOMAIN_SEPARATOR : ${encode('TYPEHASH', N, V, 'block.chainid', 'address(this)')};
  }
  constructor() {`);
    expect(kinds(safe)).toEqual([]);
  });

  it('ignores unrelated abi.encode hashes', () => {
    expect(kinds(wrap(encode('PERMIT_TYPEHASH', 'owner', 'spender', 'value')))).toEqual([]);
  });

  it('produces deterministic findings', () => {
    const src = wrap(encode('TYPEHASH', N, V, '1', 'msg.sender'));
    expect(detectPermitDomainSeparator(src)).toEqual(detectPermitDomainSeparator(src));
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [undefined, {}, '', 'just text']) {
      const r = detectPermitDomainSeparator(bad);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
    expect(() => detectPermitDomainSeparator('contract A { bytes32 d = keccak256(abi.encode(')).not.toThrow();
  });
});
