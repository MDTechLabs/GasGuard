// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./enhanced_circuit_breaker.sol";

/**
 * @title CircuitBreakerProtectedBank
 * @dev Bank contract protected by enhanced circuit breaker with granular controls
 */
contract CircuitBreakerProtectedBank is EnhancedCircuitBreaker {
    mapping(address => uint256) public balances;
    uint256 public totalDeposits;

    // Events
    event Deposit(address indexed user, uint256 amount);
    event Withdrawal(address indexed user, uint256 amount);
    event EmergencyWithdrawal(address indexed user, uint256 amount);

    modifier onlyWhenDepositsAllowed() {
        require(!isPaused(DEPOSIT_MODULE), "CircuitBreakerProtectedBank: deposits are paused");
        _;
    }

    modifier onlyWhenWithdrawalsAllowed() {
        require(!isPaused(WITHDRAWAL_MODULE), "CircuitBreakerProtectedBank: withdrawals are paused");
        _;
    }

    constructor(address _admin, address _emergencyPauser, address _timelock)
        EnhancedCircuitBreaker(_admin, _emergencyPauser, _timelock)
    {}

    /**
     * @dev Deposit funds (can be paused)
     */
    function deposit() external payable onlyWhenDepositsAllowed {
        balances[msg.sender] += msg.value;
        totalDeposits += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @dev Withdraw funds (can be paused)
     */
    function withdraw(uint256 amount) external onlyWhenWithdrawalsAllowed {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        require(address(this).balance >= amount, "Contract has insufficient funds");

        balances[msg.sender] -= amount;
        totalDeposits -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawal(msg.sender, amount);
    }

    /**
     * @dev Emergency withdrawal (works even when paused)
     * Only available during global pause or withdrawal pause
     */
    function emergencyWithdraw(uint256 amount) external {
        require(isPaused(WITHDRAWAL_MODULE) || globalPause, "CircuitBreakerProtectedBank: emergency withdrawal not allowed");
        require(balances[msg.sender] >= amount, "Insufficient balance");

        // Emergency withdrawals have additional restrictions
        // e.g., limit to certain percentage of balance
        uint256 maxEmergencyAmount = balances[msg.sender] / 2; // Max 50% in emergency
        require(amount <= maxEmergencyAmount, "Emergency withdrawal amount too high");

        balances[msg.sender] -= amount;
        totalDeposits -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit EmergencyWithdrawal(msg.sender, amount);
    }

    /**
     * @dev Governance function (can be paused)
     */
    function updateSettings(uint256 newSetting) external {
        require(!isPaused(GOVERNANCE_MODULE), "CircuitBreakerProtectedBank: governance is paused");
        // Implement governance logic here
    }

    /**
     * @dev Emergency fund recovery (works even when paused)
     * Only admin can call during emergency
     */
    function emergencyFundRecovery(address recipient, uint256 amount) external onlyAdmin {
        require(globalPause || isPaused(WITHDRAWAL_MODULE), "CircuitBreakerProtectedBank: not in emergency state");
        require(amount <= address(this).balance / 10, "Emergency recovery amount too high"); // Max 10% of contract balance

        (bool success,) = recipient.call{value: amount}("");
        require(success, "Emergency transfer failed");

        emit EmergencyActionExecuted(msg.sender, "emergency fund recovery", block.timestamp);
    }

    /**
     * @dev Get contract status
     */
    function getContractStatus() external view returns (
        bool depositsPaused,
        bool withdrawalsPaused,
        bool governancePaused,
        bool globalPaused,
        uint256 contractBalance,
        uint256 trackedDeposits
    ) {
        return (
            isPaused(DEPOSIT_MODULE),
            isPaused(WITHDRAWAL_MODULE),
            isPaused(GOVERNANCE_MODULE),
            isGlobalPaused(),
            address(this).balance,
            totalDeposits
        );
    }

    /**
     * @dev Check if operations are allowed for a user
     */
    function canUserOperate(address user, bytes32 operation) external view returns (bool) {
        if (operation == DEPOSIT_MODULE) {
            return !isPaused(DEPOSIT_MODULE) && balances[user] >= 0;
        } else if (operation == WITHDRAWAL_MODULE) {
            return !isPaused(WITHDRAWAL_MODULE) && balances[user] > 0;
        }
        return !isPaused(operation);
    }
}