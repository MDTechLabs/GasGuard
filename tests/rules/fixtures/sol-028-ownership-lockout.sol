// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract UnsafeOneStepOwner {
    address public owner;
    uint256 public fee;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function setFee(uint256 newFee) external onlyOwner {
        fee = newFee;
    }
}

contract BrokenTwoStepOwner {
    address public owner;
    address public pendingOwner;
    uint256 public fee;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function acceptOwnership() external {
        owner = pendingOwner;
    }

    function setFee(uint256 newFee) external onlyOwner {
        fee = newFee;
    }
}

contract UnsafeRenounceOwner {
    address public owner;
    uint256 public fee;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function renounceOwnership() external onlyOwner {
        owner = address(0);
    }

    function setFee(uint256 newFee) external onlyOwner {
        fee = newFee;
    }
}

contract UnprotectedRenounceOwner {
    address public owner;
    uint256 public fee;

    function renounceOwnership() external {
        owner = address(0);
    }

    function setFee(uint256 newFee) external {
        require(msg.sender == owner, "not owner");
        fee = newFee;
    }
}

contract UnsafeRoleRevocation {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public fee;

    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender), "not admin");
        _;
    }

    function revokeRole(bytes32 role, address account) external onlyAdmin {
        _revokeRole(role, account);
    }

    function setFee(uint256 newFee) external onlyAdmin {
        fee = newFee;
    }

    function hasRole(bytes32, address) internal pure returns (bool) {
        return true;
    }

    function _revokeRole(bytes32, address) internal {}
}

contract UnsafeMappingAdmin {
    mapping(address => bool) public isAdmin;
    uint256 public adminCount;
    uint256 public fee;

    modifier onlyAdmin() {
        require(isAdmin[msg.sender], "not admin");
        _;
    }

    function removeAdmin(address account) external onlyAdmin {
        isAdmin[account] = false;
        adminCount -= 1;
    }

    function setFee(uint256 newFee) external onlyAdmin {
        fee = newFee;
    }
}

contract PendingZeroOwner {
    address public owner;
    address public pendingOwner;
    uint256 public fee;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        owner = msg.sender;
        delete pendingOwner;
    }

    function setFee(uint256 newFee) external onlyOwner {
        fee = newFee;
    }
}

contract UnprotectedTransferOwner {
    address public owner;
    uint256 public fee;

    function transferOwnership(address newOwner) external {
        owner = newOwner;
    }

    function setFee(uint256 newFee) external {
        require(msg.sender == owner, "not owner");
        fee = newFee;
    }
}

contract MissingAcceptanceOwner {
    address public owner;
    address public pendingOwner;
    uint256 public fee;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        pendingOwner = newOwner;
    }

    function setFee(uint256 newFee) external onlyOwner {
        fee = newFee;
    }
}

contract StalePendingOwner {
    address public owner;
    address public pendingOwner;
    uint256 public fee;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        pendingOwner = newOwner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        owner = msg.sender;
    }

    function setFee(uint256 newFee) external onlyOwner {
        fee = newFee;
    }
}

contract SafeTwoStepOwner {
    address public owner;
    address public pendingOwner;
    uint256 public fee;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        pendingOwner = newOwner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        owner = msg.sender;
        delete pendingOwner;
    }

    function setFee(uint256 newFee) external onlyOwner {
        fee = newFee;
    }
}

contract SafeRoleRevocation {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public fee;

    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender), "not admin");
        _;
    }

    function revokeRole(bytes32 role, address account) external onlyAdmin {
        require(getRoleMemberCount(role) > 1, "last admin");
        _revokeRole(role, account);
    }

    function setFee(uint256 newFee) external onlyAdmin {
        fee = newFee;
    }

    function hasRole(bytes32, address) internal pure returns (bool) {
        return true;
    }

    function getRoleMemberCount(bytes32) internal pure returns (uint256) {
        return 2;
    }

    function _revokeRole(bytes32, address) internal {}
}

contract ImmutableOwner {
    address public immutable owner;
    uint256 public fee;

    constructor(address initialOwner) {
        owner = initialOwner;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function setFee(uint256 newFee) external onlyOwner {
        fee = newFee;
    }
}

contract PermissionlessVault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        balances[msg.sender] -= amount;
    }
}

// gasguard-ownership-lockout-exempt: ownership is intentionally burned at deployment
contract ExemptOwner {
    address public owner;
    uint256 public fee;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function renounceOwnership() external onlyOwner {
        owner = address(0);
    }

    function setFee(uint256 newFee) external onlyOwner {
        fee = newFee;
    }
}
