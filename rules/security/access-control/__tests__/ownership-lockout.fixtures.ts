/** Solidity fixtures for GG-AUTH-LOCKOUT-001. */

export const SINGLE_STEP_NO_ZERO_CHECK = `
pragma solidity ^0.8.20;
contract Vault {
  address public owner;
  constructor() { owner = msg.sender; }
  modifier onlyOwner() { require(msg.sender == owner, "no"); _; }
  function transferOwnership(address newOwner) external onlyOwner { owner = newOwner; }
  function withdraw(uint256 a) external onlyOwner { payable(msg.sender).transfer(a); }
}
`;

/** Pending-owner mistake: anyone can accept. */
export const PENDING_ACCEPT_UNRESTRICTED = `
pragma solidity ^0.8.20;
contract Vault {
  address public owner;
  address public pendingOwner;
  constructor() { owner = msg.sender; }
  modifier onlyOwner() { require(msg.sender == owner, "no"); _; }
  function proposeOwner(address n) external onlyOwner { pendingOwner = n; }
  function acceptOwnership() external { owner = pendingOwner; pendingOwner = address(0); }
  function withdraw(uint256 a) external onlyOwner { payable(msg.sender).transfer(a); }
}
`;

/** Pending-owner mistake: a pending owner is stored but nothing accepts it. */
export const PENDING_NEVER_ACCEPTED = `
pragma solidity ^0.8.20;
contract Vault {
  address public owner;
  address public pendingOwner;
  modifier onlyOwner() { require(msg.sender == owner, "no"); _; }
  function proposeOwner(address n) external onlyOwner { pendingOwner = n; }
  function withdraw(uint256 a) external onlyOwner { payable(msg.sender).transfer(a); }
}
`;

/** Safe counterexample: two-step, acceptance restricted to the pending owner, pending cleared. */
export const SAFE_TWO_STEP = `
pragma solidity ^0.8.20;
contract Vault {
  address public owner;
  address public pendingOwner;
  constructor() { owner = msg.sender; }
  modifier onlyOwner() { require(msg.sender == owner, "no"); _; }
  function proposeOwner(address n) external onlyOwner { pendingOwner = n; }
  function acceptOwnership() external {
    require(msg.sender == pendingOwner, "not pending");
    owner = pendingOwner;
    pendingOwner = address(0);
  }
  function withdraw(uint256 a) external onlyOwner { payable(msg.sender).transfer(a); }
}
`;

export const RENOUNCE_LOCKS_WITHDRAW = `
pragma solidity ^0.8.20;
contract Vault {
  address public owner;
  constructor() { owner = msg.sender; }
  modifier onlyOwner() { require(msg.sender == owner, "no"); _; }
  function renounce() external onlyOwner { owner = address(0); }
  function withdraw(uint256 a) external onlyOwner { payable(msg.sender).transfer(a); }
}
`;

/** Boundary: renounce is documented as intentional. */
export const RENOUNCE_DOCUMENTED = `
pragma solidity ^0.8.20;
contract Vault {
  address public owner;
  constructor() { owner = msg.sender; }
  modifier onlyOwner() { require(msg.sender == owner, "no"); _; }
  /// @dev Renouncing is intentional: after setup the contract is ownerless by design.
  function renounce() external onlyOwner { owner = address(0); }
  function setFee(uint256 f) external onlyOwner { }
}
`;

/** Boundary: contract-level documentation of an immutable design. */
export const DOCUMENTED_IMMUTABLE = `
pragma solidity ^0.8.20;
/// @notice Immutable, permissionless AMM: ownerless by design.
contract Pool {
  address public owner;
  modifier onlyOwner() { require(msg.sender == owner, "no"); _; }
  function setOwner(address o) external onlyOwner { owner = o; }
  function skim() external onlyOwner { }
}
`;

/** Boundary: no privileged functions at all (permanently permissionless). */
export const PERMISSIONLESS = `
pragma solidity ^0.8.20;
contract Counter {
  address public owner;
  uint256 public n;
  function transferOwnership(address o) external { owner = o; }
  function inc() external { n += 1; }
}
`;

/** Boundary: a guardian can restore the owner, which lowers the severity. */
export const WITH_RECOVERY = `
pragma solidity ^0.8.20;
contract Vault {
  address public owner;
  address public guardian;
  constructor() { owner = msg.sender; guardian = msg.sender; }
  modifier onlyOwner() { require(msg.sender == owner, "no"); _; }
  modifier onlyGuardian() { require(msg.sender == guardian, "no"); _; }
  function transferOwnership(address n) external onlyOwner { require(n != address(0)); owner = n; }
  function recoverOwner(address n) external onlyGuardian { owner = n; }
  function withdraw(uint256 a) external onlyOwner { payable(msg.sender).transfer(a); }
}
`;

/** Last-admin removal: an admin can clear the final entry. */
export const LAST_ADMIN_REMOVAL = `
pragma solidity ^0.8.20;
contract Registry {
  mapping(address => bool) public admins;
  constructor() { admins[msg.sender] = true; }
  modifier onlyAdmin() { require(admins[msg.sender], "no"); _; }
  function addAdmin(address a) external onlyAdmin { admins[a] = true; }
  function removeAdmin(address a) external onlyAdmin { admins[a] = false; }
  function renounceAdmin() external onlyAdmin { admins[msg.sender] = false; }
  function setFee(uint256 f) external onlyAdmin { }
}
`;

export const LAST_ADMIN_SAFE = `
pragma solidity ^0.8.20;
contract Registry {
  mapping(address => bool) public admins;
  uint256 public adminCount;
  constructor() { admins[msg.sender] = true; adminCount = 1; }
  modifier onlyAdmin() { require(admins[msg.sender], "no"); _; }
  function addAdmin(address a) external onlyAdmin { admins[a] = true; adminCount += 1; }
  function removeAdmin(address a) external onlyAdmin { require(a != msg.sender, "self"); admins[a] = false; adminCount -= 1; }
  function renounceAdmin() external onlyAdmin { require(adminCount > 1, "last"); admins[msg.sender] = false; adminCount -= 1; }
  function setFee(uint256 f) external onlyAdmin { }
}
`;

export const INHERITED_OWNABLE = `
pragma solidity ^0.8.20;
contract Vault is Ownable {
  function withdraw(uint256 a) external onlyOwner { payable(msg.sender).transfer(a); }
}
`;

export const INHERITED_OWNABLE2STEP_RENOUNCE_DISABLED = `
pragma solidity ^0.8.20;
contract Vault is Ownable2Step {
  function renounceOwnership() public override onlyOwner { revert("disabled"); }
  function withdraw(uint256 a) external onlyOwner { payable(msg.sender).transfer(a); }
}
`;

export const INHERITED_ACCESS_CONTROL = `
pragma solidity ^0.8.20;
contract Vault is AccessControl {
  constructor() { _grantRole(DEFAULT_ADMIN_ROLE, msg.sender); }
  function withdraw(uint256 a) external onlyRole(DEFAULT_ADMIN_ROLE) { payable(msg.sender).transfer(a); }
}
`;

export const INHERITED_DEFAULT_ADMIN_RULES = `
pragma solidity ^0.8.20;
contract Vault is AccessControlDefaultAdminRules {
  function withdraw(uint256 a) external onlyRole(DEFAULT_ADMIN_ROLE) { payable(msg.sender).transfer(a); }
}
`;
