import { parseRust } from '../rust-ast-parser';

const SAMPLE = `
use soroban_sdk::{env, contractimpl, contract, contracttype, Address, Symbol};

#[contract]
pub struct Router;

#[contractimpl]
impl Router {
    pub fn swap(env: Env, target: Address, amount: i128) -> Result<(), Error> {
        target.require_auth();
        env.invoke_contract(&target, &Symbol::new(&env, "swap"), (amount,));
        env.storage().instance().get(&target);
        Ok(())
    }

    fn helper(env: Env) -> u64 {
        env.storage().instance().set(&Symbol::new(&env, "x"), &1u64);
        1
    }
}

#[contracttype]
pub struct Offer {
    pub maker: Address,
    pub amount: i128,
    pub bytes: BytesN<32>,
}
`;

describe('RustAstParser (#791)', () => {
  it('parses contract structs and impls', () => {
    const { ast } = parseRust(SAMPLE, 'router.rs');
    expect(ast.filePath).toBe('router.rs');
    expect(ast.structs.length).toBeGreaterThanOrEqual(1);
    expect(ast.impls.length).toBeGreaterThanOrEqual(1);
    const router = ast.structs.find((s) => s.name === 'Router');
    expect(router?.isContract).toBe(true);
  });

  it('extracts functions inside impl blocks', () => {
    const { ast } = parseRust(SAMPLE);
    const impl = ast.impls.find((i) => i.target === 'Router')!;
    expect(impl.isContractImpl).toBe(true);
    const names = impl.functions.map((f) => f.name);
    expect(names).toContain('swap');
    expect(names).toContain('helper');
  });

  it('parses function parameters and return type', () => {
    const { ast } = parseRust(SAMPLE);
    const swap = ast.impls[0]!.functions.find((f) => f.name === 'swap')!;
    expect(swap.params.map((p) => p.name)).toEqual(['env', 'target', 'amount']);
    expect(swap.params.find((p) => p.name === 'target')?.typeName).toContain('Address');
    expect(swap.returnType).toContain('Result');
  });

  it('preserves source locations (1-based lines + offsets)', () => {
    const { ast } = parseRust(SAMPLE);
    const swap = ast.impls[0]!.functions.find((f) => f.name === 'swap')!;
    expect(swap.location.line).toBeGreaterThan(0);
    expect(swap.location.offset).toBeGreaterThanOrEqual(0);
    // swap fn appears on its own line in the sample (1-based)
    expect(swap.location.line).toBe(9);
  });

  it('exposes AST call and storage-op information', () => {
    const { ast } = parseRust(SAMPLE);
    const swap = ast.impls[0]!.functions.find((f) => f.name === 'swap')!;
    expect(swap.calls.some((c) => c.includes('invoke_contract'))).toBe(true);
    expect(swap.storageOps).toContain('get');
  });

  it('parses contracttype struct fields', () => {
    const { ast } = parseRust(SAMPLE);
    const offer = ast.structs.find((s) => s.name === 'Offer')!;
    expect(offer.isContractType).toBe(true);
    expect(offer.fields.map((f) => f.name)).toContain('maker');
    expect(offer.fields.find((f) => f.name === 'bytes')?.typeName).toContain('BytesN');
  });

  it('returns a warning diagnostic for non-contract input', () => {
    const { diagnostics } = parseRust('pub fn foo() { }', 'x.rs');
    expect(diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });

  it('never panics on empty input', () => {
    const { ast, diagnostics } = parseRust('');
    expect(ast.structs).toHaveLength(0);
    expect(typeof diagnostics.length).toBe('number');
  });
});