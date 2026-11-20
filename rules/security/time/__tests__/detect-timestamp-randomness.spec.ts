import { detectTimestampRandomness } from "../detect-timestamp-randomness";

describe("detectTimestampRandomness", () => {
  it("flags a lottery that picks the winner from a hashed timestamp and pays out", () => {
    const code = `pragma solidity ^0.8.20;
contract Lottery {
  address[] public players;
  address public winner;
  function draw() external {
    uint256 idx = uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender))) % players.length;
    winner = players[idx];
    payable(winner).transfer(address(this).balance);
  }
}`;
    const result = detectTimestampRandomness(code);
    expect(result.detected).toBe(true);
    const f = result.findings[0];
    expect(f.severity).toBe("high");
    expect(f.line).toBe(6);
    expect(f.message).toContain("block.timestamp");
    expect(f.evidence.join(" ")).toContain("proposer can shift the timestamp");
  });

  it("traces blockhash through a local variable into an array index", () => {
    const code = `contract Raffle {
  address[] public players;
  address public winner;
  function pickWinner() external {
    uint256 r = uint256(blockhash(block.number - 1));
    winner = players[r % players.length];
  }
}`;
    const result = detectTimestampRandomness(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].line).toBe(6);
    expect(result.findings[0].message).toContain("blockhash");
    expect(result.findings[0].message).toContain("block.number");
  });

  it("covers block.number and block.prevrandao and ranks prevrandao lower", () => {
    const number = `contract A { address[] p; address public winner; function f() external { uint256 i = block.number % p.length; winner = p[i]; } }`;
    const prevrandao = `contract B { function pick() external view returns (uint256) { return block.prevrandao % 10; } }`;
    const a = detectTimestampRandomness(number);
    const b = detectTimestampRandomness(prevrandao);
    expect(a.findings[0].severity).toBe("high");
    expect(a.findings[0].evidence.join(" ")).toContain("public and predictable");
    expect(b.detected).toBe(true);
    expect(b.findings[0].severity).toBe("low");
  });

  it("flags a random() helper built from block data", () => {
    const code = `contract R {
  function random() public view returns (uint256) {
    return uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao)));
  }
}`;
    const result = detectTimestampRandomness(code);
    expect(result.detected).toBe(true);
    expect(result.findings[0].message).toContain("returned as a random value");
    expect(result.findings[0].severity).toBe("medium");
  });

  it("does not flag timestamps used for deadlines, expiry and accounting", () => {
    const code = `contract D {
  uint256 public deadline;
  uint256 public endTime;
  uint256 public lastUpdate;
  function f() external {
    require(block.timestamp < deadline, "late");
    endTime = block.timestamp + 7 days;
    uint256 elapsed = block.timestamp - lastUpdate;
    lastUpdate = block.timestamp;
  }
}`;
    expect(detectTimestampRandomness(code).detected).toBe(false);
  });

  it("does not flag VRF callbacks that use the supplied random words", () => {
    const code = `contract V {
  address[] public players;
  address public winner;
  function fulfillRandomWords(uint256, uint256[] memory randomWords) internal {
    winner = players[randomWords[0] % players.length];
  }
}`;
    expect(detectTimestampRandomness(code).detected).toBe(false);
  });

  it("fails safely on malformed or unsupported input", () => {
    for (const bad of ["contract A { function f() external { x = block.timestamp % 2;", "", "x = block.timestamp % 2;"]) {
      const result = detectTimestampRandomness(bad);
      expect(result.detected).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
