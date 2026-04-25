import { GasGuardEngine } from '../packages/rules/gasGuard/gasguard.engine';
import * as fs from 'fs';
import * as path from 'path';

describe('Solidity Reentrancy Guard Analysis', () => {
  let engine: GasGuardEngine;

  beforeAll(() => {
    engine = new GasGuardEngine();
  });

  describe('Reentrancy Guard Detection', () => {
    it('should detect missing reentrancy guard in vulnerable contract', async () => {
      const source = fs.readFileSync(
        path.join(__dirname, '../../examples/vulnerable_bank.sol'),
        'utf8'
      );

      const result = await engine.scan({
        language: 'solidity',
        source,
      });

      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'sol-006',
            severity: 'critical',
            message: 'Function transfers ETH/tokens but lacks reentrancy guard'
          })
        ])
      );
    });

    it('should not flag secure contract with reentrancy guard', async () => {
      const source = fs.readFileSync(
        path.join(__dirname, '../../examples/secure_bank.sol'),
        'utf8'
      );

      const result = await engine.scan({
        language: 'solidity',
        source,
      });

      // Should not have sol-006 issues
      const reentrancyIssues = result.issues.filter(issue => issue.ruleId === 'sol-006');
      expect(reentrancyIssues).toHaveLength(0);
    });

    it('should detect multiple vulnerable functions in complex contract', async () => {
      const source = fs.readFileSync(
        path.join(__dirname, '../../examples/reentrancy_examples.sol'),
        'utf8'
      );

      const result = await engine.scan({
        language: 'solidity',
        source,
      });

      const reentrancyIssues = result.issues.filter(issue => issue.ruleId === 'sol-006');
      // Should detect 3 vulnerable functions: vulnerableWithdraw, vulnerableSend, vulnerableCall
      expect(reentrancyIssues).toHaveLength(3);
    });
  });

  describe('Reentrancy Attack Simulation', () => {
    it('should identify functions vulnerable to reentrancy attacks', async () => {
      const vulnerableContract = `
        contract Vulnerable {
            mapping(address => uint256) balances;

            function withdraw() external {
                uint256 amount = balances[msg.sender];
                require(amount > 0);

                // VULNERABLE: External call before state update
                (bool success,) = msg.sender.call{value: amount}("");
                require(success, "Transfer failed");

                balances[msg.sender] = 0; // State update after external call
            }

            function deposit() external payable {
                balances[msg.sender] += msg.value;
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: vulnerableContract,
      });

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          ruleId: 'sol-006',
          severity: 'critical',
          message: 'Function transfers ETH/tokens but lacks reentrancy guard'
        })
      );
    });

    it('should not flag functions that do not transfer ETH/tokens', async () => {
      const safeContract = `
        contract Safe {
            mapping(address => uint256) balances;

            function updateBalance(uint256 newBalance) external {
                balances[msg.sender] = newBalance;
            }

            function getBalance() external view returns (uint256) {
                return balances[msg.sender];
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: safeContract,
      });

      const reentrancyIssues = result.issues.filter(issue => issue.ruleId === 'sol-006');
      expect(reentrancyIssues).toHaveLength(0);
    });
  });

  describe('Fallback Function Security', () => {
    it('should detect insecure fallback with sensitive external transfer logic', async () => {
      const insecureFallbackContract = `
        contract InsecureFallback {
            address payable public treasury;

            constructor(address payable _treasury) {
                treasury = _treasury;
            }

            fallback() external payable {
                (bool ok,) = treasury.call{value: msg.value}("");
                require(ok, "Forward failed");
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: insecureFallbackContract,
      });

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          ruleId: 'sol-007',
          severity: 'high',
          message: 'Fallback/receive handler is permissive or executes sensitive logic without strict validation',
        })
      );
    });

    it('should detect permissive fallback that accepts unknown calls without explicit rejection', async () => {
      const permissiveFallbackContract = `
        contract PermissiveFallback {
            event UnknownCall(address caller, uint256 value, bytes data);

            fallback() external payable {
                uint256 x = msg.value;
                if (x > 0) {
                    emit UnknownCall(msg.sender, x, msg.data);
                }
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: permissiveFallbackContract,
      });

      const fallbackIssues = result.issues.filter(issue => issue.ruleId === 'sol-007');
      expect(fallbackIssues.length).toBeGreaterThan(0);
    });

    it('should not flag strict fallback that always rejects unknown calls', async () => {
      const strictFallbackContract = `
        contract StrictFallback {
            fallback() external payable {
                revert("Unknown function call");
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: strictFallbackContract,
      });

      const fallbackIssues = result.issues.filter(issue => issue.ruleId === 'sol-007');
      expect(fallbackIssues).toHaveLength(0);
    });

    it('should not flag minimal receive handler that only emits telemetry event', async () => {
      const safeReceiveContract = `
        contract SafeReceive {
            event Received(address indexed sender, uint256 amount);

            receive() external payable {
                emit Received(msg.sender, msg.value);
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: safeReceiveContract,
      });

      const fallbackIssues = result.issues.filter(issue => issue.ruleId === 'sol-007');
      expect(fallbackIssues).toHaveLength(0);
    });
  });

  describe('Timelock Security For Sensitive Operations', () => {
    it('should detect immediate sensitive actions without timelock scheduling', async () => {
      const vulnerableContract = `
        contract VulnerableTreasury {
            address public owner;
            uint256 public treasury;

            constructor() {
                owner = msg.sender;
            }

            function withdrawFunds(address payable recipient, uint256 amount) external {
                require(msg.sender == owner, "Not owner");
                treasury -= amount;
                recipient.transfer(amount);
  describe('External Call Validation', () => {
    it('should detect unchecked low-level call return values', async () => {
      const uncheckedCallContract = `
        contract UncheckedCall {
            function execute(address target, bytes calldata data) external {
                target.call(data);
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: vulnerableContract,
        source: uncheckedCallContract,
      });

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          ruleId: 'sol-009',
          severity: 'high',
          message: expect.stringContaining('lacks enforced timelock'),
        })
      );
    });

    it('should detect execute paths without delay enforcement', async () => {
      const vulnerableContract = `
        contract MissingDelay {
            address public owner;
            mapping(bytes32 => bool) public queued;

            function scheduleOperation(bytes32 opId) external {
                require(msg.sender == owner, "Not owner");
                queued[opId] = true;
            }

            function executeOperation(bytes32 opId) external {
                require(msg.sender == owner, "Not owner");
                require(queued[opId], "Not queued");
                // Missing block.timestamp delay check
                queued[opId] = false;
          ruleId: 'sol-008',
          severity: 'high',
        })
      );
    });

    it('should not flag low-level call when return value is captured and checked', async () => {
      const safeCallContract = `
        contract SafeCall {
            function execute(address target, bytes calldata data) external {
                (bool success, ) = target.call(data);
                require(success, "Call failed");
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: vulnerableContract,
      });

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          ruleId: 'sol-009',
          message: expect.stringContaining('does not enforce timelock delay'),
        })
      );
    });

    it('should detect missing authorization on timelock operations', async () => {
      const vulnerableContract = `
        contract MissingAuth {
            mapping(bytes32 => uint256) public queuedAt;

            function schedule(bytes32 opId) external {
                queuedAt[opId] = block.timestamp + 1 days;
            }

            function execute(bytes32 opId) external {
                require(block.timestamp >= queuedAt[opId], "Timelock not expired");
                delete queuedAt[opId];
            }

            function cancel(bytes32 opId) external {
                delete queuedAt[opId];
        source: safeCallContract,
      });

      const uncheckedCallIssues = result.issues.filter(
        issue => issue.ruleId === 'sol-008' && issue.message.includes('return value not checked')
      );
      expect(uncheckedCallIssues).toHaveLength(0);
    });

    it('should detect delegatecall usage as unsafe external interaction', async () => {
      const delegateCallContract = `
        contract DelegateCaller {
            function proxy(address target, bytes calldata data) external {
                (bool ok, ) = target.delegatecall(data);
                require(ok, "delegatecall failed");
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: vulnerableContract,
      });

      const authIssues = result.issues.filter(
        issue => issue.ruleId === 'sol-009' && issue.message.includes('lacks authorization')
      );
      expect(authIssues.length).toBeGreaterThan(0);
    });

    it('should detect timelock flows missing cancellation capability', async () => {
      const vulnerableContract = `
        contract MissingCancel {
            address public owner;
            mapping(bytes32 => uint256) public queuedAt;

            function schedule(bytes32 opId) external {
                require(msg.sender == owner, "Not owner");
                queuedAt[opId] = block.timestamp + 1 days;
            }

            function execute(bytes32 opId) external {
                require(msg.sender == owner, "Not owner");
                require(block.timestamp >= queuedAt[opId], "Timelock not expired");
                delete queuedAt[opId];
        source: delegateCallContract,
      });

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          ruleId: 'sol-008',
          message: expect.stringContaining('delegatecall'),
        })
      );
    });

    it('should detect CEI violations when state is updated after external calls', async () => {
      const ceiViolationContract = `
        contract CeiViolation {
            mapping(address => uint256) public balances;

            function withdraw(uint256 amount) external {
                require(balances[msg.sender] >= amount, "Insufficient");
                (bool success, ) = msg.sender.call{value: amount}("");
                require(success, "Transfer failed");
                balances[msg.sender] -= amount;
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: vulnerableContract,
        source: ceiViolationContract,
      });

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          ruleId: 'sol-009',
          message: expect.stringContaining('missing cancellation capability'),
        })
      );
    });

    it('should not flag properly timelocked and authorized sensitive operations', async () => {
      const secureContract = `
        contract SecureTimelock {
            address public owner;
            uint256 public constant TIMELOCK_DELAY = 1 days;

            struct QueuedOperation {
                uint256 executeAfter;
                bool exists;
            }

            mapping(bytes32 => QueuedOperation) public queuedOperations;

            event OperationScheduled(bytes32 indexed opId, uint256 executeAfter);
            event OperationExecuted(bytes32 indexed opId);
            event OperationCancelled(bytes32 indexed opId);

            constructor() {
                owner = msg.sender;
            }

            function scheduleWithdraw(bytes32 opId) external {
                require(msg.sender == owner, "Not owner");
                queuedOperations[opId] = QueuedOperation({
                    executeAfter: block.timestamp + TIMELOCK_DELAY,
                    exists: true
                });
                emit OperationScheduled(opId, queuedOperations[opId].executeAfter);
            }

            function executeWithdraw(bytes32 opId) external {
                require(msg.sender == owner, "Not owner");
                require(queuedOperations[opId].exists, "Not queued");
                require(block.timestamp >= queuedOperations[opId].executeAfter, "Timelock not expired");
                delete queuedOperations[opId];
                emit OperationExecuted(opId);
            }

            function cancelOperation(bytes32 opId) external {
                require(msg.sender == owner, "Not owner");
                require(queuedOperations[opId].exists, "Not queued");
                delete queuedOperations[opId];
                emit OperationCancelled(opId);
          ruleId: 'sol-008',
          message: expect.stringContaining('CEI'),
        })
      );
    });

    it('should not flag CEI-compliant functions with effects before interactions', async () => {
      const compliantCeiContract = `
        contract CorrectCei {
            mapping(address => uint256) public balances;

            function withdraw(uint256 amount) external {
                require(balances[msg.sender] >= amount, "Insufficient");
                balances[msg.sender] -= amount;
                (bool success, ) = msg.sender.call{value: amount}("");
                require(success, "Transfer failed");
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: secureContract,
      });

      const timelockIssues = result.issues.filter(issue => issue.ruleId === 'sol-009');
      expect(timelockIssues).toHaveLength(0);
        source: compliantCeiContract,
      });

      const ceiIssues = result.issues.filter(
        issue => issue.ruleId === 'sol-008' && issue.message.includes('CEI')
      );
      expect(ceiIssues).toHaveLength(0);
    });
  });
  describe('Enhanced Circuit Breaker Functionality', () => {
    it('should validate circuit breaker pause/unpause operations', async () => {
      const circuitBreakerSource = `
        contract EnhancedCircuitBreaker {
            mapping(bytes32 => bool) private pausedModules;
            bool private globalPause;
            address public admin;
            address public emergencyPauser;

            bytes32 public constant WITHDRAWAL_MODULE = keccak256("WITHDRAWAL");
            bytes32 public constant DEPOSIT_MODULE = keccak256("DEPOSIT");

            event ModulePaused(bytes32 indexed moduleId, address indexed pauser, uint256 timestamp);
            event ModuleUnpaused(bytes32 indexed moduleId, address indexed unpauser, uint256 timestamp);

            modifier onlyEmergencyPauser() {
                require(msg.sender == emergencyPauser || msg.sender == admin, "Not authorized");
                _;
            }

            modifier onlyAdmin() {
                require(msg.sender == admin, "Not admin");
                _;
            }

            constructor(address _admin, address _emergencyPauser) {
                admin = _admin;
                emergencyPauser = _emergencyPauser;
            }

            function pauseModule(bytes32 moduleId) external onlyEmergencyPauser {
                require(!pausedModules[moduleId], "Already paused");
                pausedModules[moduleId] = true;
                emit ModulePaused(moduleId, msg.sender, block.timestamp);
            }

            function adminUnpause(bytes32 moduleId) external onlyAdmin {
                require(pausedModules[moduleId], "Not paused");
                pausedModules[moduleId] = false;
                emit ModuleUnpaused(moduleId, msg.sender, block.timestamp);
            }

            function isPaused(bytes32 moduleId) public view returns (bool) {
                return globalPause || pausedModules[moduleId];
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: circuitBreakerSource,
      });

      // Circuit breaker should not trigger security issues
      const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
      const highIssues = result.issues.filter(issue => issue.severity === 'high');

      expect(criticalIssues).toHaveLength(0);
      expect(highIssues).toHaveLength(0);
    });

    it('should detect unsafe circuit breaker implementations', async () => {
      const unsafeCircuitBreaker = `
        contract UnsafeCircuitBreaker {
            bool public paused;

            function pause() external {
                // UNSAFE: Anyone can pause
                paused = true;
            }

            function unpause() external {
                // UNSAFE: Anyone can unpause immediately
                paused = false;
            }

            function sensitiveOperation() external {
                require(!paused, "Paused");
                // Critical operation
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: unsafeCircuitBreaker,
      });

      // Should detect missing access controls
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should validate protected contract integration', async () => {
      const protectedContractSource = `
        import "./enhanced_circuit_breaker.sol";

        contract ProtectedBank is EnhancedCircuitBreaker {
            mapping(address => uint256) public balances;

            modifier onlyWhenNotPaused(bytes32 moduleId) {
                require(!isPaused(moduleId), "Module paused");
                _;
            }

            bytes32 public constant WITHDRAWAL_MODULE = keccak256("WITHDRAWAL");

            function withdraw(uint256 amount) external onlyWhenNotPaused(WITHDRAWAL_MODULE) {
                require(balances[msg.sender] >= amount, "Insufficient balance");
                balances[msg.sender] -= amount;
                payable(msg.sender).transfer(amount);
            }

            function emergencyWithdraw(uint256 amount) external {
                // Emergency withdrawal that works even when paused
                require(isPaused(WITHDRAWAL_MODULE) || globalPause, "Not in emergency");
                uint256 maxAmount = balances[msg.sender] / 2;
                require(amount <= maxAmount, "Amount too high for emergency");
                balances[msg.sender] -= amount;
                payable(msg.sender).transfer(amount);
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: protectedContractSource,
      });

      // Protected contract should have minimal security issues
      const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
      expect(criticalIssues).toHaveLength(0);
    });
  });
  describe('Contract Health Check Functionality', () => {
    it('should recognize health check functions as safe monitoring utilities', async () => {
      const healthCheckContract = fs.readFileSync(
        path.join(__dirname, '../../examples/health_checkable_bank.sol'),
        'utf8'
      );

      const result = await engine.scan({
        language: 'solidity',
        source: healthCheckContract,
      });

      // Health check functions should not trigger security warnings
      const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
      const highIssues = result.issues.filter(issue => issue.severity === 'high');

      // Should have minimal or no security issues for health check functions
      // (may have some informational issues about gas optimization)
      expect(criticalIssues.length).toBeLessThanOrEqual(1); // Allow 1 for potential gas issues
      expect(highIssues).toHaveLength(0);
    });

    it('should validate health check function structure', async () => {
      const healthCheckSource = `
        contract HealthCheckable {
            uint256 public totalBalances;
            bool private locked;

            function healthCheck() external view returns (
                uint256 balance,
                uint256 total,
                bool invariant,
                bool isLocked,
                uint256 timestamp,
                uint256 version
            ) {
                balance = address(this).balance;
                total = totalBalances;
                invariant = balance == total;
                isLocked = locked;
                timestamp = block.timestamp;
                version = 1;
            }

            function checkCriticalInvariants() external view returns (bool) {
                return address(this).balance >= totalBalances;
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: healthCheckSource,
      });

      // Health check functions should be clean of security issues
      const securityIssues = result.issues.filter(
        issue => ['critical', 'high'].includes(issue.severity) &&
        !issue.message.includes('gas') // Allow gas optimization suggestions
      );
      expect(securityIssues).toHaveLength(0);
    });

    it('should detect potentially unsafe health check implementations', async () => {
      const unsafeHealthCheck = `
        contract UnsafeHealthCheck {
            address public owner;

            function riskyHealthCheck() external returns (bool) {
                // UNSAFE: Modifies state in health check
                owner = msg.sender;
                return true;
            }

            function expensiveHealthCheck() external view {
                // UNSAFE: Potentially unbounded loop
                for (uint256 i = 0; i < 1000000; i++) {
                    // Expensive operation
                }
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: unsafeHealthCheck,
      });

      // Should detect issues with unsafe health check implementations
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });
});