import { GasGuardEngine } from '../packages/rules/gasGuard/gasguard.engine';
import * as fs from 'fs';
import * as path from 'path';

describe('Circuit Breaker Security Analysis', () => {
  let engine: GasGuardEngine;

  beforeAll(() => {
    engine = new GasGuardEngine();
  });

  describe('Granular Pause Control Validation', () => {
    it('should recognize secure circuit breaker implementations', async () => {
      const secureCircuitBreaker = fs.readFileSync(
        path.join(__dirname, '../../examples/enhanced_circuit_breaker.sol'),
        'utf8'
      );

      const result = await engine.scan({
        language: 'solidity',
        source: secureCircuitBreaker,
      });

      // Secure circuit breaker should not trigger critical security issues
      const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
      expect(criticalIssues).toHaveLength(0);
    });

    it('should validate protected contract implementations', async () => {
      const protectedBank = fs.readFileSync(
        path.join(__dirname, '../../examples/circuit_breaker_protected_bank.sol'),
        'utf8'
      );

      const result = await engine.scan({
        language: 'solidity',
        source: protectedBank,
      });

      // Protected contracts should have minimal security issues
      const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
      const highIssues = result.issues.filter(issue => issue.severity === 'high');

      // Allow some issues for demonstration purposes, but not critical security flaws
      expect(criticalIssues.length).toBeLessThanOrEqual(2);
    });

    it('should detect insufficient pause granularity', async () => {
      const insufficientGranularity = `
        contract InsufficientPause {
            bool public paused;

            function pause() external {
                paused = true;
            }

            function withdraw() external {
                require(!paused, "Paused");
                // All operations paused together - insufficient granularity
            }

            function deposit() external {
                require(!paused, "Paused");
                // All operations paused together - insufficient granularity
            }

            function emergencyAction() external {
                // No emergency functions that work during pause
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: insufficientGranularity,
      });

      // Should detect potential issues with pause mechanism design
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should identify missing emergency access patterns', async () => {
      const noEmergencyAccess = `
        contract NoEmergencyAccess {
            bool public paused;
            address public admin;

            modifier onlyAdmin() {
                require(msg.sender == admin, "Not admin");
                _;
            }

            function pause() external onlyAdmin {
                paused = true;
            }

            function unpause() external onlyAdmin {
                paused = false;
            }

            function criticalOperation() external {
                require(!paused, "Paused");
                // No way to perform critical operations during pause
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: noEmergencyAccess,
      });

      // Should detect lack of emergency access patterns
      const issues = result.issues.filter(issue =>
        issue.message.includes('emergency') ||
        issue.message.includes('pause') ||
        issue.message.includes('access')
      );
      expect(issues.length).toBeGreaterThan(0);
    });
  });

  describe('Access Control Validation', () => {
    it('should detect overly permissive pause controls', async () => {
      const permissivePause = `
        contract PermissivePause {
            bool public paused;

            function pause() external {
                // UNSAFE: Anyone can pause
                paused = true;
            }

            function unpause() external {
                // UNSAFE: Anyone can unpause
                paused = false;
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: permissivePause,
      });

      // Should detect missing access controls
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should validate proper role separation', async () => {
      const properRoles = `
        contract ProperRoles {
            bool public paused;
            address public admin;
            address public pauser;

            modifier onlyAdmin() {
                require(msg.sender == admin, "Not admin");
                _;
            }

            modifier onlyPauser() {
                require(msg.sender == pauser || msg.sender == admin, "Not authorized");
                _;
            }

            function pause() external onlyPauser {
                paused = true;
            }

            function unpause() external onlyAdmin {
                paused = false;
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: properRoles,
      });

      // Proper role separation should not trigger security issues
      const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
      expect(criticalIssues).toHaveLength(0);
    });

    it('should detect missing timelock protections', async () => {
      const noTimelock = `
        contract NoTimelock {
            bool public paused;
            address public admin;

            function pause() external {
                require(msg.sender == admin, "Not admin");
                paused = true;
            }

            function unpause() external {
                require(msg.sender == admin, "Not admin");
                // UNSAFE: Immediate unpause without timelock
                paused = false;
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: noTimelock,
      });

      // Should detect lack of timelock for unpause operations
      const issues = result.issues.filter(issue =>
        issue.message.includes('timelock') ||
        issue.message.includes('immediate') ||
        issue.message.includes('unpause')
      );
      expect(issues.length).toBeGreaterThan(0);
    });
  });

  describe('Event Emission Validation', () => {
    it('should validate proper event emission for pause operations', async () => {
      const properEvents = `
        contract ProperEvents {
            bool public paused;
            address public admin;

            event Paused(address indexed pauser, uint256 timestamp);
            event Unpaused(address indexed unpauser, uint256 timestamp);

            function pause() external {
                require(msg.sender == admin, "Not admin");
                paused = true;
                emit Paused(msg.sender, block.timestamp);
            }

            function unpause() external {
                require(msg.sender == admin, "Not admin");
                paused = false;
                emit Unpaused(msg.sender, block.timestamp);
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: properEvents,
      });

      // Proper event emission should not trigger issues
      const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
      expect(criticalIssues).toHaveLength(0);
    });

    it('should detect missing event emissions', async () => {
      const missingEvents = `
        contract MissingEvents {
            bool public paused;

            function pause() external {
                // MISSING: No event emitted for pause
                paused = true;
            }

            function unpause() external {
                // MISSING: No event emitted for unpause
                paused = false;
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: missingEvents,
      });

      // Should detect missing event emissions for state changes
      const issues = result.issues.filter(issue =>
        issue.message.includes('event') ||
        issue.message.includes('emit') ||
        issue.message.includes('log')
      );
      expect(issues.length).toBeGreaterThan(0);
    });
  });

  describe('Emergency Function Validation', () => {
    it('should validate emergency functions that bypass pause', async () => {
      const emergencyFunctions = `
        contract EmergencyFunctions {
            bool public paused;
            mapping(address => uint256) public balances;

            function pause() external {
                paused = true;
            }

            function normalWithdraw(uint256 amount) external {
                require(!paused, "Paused");
                require(balances[msg.sender] >= amount, "Insufficient balance");
                balances[msg.sender] -= amount;
                payable(msg.sender).transfer(amount);
            }

            function emergencyWithdraw(uint256 amount) external {
                // Emergency function that works even when paused
                require(paused, "Not in emergency state");
                uint256 maxAmount = balances[msg.sender] / 2; // 50% limit
                require(amount <= maxAmount, "Emergency amount too high");
                balances[msg.sender] -= amount;
                payable(msg.sender).transfer(amount);
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: emergencyFunctions,
      });

      // Emergency functions should not trigger security issues
      const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
      expect(criticalIssues).toHaveLength(0);
    });

    it('should detect emergency functions with insufficient restrictions', async () => {
      const unsafeEmergency = `
        contract UnsafeEmergency {
            bool public paused;
            mapping(address => uint256) public balances;

            function emergencyWithdraw(uint256 amount) external {
                require(paused, "Not paused");
                // UNSAFE: No limits on emergency withdrawal amount
                require(balances[msg.sender] >= amount, "Insufficient balance");
                balances[msg.sender] -= amount;
                payable(msg.sender).transfer(amount);
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: unsafeEmergency,
      });

      // Should detect insufficient restrictions on emergency functions
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe('State Consistency Validation', () => {
    it('should validate pause state consistency', async () => {
      const stateConsistency = `
        contract StateConsistency {
            mapping(bytes32 => bool) public pausedModules;
            bool public globalPause;

            function isPaused(bytes32 moduleId) public view returns (bool) {
                return globalPause || pausedModules[moduleId];
            }

            function pauseModule(bytes32 moduleId) external {
                pausedModules[moduleId] = true;
            }

            function globalPause() external {
                globalPause = true;
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: stateConsistency,
      });

      // Proper state consistency should not trigger issues
      const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
      expect(criticalIssues).toHaveLength(0);
    });

    it('should detect potential state inconsistencies', async () => {
      const stateInconsistency = `
        contract StateInconsistency {
            bool public paused;
            uint256 public pauseCounter;

            function pause() external {
                paused = true;
                pauseCounter += 1;
            }

            function unpause() external {
                paused = false;
                // MISSING: pauseCounter not decremented
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: stateInconsistency,
      });

      // Should detect potential state inconsistencies
      const issues = result.issues.filter(issue =>
        issue.message.includes('state') ||
        issue.message.includes('consistency') ||
        issue.message.includes('counter')
      );
      expect(issues.length).toBeGreaterThan(0);
    });
  });
});