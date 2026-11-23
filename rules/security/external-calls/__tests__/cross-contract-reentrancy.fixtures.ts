/** Multi-contract Solidity fixtures for GG-REENTRANCY-XCONTRACT-001. */

/** Vault pays out before updating balances; Lender prices collateral from the stale vault balance. */
export const VULNERABLE_STALE_READ = `
pragma solidity ^0.8.20;
contract Vault {
  mapping(address => uint256) public balances;
  uint256 public totalDeposits;
  function deposit() external payable {
    balances[msg.sender] += msg.value;
    totalDeposits += msg.value;
  }
  function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount, "low");
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok, "send failed");
    balances[msg.sender] -= amount;
    totalDeposits -= amount;
  }
}
contract Lender {
  Vault public vault;
  mapping(address => uint256) public loans;
  constructor(Vault v) { vault = v; }
  function borrow(uint256 amount) external {
    require(vault.balances(msg.sender) >= amount, "no collateral");
    loans[msg.sender] += amount;
    payable(msg.sender).transfer(amount);
  }
}
`;

/** Same design, but effects are applied before the interaction. */
export const SAFE_EFFECTS_FIRST = `
pragma solidity ^0.8.20;
contract Vault {
  mapping(address => uint256) public balances;
  uint256 public totalDeposits;
  function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount, "low");
    balances[msg.sender] -= amount;
    totalDeposits -= amount;
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok, "send failed");
  }
}
contract Lender {
  Vault public vault;
  mapping(address => uint256) public loans;
  function borrow(uint256 amount) external {
    require(vault.balances(msg.sender) >= amount, "no collateral");
    loans[msg.sender] += amount;
  }
}
`;

/** Late writes, but the lock covers the mutator and the read path refuses to answer while locked. */
export const SAFE_LOCKED_VIEW = `
pragma solidity ^0.8.20;
contract Vault {
  uint256 private _status = 1;
  mapping(address => uint256) private _balances;
  modifier nonReentrant() { require(_status != 2, "reentrant"); _status = 2; _; _status = 1; }
  function _checkNotEntered() internal view { require(_status != 2, "reentrant"); }
  function balanceOfAccount(address a) external view returns (uint256) {
    _checkNotEntered();
    return _balances[a];
  }
  function withdraw(uint256 amount) external nonReentrant {
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok, "send failed");
    _balances[msg.sender] -= amount;
  }
}
contract Lender {
  Vault public vault;
  mapping(address => uint256) public loans;
  function borrow(uint256 amount) external {
    require(vault.balanceOfAccount(msg.sender) >= amount, "no collateral");
    loans[msg.sender] += amount;
  }
}
`;

