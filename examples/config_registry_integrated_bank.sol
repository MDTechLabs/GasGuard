// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./on_chain_config_registry.sol";

/**
 * @title ConfigRegistryIntegratedBank
 * @dev Example contract demonstrating integration with OnChainConfigRegistry
 * This contract uses the config registry for all its configuration parameters
 */
contract ConfigRegistryIntegratedBank {
    OnChainConfigRegistry public configRegistry;

    // Events
    event Deposit(address indexed user, uint256 amount);
    event Withdrawal(address indexed user, uint256 amount);
    event FeeCollected(address indexed user, uint256 amount, uint256 fee);

    // State
    mapping(address => uint256) public balances;

    /**
     * @dev Constructor
     * @param _configRegistry Address of the configuration registry
     */
    constructor(address _configRegistry) {
        require(_configRegistry != address(0), "ConfigRegistryIntegratedBank: invalid config registry address");
        configRegistry = OnChainConfigRegistry(_configRegistry);
    }

    /**
     * @dev Deposit funds into the bank
     */
    function deposit() external payable {
        require(msg.value > 0, "ConfigRegistryIntegratedBank: deposit amount must be greater than 0");

        // Check if maintenance mode is enabled
        bool maintenanceMode = configRegistry.getBool(configRegistry.MAINTENANCE_MODE());
        require(!maintenanceMode, "ConfigRegistryIntegratedBank: maintenance mode is enabled");

        // Check minimum transaction limit
        uint256 minLimit = configRegistry.getUint256(configRegistry.MIN_TRANSACTION_LIMIT());
        require(msg.value >= minLimit, "ConfigRegistryIntegratedBank: deposit below minimum limit");

        // Check maximum transaction limit
        uint256 maxLimit = configRegistry.getUint256(configRegistry.MAX_TRANSACTION_LIMIT());
        require(msg.value <= maxLimit, "ConfigRegistryIntegratedBank: deposit above maximum limit");

        balances[msg.sender] += msg.value;

        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @dev Withdraw funds from the bank
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external {
        require(amount > 0, "ConfigRegistryIntegratedBank: withdrawal amount must be greater than 0");
        require(balances[msg.sender] >= amount, "ConfigRegistryIntegratedBank: insufficient balance");

        // Check if emergency pause is enabled
        bool emergencyPause = configRegistry.getBool(configRegistry.EMERGENCY_PAUSE_ENABLED());
        require(!emergencyPause, "ConfigRegistryIntegratedBank: emergency pause is enabled");

        // Check minimum transaction limit
        uint256 minLimit = configRegistry.getUint256(configRegistry.MIN_TRANSACTION_LIMIT());
        require(amount >= minLimit, "ConfigRegistryIntegratedBank: withdrawal below minimum limit");

        // Check maximum transaction limit
        uint256 maxLimit = configRegistry.getUint256(configRegistry.MAX_TRANSACTION_LIMIT());
        require(amount <= maxLimit, "ConfigRegistryIntegratedBank: withdrawal above maximum limit");

        // Calculate fee
        uint256 feeNumerator = configRegistry.getUint256(configRegistry.FEE_NUMERATOR());
        uint256 feeDenominator = configRegistry.getUint256(configRegistry.FEE_DENOMINATOR());
        uint256 fee = (amount * feeNumerator) / feeDenominator;

        require(amount > fee, "ConfigRegistryIntegratedBank: withdrawal amount too small after fee");

        uint256 netAmount = amount - fee;
        balances[msg.sender] -= amount;

        // Send fee to treasury
        address treasury = configRegistry.getAddress(configRegistry.TREASURY_ADDRESS());
        payable(treasury).transfer(fee);

        // Send net amount to user
        payable(msg.sender).transfer(netAmount);

        emit FeeCollected(msg.sender, amount, fee);
        emit Withdrawal(msg.sender, netAmount);
    }

    /**
     * @dev Get user's balance
     * @param user User address
     * @return User's balance
     */
    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }

    /**
     * @dev Get current fee rate
     * @return Fee numerator and denominator
     */
    function getFeeRate() external view returns (uint256, uint256) {
        uint256 numerator = configRegistry.getUint256(configRegistry.FEE_NUMERATOR());
        uint256 denominator = configRegistry.getUint256(configRegistry.FEE_DENOMINATOR());
        return (numerator, denominator);
    }

    /**
     * @dev Get transaction limits
     * @return Minimum and maximum transaction limits
     */
    function getTransactionLimits() external view returns (uint256, uint256) {
        uint256 minLimit = configRegistry.getUint256(configRegistry.MIN_TRANSACTION_LIMIT());
        uint256 maxLimit = configRegistry.getUint256(configRegistry.MAX_TRANSACTION_LIMIT());
        return (minLimit, maxLimit);
    }

    /**
     * @dev Check if contract is operational
     * @return True if contract is operational
     */
    function isOperational() external view returns (bool) {
        bool maintenanceMode = configRegistry.getBool(configRegistry.MAINTENANCE_MODE());
        bool emergencyPause = configRegistry.getBool(configRegistry.EMERGENCY_PAUSE_ENABLED());
        return !maintenanceMode && !emergencyPause;
    }

    /**
     * @dev Get treasury address
     * @return Treasury address
     */
    function getTreasuryAddress() external view returns (address) {
        return configRegistry.getAddress(configRegistry.TREASURY_ADDRESS());
    }

    /**
     * @dev Emergency withdrawal function (bypasses normal checks)
     * Only callable when emergency pause is enabled
     */
    function emergencyWithdraw() external {
        uint256 balance = balances[msg.sender];
        require(balance > 0, "ConfigRegistryIntegratedBank: no balance to withdraw");

        // Check if emergency pause is enabled
        bool emergencyPause = configRegistry.getBool(configRegistry.EMERGENCY_PAUSE_ENABLED());
        require(emergencyPause, "ConfigRegistryIntegratedBank: emergency pause not enabled");

        balances[msg.sender] = 0;
        payable(msg.sender).transfer(balance);

        emit Withdrawal(msg.sender, balance);
    }
}