import { detectExpensiveSLOADOperations } from '../../rules/optimization/storage/detect-expensive-sload-operations';

describe('detectExpensiveSLOADOperations', () => {
  it('flags repeated SLOAD operations', () => {
    const code = `let a = storage().instance().get(&key);
let b = storage().instance().get(&key);`;
    const result = detectExpensiveSLOADOperations(code);
    expect(result.detected).toBe(true);
    expect(result.sloads.some(s => s.type === 'repeated-sload')).toBe(true);
  });

  it('flags SLOAD in loop', () => {
    const code = `for i in 0..n {
    let val = storage().instance().get(&key);
}`;
    const result = detectExpensiveSLOADOperations(code);
    expect(result.detected).toBe(true);
  });

  it('returns clean for single cached read', () => {
    const code = `let val = storage().instance().get(&key);
process(val);
update(val);`;
    const result = detectExpensiveSLOADOperations(code);
    expect(result.detected).toBe(false);
  });
});