/** Lock on the vault, but the view is unguarded: classic read-only reentrancy. */
export const VULNERABLE_LOCKED_BUT_UNGUARDED_VIEW = `
pragma solidity ^0.8.20;
contract Vault {
  uint256 private _status = 1;
  mapping(address => uint256) public shares;
  modifier nonReentrant() { require(_status != 2, "reentrant"); _status = 2; _; _status = 1; }
  function redeem(uint256 s) external nonReentrant {
    (bool ok, ) = msg.sender.call{value: s}("");
    require(ok, "send failed");
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

/** A second contract mutates the same liability state through an unguarded function. */
export const VULNERABLE_SHARED_MUTATION = `
pragma solidity ^0.8.20;
contract Pool {
  mapping(address => uint256) public shares;
  uint256 public totalShares;
  function redeem(uint256 s) external {
    require(shares[msg.sender] >= s, "low");
    (bool ok, ) = msg.sender.call{value: s}("");
    require(ok, "send failed");
    shares[msg.sender] -= s;
    totalShares -= s;
  }
  function transferShares(address to, uint256 s) external {
    shares[msg.sender] -= s;
    shares[to] += s;
  }
}
contract Router {
  Pool public pool;
  function moveShares(address to, uint256 s) external { pool.transferShares(to, s); }
}
`;

/** Same shape, but both functions hold the pool's lock so the re-entered mutator reverts. */
export const SAFE_SHARED_MUTATION_LOCKED = `
pragma solidity ^0.8.20;
contract Pool {
  uint256 private _status = 1;
  mapping(address => uint256) public shares;
  modifier nonReentrant() { require(_status != 2, "reentrant"); _status = 2; _; _status = 1; }
  function redeem(uint256 s) external nonReentrant {
    (bool ok, ) = msg.sender.call{value: s}("");
    require(ok, "send failed");
    shares[msg.sender] -= s;
  }
  function transferShares(address to, uint256 s) external nonReentrant {
    shares[msg.sender] -= s;
    shares[to] += s;
  }
}
contract Router {
  Pool public pool;
  function moveShares(address to, uint256 s) external { pool.transferShares(to, s); }
}
`;

/** The payout helper and the accounting write live in a base contract. */
export const VULNERABLE_INHERITED_HELPERS = `
pragma solidity ^0.8.20;
contract Ledger {
  mapping(address => uint256) public balances;
  function _debit(address a, uint256 x) internal { balances[a] -= x; }
}
contract Vault is Ledger {
  function _pay(address to, uint256 x) internal {
    (bool ok, ) = to.call{value: x}("");
    require(ok);
  }
  function withdraw(uint256 amount) external {
    _pay(msg.sender, amount);
    _debit(msg.sender, amount);
  }
}
contract Lender {
  Vault public vault;
  mapping(address => uint256) public loans;
  function borrow(uint256 amount) external {
    require(vault.balances(msg.sender) >= amount, "no collateral");
    loans[msg.sender] += amount;
  }
}
`;

/** Interface-typed consumer; the interface lives in the project and Vault implements it. */
export const VULNERABLE_INTERFACE_CONSUMER = `
pragma solidity ^0.8.20;
interface IVault { function balanceOfAccount(address a) external view returns (uint256); }
contract Vault is IVault {
  mapping(address => uint256) internal _balances;
  function balanceOfAccount(address a) external view returns (uint256) { return _balances[a]; }
  function withdraw(uint256 amount) external {
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok);
    _balances[msg.sender] -= amount;
  }
}
contract Lender {
  IVault public vault;
  mapping(address => uint256) public loans;
  function borrow(uint256 amount) external {
    require(vault.balanceOfAccount(msg.sender) >= amount, "no collateral");
    loans[msg.sender] += amount;
  }
}
`;

/** Token-hook interaction (ERC-777 style) before the stake is recorded, read by Governor. */
export const TOKEN_HOOK_STALE_READ = `
pragma solidity ^0.8.20;
contract Staking {
  IERC20 public token;
  mapping(address => uint256) public staked;
  function stake(uint256 a) external {
    token.transferFrom(msg.sender, address(this), a);
    staked[msg.sender] += a;
  }
}
contract Governor {
  Staking public staking;
  mapping(uint256 => uint256) public votes;
  function vote(uint256 id) external { votes[id] += staking.staked(msg.sender); }
}
`;

/** Stipend-limited transfer cannot re-enter. */
export const SAFE_STIPEND_TRANSFER = `
pragma solidity ^0.8.20;
contract Vault {
  mapping(address => uint256) public balances;
  function withdraw(uint256 amount) external {
    payable(msg.sender).transfer(amount);
    balances[msg.sender] -= amount;
  }
}
contract Lender {
  Vault public vault;
  mapping(address => uint256) public loans;
  function borrow(uint256 amount) external {
    require(vault.balances(msg.sender) >= amount, "no collateral");
    loans[msg.sender] += amount;
  }
}
`;

/** Same vulnerable design split across two source files. */
export const MULTI_FILE = [
  {
    path: 'contracts/Vault.sol',
    content: `
pragma solidity ^0.8.20;
contract Vault {
  mapping(address => uint256) public balances;
  function withdraw(uint256 amount) external {
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok);
    balances[msg.sender] -= amount;
  }
}
`,
  },
  {
    path: 'contracts/Lender.sol',
    content: `
pragma solidity ^0.8.20;
import "./Vault.sol";
contract Lender {
  Vault public vault;
  mapping(address => uint256) public loans;
  function borrow(uint256 amount) external {
    require(vault.balances(msg.sender) >= amount, "no collateral");
    loans[msg.sender] += amount;
  }
}
`,
  },
];

/** Late write, but nothing else in the project can reach the state. */
export const SINGLE_CONTRACT_ONLY = `
pragma solidity ^0.8.20;
contract Vault {
  mapping(address => uint256) public balances;
  function withdraw(uint256 amount) external {
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok);
    balances[msg.sender] -= amount;
  }
}
`;
