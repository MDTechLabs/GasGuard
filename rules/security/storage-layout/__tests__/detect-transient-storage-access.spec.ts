import { detectTransientStorageAccess } from '../detect-transient-storage-access';

const wrap = (body: string, pragma = '^0.8.24', extra = '') => `pragma solidity ${pragma};
contract Lock {
  bytes32 constant SLOT = keccak256("lock");
${extra}
  function guarded() external {
${body}
  }
}`;
const kinds = (src: string) => detectTransientStorageAccess(src).findings.map((f) => `${f.kind}:${f.severity}`);

const LOCK = '    assembly { if tload(SLOT) { revert(0, 0) } tstore(SLOT, 1) }';

describe('detectTransientStorageAccess', () => {
  it('flags a lock that is set but never released', () => {
    const r = detectTransientStorageAccess(wrap(LOCK));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ ruleId: 'GG-TSTORE-001', kind: 'transient-value-never-reset', severity: 'medium', confidence: 'high', contract: 'Lock', function: 'guarded' });
    expect(r.slots).toEqual([{ contract: 'Lock', slot: 'SLOT', sets: 1, resets: 0, loads: 1 }]);
  });

  it('accepts a lock that is released', () => {
    expect(kinds(wrap(`${LOCK}\n    assembly { tstore(SLOT, 0) }`))).toEqual([]);
  });

  it('rates a leftover non-lock value low', () => {
    expect(kinds(wrap('    assembly { tstore(SLOT, 5) }'))).toEqual(['transient-value-never-reset:low']);
  });

  it('flags a slot that is read but never written', () => {
    expect(kinds(wrap('    assembly { let v := tload(SLOT) }'))).toEqual(['transient-read-never-written:low']);
  });

  it('tracks transient state variables', () => {
    const body = '    require(!locked);\n    locked = true;';
    const extra = '  bool transient locked;';
    expect(kinds(wrap(body, '^0.8.28', extra))).toEqual(['transient-value-never-reset:medium']);
    expect(kinds(wrap(`${body}\n    locked = false;`, '^0.8.28', extra))).toEqual([]);
  });

  it('flags delegatecall in a function that holds transient state', () => {
    const body = `    assembly { tstore(SLOT, 1) }
    (bool ok, ) = target.delegatecall(data);
    assembly { tstore(SLOT, 0) }`;
    expect(kinds(wrap(body))).toEqual(['delegatecall-shares-transient-storage:low']);
  });

  it('flags pragmas that cannot select a compiler with transient storage', () => {
    const body = '    assembly { tstore(SLOT, 1) tstore(SLOT, 0) }';
    expect(kinds(wrap(body, '0.8.20'))).toEqual(['unsupported-compiler-version:low']);
    expect(kinds(wrap(body, '>=0.8.0 <0.8.24'))).toEqual(['unsupported-compiler-version:low']);
    expect(kinds(wrap(body, '^0.8.20'))).toEqual([]);
    expect(kinds(wrap('    locked = true;\n    locked = false;', '0.8.26', '  bool transient locked;'))).toEqual(['unsupported-compiler-version:low']);
  });

  it('produces deterministic findings', () => {
    const src = wrap(LOCK);
    expect(detectTransientStorageAccess(src)).toEqual(detectTransientStorageAccess(src));
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [undefined, null, 7, '', 'pragma solidity ^0.8.24;']) {
      const r = detectTransientStorageAccess(bad);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
    }
    expect(() => detectTransientStorageAccess('contract A { function f() external { assembly { tstore(')).not.toThrow();
  });
});
