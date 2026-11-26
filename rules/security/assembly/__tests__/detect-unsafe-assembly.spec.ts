import { detectUnsafeAssembly } from '../detect-unsafe-assembly';

const wrap = (asm: string, opts: { header?: string; mods?: string; params?: string; annotation?: string } = {}) => `pragma solidity ^0.8.20;
contract Vault {
  bytes32 constant SLOT = keccak256("vault.storage");
  modifier onlyOwner() { _; }
  function run(${opts.params ?? ''}) ${opts.header ?? 'external'} ${opts.mods ?? ''} {
    assembly ${opts.annotation ?? ''} {
${asm}
    }
  }
}`;
const kinds = (src: string) => detectUnsafeAssembly(src).findings.map((f) => `${f.kind}:${f.severity}`);

describe('detectUnsafeAssembly', () => {
  it('flags a free memory pointer set below 0x80', () => {
    const r = detectUnsafeAssembly(wrap('      mstore(0x40, 0x20)'));
    expect(r.blocks).toBe(1);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ ruleId: 'GG-ASM-MEM-001', kind: 'free-pointer-corruption', severity: 'high', function: 'run', contract: 'Vault' });
    expect(r.findings[0].line).toBeGreaterThan(5);
  });

  it('accepts a correctly advanced free memory pointer', () => {
    const asm = `      let ptr := mload(0x40)
      mstore(ptr, 1)
      mstore(0x40, add(ptr, 0x20))`;
    expect(kinds(wrap(asm))).toEqual([]);
  });

  it('flags data written at the free pointer without allocating it, but not before return/revert', () => {
    const asm = `      let ptr := mload(0x40)
      mstore(ptr, 1)`;
    expect(kinds(wrap(asm))).toEqual(['unallocated-memory-write:medium']);
    expect(kinds(wrap(`${asm}\n      return(ptr, 0x20)`))).toEqual([]);
  });

  it('flags a non-zero write to the zero slot unless it is restored', () => {
    expect(kinds(wrap('      mstore(0x60, 1)'))).toEqual(['zero-slot-overwrite:medium']);
    expect(kinds(wrap('      mstore(0x60, 1)\n      mstore(0x60, 0)'))).toEqual([]);
  });

  it('flags fixed-offset writes in a memory-safe block only when annotated', () => {
    const asm = '      mstore(0x80, 1)';
    expect(kinds(wrap(asm, { annotation: '("memory-safe")' }))).toEqual(['memory-safe-violation:medium']);
    expect(kinds(wrap(asm))).toEqual([]);
    expect(kinds(wrap('      mstore(0x00, 1)', { annotation: '("memory-safe")' }))).toEqual([]);
  });

  it('flags a low literal storage slot and accepts namespaced slots', () => {
    expect(kinds(wrap('      sstore(0, 1)'))).toEqual(['fixed-storage-slot-write:medium']);
    expect(kinds(wrap('      sstore(SLOT, 1)'))).toEqual([]);
    expect(kinds(wrap('      sstore(0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc, 1)'))).toEqual([]);
  });

  it('flags a caller-controlled storage slot, with lower severity when guarded or internal', () => {
    const asm = '      sstore(slot, v)';
    const params = 'bytes32 slot, uint256 v';
    expect(kinds(wrap(asm, { params }))).toEqual(['user-controlled-storage-slot:high']);
    expect(kinds(wrap(asm, { params, mods: 'onlyOwner' }))).toEqual(['user-controlled-storage-slot:medium']);
    expect(kinds(wrap(asm, { params, header: 'internal' }))).toEqual(['user-controlled-storage-slot:medium']);
  });

  it('accepts a slot hashed into a namespace from a parameter', () => {
    const asm = `      mstore(0x00, k)
      let slot := keccak256(0x00, 0x20)
      sstore(slot, v)`;
    expect(kinds(wrap(asm, { params: 'address k, uint256 v' }))).toEqual([]);
  });

  it('produces deterministic findings', () => {
    const src = wrap('      mstore(0x40, 0x20)\n      sstore(0, 1)');
    expect(detectUnsafeAssembly(src)).toEqual(detectUnsafeAssembly(src));
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [undefined, 42, '', '   ', 'not solidity at all']) {
      const r = detectUnsafeAssembly(bad);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
    expect(() => detectUnsafeAssembly('contract A { function f() external { assembly { mstore(0x40, ')).not.toThrow();
  });
});

describe('detectUnsafeAssembly modifiers', () => {
  it('inspects assembly inside modifiers', () => {
    const src = `pragma solidity ^0.8.20;
contract Guard {
  modifier lock() {
    assembly { mstore(0x40, 0x20) }
    _;
  }
}`;
    expect(detectUnsafeAssembly(src).findings.map((f) => f.kind)).toEqual(['free-pointer-corruption']);
  });
});
