import {
  extractContracts,
  extractFunctions,
  extractMappings,
  extractStateVars,
  findMatching,
  lineColumn,
  maskCommentsAndStrings,
  parseParams,
  prepareSource,
  splitTopLevel,
} from '../solidity-lite';

const SAMPLE = `
pragma solidity ^0.8.20;
contract Vault is Base, Ownable(msg.sender) {
  mapping(address => mapping(uint256 => bool)) public used;
  uint256 public constant LIMIT = 10;
  address immutable endpoint;
  event Done(uint256 id);
  // function ghost() external {}
  string private s = "function fake() external {}";
  constructor(address e) { endpoint = e; }
  function pay(address to, uint256 amt, bytes calldata data) external payable onlyOwner returns (bool ok) {
    used[to][amt] = true;
    return true;
  }
  function declared(uint256 x) external view returns (uint256);
  receive() external payable {}
}
interface IFoo { function foo() external; }
`;

describe('solidity-lite', () => {
  it('masks comments and string bodies but preserves offsets and quotes', () => {
    const masked = maskCommentsAndStrings(SAMPLE);
    expect(masked).toHaveLength(SAMPLE.length);
    expect(masked).not.toContain('ghost');
    expect(masked).not.toContain('fake');
    expect(masked).toContain('string private s = "');
    expect(masked.split('\n')).toHaveLength(SAMPLE.split('\n').length);
  });

  it('extracts contracts with their bases', () => {
    const masked = maskCommentsAndStrings(SAMPLE);
    const contracts = extractContracts(masked);
    expect(contracts.map((c) => c.name)).toEqual(['Vault', 'IFoo']);
    expect(contracts[0].bases).toEqual(['Base', 'Ownable']);
    expect(contracts[1].kind).toBe('interface');
  });

  it('extracts functions, modifiers, visibility and body-less declarations', () => {
    const masked = maskCommentsAndStrings(SAMPLE);
    const fns = extractFunctions(masked, SAMPLE);
    const names = fns.map((f) => f.name);
    expect(names).toEqual(['constructor', 'pay', 'declared', 'receive', 'foo']);
    const pay = fns.find((f) => f.name === 'pay')!;
    expect(pay.visibility).toBe('external');
    expect(pay.mutability).toBe('payable');
    expect(pay.modifiers).toEqual(['onlyOwner']);
    expect(pay.params.map((p) => p.name)).toEqual(['to', 'amt', 'data']);
    expect(pay.params[2]).toEqual({ type: 'bytes', name: 'data', location: 'calldata' });
    expect(pay.contract).toBe('Vault');
    expect(pay.body).toContain('used[to][amt] = true;');
    expect(fns.find((f) => f.name === 'declared')!.hasBody).toBe(false);
  });

  it('extracts nested mapping declarations with key types', () => {
    const masked = maskCommentsAndStrings(SAMPLE);
    const maps = extractMappings(masked, SAMPLE);
    expect(maps).toHaveLength(1);
    expect(maps[0].name).toBe('used');
    expect(maps[0].keyTypes).toEqual(['address', 'uint256']);
    expect(maps[0].valueType).toBe('bool');
  });

  it('extracts state variables but not functions or events', () => {
    const masked = maskCommentsAndStrings(SAMPLE);
    const vars = extractStateVars(masked, SAMPLE);
    const names = vars.map((v) => v.name);
    expect(names).toContain('LIMIT');
    expect(names).toContain('endpoint');
    expect(names).not.toContain('Done');
    expect(vars.find((v) => v.name === 'LIMIT')!.constant).toBe(true);
    expect(vars.find((v) => v.name === 'endpoint')!.immutable).toBe(true);
  });

  it('parses parameters and splits on top-level separators only', () => {
    expect(parseParams('address payable a, uint256[] memory xs')).toEqual([
      { type: 'address payable', name: 'a', location: '' },
      { type: 'uint256[]', name: 'xs', location: 'memory' },
    ]);
    expect(splitTopLevel('a, f(b, c), [d, e]')).toEqual(['a', ' f(b, c)', ' [d, e]']);
  });

  it('finds matching delimiters and line/column positions', () => {
    expect(findMatching('{ { } }', 0)).toBe(6);
    expect(findMatching('{ { }', 0)).toBe(-1);
    expect(lineColumn('a\nbc\nd', 3)).toEqual({ line: 2, column: 2 });
  });

  describe('prepareSource', () => {
    it('rejects non-string, empty, oversized and non-Solidity input without throwing', () => {
      expect(prepareSource(42)).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid-input' }] });
      expect(prepareSource('   ')).toMatchObject({ ok: false, diagnostics: [{ code: 'empty-input' }] });
      expect(prepareSource('x'.repeat(1_000_001))).toMatchObject({ ok: false, diagnostics: [{ code: 'source-too-large' }] });
      expect(prepareSource('hello world')).toMatchObject({ ok: false, diagnostics: [{ code: 'no-contract' }] });
    });

    it('warns (but proceeds) on unbalanced delimiters', () => {
      const r = prepareSource('contract A { function f() external {');
      expect(r.ok).toBe(true);
      expect(r.diagnostics.map((d) => d.code)).toContain('unbalanced-delimiters');
    });
  });
});
