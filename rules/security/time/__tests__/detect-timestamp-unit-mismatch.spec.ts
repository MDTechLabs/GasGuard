import { detectTimestampUnitMismatch } from "../detect-timestamp-unit-mismatch";

const wrap = (body: string, head = "") => `pragma solidity ^0.8.20;
contract C {
${head}  function f() external {
${body}
  }
}`;

describe("detectTimestampUnitMismatch", () => {
  it("flags an expiry check that compares seconds with milliseconds", () => {
    const code = `contract Claims {
  mapping(address => uint256) public deadlineMs;
  function claim() external {
    require(block.timestamp < deadlineMs[msg.sender], "expired");
  }
}`;
    const result = detectTimestampUnitMismatch(code);
    expect(result.detected).toBe(true);
    const f = result.findings[0];
    expect(f.severity).toBe("high");
    expect(f.message).toContain("seconds vs milliseconds");
    expect(f.line).toBe(4);
  });

  it("flags a vesting end computed from a count of days and accepts the converted form", () => {
    const bad = wrap("    uint256 end = start + durationDays;", "  uint256 start;\n  uint256 durationDays;\n");
    const good = wrap("    uint256 end = start + durationDays * 1 days;", "  uint256 start;\n  uint256 durationDays;\n");
    const result = detectTimestampUnitMismatch(bad);
    expect(result.detected).toBe(true);
    expect(result.findings[0].message).toContain("durationDays [days]");
    expect(detectTimestampUnitMismatch(good).detected).toBe(false);
  });

  it("flags comparing a block number with a seconds-based cooldown", () => {
    const bad = wrap("    require(block.number >= lastCall + COOLDOWN_SECONDS);", "  uint256 lastCall;\n  uint256 constant COOLDOWN_SECONDS = 3600;\n");
    const good = wrap("    require(block.timestamp >= lastCall + COOLDOWN_SECONDS);", "  uint256 lastCall;\n  uint256 constant COOLDOWN_SECONDS = 3600;\n");
    const result = detectTimestampUnitMismatch(bad);
    expect(result.detected).toBe(true);
    expect(result.findings[0].title).toContain("Block count");
    expect(detectTimestampUnitMismatch(good).detected).toBe(false);
  });

  it("flags block.timestamp / 1000", () => {
    const result = detectTimestampUnitMismatch(wrap("    uint256 nowSec = block.timestamp / 1000;"));
    expect(result.detected).toBe(true);
    expect(result.findings[0].title).toContain("divided by 1000");
  });

  it("flags a seconds constant that is scaled by another time factor", () => {
    const bad = wrap("    uint256 end = block.timestamp + LOCK_PERIOD * 1 days;", "  uint256 constant LOCK_PERIOD = 7 days;\n");
    const good = wrap("    uint256 end = block.timestamp + LOCK_PERIOD;", "  uint256 constant LOCK_PERIOD = 7 days;\n");
    const result = detectTimestampUnitMismatch(bad);
    expect(result.detected).toBe(true);
    expect(result.findings[0].title).toContain("already in seconds");
    expect(detectTimestampUnitMismatch(good).detected).toBe(false);
  });

  it("does not flag explicitly normalised values", () => {
    const cases = [
      wrap("    require(block.timestamp * 1000 <= deadlineMs);", "  uint256 deadlineMs;\n"),
      wrap("    require(deadlineMs / 1000 >= block.timestamp);", "  uint256 deadlineMs;\n"),
      wrap("    uint256 unlock = block.timestamp + lockBlocks * BLOCK_TIME;", "  uint256 lockBlocks;\n  uint256 constant BLOCK_TIME = 12;\n"),
      wrap("    uint256 end = block.timestamp + 2 hours + 30 minutes;"),
    ];
    for (const c of cases) expect(detectTimestampUnitMismatch(c).detected).toBe(false);
  });

  it("flags millisecond timestamps compared with second-based values", () => {
    const code = wrap("    require(block.timestamp * 1000 < expirySeconds);", "  uint256 expirySeconds;\n");
    const result = detectTimestampUnitMismatch(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].message).toContain("milliseconds vs seconds");
  });

  it("reduces severity when there is no expiry or lockup context", () => {
    const code = wrap("    uint256 x = block.timestamp + itemsMs;", "  uint256 itemsMs;\n");
    const result = detectTimestampUnitMismatch(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].severity).toBe("medium");
  });

  it("fails safely on malformed or unsupported input", () => {
    for (const bad of ["contract A { function f() external { x = block.timestamp / 1000;", "", "let a = block.timestamp / 1000"]) {
      const result = detectTimestampUnitMismatch(bad);
      expect(result.detected).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
