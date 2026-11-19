/** Solidity fixtures for GG-ORACLE-REPLACE-001. */

const BORROW = `
  function borrow(address token, uint256 amount) external returns (uint256) {
    uint256 p = oracle.getPrice(token);
    return amount * p;
  }
`;

/** Anyone can replace the oracle. */
export const UNRESTRICTED_SETTER = `
pragma solidity ^0.8.20;
contract Lender {
  IOracle public oracle;
  function setOracle(address o) external { oracle = IOracle(o); }
${BORROW}}
`;

/** onlyOwner, but effective immediately and unvalidated. */
export const OWNER_IMMEDIATE = `
pragma solidity ^0.8.20;
contract Lender is Ownable {
  IOracle public oracle;
  function setOracle(address o) external onlyOwner { oracle = IOracle(o); }
${BORROW}}
`;

/** Role-gated, with the role granted in the constructor. */
export const ROLE_GATED = `
pragma solidity ^0.8.20;
contract Lender is AccessControl {
  bytes32 public constant ORACLE_ADMIN = keccak256("ORACLE_ADMIN");
  IOracle public oracle;
  constructor() { _grantRole(ORACLE_ADMIN, msg.sender); }
  function setOracle(address o) external onlyRole(ORACLE_ADMIN) { oracle = IOracle(o); }
${BORROW}}
`;

/** Propose -> wait -> apply, with validation of the proposed feed. */
export const SAFE_TIMELOCKED_AND_VALIDATED = `
pragma solidity ^0.8.20;
contract Lender is Ownable {
  uint256 constant DELAY = 2 days;
  IOracle public oracle;
  address public pendingOracle;
  uint256 public eta;
  function proposeOracle(address o) external onlyOwner {
    require(IOracle(o).decimals() == oracle.decimals(), "decimals");
    pendingOracle = o;
    eta = block.timestamp + DELAY;
  }
  function applyOracle() external onlyOwner {
    require(block.timestamp >= eta, "wait");
    oracle = IOracle(pendingOracle);
  }
${BORROW}}
`;

/** Documented emergency path: guardian only, validated, delay waived. */
export const SAFE_EMERGENCY_POLICY = `
pragma solidity ^0.8.20;
contract Lender is Ownable {
  IOracle public oracle;
  function emergencySetOracle(address o) external onlyGuardian {
    require(IOracle(o).decimals() == 8, "decimals");
    oracle = IOracle(o);
  }
${BORROW}}
`;

/** Emergency path that skips validation. */
export const EMERGENCY_UNVALIDATED = `
pragma solidity ^0.8.20;
contract Lender is Ownable {
  IOracle public oracle;
  function emergencySetOracle(address o) external onlyGuardian { oracle = IOracle(o); }
${BORROW}}
`;

/** A per-token feed mapping that anyone can write. */
export const UNRESTRICTED_FEED_MAPPING = `
pragma solidity ^0.8.20;
contract Lender {
  mapping(address => IFeed) public feeds;
  function setFeed(address t, address f) external { feeds[t] = IFeed(f); }
  function value(address t, uint256 amt) external view returns (uint256) {
    return amt * feeds[t].latestAnswer();
  }
}
`;

/** Inline msg.sender check against a stored admin. */
export const INLINE_ADMIN_CHECK = `
pragma solidity ^0.8.20;
contract Lender {
  address public admin;
  IOracle public oracle;
  function setOracle(address o) external {
    require(msg.sender == admin, "no");
    oracle = IOracle(o);
  }
${BORROW}}
`;

/** Access control comes from a modifier defined in the same file. */
export const MODIFIER_DEFINED_IN_FILE = `
pragma solidity ^0.8.20;
contract Lender {
  address public admin;
  IOracle public oracle;
  modifier onlyAdmin() { require(msg.sender == admin, "no"); _; }
  function setOracle(address o) external onlyAdmin { oracle = IOracle(o); }
${BORROW}}
`;

/** Only a non-restrictive modifier. */
export const ONLY_PAUSE_MODIFIER = `
pragma solidity ^0.8.20;
contract Lender {
  IOracle public oracle;
  modifier whenNotPaused() { _; }
  function setOracle(address o) external whenNotPaused { oracle = IOracle(o); }
${BORROW}}
`;

/** Restricted and validated, but no delay. */
export const VALIDATED_NO_DELAY = `
pragma solidity ^0.8.20;
contract Lender is Ownable {
  IOracle public oracle;
  function setOracle(address o) external onlyOwner {
    require(IOracle(o).decimals() == 8, "decimals");
    oracle = IOracle(o);
  }
${BORROW}}
`;

/** No financial function reads the oracle: lower severity. */
export const UNRESTRICTED_NO_DEPENDENTS = `
pragma solidity ^0.8.20;
contract Registry {
  IOracle public oracle;
  function setOracle(address o) external { oracle = IOracle(o); }
}
`;

export const NON_ORACLE_SETTER = `
pragma solidity ^0.8.20;
contract Treasury {
  address public treasury;
  function setTreasury(address t) external { treasury = t; }
}
`;

export const CONSTRUCTOR_ONLY = `
pragma solidity ^0.8.20;
contract Lender {
  IOracle public oracle;
  constructor(address o) { oracle = IOracle(o); }
${BORROW}}
`;
