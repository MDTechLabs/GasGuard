# On-Chain Configuration Registry System

## Overview

The On-Chain Configuration Registry provides a centralized, transparent, and secure mechanism for managing protocol configuration parameters. This system enables protocols to store, update, and retrieve configuration values on-chain while maintaining auditability, access control, and consistency.

## Problem Statement

Traditional configuration management in smart contracts often suffers from:

- **Scattered Configuration**: Parameters stored in multiple contracts or hardcoded values
- **Unsafe Updates**: Lack of proper access controls for configuration changes
- **Poor Auditability**: No systematic tracking of configuration changes
- **Inconsistency**: Difficulty ensuring all dependent contracts use the same configuration values
- **Maintenance Challenges**: Hard to update configurations safely without breaking dependent logic

## Solution Architecture

### Core Components

1. **OnChainConfigRegistry Contract**: Main registry contract providing configuration storage and management
2. **Type-Safe Storage**: Support for multiple data types (uint256, address, bool, bytes32, string)
3. **Role-Based Access Control**: Separate roles for admin, config updater, and emergency admin
4. **Versioning System**: Track configuration changes with version numbers
5. **Event Emission**: Comprehensive event logging for all configuration operations
6. **Batch Operations**: Efficient bulk updates for multiple configurations

### Supported Data Types

- `UINT256`: Large unsigned integers (fees, limits, counters)
- `ADDRESS`: Ethereum addresses (contracts, treasuries, admins)
- `BOOL`: Boolean flags (feature toggles, pause states)
- `BYTES32`: Fixed-size byte arrays (hashes, identifiers)
- `STRING`: Variable-length strings (descriptions, URLs)

## Contract Interface

### Configuration Management

#### Setting Values

```solidity
// Set individual values
function setUint256(bytes32 key, uint256 value) external onlyConfigUpdater
function setAddress(bytes32 key, address value) external onlyConfigUpdater
function setBool(bytes32 key, bool value) external onlyConfigUpdater
function setBytes32(bytes32 key, bytes32 value) external onlyConfigUpdater
function setString(bytes32 key, string calldata value) external onlyConfigUpdater

// Batch updates
function batchUpdate(ConfigUpdate[] calldata updates) external onlyConfigUpdater
```

#### Retrieving Values

```solidity
// Get typed values
function getUint256(bytes32 key) external view returns (uint256)
function getAddress(bytes32 key) external view returns (address)
function getBool(bytes32 key) external view returns (bool)
function getBytes32(bytes32 key) external view returns (bytes32)
function getString(bytes32 key) external view returns (string memory)

// Get complete entry
function getConfigEntry(bytes32 key) external view returns (ConfigEntry memory)
```

### Access Control

#### Roles

- **Admin**: Full control over registry management and access control
- **Config Updater**: Can update configuration values
- **Emergency Admin**: Can update configurations during emergencies

#### Role Management

```solidity
function updateAdmin(address newAdmin) external onlyAdmin
function updateConfigUpdater(address newUpdater) external onlyAdmin
function updateEmergencyAdmin(address newEmergencyAdmin) external onlyAdmin
```

### Utility Functions

```solidity
// Configuration queries
function configExists(bytes32 key) external view returns (bool)
function getAllKeys() external view returns (bytes32[] memory)
function getConfigCount() external view returns (uint256)

// Version management
function getVersionKeys(uint256 version) external view returns (bytes32[] memory)
function getCurrentVersion() external view returns (uint256)
```

## Standard Configuration Keys

The registry defines standard keys for common protocol parameters:

```solidity
bytes32 public constant FEE_NUMERATOR = keccak256("FEE_NUMERATOR");
bytes32 public constant FEE_DENOMINATOR = keccak256("FEE_DENOMINATOR");
bytes32 public constant MAX_TRANSACTION_LIMIT = keccak256("MAX_TRANSACTION_LIMIT");
bytes32 public constant MIN_TRANSACTION_LIMIT = keccak256("MIN_TRANSACTION_LIMIT");
bytes32 public constant TREASURY_ADDRESS = keccak256("TREASURY_ADDRESS");
bytes32 public constant EMERGENCY_PAUSE_ENABLED = keccak256("EMERGENCY_PAUSE_ENABLED");
bytes32 public constant MAINTENANCE_MODE = keccak256("MAINTENANCE_MODE");
```

## Integration Examples

### Basic Integration

```solidity
contract MyProtocol {
    OnChainConfigRegistry public configRegistry;

    constructor(address _configRegistry) {
        configRegistry = OnChainConfigRegistry(_configRegistry);
    }

    function getFeeRate() public view returns (uint256) {
        uint256 numerator = configRegistry.getUint256(configRegistry.FEE_NUMERATOR());
        uint256 denominator = configRegistry.getUint256(configRegistry.FEE_DENOMINATOR());
        return (numerator * 100) / denominator; // Convert to percentage
    }

    function isOperational() public view returns (bool) {
        bool maintenanceMode = configRegistry.getBool(configRegistry.MAINTENANCE_MODE());
        bool emergencyPause = configRegistry.getBool(configRegistry.EMERGENCY_PAUSE_ENABLED());
        return !maintenanceMode && !emergencyPause;
    }
}
```

### Advanced Integration with Circuit Breaker

