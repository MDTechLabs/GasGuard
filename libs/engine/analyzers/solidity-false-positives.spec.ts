/**
 * Regression tests for false positives in patterns that audits routinely accept.
 *
 * Each case is a small, correct contract. The expected result is "no finding for this rule".
 * The controls next to them are vulnerable on purpose, so a detector that flags everything
 * cannot pass.
 */
import { SolidityAnalyzer } from "./solidity-analyzer";

async function ruleIdsFor(code: string, file = "contracts/Case.sol"): Promise<string[]> {
  const analyzer = new SolidityAnalyzer();
  const result = await analyzer.analyze(code, file);
  return result.findings.map((f) => f.ruleId);
}

describe("false positives in audited Solidity patterns", () => {
  it("does not flag an OpenZeppelin nonReentrant withdraw as missing a guard", async () => {
    const code = `pragma solidity ^0.8.20;
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
contract Vault is ReentrancyGuard {
    mapping(address => uint256) public balances;
    function withdraw(uint256 amount) external nonReentrant {
        require(balances[msg.sender] >= amount, "insufficient");
        balances[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
    }
}`;
    expect(await ruleIdsFor(code)).not.toContain("sol-006");
  });

  it("does not flag SafeERC20 safeTransfer as an unguarded transfer", async () => {
    const code = `pragma solidity ^0.8.20;
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
contract Escrow {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    constructor(IERC20 t) { token = t; }
    function release(address to, uint256 amount) external {
        token.safeTransfer(to, amount);
    }
}`;
    expect(await ruleIdsFor(code)).not.toContain("sol-006");
  });

  it("does not flag a view getter as a transfer path", async () => {
    const code = `pragma solidity ^0.8.20;
contract Ledger {
    mapping(address => uint256) private _balances;
    function balanceOf(address who) external view returns (uint256) {
        return _balances[who];
    }
}`;
    expect(await ruleIdsFor(code)).not.toContain("sol-006");
  });

  it("does not flag a trailing comment that mentions tx.origin", async () => {
    const code = `pragma solidity ^0.8.20;
contract Config {
    address public owner;
    uint256 public fee = 1; // never authorise with tx.origin
    function setFee(uint256 f) external {
        require(msg.sender == owner, "not owner");
        fee = f;
    }
}`;
    expect(await ruleIdsFor(code)).not.toContain("sol-014");
  });

  it("does not flag a block comment that mentions tx.origin", async () => {
    const code = `pragma solidity ^0.8.20;
contract Config {
    address public owner;
    /* tx.origin is not used here */ uint256 public fee = 1;
}`;
    expect(await ruleIdsFor(code)).not.toContain("sol-014");
  });

  it("still flags real tx.origin authorization (control)", async () => {
    const code = `pragma solidity ^0.8.20;
contract Wallet {
    address public owner;
    function drain(address payable to) external {
        require(tx.origin == owner, "not owner");
        to.transfer(address(this).balance);
    }
}`;
    expect(await ruleIdsFor(code)).toContain("sol-014");
  });

  it("still flags an unguarded withdraw that transfers ETH (control)", async () => {
    const code = `pragma solidity ^0.8.20;
contract Bank {
    mapping(address => uint256) public balances;
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok);
        balances[msg.sender] = 0;
    }
}`;
    expect(await ruleIdsFor(code)).toContain("sol-006");
  });
});
