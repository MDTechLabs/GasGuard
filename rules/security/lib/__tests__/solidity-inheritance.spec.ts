import { Diagnostic, maskCommentsAndStrings } from '../solidity-lite';
import {
  buildSourceModel,
  calleesOf,
  formatModifierOrder,
  libraryCallTaint,
  modifierExecutionOrder,
} from '../solidity-inheritance';

function model(src: string) {
  const diagnostics: Diagnostic[] = [];
  return { source: buildSourceModel(maskCommentsAndStrings(src), src, diagnostics), diagnostics };
}

describe('inheritance and override chains (#1294)', () => {
  const DIAMOND = `
contract A { function f() public virtual returns (uint) { return 1; } }
contract B is A { function f() public virtual override returns (uint) { return super.f() + 1; } }
contract C is A { function f() public virtual override returns (uint) { return super.f() + 2; } }
contract D is B, C { function g() external returns (uint) { return f(); } }
`;

  it('uses the C3 order for a diamond (right-most base wins)', () => {
    const d = model(DIAMOND).source.contracts.get('D')!;
    expect(d.linearization.map((c) => c.name)).toEqual(['D', 'C', 'B', 'A']);
    expect(d.functions.find((f) => f.name === 'f')!.contract).toBe('C');
  });

  it('resolves super along the linearization, not the declared base', () => {
    const d = model(DIAMOND).source.contracts.get('D')!;
    const cf = d.functions.find((f) => f.name === 'f')!;
    expect(calleesOf(d, cf).map((f) => f.contract)).toEqual(['B']);
  });

  it('keeps single inheritance unchanged', () => {
    const b = model(DIAMOND).source.contracts.get('B')!;
    expect(b.linearization.map((c) => c.name)).toEqual(['B', 'A']);
  });

  it('reports an inconsistent hierarchy instead of throwing', () => {
    const { source, diagnostics } = model(`
contract A {}
contract B is A {}
contract Z is B, A { function h() external {} }
`);
    expect(source.contracts.get('Z')!.linearization[0].name).toBe('Z');
    expect(diagnostics.map((d) => d.code)).toContain('inconsistent-linearization');
  });

  it('survives an inheritance cycle', () => {
    const { source, diagnostics } = model('contract P is Q {} contract Q is P {}');
    expect(source.contracts.size).toBe(2);
    expect(diagnostics.some((d) => d.code === 'inconsistent-linearization')).toBe(true);
  });

  it('leaves bases that are not in the source unresolved', () => {
    const v = model('contract V is Ownable { function f() external {} }').source.contracts.get('V')!;
    expect(v.unresolvedBases).toEqual(['Ownable']);
  });
});

describe('modifier execution order (#1295)', () => {
  const SRC = `
contract Base { modifier m() virtual { require(true); _; } }
contract T is Base {
  uint s;
  modifier m() override { _; }
  modifier lock() { s = 1; _; s = 0; }
  modifier stop() { revert(); }
  constructor() Base() lock {}
  function f() external lock m { s = 2; }
  function g() external stop {}
  function h() external unknownMod {}
}
`;
  const t = model(SRC).source.contracts.get('T')!;
  const fn = (name: string) => t.functions.find((f) => f.name === name)!;

  it('lists modifiers left to right with the post-body code unwinding in reverse', () => {
    const steps = modifierExecutionOrder(t, fn('f'));
    expect(steps.map((s) => s.name)).toEqual(['lock', 'm']);
    expect(steps[0].before).toContain('s = 1');
    expect(steps[0].after).toContain('s = 0');
    expect(formatModifierOrder(steps)).toBe('lock > m > body > lock(after)');
  });

  it('uses the overriding modifier definition', () => {
    expect(modifierExecutionOrder(t, fn('f'))[1].definition!.contract).toBe('T');
  });

  it('flags a modifier without a placeholder as skipping the body', () => {
    expect(modifierExecutionOrder(t, fn('g'))[0].skipsBody).toBe(true);
  });

  it('keeps unknown modifiers without guessing their code', () => {
    const [step] = modifierExecutionOrder(t, fn('h'));
    expect(step).toMatchObject({ name: 'unknownMod', definition: undefined, skipsBody: false });
  });

  it('leaves base-constructor calls out of a constructor', () => {
    const ctor = model(SRC).source.allFunctions.find((f) => f.kind === 'constructor')!;
    expect(modifierExecutionOrder(t, ctor).map((s) => s.name)).toEqual(['lock']);
  });
});

describe('taint across internal library calls (#1296)', () => {
  const SRC = `
library L {
  function id(uint x) internal pure returns (uint) { uint y = x; return y + 1; }
  function zero(uint x) internal pure returns (uint) { x; return 0; }
  function named(uint x) internal pure returns (uint out) { out = L.id(x); }
  function pick(uint a, uint b) internal pure returns (uint) { return b; }
}
contract Vault { using L for uint; function f(uint amount) external {} }
`;
  const src = model(SRC).source;

  it('follows a tainted argument to the return value', () => {
    const r = libraryCallTaint(src, 'L.id(amount)', ['amount']);
    expect(r).toMatchObject({ tainted: true, resolved: true });
    expect(r.path[0]).toMatch(/^L\.id:\d+$/);
  });

  it('drops taint when the return value does not depend on it', () => {
    expect(libraryCallTaint(src, 'L.zero(amount)', ['amount']).tainted).toBe(false);
    expect(libraryCallTaint(src, 'L.id(other)', ['amount']).tainted).toBe(false);
  });

  it('maps arguments to the right parameters', () => {
    expect(libraryCallTaint(src, 'L.pick(amount, 5)', ['amount']).tainted).toBe(false);
    expect(libraryCallTaint(src, 'L.pick(5, amount)', ['amount']).tainted).toBe(true);
  });

  it('follows named returns and nested library calls', () => {
    const r = libraryCallTaint(src, 'L.named(amount)', ['amount']);
    expect(r.tainted).toBe(true);
    expect(r.path).toEqual(expect.arrayContaining([expect.stringMatching(/^L\.named:/), expect.stringMatching(/^L\.id:/)]));
  });

  it('handles using-for calls', () => {
    expect(libraryCallTaint(src, 'amount.id()', ['amount']).tainted).toBe(true);
  });

  it('treats a library outside the source as tainted but unresolved', () => {
    expect(libraryCallTaint(src, 'SafeMath.add(amount, 1)', ['amount'])).toMatchObject({ tainted: true, resolved: false });
  });

  it('does not throw on a malformed call', () => {
    expect(() => libraryCallTaint(src, 'L.id(amount', ['amount'])).not.toThrow();
  });
});
