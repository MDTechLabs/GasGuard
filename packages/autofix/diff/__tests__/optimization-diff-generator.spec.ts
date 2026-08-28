import {
  generateOptimizationDiff,
  FixInstruction,
} from '../optimization-diff-generator';

const SOURCE = `fn transfer(env: Env, amount: i128) {\n    let balance = env.storage().persistent().get(&DataKey::Balance).unwrap();\n    let new_balance = balance - amount;\n    env.storage().persistent().set(&DataKey::Balance, &new_balance);\n}`;

describe('generateOptimizationDiff', () => {
  it('preserves the original source', () => {
    const fix: FixInstruction = {
      startLine: 2,
      endLine: 2,
      replacement: ['    // OPTIMIZED: cached balance read'],
      description: 'Cache storage read',
    };
    const result = generateOptimizationDiff(SOURCE, 'contract.rs', [fix]);
    expect(result.originalSource).toBe(SOURCE);
  });

  it('generates a unified-diff patch with --- and +++ headers', () => {
    const fix: FixInstruction = {
      startLine: 1,
      endLine: 1,
      replacement: ['fn transfer(env: Env, amount: u128) {'],
      description: 'Use unsigned type',
    };
    const result = generateOptimizationDiff(SOURCE, 'contract.rs', [fix]);
    expect(result.patch).toContain('--- a/contract.rs');
    expect(result.patch).toContain('+++ b/contract.rs');
    expect(result.patch).toContain('-fn transfer');
    expect(result.patch).toContain('+fn transfer');
  });

  it('supports multiple fixes', () => {
    const fixes: FixInstruction[] = [
      { startLine: 1, endLine: 1, replacement: ['fn transfer(env: Env, amount: u128) {'], description: 'a' },
      { startLine: 4, endLine: 4, replacement: ['    // batched write'], description: 'b' },
    ];
    const result = generateOptimizationDiff(SOURCE, 'contract.rs', fixes);
    expect(result.hunks).toHaveLength(2);
  });
});
