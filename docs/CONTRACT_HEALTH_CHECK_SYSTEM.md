# Contract Health Check Implementation

## Overview

This document describes the implementation of health check functionality for smart contracts in GasGuard. Health checks provide visibility into contract state, enable proactive monitoring, and help detect anomalies before they become critical issues.

## Problem Statement

Smart contracts often lack built-in monitoring capabilities, making it difficult to:
- Detect abnormal states or inconsistencies
- Monitor key performance indicators
- Integrate with off-chain monitoring systems
- Perform proactive maintenance and issue detection

## Solution

We implement comprehensive health check functions that expose key contract metrics and invariants in a structured, read-only manner.

## Implementation

### Solidity Health Checks

#### Basic Health Check (SecureBank.sol)

```solidity
function healthCheck() external view returns (
    uint256 contractBalance,
    uint256 totalUserBalances,
    bool balanceInvariant,
    bool reentrancyLock,
    uint256 lastCheckTimestamp,
    uint256 contractVersion
)
```

**Parameters:**
- `contractBalance`: Current contract ETH balance
- `totalUserBalances`: Sum of all tracked user balances (0 in basic implementation)
- `balanceInvariant`: Whether balance invariant holds (simplified to true)
- `reentrancyLock`: Current state of reentrancy lock
- `lastCheckTimestamp`: Block timestamp of last check
- `contractVersion`: Contract version number

#### Advanced Health Check (HealthCheckableBank.sol)

```solidity
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

function performHealthCheck() external returns (HealthStatus memory)
function getHealthStatus() public view returns (HealthStatus memory)
function getHealthMetrics() external view returns (uint256, uint256, bool, bool, uint256)
function checkCriticalInvariants() external view returns (bool)
```

**Key Features:**
- **Balance Invariant Checking**: Verifies contract balance equals sum of user balances
- **State Tracking**: Maintains total user balances for accurate invariant checking
- **Event Logging**: Emits events when health checks are performed
- **Multiple Access Patterns**: View-only and state-updating versions
- **Critical Invariant Checks**: Quick boolean checks for essential conditions

### Soroban Health Checks

#### Health Status Structure

```rust
#[contracttype]
pub struct HealthStatus {
    pub contract_balance: u64,
    pub transaction_count: u32,
    pub total_operations: u32,
    pub contract_version: u32,
    pub last_check_timestamp: u64,
    pub balance_positive: bool,
    pub operations_consistent: bool,
    pub version_valid: bool,
    pub has_anomalies: bool,
    pub ledger_sequence: u32,
}
```

#### Health Check Methods

```rust
pub fn perform_health_check(&mut self, env: Env) -> Result<HealthStatus, DemoError>
pub fn get_health_status(&self, env: Env) -> HealthStatus
pub fn quick_health_check(&self) -> (bool, u64, u32)
pub fn check_invariants(&self) -> bool
```

**Features:**
- **Comprehensive State Monitoring**: Tracks balance, operations, and version
- **Invariant Validation**: Checks critical business logic constraints
- **Ledger Integration**: Includes ledger sequence for temporal context
- **Anomaly Detection**: Flags potential issues automatically
- **Performance Optimized**: Quick checks for frequent monitoring

## Health Indicators

### Balance & Invariants
- Contract balance vs. tracked user balances
- Non-negative balance requirements
- Total supply consistency (token contracts)

### Operational Metrics
- Transaction counts
- Operation success rates
- Gas usage patterns
- User activity levels

### Security State
- Reentrancy lock status
- Access control state
- Emergency pause status
- Authorization flags

### System Health
- Contract version
- Last maintenance timestamp
- Ledger/block information
- Configuration validity

## Integration with Monitoring Systems

### Off-Chain Monitoring

Health check functions are designed to be called by:
- **Monitoring Bots**: Automated systems checking contract health
- **Dashboard Applications**: Real-time status displays
- **Alert Systems**: Triggering notifications on anomalies
- **Analytics Platforms**: Collecting performance metrics

### API Integration

```javascript
// Example monitoring integration
async function checkContractHealth(contractAddress) {
    const healthData = await contract.getHealthStatus();
    const metrics = await contract.getHealthMetrics();

    // Send to monitoring service
    await monitoringService.report({
        contract: contractAddress,
        balance: healthData.contractBalance,
        invariantHolds: healthData.balanceInvariantHolds,
        hasAnomalies: healthData.hasAnomalies,
        timestamp: healthData.blockTimestamp
    });
}
```

### Alert Conditions

Common alert triggers:
- `balanceInvariantHolds == false`: Balance tracking inconsistency
- `hasAnomalies == true`: Any detected anomalies
- `contractBalance == 0`: Contract may be drained
- `reentrancyLockActive == true` (persistent): Potential stuck state

## Testing

### Unit Tests

```solidity
function testHealthCheck() public {
    // Setup contract state
    bank.deposit{value: 1 ether}();

    // Perform health check
    (uint256 balance, uint256 total, bool invariant, , , ) = bank.healthCheck();

    // Verify metrics
    assertEq(balance, 1 ether);
    assertTrue(invariant);
}
```

### Integration Tests

```rust
#[test]
fn test_soroban_health_check() {
    let env = Env::default();
    let contract = OptimizedContract::new(admin, 1000).unwrap();

    let health = contract.get_health_status(env);
    assert!(health.balance_positive);
    assert!(!health.has_anomalies);
}
```

## Security Considerations

### Read-Only Operations
- Health check functions are `view`/`pure` where possible
- No state modifications during checks
- Safe for frequent calling

### Gas Efficiency
- Optimized for low gas costs
- Avoid expensive operations in health checks
- Consider gas limits for complex checks

### Access Control
- Public access for monitoring transparency
- Consider rate limiting for public endpoints
- Admin-only detailed diagnostics if needed

## Best Practices

### Implementation Guidelines
1. **Keep Health Checks Simple**: Avoid complex logic that could introduce bugs
2. **Use View Functions**: Prefer read-only checks for safety
3. **Include Timestamps**: Track when checks were performed
4. **Version Information**: Include contract version for compatibility
5. **Invariant Documentation**: Clearly document what invariants are checked

### Monitoring Guidelines
1. **Regular Checks**: Implement automated periodic health checks
2. **Alert Thresholds**: Define clear anomaly detection rules
3. **Historical Tracking**: Log health check results over time
4. **Multi-Contract Monitoring**: Check related contracts together
5. **Fail-Safe Design**: Ensure monitoring failures don't break contracts

## Future Enhancements

- **Historical Health Data**: Store health check history on-chain
- **Configurable Thresholds**: Dynamic anomaly detection parameters
- **Cross-Contract Checks**: Verify consistency across multiple contracts
- **Performance Metrics**: Include gas usage and performance indicators
- **Automated Recovery**: Self-healing capabilities based on health checks