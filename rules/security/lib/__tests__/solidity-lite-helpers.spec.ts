import {
  endpointAuthentication,
  extractContracts,
  extractFunctions,
  extractStateVars,
  findEffects,
  findOracleReads,
  maskCommentsAndStrings,
  modifierBodies,
  msgSenderComparands,
  statementsOf,
} from '../solidity-lite';

const SRC = `
contract Bridge {
  address public endpoint;
  mapping(bytes32 => bool) public done;
  uint256 public total;
  modifier onlyGate() { require(msg.sender == endpoint, "no"); _; }
  function viaModifier(bytes32 id) external onlyGate { done[id] = true; }
  function viaBody(bytes32 id) external {
    require(msg.sender == address(endpoint));
    done[id] = true;
    total += 1;
    token.mint(msg.sender, 1);
    uint256 local = 5;
  }
  function open(bytes32 id) external { done[id] = true; }
  function loop() external { for (uint i = 0; i < 3; i++) { total = i; } }
}
`;

function setup() {
  const masked = maskCommentsAndStrings(SRC);
  const contracts = extractContracts(masked);
  const fns = extractFunctions(masked, SRC, contracts);
  const stateNames = new Set(extractStateVars(masked, SRC, contracts).map((v) => v.name));
  return { fns, stateNames, mods: modifierBodies(fns) };
}

describe('solidity-lite helpers', () => {
  it('splits bodies into statements without splitting for-loop headers', () => {
    const { fns } = setup();
    const loop = fns.find((f) => f.name === 'loop')!;
    const texts = statementsOf(loop, SRC).map((s) => s.text);
    expect(texts).toContain('for (uint i = 0; i < 3; i++)');
    expect(texts).toContain('total = i');
  });

  it('keeps call-option braces inside a statement and still splits control-flow blocks', () => {
    const src = `contract C { function f(address to, uint256 v) external { (bool ok, ) = to.call{gas: 2300, value: v}(""); if (!ok) { revert(); } } }`;
    const masked = maskCommentsAndStrings(src);
    const fn = extractFunctions(masked, src).find((f) => f.name === 'f')!;
    expect(statementsOf(fn, src).map((s) => s.text)).toEqual([
      '(bool ok, ) = to.call{gas: 2300, value: v}("")',
      'if (!ok)',
      'revert()',
    ]);
  });

  it('reads msg.sender comparands in both orders', () => {
    expect(msgSenderComparands('require(msg.sender == endpoint); if (router != msg.sender) revert();')).toEqual([
      'endpoint',
      'router',
    ]);
  });

  it('detects endpoint authentication via modifier body and via inline check', () => {
    const { fns, mods } = setup();
    const byName = (n: string) => fns.find((f) => f.name === n)!;
    expect(endpointAuthentication(byName('viaModifier'), mods).authenticated).toBe(true);
    expect(endpointAuthentication(byName('viaBody'), mods).authenticated).toBe(true);
    expect(endpointAuthentication(byName('open'), mods)).toEqual({ authenticated: false, evidence: [] });
  });

  it('finds value transfers and state writes but not local declarations', () => {
    const { fns, stateNames } = setup();
    const effects = findEffects(fns.find((f) => f.name === 'viaBody')!, stateNames, SRC);
    expect(effects.map((e) => [e.kind, e.statement.text])).toEqual([
      ['state-write', 'done[id] = true'],
      ['state-write', 'total += 1'],
      ['value-transfer', 'token.mint(msg.sender, 1)'],
    ]);
  });
});

describe('findOracleReads', () => {
  const ORACLE_SRC = `
contract Lender {
  function a() external view returns (uint256) {
    (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
    return uint256(answer);
  }
  function b() external view returns (int256) {
    int256 p = feeds[token].latestAnswer();
    uint256 q;
    q = oracle.getPrice(token);
    return p;
  }
  function c() external view returns (uint256) {
    (, int256 answer, , , ) = sequencer.latestRoundData();
    return uint256(answer);
  }
  function d(uint256 x) external pure returns (uint256) { return x + 1; }
}
`;
  const fns = () => {
    const masked = maskCommentsAndStrings(ORACLE_SRC);
    return extractFunctions(masked, ORACLE_SRC);
  };
  it('reads named round-data tuple members by position', () => {
    const [read] = findOracleReads(fns().find((f) => f.name === 'a')!, ORACLE_SRC);
    expect(read.feed).toBe('feed');
    expect(read.method).toBe('latestRoundData');
    expect(read.roundData).toEqual({ roundId: 'roundId', answer: 'answer', updatedAt: 'updatedAt', answeredInRound: 'answeredInRound' });
  });

  it('tracks single-value price calls and their receiving variables', () => {
    const reads = findOracleReads(fns().find((f) => f.name === 'b')!, ORACLE_SRC);
    expect(reads.map((r) => [r.feed, r.method, r.resultVar])).toEqual([
      ['feeds[token]', 'latestAnswer', 'p'],
      ['oracle', 'getPrice', 'q'],
    ]);
  });

  it('leaves unnamed tuple positions undefined and ignores functions without reads', () => {
    const [read] = findOracleReads(fns().find((f) => f.name === 'c')!, ORACLE_SRC);
    expect(read.roundData).toEqual({ answer: 'answer' });
    expect(findOracleReads(fns().find((f) => f.name === 'd')!, ORACLE_SRC)).toEqual([]);
  });
});
