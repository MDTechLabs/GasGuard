import { detectDivisionByZeroPaths } from "../detect-division-by-zero-paths";

describe("detectDivisionByZeroPaths", () => {
  it("reports a fee denominator that a setter can set to zero and names the missing guard", () => {
    const code = `pragma solidity ^0.8.20;
contract Fees {
  uint256 public feeDenominator = 10000;
  function setFeeDenominator(uint256 d) external onlyOwner { feeDenominator = d; }
  function fee(uint256 amount) external view returns (uint256) {
    return amount / feeDenominator;
  }
}`;
    const result = detectDivisionByZeroPaths(code);
    expect(result.detected).toBe(true);
    const f = result.findings[0];
    expect(f.message).toContain("fee denominator");
    expect(f.message).toContain("setFeeDenominator() can set feeDenominator to zero");
    expect(f.message).toContain("Missing guard: require(feeDenominator != 0)");
    expect(f.severity).toBe("medium");
    expect(f.line).toBe(6);
  });

  it("raises severity to high when the setter has no access modifier", () => {
    const code = `contract Fees {
  uint256 public feeDenominator = 10000;
  function setFeeDenominator(uint256 d) external { feeDenominator = d; }
  function fee(uint256 amount) external view returns (uint256) { return amount / feeDenominator; }
}`;
    expect(detectDivisionByZeroPaths(code).findings[0].severity).toBe("high");
  });

  it("accepts a guarded setter and a literal initial value", () => {
    const code = `contract Fees {
  uint256 public feeDenominator = 10000;
  function setFeeDenominator(uint256 d) external onlyOwner {
    require(d != 0, "zero");
    feeDenominator = d;
  }
  function fee(uint256 amount) external view returns (uint256) { return amount / feeDenominator; }
}`;
    expect(detectDivisionByZeroPaths(code).detected).toBe(false);
  });

  it("reports a caller-supplied divisor as high severity", () => {
    const code = `contract D {
  function ratio(uint256 a, uint256 b) external pure returns (uint256) {
    return a / b;
  }
}`;
    const result = detectDivisionByZeroPaths(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].severity).toBe("high");
    expect(result.findings[0].evidence.join(" ")).toContain("the caller supplies b");
  });

  it("treats a dominating require(b != 0) or if-revert as deliberate revert-on-zero", () => {
    const required = `contract D { function ratio(uint256 a, uint256 b) external pure returns (uint256) { require(b != 0, "zero"); return a / b; } }`;
    const reverted = `contract D { function ratio(uint256 a, uint256 b) external pure returns (uint256) { if (b == 0) revert(); return a % b; } }`;
    expect(detectDivisionByZeroPaths(required).detected).toBe(false);
    expect(detectDivisionByZeroPaths(reverted).detected).toBe(false);
  });

  it("reports empty-pool division by total supply", () => {
    const code = `contract Vault {
  uint256 public totalSupply;
  function convert(uint256 assets, uint256 totalAssets) external view returns (uint256) {
    return assets * totalSupply / totalAssets;
  }
}`;
    const result = detectDivisionByZeroPaths(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].message).toContain("totalAssets");
  });

  it("reports a deliberate silent zero return separately, at low severity", () => {
    const code = `contract Vault {
  uint256 public totalSupply;
  function price(uint256 assets) external view returns (uint256) {
    if (totalSupply == 0) return 0;
    return assets / totalSupply;
  }
}`;
    const result = detectDivisionByZeroPaths(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].severity).toBe("low");
    expect(result.findings[0].title).toContain("silent zero");
  });

  it("flags Yul div with an unchecked divisor as high severity and accepts an iszero check", () => {
    const bad = `contract Y {
  function f(uint256 a, uint256 b) external pure returns (uint256 r) {
    assembly { r := div(a, b) }
  }
}`;
    const good = `contract Y {
  function f(uint256 a, uint256 b) external pure returns (uint256 r) {
    assembly { if iszero(b) { revert(0, 0) } r := div(a, b) }
  }
}`;
    const result = detectDivisionByZeroPaths(bad);
    expect(result.detected).toBe(true);
    expect(result.findings[0].severity).toBe("high");
    expect(result.findings[0].title).toContain("Yul");
    expect(detectDivisionByZeroPaths(good).detected).toBe(false);
  });

  it("ignores literal and non-zero constant divisors", () => {
    const code = `contract C {
  uint256 public constant BPS = 10000;
  function f(uint256 a) external pure returns (uint256, uint256, uint256) {
    return (a / 10000, a / BPS, a / 1e18);
  }
}`;
    expect(detectDivisionByZeroPaths(code).detected).toBe(false);
  });

  it("fails safely on malformed or unsupported input", () => {
    for (const bad of ["contract A { function f() external { return 1 / x;", "", "x = a / b;"]) {
      const result = detectDivisionByZeroPaths(bad);
      expect(result.detected).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
