import { detectUncheckedArithmeticInvariants } from "../detect-unchecked-arithmetic-invariants";
import { toNormalizedFindings } from "../../_shared/solidity-source";

const lineOf = (code: string, needle: string) => code.split("\n").findIndex((l) => l.includes(needle)) + 1;

describe("detectUncheckedArithmeticInvariants", () => {
  it("flags an unchecked subtraction with no bound and names the missing invariant", () => {
    const code = `pragma solidity ^0.8.20;
contract Vault {
  mapping(address => uint256) public balances;
  function withdraw(uint256 amount) external {
    unchecked {
      balances[msg.sender] = balances[msg.sender] - amount;
    }
  }
}`;
    const result = detectUncheckedArithmeticInvariants(code);
    expect(result.detected).toBe(true);
    const f = result.findings[0];
    expect(f.ruleId).toBe("arith-unchecked-invariants");
    expect(f.severity).toBe("high");
    expect(f.message).toContain("balances >= amount");
    expect(f.line).toBe(lineOf(code, "- amount"));
    expect(f.functionName).toBe("withdraw");
  });

  it("accepts the subtraction when a dominating require relates both operands", () => {
    const code = `pragma solidity ^0.8.20;
contract Vault {
  mapping(address => uint256) public balances;
  function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount, "insufficient");
    unchecked {
      balances[msg.sender] = balances[msg.sender] - amount;
    }
  }
}`;
    expect(detectUncheckedArithmeticInvariants(code).detected).toBe(false);
  });

  it("accepts an if-revert guard written with braces", () => {
    const code = `contract V {
  uint256 public total;
  function sub(uint256 a, uint256 b) external {
    if (a < b) {
      revert();
    }
    unchecked { total = a - b; }
  }
}`;
    expect(detectUncheckedArithmeticInvariants(code).detected).toBe(false);
  });

  it("does not accept a guard that only exists in a sibling branch", () => {
    const code = `contract V {
  uint256 public total;
  function sub(uint256 a, uint256 b, bool flag) external {
    if (flag) {
      require(a >= b);
    }
    unchecked { total = a - b; }
  }
}`;
    expect(detectUncheckedArithmeticInvariants(code).detected).toBe(true);
  });

  it("accepts the loop counter idiom bounded by the loop condition", () => {
    const code = `contract V {
  function run(uint256[] calldata items) external {
    for (uint256 i = 0; i < items.length; ) {
      process(items[i]);
      unchecked { ++i; }
    }
  }
  function process(uint256 x) internal {}
}`;
    expect(detectUncheckedArithmeticInvariants(code).detected).toBe(false);
  });

  it("flags an accumulator inside an unchecked loop body as medium when no caller input is involved", () => {
    const code = `contract V {
  function _sum(uint256[] memory v) internal pure returns (uint256 total) {
    for (uint256 i = 0; i < v.length; i++) {
      unchecked { total += v[i]; }
    }
  }
}`;
    const result = detectUncheckedArithmeticInvariants(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].severity).toBe("medium");
    expect(result.findings[0].evidence.join(" ")).toContain("loop");
  });

  it("ignores constant-only arithmetic", () => {
    const code = `contract V { function f() external pure returns (uint256 x) { unchecked { x = 2 + 3; } } }`;
    expect(detectUncheckedArithmeticInvariants(code).detected).toBe(false);
  });

  it("handles multiplication with a bound on only one operand as a finding", () => {
    const code = `contract V {
  function scale(uint256 a, uint256 b) external pure returns (uint256 r) {
    require(a < 1e18);
    unchecked { r = a * b; }
  }
}`;
    expect(detectUncheckedArithmeticInvariants(code).detected).toBe(true);
  });

  it("produces the normalized finding shape", () => {
    const code = `contract V {
  function f(uint256 a, uint256 b) external pure returns (uint256 r) {
    unchecked { r = a - b; }
  }
}`;
    const normalized = toNormalizedFindings(detectUncheckedArithmeticInvariants(code), "V.sol");
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      ruleId: "arith-unchecked-invariants",
      severity: "high",
      location: { file: "V.sol", startLine: 3, endLine: 3 },
    });
    expect(normalized[0].suggestedFix.documentationUrl).toContain("arith-unchecked-invariants");
  });

  it("fails safely on malformed, empty, non-string and non-Solidity input", () => {
    for (const bad of ["contract A { function f() external {", "", "   ", "fn main() {}"]) {
      const result = detectUncheckedArithmeticInvariants(bad);
      expect(result.detected).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
    expect(detectUncheckedArithmeticInvariants(undefined as unknown as string).detected).toBe(false);
  });

  it("warns that pre-0.8 sources use different arithmetic semantics", () => {
    const code = `pragma solidity ^0.7.6;
contract V { function f(uint256 a, uint256 b) external pure returns (uint256) { unchecked { return a - b; } } }`;
    const result = detectUncheckedArithmeticInvariants(code);
    expect(result.diagnostics.some((d) => d.level === "warning")).toBe(true);
  });
});
