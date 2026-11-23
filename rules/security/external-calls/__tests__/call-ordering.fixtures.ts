/** Solidity fixtures for GG-CALLORDER-001. */

/** Exploit-shaped: the balance is read and checked, the ETH is sent, then the balance is cleared. */
export const EXPLOIT_CLASSIC_DRAIN = `
pragma solidity ^0.8.20;
contract Bank {
  mapping(address => uint256) public balances;
  function deposit() external payable { balances[msg.sender] += msg.value; }
  function withdraw() external {
    uint256 amt = balances[msg.sender];
    require(amt > 0, "none");
    (bool ok, ) = msg.sender.call{value: amt}("");
    require(ok);
    balances[msg.sender] = 0;
  }
}
`;

/** Safe: state is zeroed before the interaction. */
export const SAFE_EFFECTS_BEFORE_INTERACTIONS = `
pragma solidity ^0.8.20;
contract Bank {
  mapping(address => uint256) public balances;
  function withdraw() external {
    uint256 amt = balances[msg.sender];
    require(amt > 0, "none");
    balances[msg.sender] = 0;
    (bool ok, ) = msg.sender.call{value: amt}("");
    require(ok);
  }
}
`;

/** Accounting written after the payout with no check of it beforehand. */
export const ACCOUNTING_AFTER_PAYOUT = `
pragma solidity ^0.8.20;
contract Treasury {
  address public owner;
  uint256 public totalPaid;
  function payout(address to, uint256 amount) external onlyOwner {
    (bool ok, ) = to.call{value: amount}("");
    require(ok);
    totalPaid += amount;
  }
}
`;

/** The interaction is in an internal helper and the late write is in an inherited base. */
export const HELPERS_AND_INHERITANCE = `
pragma solidity ^0.8.20;
contract Accounting {
  mapping(address => uint256) public shares;
  function _settle(address a, uint256 s) internal { shares[a] -= s; }
}
contract Pool is Accounting {
  function _payout(address to, uint256 amount) internal {
    (bool ok, ) = to.call{value: amount}("");
    require(ok);
  }
  function redeem(uint256 s) external {
    require(shares[msg.sender] >= s, "low");
    _payout(msg.sender, s);
    _settle(msg.sender, s);
  }
}
`;

/** Code after \`_;\` in a modifier runs after the body's external call. */
export const MODIFIER_WRITES_AFTER_BODY = `
pragma solidity ^0.8.20;
contract Rewards {
  mapping(address => uint256) public pending;
  modifier settleAfter(address u) { _; pending[u] = 0; }
  function claim() external settleAfter(msg.sender) {
    require(pending[msg.sender] > 0, "nothing");
    (bool ok, ) = msg.sender.call{value: pending[msg.sender]}("");
    require(ok);
  }
}
`;

/** Late accounting write, but the function holds a lock and nothing else reads the state. */
export const SAFE_LOCKED_NO_CONSUMERS = `
pragma solidity ^0.8.20;
contract Bank {
  uint256 private _status = 1;
  mapping(address => uint256) public balances;
  modifier nonReentrant() { require(_status != 2, "reentrant"); _status = 2; _; _status = 1; }
  function balanceOfAccount(address a) external view returns (uint256) { return balances[a]; }
  function withdraw(uint256 amount) external nonReentrant {
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok);
    balances[msg.sender] -= amount;
  }
}
`;

/** The lock does not cover an unguarded consumer in another contract. */
export const LOCKED_BUT_UNGUARDED_CONSUMER = `
pragma solidity ^0.8.20;
contract Vault {
  uint256 private _status = 1;
  mapping(address => uint256) public shares;
  modifier nonReentrant() { require(_status != 2, "reentrant"); _status = 2; _; _status = 1; }
  function redeem(uint256 s) external nonReentrant {
    (bool ok, ) = msg.sender.call{value: s}("");
    require(ok);
    shares[msg.sender] -= s;
  }
  function sharesOf(address a) external view returns (uint256) { return shares[a]; }
}
contract Pricer {
  Vault public vault;
  mapping(address => uint256) public credit;
  function sync() external { credit[msg.sender] = vault.sharesOf(msg.sender); }
}
`;

/** Inline mutex: a boolean flipped before and after the call is a lock, not state. */
export const SAFE_INLINE_MUTEX = `
pragma solidity ^0.8.20;
contract Bank {
  bool private locked;
  mapping(address => uint256) public balances;
  function withdraw(uint256 amount) external {
    require(!locked, "reentrant");
    locked = true;
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok);
    balances[msg.sender] -= amount;
    locked = false;
  }
}
`;

/** Only non-interactive calls precede the write: stipend transfer, view call and a leaf project contract. */
export const SAFE_NON_INTERACTIVE_CALLS = `
pragma solidity ^0.8.20;
contract Registry {
  mapping(address => bool) public seen;
  function record(address a) external { seen[a] = true; }
}
contract Pool {
  Registry public registry;
  IERC20 public token;
  mapping(address => uint256) public balances;
  function withdraw(uint256 amount) external {
    registry.record(msg.sender);
    uint256 b = token.balanceOf(address(this));
    payable(msg.sender).transfer(amount);
    balances[msg.sender] -= amount;
  }
}
`;

/** A leaf project call is skipped, the low-level call is not. */
export const MIXED_TRUSTED_AND_UNTRUSTED = `
pragma solidity ^0.8.20;
contract Registry {
  mapping(address => bool) public seen;
  function record(address a) external { seen[a] = true; }
}
contract Pool {
  Registry public registry;
  mapping(address => uint256) public balances;
  function settle(uint256 amount) external {
    registry.record(msg.sender);
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok);
    balances[msg.sender] -= amount;
  }
}
`;

/** Token transfer (possible hook) followed by accounting. */
export const TOKEN_TRANSFER_THEN_ACCOUNTING = `
pragma solidity ^0.8.20;
contract Staking {
  IERC20 public token;
  mapping(address => uint256) public staked;
  function unstake(uint256 amount) external {
    token.transfer(msg.sender, amount);
    staked[msg.sender] -= amount;
  }
}
`;

/** Interaction and late write live in different files. */
export const MULTI_FILE = [
  {
    path: 'contracts/Payable.sol',
    content: `
pragma solidity ^0.8.20;
contract Payable {
  function _pay(address to, uint256 amount) internal {
    (bool ok, ) = to.call{value: amount}("");
    require(ok);
  }
}
`,
  },
  {
    path: 'contracts/Pool.sol',
    content: `
pragma solidity ^0.8.20;
import "./Payable.sol";
contract Pool is Payable {
  mapping(address => uint256) public balances;
  function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount, "low");
    _pay(msg.sender, amount);
    balances[msg.sender] -= amount;
  }
}
`,
  },
];

/** Inherits a base that is not part of the supplied sources. */
export const UNRESOLVED_BASE = `
pragma solidity ^0.8.20;
contract Bank is Ownable {
  mapping(address => uint256) public balances;
  function withdraw(uint256 amount) external {
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok);
    balances[msg.sender] -= amount;
  }
}
`;
