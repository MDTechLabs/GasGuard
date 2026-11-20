import { detectSignedToUnsignedConversion } from "../detect-signed-to-unsigned-conversion";

describe("detectSignedToUnsignedConversion", () => {
  it("flags a caller-supplied int256 cast to uint256 and treats it as high severity", () => {
    const code = `pragma solidity ^0.8.20;
contract Fees {
  uint256 public feeBps;
  function setFee(int256 fee) external {
    feeBps = uint256(fee);
  }
}`;
    const result = detectSignedToUnsignedConversion(code);
    expect(result.detected).toBe(true);
    const f = result.findings[0];
    expect(f.severity).toBe("high");
    expect(f.line).toBe(5);
    expect(f.evidence.join(" ")).toContain("external input fee");
    expect(f.message).toContain("fee >= 0");
  });

  it("accepts a dominating require(x >= 0)", () => {
    const code = `contract Fees {
  uint256 public feeBps;
  function setFee(int256 fee) external {
    require(fee >= 0, "negative");
    feeBps = uint256(fee);
  }
}`;
    expect(detectSignedToUnsignedConversion(code).detected).toBe(false);
  });

  it("accepts an if-revert guard on a negative value", () => {
    const code = `contract Fees {
  uint256 public feeBps;
  function setFee(int256 fee) external {
    if (fee < 0) revert();
    feeBps = uint256(fee);
  }
}`;
    expect(detectSignedToUnsignedConversion(code).detected).toBe(false);
  });

  it("does not accept a guard on a different variable", () => {
    const code = `contract Fees {
  uint256 public feeBps;
  function setFee(int256 fee, int256 other) external {
    require(other >= 0);
    feeBps = uint256(fee);
  }
}`;
    expect(detectSignedToUnsignedConversion(code).detected).toBe(true);
  });

  it("flags a signed arithmetic result that is cast back", () => {
    const code = `contract Ledger {
  mapping(address => uint256) public balances;
  function settle(uint256 a, uint256 b) external {
    int256 delta = int256(a) - int256(b);
    balances[msg.sender] = uint256(delta);
  }
}`;
    const result = detectSignedToUnsignedConversion(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].evidence.join(" ")).toContain("signed arithmetic result");
  });

  it("flags oracle answers cast without a positivity check", () => {
    const code = `contract Oracle {
  uint256 public price;
  function refresh() external {
    (, int256 answer, , , ) = feed.latestRoundData();
    price = uint256(answer);
  }
}`;
    const result = detectSignedToUnsignedConversion(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].confidence).toBe("medium");
  });

  it("notes when the cast also narrows the value", () => {
    const code = `contract N {
  uint8 public level;
  function set(int256 v) external { level = uint8(v); }
}`;
    const result = detectSignedToUnsignedConversion(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].message).toContain("also truncates");
  });

  it("does not flag SafeCast, abs normalisation or unsigned-to-unsigned casts", () => {
    const code = `contract Safe {
  uint256 public a;
  uint128 public b;
  function f(int256 x, uint256 y) external {
    a = SafeCast.toUint256(x);
    a = uint256(x < 0 ? -x : x);
    b = uint128(y);
  }
}`;
    expect(detectSignedToUnsignedConversion(code).detected).toBe(false);
  });

  it("fails safely on malformed or unsupported input", () => {
    for (const bad of ["contract A { function f( {", "", "uint256 x = uint256(y);"]) {
      const result = detectSignedToUnsignedConversion(bad);
      expect(result.detected).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
