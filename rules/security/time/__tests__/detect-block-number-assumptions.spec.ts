import { detectBlockNumberAssumptions } from "../detect-block-number-assumptions";

describe("detectBlockNumberAssumptions", () => {
  it("reports a fixed block-count lock with its duration on each target chain", () => {
    const code = `pragma solidity ^0.8.20;
contract Locker {
  mapping(address => uint256) public unlockBlock;
  function lock() external {
    unlockBlock[msg.sender] = block.number + 50400;
  }
}`;
    const result = detectBlockNumberAssumptions(code);
    expect(result.detected).toBe(true);
    const f = result.findings[0];
    expect(f.message).toContain("50400 blocks");
    expect(f.message).toContain("ethereum: 7d");
    expect(f.message).toContain("optimism: 28h");
    expect(f.severity).toBe("medium");
    expect(f.line).toBe(5);
    expect(result.diagnostics.some((d) => d.level === "info" && d.message.includes("Chain profile used"))).toBe(true);
  });

  it("resolves named block-count constants", () => {
    const code = `contract Timelock {
  uint256 public constant DELAY_BLOCKS = 7200;
  uint256 public queuedAt;
  function execute() external {
    require(block.number >= queuedAt + DELAY_BLOCKS, "early");
  }
}`;
    const result = detectBlockNumberAssumptions(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].message).toContain("7200 blocks");
  });

  it("reports hard-coded block-time conversions on chains with a different block time", () => {
    const code = `contract Vesting {
  uint256 public start;
  function elapsedSeconds() external view returns (uint256) {
    return (block.number - start) * 12;
  }
}`;
    const result = detectBlockNumberAssumptions(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].message).toContain("Assumes 12s per block");
    expect(result.findings[0].message).toContain("optimism");
    expect(result.findings[0].message).not.toContain("does not hold on ethereum");
  });

  it("derives the implied block time from BLOCKS_PER_DAY and SECONDS_PER_BLOCK constants", () => {
    const perDay = `contract A {
  uint256 constant BLOCKS_PER_DAY = 7200;
  uint256 public start;
  function days_() external view returns (uint256) { return (block.number - start) / BLOCKS_PER_DAY; }
}`;
    const perBlock = `contract B {
  uint256 constant SECONDS_PER_BLOCK = 2;
  function secs(uint256 blocks) external pure returns (uint256) { return blocks * SECONDS_PER_BLOCK; }
}`;
    expect(detectBlockNumberAssumptions(perDay).findings[0].message).toContain("BLOCKS_PER_DAY implies 12s per block");
    const b = detectBlockNumberAssumptions(perBlock);
    expect(b.findings[0].message).toContain("Assumes 2s per block");
    expect(b.findings[0].message).toContain("ethereum");
  });

  it("allows configuring the target chain profile", () => {
    const code = `contract Vesting {
  uint256 public start;
  function elapsedSeconds() external view returns (uint256) { return (block.number - start) * 12; }
}`;
    expect(detectBlockNumberAssumptions(code, { chains: ["ethereum"] }).detected).toBe(false);
    const custom = detectBlockNumberAssumptions(code, { chains: ["mychain"], profiles: { mychain: { blockTimeSeconds: 12 } } });
    expect(custom.detected).toBe(false);
    expect(custom.diagnostics.some((d) => d.message.includes("mychain (12s per block"))).toBe(true);
  });

  it("warns about unknown chains and invalid profiles instead of failing", () => {
    const code = `contract L { function f() external { uint256 u = block.number + 50400; } }`;
    const result = detectBlockNumberAssumptions(code, { chains: ["nowhere"], profiles: { bad: { blockTimeSeconds: -1 } } });
    expect(result.diagnostics.filter((d) => d.level === "warning").length).toBeGreaterThanOrEqual(2);
    expect(result.detected).toBe(true); // falls back to the default profile
  });

  it("ignores same-block and ordering uses of block.number", () => {
    const code = `contract Guard {
  uint256 public lastBlock;
  function act() external {
    require(block.number > lastBlock, "same block");
    lastBlock = block.number;
    bytes32 h = blockhash(block.number - 1);
    uint256 next = block.number + 1;
  }
}`;
    expect(detectBlockNumberAssumptions(code).detected).toBe(false);
  });

  it("fails safely on malformed or unsupported input", () => {
    for (const bad of ["contract A { function f() external {", "", "block.number + 50400;"]) {
      const result = detectBlockNumberAssumptions(bad);
      expect(result.detected).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
