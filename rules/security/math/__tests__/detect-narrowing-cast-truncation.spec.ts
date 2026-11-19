import { detectNarrowingCastTruncation } from "../detect-narrowing-cast-truncation";

describe("detectNarrowingCastTruncation", () => {
  it("flags a raw uint256 -> uint128 cast that feeds accounting", () => {
    const code = `pragma solidity ^0.8.20;
contract Pool {
  mapping(address => uint128) public balances;
  function deposit(uint256 amount) external {
    balances[msg.sender] += uint128(amount);
  }
}`;
    const result = detectNarrowingCastTruncation(code);
    expect(result.detected).toBe(true);
    const f = result.findings[0];
    expect(f.severity).toBe("high");
    expect(f.line).toBe(5);
    expect(f.evidence.join(" ")).toContain("source width 256 bits, target 128 bits");
    expect(f.evidence.join(" ")).toContain("accounting");
  });

  it("accepts a type(uintN).max range check before the cast", () => {
    const code = `contract Pool {
  mapping(address => uint128) public balances;
  function deposit(uint256 amount) external {
    require(amount <= type(uint128).max, "too big");
    balances[msg.sender] += uint128(amount);
  }
}`;
    expect(detectNarrowingCastTruncation(code).detected).toBe(false);
  });

  it("accepts a named upper bound and a verified round trip", () => {
    const bounded = `contract P {
  uint256 constant MAX_STAKE = 1e30;
  uint128 public staked;
  function stake(uint256 amount) external {
    if (amount > MAX_STAKE) revert();
    staked = uint128(amount);
  }
}`;
    const roundTrip = `contract P {
  uint128 public staked;
  function stake(uint256 amount) external {
    uint128 narrowed = uint128(amount);
    require(uint256(narrowed) == amount);
    staked = narrowed;
  }
}`;
    expect(detectNarrowingCastTruncation(bounded).detected).toBe(false);
    expect(detectNarrowingCastTruncation(roundTrip).detected).toBe(false);
  });

  it("does not match checked-cast library calls but does flag raw casts next to them", () => {
    const safe = `contract S {
  uint128 public v;
  function set(uint256 x) external { v = SafeCast.toUint128(x); }
}`;
    const unsafe = `contract S {
  uint128 public v;
  function set(uint256 x) external { v = uint128(x); }
}`;
    expect(detectNarrowingCastTruncation(safe).detected).toBe(false);
    expect(detectNarrowingCastTruncation(unsafe).detected).toBe(true);
  });

  it("accepts the guarded cast inside a checked-cast helper library", () => {
    const code = `library MySafeCast {
  function toUint128(uint256 value) internal pure returns (uint128) {
    require(value <= type(uint128).max, "overflow");
    return uint128(value);
  }
}`;
    expect(detectNarrowingCastTruncation(code).detected).toBe(false);
  });

  it("ranks a timestamp truncation below accounting and marks it as a timestamp", () => {
    const code = `contract T {
  uint32 public lastUpdate;
  function touch() external { lastUpdate = uint32(block.timestamp); }
}`;
    const result = detectNarrowingCastTruncation(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].severity).toBe("medium");
    expect(result.findings[0].evidence.join(" ")).toContain("timestamp");
  });

  it("ignores widening casts, literals and type(...) expressions", () => {
    const code = `contract W {
  function f(uint128 a) external pure returns (uint256 b, uint8 c, uint128 d) {
    b = uint256(a);
    c = uint8(7);
    d = uint128(type(uint64).max);
  }
}`;
    expect(detectNarrowingCastTruncation(code).detected).toBe(false);
  });

  it("covers signed narrowing (int256 -> int128)", () => {
    const code = `contract Q {
  int128 public delta;
  function apply(int256 d) external { delta = int128(d); }
}`;
    const result = detectNarrowingCastTruncation(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].message).toContain("int256");
  });

  it("reports unknown-width value-like operands at low confidence only", () => {
    const code = `contract U {
  function f() external { uint64 x = uint64(computeAmount()); }
  function computeAmount() internal pure returns (uint256) { return 1; }
}`;
    const result = detectNarrowingCastTruncation(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].confidence).toBe("low");
  });

  it("fails safely on malformed or unsupported input", () => {
    for (const bad of ["library L { function f() {", "", "uint8 x = uint8(y);"]) {
      const result = detectNarrowingCastTruncation(bad);
      expect(result.detected).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