```solidity
contract AdvancedProtocol is EnhancedCircuitBreaker {
    OnChainConfigRegistry public configRegistry;

    modifier whenOperational() {
        require(isOperational(), "Protocol: not operational");
        _;
    }

    function isOperational() public view returns (bool) {
        if (isPaused()) return false;

        bool maintenanceMode = configRegistry.getBool(configRegistry.MAINTENANCE_MODE());
        return !maintenanceMode;
    }

    function updateConfig(bytes32 key, uint256 value) external onlyOwner {
        // Update config and pause if necessary
        configRegistry.setUint256(key, value);

        if (key == configRegistry.EMERGENCY_PAUSE_ENABLED()) {
            if (value == 1) {
                _pause();
            }
        }
    }
}
```

## Security Considerations

### Access Control

- **Principle of Least Privilege**: Each role has minimal required permissions
- **Multi-Signature Requirements**: Consider requiring multiple admins for critical changes
- **Time-Locked Updates**: Implement timelock for sensitive configuration changes

### Validation

- **Input Validation**: Validate all configuration values before storage
- **Type Safety**: Ensure correct data types are used for each configuration
- **Range Checks**: Validate numeric values are within acceptable ranges

### Emergency Procedures

- **Emergency Admin**: Separate role for emergency configuration changes
- **Circuit Breaker Integration**: Automatic pausing when emergency conditions detected
- **Audit Trail**: All changes are logged with timestamps and actor addresses

## Testing Strategy

### Unit Tests

- **Access Control**: Test all role-based permissions
- **Data Types**: Test all supported data types
- **Edge Cases**: Test boundary conditions and error cases
- **Versioning**: Test version increment and snapshot functionality

### Integration Tests

- **Cross-Contract**: Test configuration sharing between contracts
- **Batch Operations**: Test bulk configuration updates
- **Event Emission**: Verify all events are emitted correctly

### Security Tests

- **Authorization**: Test unauthorized access attempts
- **Input Validation**: Test invalid input handling
- **State Consistency**: Test state consistency after failures

## Deployment Guide

### 1. Deploy Registry Contract

```javascript
const ConfigRegistry = await ethers.getContractFactory("OnChainConfigRegistry");
const registry = await ConfigRegistry.deploy(
    adminAddress,
    configUpdaterAddress,
    emergencyAdminAddress
);
await registry.deployed();
```

### 2. Initialize Standard Configurations

```javascript
// Set initial fee structure
await registry.connect(configUpdater).setUint256(
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FEE_NUMERATOR")),
    25 // 2.5%
);
await registry.connect(configUpdater).setUint256(
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FEE_DENOMINATOR")),
    1000
);

// Set transaction limits
await registry.connect(configUpdater).setUint256(
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MAX_TRANSACTION_LIMIT")),
    ethers.utils.parseEther("1000")
);
await registry.connect(configUpdater).setUint256(
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MIN_TRANSACTION_LIMIT")),
    ethers.utils.parseEther("0.01")
);

// Set treasury address
await registry.connect(configUpdater).setAddress(
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TREASURY_ADDRESS")),
    treasuryAddress
);
```

### 3. Integrate with Protocol Contracts

```javascript
// In your protocol contracts
constructor(address _configRegistry) {
    configRegistry = OnChainConfigRegistry(_configRegistry);
}
```

## Monitoring and Maintenance

### Event Monitoring

Monitor these events for configuration changes:

- `ConfigUpdated`: Individual configuration updates
- `ConfigBatchUpdated`: Batch configuration updates
- `ConfigDeleted`: Configuration deletions
- `VersionCreated`: New configuration versions

### Health Checks

Regularly verify:

- Configuration values are within expected ranges
- Access controls are properly configured
- Contract state is consistent
- Event logs are being generated correctly

### Backup and Recovery

- **Off-chain Backup**: Maintain off-chain backups of critical configurations
- **Emergency Procedures**: Document procedures for emergency configuration changes
- **Version Rollback**: Consider implementing rollback functionality for critical errors

## Soroban Implementation

The system also includes a Soroban (Rust) implementation for Stellar network compatibility:

### Key Differences

- Uses Soroban SDK types (`Symbol`, `Address`, `String`)
- Limited to `u64` for large numbers (Soroban constraint)
- Uses persistent storage for configuration data
- Events use Soroban event system

### Usage Example

```rust
let config_key = Symbol::new(&env, "fee_rate");
client.set_uint256(&config_key, &25u64);
let fee_rate = client.get_uint256(&config_key);
```

## Future Enhancements

### Potential Improvements

1. **Timelock Integration**: Add timelock for critical configuration changes
2. **Governance Integration**: Connect with DAO governance for configuration updates
3. **Cross-Chain Configuration**: Synchronize configurations across multiple chains
4. **Configuration Templates**: Pre-defined configuration templates for common protocols
5. **Historical Analysis**: Advanced analytics on configuration change patterns

### Research Areas

- **Gas Optimization**: Optimize storage patterns for reduced gas costs
- **Layer 2 Compatibility**: Ensure compatibility with various Layer 2 solutions
- **Quantum Resistance**: Consider quantum-resistant signature schemes for long-term configurations

## Conclusion

The On-Chain Configuration Registry provides a robust foundation for managing protocol configurations with strong security guarantees, auditability, and flexibility. By centralizing configuration management and providing type-safe, access-controlled operations, protocols can achieve better maintainability and reliability.