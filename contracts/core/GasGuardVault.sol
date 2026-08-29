// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title GasGuardVault
/// @notice Vault contract for GasGuard using custom errors throughout.

error Unauthorized();
error InvalidAmount();
error ZeroAddress();
error VaultNotInitialized();
error InsufficientBalance();
error WithdrawalFailed();
error AlreadyPaused();
error NotPaused();

contract GasGuardVault {
    address public admin;
    address public feeRecipient;
    uint256 public feeBps;
    bool public initialized;
    bool public paused;

    mapping(address => uint256) public deposits;
    uint256 public totalDeposits;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount, uint256 fee);
    event FeesUpdated(uint256 newFeeBps);
    event Paused();
    event Unpaused();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert AlreadyPaused();
        _;
    }

    modifier whenPaused() {
        if (!paused) revert NotPaused();
        _;
    }

    function initialize(address _admin, address _feeRecipient, uint256 _feeBps) external {
        if (initialized) revert AlreadyPaused();
        if (_admin == address(0) || _feeRecipient == address(0)) revert ZeroAddress();
        if (_feeBps > 10000) revert InvalidAmount();

        admin = _admin;
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
        initialized = true;
    }

    function deposit() external payable whenNotPaused {
        if (msg.value == 0) revert InvalidAmount();

        deposits[msg.sender] += msg.value;
        totalDeposits += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (deposits[msg.sender] < amount) revert InsufficientBalance();

        uint256 fee = amount * feeBps / 10000;
        uint256 netAmount = amount - fee;

        deposits[msg.sender] -= amount;
        totalDeposits -= amount;

        (bool success, ) = msg.sender.call{value: netAmount}("");
        if (!success) revert WithdrawalFailed();

        if (fee > 0) {
            (bool feeSuccess, ) = feeRecipient.call{value: fee}("");
            if (!feeSuccess) revert WithdrawalFailed();
        }

        emit Withdrawn(msg.sender, netAmount, fee);
    }

    function pause() external onlyAdmin {
        if (paused) revert AlreadyPaused();
        paused = true;
        emit Paused();
    }

    function unpause() external onlyAdmin {
        if (!paused) revert NotPaused();
        paused = false;
        emit Unpaused();
    }

    function updateFee(uint256 _feeBps) external onlyAdmin {
        if (_feeBps > 10000) revert InvalidAmount();
        feeBps = _feeBps;
        emit FeesUpdated(_feeBps);
    }
}
