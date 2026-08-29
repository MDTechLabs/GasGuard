// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title GasGuardRouter
/// @notice Main router contract for GasGuard protocol using custom errors.
/// @dev Replaces all require() strings with custom error selectors for gas savings.

error Unauthorized();
error InvalidAmount();
error ZeroAddress();
error AlreadyInitialized();
error RequestNotFound();
error RequestAlreadyCompleted();
error InsufficientBalance();
error OperationFailed();

contract GasGuardRouter {
    address public admin;
    bool public initialized;

    mapping(address => uint256) public balances;
    mapping(bytes32 => bool) public processedRequests;

    event Deposit(address indexed user, uint256 amount);
    event Withdrawal(address indexed user, uint256 amount);
    event RequestProcessed(bytes32 indexed requestId);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    /// @notice Initialize the router.
    /// @param _admin The admin address.
    function initialize(address _admin) external {
        if (initialized) revert AlreadyInitialized();
        if (_admin == address(0)) revert ZeroAddress();

        admin = _admin;
        initialized = true;
    }

    /// @notice Deposit funds.
    function deposit() external payable {
        if (msg.value == 0) revert InvalidAmount();

        balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice Withdraw funds.
    /// @param amount Amount to withdraw.
    function withdraw(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        balances[msg.sender] -= amount;
        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert OperationFailed();

        emit Withdrawal(msg.sender, amount);
    }

    /// @notice Process a request with a unique ID.
    /// @param requestId Unique request identifier.
    /// @param amount Processing amount.
    function processRequest(bytes32 requestId, uint256 amount) external onlyAdmin {
        if (requestId == bytes32(0)) revert InvalidAmount();
        if (processedRequests[requestId]) revert RequestAlreadyCompleted();
        if (amount == 0) revert InvalidAmount();

        processedRequests[requestId] = true;
        emit RequestProcessed(requestId);
    }

    /// @notice Get balance of a user.
    function getBalance(address user) external view returns (uint256) {
        if (user == address(0)) revert ZeroAddress();
        return balances[user];
    }
}
