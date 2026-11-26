// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {}
interface IVault {
    function initialize(address token, address owner) external;
}

// ---- Constructors ----

contract UncheckedConstructor {
    address public owner;
    address public token;
    address public oracle;

    constructor(address _owner, address _token, address _oracle) {
        owner = _owner;
        token = _token;
        oracle = _oracle;
    }
}

contract CheckedConstructor {
    error ZeroAddress();
    address public owner;
    address public token;
    address public oracle;

    constructor(address _owner, address _token, address _oracle) {
        require(_owner != address(0), "owner is zero");
        if (_token == address(0)) revert ZeroAddress();
        if (address(0) == _oracle) revert ZeroAddress();
        owner = _owner;
        token = _token;
        oracle = _oracle;
    }
}

// ---- Initializers ----

contract UncheckedInitializer {
    address public admin;
    address public implementation;
    bool private initialized;

    function initialize(address _admin, address _implementation) external {
        require(!initialized, "already initialized");
        initialized = true;
        admin = _admin;
        implementation = _implementation;
    }
}

contract CheckedInitializer {
    address public admin;
    address public implementation;
    bool private initialized;

    function initialize(address _admin, address _implementation) external {
        require(!initialized, "already initialized");
        _requireNonZero(_admin);
        _requireNonZero(_implementation);
        initialized = true;
        admin = _admin;
        implementation = _implementation;
    }

    function _requireNonZero(address account) internal pure {
        require(account != address(0), "zero address");
    }
}

// ---- Setters ----

contract Setters {
    address public owner;
    address public oracle;
    address public treasury;
    address public feeRecipient;
    address public nativeToken;
    bool public useNative;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier notZero(address account) {
        require(account != address(0), "zero address");
        _;
    }

    function setOracle(address newOracle) external onlyOwner {
        oracle = newOracle;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner notZero(newRecipient) {
        feeRecipient = newRecipient;
    }

    /// @param newTreasury Receives protocol fees; zero disables fee collection.
    function setTreasury(address newTreasury) external onlyOwner {
        treasury = newTreasury;
    }

    function setNativeToken(address newToken) external onlyOwner {
        if (newToken == address(0)) {
            useNative = true;
        }
        nativeToken = newToken;
    }

    function transferAdmin(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}

// ---- Factories ----

contract Vault {
    address public token;
    address public owner;

    constructor(address _token, address _owner) {
        token = _token;
        owner = _owner;
    }
}

contract CheckedVault {
    address public token;
    address public owner;

    constructor(address _token, address _owner) {
        require(_token != address(0) && _owner != address(0), "zero address");
        token = _token;
        owner = _owner;
    }
}

contract Factory {
    function createVault(address token, address owner) external returns (address) {
        Vault vault = new Vault(token, owner);
        return address(vault);
    }

    function createCheckedVault(address token, address owner) external returns (address) {
        CheckedVault vault = new CheckedVault(token, owner);
        return address(vault);
    }

    function createVaultViaInitializer(address clone, address token, address owner) external {
        IVault(clone).initialize(token, owner);
    }
}
