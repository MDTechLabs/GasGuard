/** Solidity fixtures for GG-AUTH-PAUSE-001. */

const HEAD = `pragma solidity ^0.8.20;
contract Vault is AccessControl {
  bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
  bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");
  bool public paused;
`;

export const UNPAUSE_OPEN = `
pragma solidity ^0.8.20;
contract Vault {
  address public owner;
  bool public paused;
  modifier onlyOwner() { require(msg.sender == owner, "no"); _; }
  function pause() external onlyOwner { paused = true; }
  function unpause() external { paused = false; }
}
`;

export const PAUSE_OPEN = `
pragma solidity ^0.8.20;
contract Vault {
  address public owner;
  bool public paused;
  modifier onlyOwner() { require(msg.sender == owner, "no"); _; }
  function pause() external { paused = true; }
  function unpause() external onlyOwner { paused = false; }
}
`;

/** Separated pauser and unpauser roles, both granted at deployment. */
export const SEPARATED_SAFE = `
${HEAD}
  constructor() {
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    _grantRole(PAUSER_ROLE, msg.sender);
    _grantRole(UNPAUSER_ROLE, msg.sender);
  }
  function pause() external onlyRole(PAUSER_ROLE) { paused = true; }
  function unpause() external onlyRole(UNPAUSER_ROLE) { paused = false; }
}
`;

/** Unpause is granted to the pauser role, wider than the documented policy. */
export const UNPAUSE_BROADER = `
${HEAD}
  constructor() {
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    _grantRole(PAUSER_ROLE, msg.sender);
    _grantRole(UNPAUSER_ROLE, msg.sender);
  }
  function pause() external onlyRole(PAUSER_ROLE) { paused = true; }
  function unpause() external onlyRole(PAUSER_ROLE) { paused = false; }
}
`;

/** The pauser role administers the unpauser role, so pausers can grant themselves unpause. */
export const UNPAUSE_ROLE_ADMIN_BROAD = `
${HEAD}
  constructor() {
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    _grantRole(PAUSER_ROLE, msg.sender);
    _grantRole(UNPAUSER_ROLE, msg.sender);
    _setRoleAdmin(UNPAUSER_ROLE, PAUSER_ROLE);
  }
  function pause() external onlyRole(PAUSER_ROLE) { paused = true; }
  function unpause() external onlyRole(UNPAUSER_ROLE) { paused = false; }
}
`;

/** Nobody holds the pauser role and no admin exists: emergency authority is lost. */
export const PAUSE_AUTHORITY_LOST = `
${HEAD}
  function pause() external onlyRole(PAUSER_ROLE) { paused = true; }
  function unpause() external onlyRole(UNPAUSER_ROLE) { paused = false; }
}
`;

/** The unpauser role is never granted but the default admin can grant it. */
export const UNPAUSE_UNASSIGNED = `
${HEAD}
  constructor() {
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    _grantRole(PAUSER_ROLE, msg.sender);
  }
  function pause() external onlyRole(PAUSER_ROLE) { paused = true; }
  function unpause() external onlyRole(UNPAUSER_ROLE) { paused = false; }
}
`;

export const NO_PAUSE = `
pragma solidity ^0.8.20;
contract Vault {
  mapping(address => uint256) public balances;
  function deposit() external payable { balances[msg.sender] += msg.value; }
}
`;

/** One role both pauses and unpauses. */
export const NOT_SEPARATED = `
${HEAD}
  constructor() { _grantRole(PAUSER_ROLE, msg.sender); _grantRole(DEFAULT_ADMIN_ROLE, msg.sender); }
  function pause() external onlyRole(PAUSER_ROLE) { paused = true; }
  function unpause() external onlyRole(PAUSER_ROLE) { paused = false; }
}
`;
