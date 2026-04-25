// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title HealthCheckableBank
 * @dev Example contract demonstrating comprehensive health check functionality
 * This contract maintains balance invariants and provides detailed health monitoring
 */
contract HealthCheckableBank {
    mapping(address => uint256) public balances;
    uint256 public totalUserBalances;
    bool private locked;
    uint256 private constant VERSION = 1;
    uint256 private lastHealthCheck;

    // Events for monitoring
    event Deposit(address indexed user, uint256 amount);
    event Withdrawal(address indexed user, uint256 amount);
    event HealthCheckPerformed(address indexed checker, uint256 timestamp);

    modifier nonReentrant() {
        require(!locked, "ReentrancyGuard: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    modifier validAmount(uint256 amount) {
        require(amount > 0, "Amount must be greater than 0");
        _;
    }

    /**
     * @dev Deposit funds into the contract
     */
    function deposit() external payable validAmount(msg.value) {
        balances[msg.sender] += msg.value;
        totalUserBalances += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @dev Withdraw funds from the contract
     */
    function withdraw(uint256 amount) external nonReentrant validAmount(amount) {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        require(address(this).balance >= amount, "Contract has insufficient funds");

        balances[msg.sender] -= amount;
        totalUserBalances -= amount;

        // External call after state update - SECURE
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawal(msg.sender, amount);
    }

    /**
     * @dev Comprehensive health check function
     * @return struct containing all health indicators
     */
    function performHealthCheck() external returns (HealthStatus memory) {
        lastHealthCheck = block.timestamp;
        emit HealthCheckPerformed(msg.sender, block.timestamp);

        return getHealthStatus();
    }

    /**
     * @dev View-only health check (no events emitted)
     * @return struct containing all health indicators
     */
    function getHealthStatus() public view returns (HealthStatus memory) {
        uint256 contractBalance = address(this).balance;
        bool balanceInvariant = (contractBalance == totalUserBalances);
        bool reentrancyLock = locked;
        uint256 userCount = getUserCount(); // Simplified - would need proper tracking

        // Check for any abnormal conditions
        bool hasAnomalies = !balanceInvariant || contractBalance == 0;

        return HealthStatus({
            contractBalance: contractBalance,
            totalUserBalances: totalUserBalances,
            balanceInvariantHolds: balanceInvariant,
            reentrancyLockActive: reentrancyLock,
            userCount: userCount,
            hasAnomalies: hasAnomalies,
            lastCheckTimestamp: lastHealthCheck,
            contractVersion: VERSION,
            blockTimestamp: block.timestamp
        });
    }

    /**
     * @dev Get simplified health metrics for monitoring tools
     * @return Basic health metrics as individual values
     */
    function getHealthMetrics() external view returns (
        uint256 contractBalance,
        uint256 totalTrackedBalances,
        bool invariantHolds,
        bool isLocked,
        uint256 version
    ) {
        contractBalance = address(this).balance;
        totalTrackedBalances = totalUserBalances;
        invariantHolds = (contractBalance == totalUserBalances);
        isLocked = locked;
        version = VERSION;
    }

    /**
     * @dev Emergency check for critical invariants
     * @return true if all critical invariants hold
     */
    function checkCriticalInvariants() external view returns (bool) {
        // Critical invariant: contract balance should equal tracked user balances
        return address(this).balance == totalUserBalances;
    }

    /**
     * @dev Get user count (simplified implementation)
     * In production, this would be properly tracked
     */
    function getUserCount() internal pure returns (uint256) {
        // Placeholder - would need proper user tracking
        return 0;
    }

    // Struct for comprehensive health status
    struct HealthStatus {
        uint256 contractBalance;
        uint256 totalUserBalances;
        bool balanceInvariantHolds;
        bool reentrancyLockActive;
        uint256 userCount;
        bool hasAnomalies;
        uint256 lastCheckTimestamp;
        uint256 contractVersion;
        uint256 blockTimestamp;
    }
}