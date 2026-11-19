import { analyzeExpression, detectFixedPointPrecisionLoss } from "../detect-fixed-point-precision-loss";

const kinds = (expr: string) => analyzeExpression(expr).map((i) => i.kind);

describe("analyzeExpression (operation order)", () => {
  it("flags division before multiplication", () => {
    expect(kinds("a / b * c")).toEqual(["division-before-multiplication"]);
    expect(kinds("(a / b) * c")).toEqual(["division-before-multiplication"]);
    expect(kinds("c * (a / b)")).toEqual(["division-before-multiplication"]);
    expect(kinds("(a * b / c) * d")).toEqual(["division-before-multiplication"]);
  });

  it("flags chained divisions", () => {
    expect(kinds("a / WAD / WAD")).toEqual(["chained-division"]);
  });

  it("accepts multiply-then-divide and a single division", () => {
    expect(kinds("a * b / c")).toEqual([]);
    expect(kinds("(a * b) / c")).toEqual([]);
    expect(kinds("a * b / WAD")).toEqual([]);
    expect(kinds("(a / b) + c")).toEqual([]);
    expect(kinds("mulDiv(a, b, c)")).toEqual([]);
  });

  it("looks inside call arguments", () => {
    expect(kinds("transfer(to, a / b * c)")).toEqual(["division-before-multiplication"]);
  });

  it("treats exponent scales as part of the operand", () => {
    expect(kinds("a / 10 ** 18 * b")).toEqual(["division-before-multiplication"]);
    expect(kinds("a * b / 10 ** 18")).toEqual([]);
  });
});

describe("detectFixedPointPrecisionLoss", () => {
  it("flags the classic share-conversion truncation with a value-impact path", () => {
    const code = `pragma solidity ^0.8.20;
contract Vault {
  uint256 public totalAssets;
  uint256 public totalShares;
  function convertToShares(uint256 assets) external view returns (uint256) {
    return (assets / totalAssets) * totalShares;
  }
}`;
    const result = detectFixedPointPrecisionLoss(code);
    expect(result.detected).toBe(true);
    const f = result.findings[0];
    expect(f.severity).toBe("medium");
    expect(f.message).toContain("returned by public/external convertToShares()");
    expect(f.line).toBe(6);
  });

  it("accepts the multiply-first form", () => {
    const code = `contract Vault {
  uint256 public totalAssets;
  uint256 public totalShares;
  function convertToShares(uint256 assets) external view returns (uint256) {
    return (assets * totalShares) / totalAssets;
  }
}`;
    expect(detectFixedPointPrecisionLoss(code).detected).toBe(false);
  });

  it("reports a low-severity, hedged finding when no value-impact path exists", () => {
    const code = `contract M {
  uint256 constant WAD = 1e18;
  function _scale(uint256 a, uint256 b) internal pure returns (uint256 r) {
    r = a / WAD / WAD * b;
  }
}`;
    const result = detectFixedPointPrecisionLoss(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].severity).toBe("low");
    expect(result.findings[0].message).toContain("may be harmless");
    expect(result.findings[0].evidence.join(" ")).toContain("WAD");
  });

  it("finds the path when the truncated value reaches a transfer", () => {
    const code = `contract Rewards {
  function claimRewards(uint256 amount, uint256 total, uint256 pool) external {
    uint256 payout = amount / total * pool;
    token.transfer(msg.sender, payout);
  }
}`;
    const result = detectFixedPointPrecisionLoss(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].severity).toBe("medium");
    expect(result.findings[0].evidence.join(" ")).toContain("payout reaches");
  });

  it("ignores events and statements without division", () => {
    const code = `contract E {
  event Rate(uint256 r);
  function f(uint256 a, uint256 b) external { emit Rate(a / b * 2); uint256 x = a * b; }
}`;
    expect(detectFixedPointPrecisionLoss(code).detected).toBe(false);
  });

  it("fails safely on malformed or unsupported input", () => {
    for (const bad of ["contract A { function f() external {", "", "let x = 1 / 2 * 3;"]) {
      const result = detectFixedPointPrecisionLoss(bad);
      expect(result.detected).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
