import { analyzeRoundingPaths, detectRoundingAsymmetry, roundingOf } from "../detect-rounding-direction-asymmetry";

const VAULT_HEAD = `pragma solidity ^0.8.20;
contract Vault {
  uint256 public totalAssets;
  uint256 public totalSupply;
`;

describe("roundingOf", () => {
  it("recognises floor and ceiling idioms", () => {
    expect(roundingOf("x = a * b / c")).toBe("floor");
    expect(roundingOf("x = Math.mulDiv(a, b, c)")).toBe("floor");
    expect(roundingOf("x = FixedPoint.mulDivUp(a, b, c)")).toBe("ceil");
    expect(roundingOf("x = Math.mulDiv(a, b, c, Math.Rounding.Ceil)")).toBe("ceil");
    expect(roundingOf("x = (a * b + c - 1) / c")).toBe("ceil");
    expect(roundingOf("x = a + b")).toBeNull();
  });
});

describe("detectRoundingAsymmetry", () => {
  it("flags user-favoring rounding in deposit and withdraw under the default policy", () => {
    const code = `${VAULT_HEAD}  function deposit(uint256 assets) external returns (uint256 shares) {
    shares = Math.mulDivUp(assets, totalSupply, totalAssets);
  }
  function withdraw(uint256 assets) external returns (uint256 shares) {
    shares = assets * totalSupply / totalAssets;
  }
}`;
    const result = detectRoundingAsymmetry(code);
    expect(result.detected).toBe(true);
    const byFn = Object.fromEntries(result.findings.map((f) => [f.functionName, f]));
    expect(byFn.deposit.severity).toBe("high");
    expect(byFn.deposit.message).toContain("rounds up");
    expect(byFn.deposit.message).toContain("requires rounding down");
    expect(byFn.withdraw.message).toContain("rounds down");
    expect(byFn.withdraw.message).toContain("requires rounding up");
    expect(byFn.deposit.evidence.join(" ")).toContain("dust-sized");
  });

  it("accepts asymmetric rounding that matches the policy", () => {
    const code = `${VAULT_HEAD}  function deposit(uint256 assets) external returns (uint256 shares) {
    shares = Math.mulDiv(assets, totalSupply, totalAssets);
  }
  function mint(uint256 shares) external returns (uint256 assets) {
    assets = Math.mulDivUp(shares, totalAssets, totalSupply);
  }
  function withdraw(uint256 assets) external returns (uint256 shares) {
    shares = (assets * totalSupply + totalAssets - 1) / totalAssets;
  }
  function redeem(uint256 shares) external returns (uint256 assets) {
    assets = shares * totalAssets / totalSupply;
  }
}`;
    expect(detectRoundingAsymmetry(code).detected).toBe(false);
    const paths = analyzeRoundingPaths(code);
    expect(paths.map((p) => `${p.functionName}:${p.direction}`).sort()).toEqual(["deposit:floor", "mint:ceil", "redeem:floor", "withdraw:ceil"]);
  });

  it("follows a delegating action to the preview it calls", () => {
    const code = `${VAULT_HEAD}  function deposit(uint256 assets) external returns (uint256) {
    return previewDeposit(assets);
  }
  function previewDeposit(uint256 assets) public view returns (uint256) {
    return Math.mulDivUp(assets, totalSupply, totalAssets);
  }
}`;
    const result = detectRoundingAsymmetry(code);
    expect(result.findings.some((f) => f.functionName === "deposit" && f.message.includes("through previewDeposit()"))).toBe(true);
    expect(result.findings.some((f) => f.functionName === "previewDeposit" && f.severity === "medium")).toBe(true);
  });

  it("skips functions whose direction is chosen by a Rounding parameter", () => {
    const code = `${VAULT_HEAD}  function convertToShares(uint256 assets, Math.Rounding rounding) public view returns (uint256) {
    return assets.mulDiv(totalSupply, totalAssets, rounding);
  }
}`;
    expect(detectRoundingAsymmetry(code).detected).toBe(false);
  });

  it("checks only action/preview agreement under the paired-only policy", () => {
    const code = `${VAULT_HEAD}  function deposit(uint256 assets) external returns (uint256 shares) {
    shares = Math.mulDivUp(assets, totalSupply, totalAssets);
  }
  function previewDeposit(uint256 assets) public view returns (uint256 shares) {
    shares = assets * totalSupply / totalAssets;
  }
}`;
    const result = detectRoundingAsymmetry(code, { policy: "paired-only" });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toContain("preview");
    const consistent = code.replace("Math.mulDivUp(assets, totalSupply, totalAssets)", "assets * totalSupply / totalAssets");
    expect(detectRoundingAsymmetry(consistent, { policy: "paired-only" }).detected).toBe(false);
  });

  it("honors a rounding-policy comment and the none policy", () => {
    const code = `// rounding-policy: none
${VAULT_HEAD}  function deposit(uint256 assets) external returns (uint256 shares) {
    shares = Math.mulDivUp(assets, totalSupply, totalAssets);
  }
}`;
    expect(detectRoundingAsymmetry(code).detected).toBe(false);
  });

  it("warns about an unknown declared policy and falls back to the default", () => {
    const code = `// rounding-policy: made-up
${VAULT_HEAD}  function deposit(uint256 assets) external returns (uint256 shares) {
    shares = Math.mulDivUp(assets, totalSupply, totalAssets);
  }
}`;
    const result = detectRoundingAsymmetry(code);
    expect(result.detected).toBe(true);
    expect(result.diagnostics.some((d) => d.level === "warning")).toBe(true);
  });

  it("fails safely on malformed or unsupported input", () => {
    for (const bad of ["contract V { function deposit() external {", "", "shares = a / b;"]) {
      const result = detectRoundingAsymmetry(bad);
      expect(result.detected).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
