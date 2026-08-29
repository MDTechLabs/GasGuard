import { parseRust } from '../../../../parsers/rust/rust-ast-parser';
import {
  BaseSorobanVisitor,
  VisitorRegistry,
  walkAst,
  type SorobanAstVisitor,
} from '../visitor';

const SOURCE = `
#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    pub fn deposit(env: Env, user: Address, amount: i128) {
        user.require_auth();
        env.invoke_contract(&user, &Symbol::new(&env, "deposit"), (amount,));
        env.storage().instance().set(&user, &amount);
    }

    pub fn withdraw(env: Env, user: Address) -> i128 {
        env.storage().instance().get(&user).unwrap_or(0)
    }
}

#[contracttype]
pub struct Order {
    pub maker: Address,
}
`;

function buildVisitor(id: string, onto: Record<string, number[]>): SorobanAstVisitor {
  const push = (key: string, value: number) => {
    (onto[key] ??= []).push(value);
  };
  return {
    id,
    enterContract: (ast) => push('enterContract', ast.impls.length),
    enterImpl: (n) => push('enterImpl', 1),
    enterFunction: (n) => push('enterFunction', n.name.length),
    visitParam: (p) => push('visitParam', p.name.length),
    visitCall: (c) => push('visitCall', c.length),
    visitStorageOp: (op) => push('visitStorageOp', 1),
    exitFunction: () => push('exitFunction', 1),
  };
}

describe('AstVisitor (#792)', () => {
  it('walks contract, impl, function and param nodes', () => {
    const { ast } = parseRust(SOURCE);
    const onto: Record<string, number[]> = {};
    const visitor = buildVisitor('v1', onto);
    const result = walkAst(ast, visitor);

    expect(result.visitedImpls).toBe(1);
    expect(result.visitedFunctions).toBe(2);
    expect(result.visitedParams).toBeGreaterThan(0);
    // deposit + withdraw functions entered
    expect(onto.enterFunction!.length).toBe(2);
  });

  it('visits calls and storage ops', () => {
    const { ast } = parseRust(SOURCE);
    const onto: Record<string, number[]> = {};
    const visitor = buildVisitor('v1', onto);
    walkAst(ast, visitor);

    expect(onto.visitCall!.some((len) => len > 0)).toBe(true);
    expect(onto.visitStorageOp!.length).toBeGreaterThanOrEqual(2); // set + get
  });

  it('runs multiple visitors over the same AST', () => {
    const { ast } = parseRust(SOURCE);
    const a: Record<string, number[]> = {};
    const b: Record<string, number[]> = {};
    const result = walkAst(ast, [buildVisitor('a', a), buildVisitor('b', b)]);
    expect(result.visitorActivity['a']).toBeGreaterThan(0);
    expect(result.visitorActivity['b']).toBeGreaterThan(0);
  });

  it('lets rules register custom visitors via the registry', () => {
    const { ast } = parseRust(SOURCE);
    const registry = new VisitorRegistry();
    const hits: number[] = [];
    const custom = new BaseSorobanVisitor('soroban-test-rule');
    custom.enterFunction = () => hits.push(1);
    registry.register(custom);

    expect(registry.get('soroban-test-rule')).toBeDefined();
    registry.run(ast);
    expect(hits.length).toBe(2);
    registry.unregister('soroban-test-rule');
    expect(registry.get('soroban-test-rule')).toBeUndefined();
  });
});