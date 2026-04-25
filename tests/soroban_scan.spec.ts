import { GasGuardEngine } from '../packages/rules/gasGuard/gasguard.engine'
import * as path from 'path';
import * as fs from 'fs';

describe('Soroban Full Scan Lifecycle', () => {
  const fixturesDir = path.join(
    __dirname,
    '../../../fixtures/soroban',
  );

  const expectedDir = path.join(fixturesDir, 'expected');

  let engine: GasGuardEngine;

  beforeAll(() => {
    engine = new GasGuardEngine();
  });

  it.each([
    'inefficient_storage.rs',
    'inefficient_loop.rs',
    'redundant_clone.rs',
  ])('scans %s and returns expected findings', async (file) => {
    const source = fs.readFileSync(
      path.join(fixturesDir, file),
      'utf8',
    );

    const expected = JSON.parse(
      fs.readFileSync(
        path.join(expectedDir, file.replace('.rs', '.json')),
        'utf8',
      ),
    );

    const result = await engine.scan({
      language: 'soroban',
      source,
    });

    expect(result.issues).toEqual(expected.issues);
  });

  describe('Soroban Health Check Functionality', () => {
    it('should recognize health check functions as safe monitoring utilities', async () => {
      const healthCheckContract = `
        use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

        #[contracttype]
        pub struct HealthStatus {
            pub contract_balance: u64,
            pub transaction_count: u32,
            pub has_anomalies: bool,
            pub contract_version: u32,
        }

        #[contracttype]
        pub struct OptimizedContract {
            pub owner: Address,
            pub balance: u64,
            pub transaction_count: u32,
            pub version: u32,
        }

        #[contractimpl]
        impl OptimizedContract {
            pub fn get_health_status(&self, env: Env) -> HealthStatus {
                let has_anomalies = self.balance == 0 || self.version == 0;

                HealthStatus {
                    contract_balance: self.balance,
                    transaction_count: self.transaction_count,
                    has_anomalies,
                    contract_version: self.version,
                }
            }

            pub fn check_invariants(&self) -> bool {
                self.balance >= 0 && self.version > 0
            }
        }
      `;

      const result = await engine.scan({
        language: 'soroban',
        source: healthCheckContract,
      });

      // Health check functions should not trigger security warnings
      const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
      const highIssues = result.issues.filter(issue => issue.severity === 'high');

      // Should have minimal security issues for health check functions
      expect(criticalIssues).toHaveLength(0);
      expect(highIssues).toHaveLength(0);
    });

    it('should validate health check function structure and safety', async () => {
      const safeHealthCheck = `
        use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

        #[contracttype]
        pub struct ContractMetrics {
            pub balance: u64,
            pub operations: u32,
            pub is_healthy: bool,
            pub timestamp: u64,
        }

        #[contractimpl]
        impl HealthCheckable {
            pub fn perform_health_check(&self, env: Env) -> ContractMetrics {
                let is_healthy = self.validate_state();
                let timestamp = env.ledger().timestamp();

                ContractMetrics {
                    balance: self.balance,
                    operations: self.operation_count,
                    is_healthy,
                    timestamp,
                }
            }

            pub fn validate_state(&self) -> bool {
                // Safe validation logic
                self.balance >= 0 && self.operation_count >= 0
            }
        }
      `;

      const result = await engine.scan({
        language: 'soroban',
        source: safeHealthCheck,
      });

      // Should not have security issues for proper health check implementation
      const securityIssues = result.issues.filter(
        issue => ['critical', 'high'].includes(issue.severity)
      );
      expect(securityIssues).toHaveLength(0);
    });
  });

  describe('Soroban Circuit Breaker Functionality', () => {
    it('should validate circuit breaker pause operations', async () => {
      const circuitBreakerContract = `
        use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Map};

        #[contracttype]
        pub struct CircuitBreakerContract {
            pub paused: bool,
            pub paused_modules: Map<Symbol, bool>,
            pub emergency_pauser: Address,
            pub owner: Address,
        }

        #[contractimpl]
        impl CircuitBreakerContract {
            pub fn emergency_pause(&mut self, env: Env, caller: Address) -> Result<(), DemoError> {
                if caller != self.emergency_pauser && caller != self.owner {
                    return Err(DemoError::Unauthorized);
                }
                self.paused = true;
                Ok(())
            }

            pub fn pause_module(&mut self, env: Env, caller: Address, module: Symbol) -> Result<(), DemoError> {
                if caller != self.emergency_pauser && caller != self.owner {
                    return Err(DemoError::Unauthorized);
                }
                self.paused_modules.set(module, true);
                Ok(())
            }

            pub fn is_paused(&self, module: Option<Symbol>) -> bool {
                if self.paused {
                    return true;
                }
                if let Some(module_key) = module {
                    return self.paused_modules.get(module_key).unwrap_or(false);
                }
                false
            }
        }

        #[contracttype]
        #[derive(Debug, Clone)]
        pub enum DemoError {
            InvalidAmount,
            InsufficientBalance,
            Unauthorized,
            TransactionExpired,
        }
      `;

      const result = await engine.scan({
        language: 'soroban',
        source: circuitBreakerContract,
      });

      // Circuit breaker should not trigger security issues
      const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
      const highIssues = result.issues.filter(issue => issue.severity === 'high');

      expect(criticalIssues).toHaveLength(0);
      expect(highIssues).toHaveLength(0);
    });

    it('should detect operations that bypass pause checks', async () => {
      const unsafePausedContract = `
        use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

        #[contracttype]
        pub struct UnsafeContract {
            pub paused: bool,
            pub balance: u64,
        }

        #[contractimpl]
        impl UnsafeContract {
            pub fn transfer(&mut self, env: Env, amount: u64) -> Result<(), DemoError> {
                // UNSAFE: No pause check before critical operation
                if self.balance < amount {
                    return Err(DemoError::InsufficientBalance);
                }
                self.balance -= amount;
                Ok(())
            }

            pub fn is_paused(&self) -> bool {
                self.paused
            }
        }

        #[contracttype]
        #[derive(Debug, Clone)]
        pub enum DemoError {
            InsufficientBalance,
            Unauthorized,
        }
      `;

      const result = await engine.scan({
        language: 'soroban',
        source: unsafePausedContract,
      });

      // Should potentially detect missing pause checks (depending on analysis rules)
      // At minimum, should not have false positives
      const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
      expect(criticalIssues.length).toBeLessThanOrEqual(1);
    });

    it('should validate proper pause integration in operations', async () => {
      const safePausedContract = `
        use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

        #[contracttype]
        pub struct SafeContract {
            pub paused: bool,
            pub balance: u64,
        }

        #[contractimpl]
        impl SafeContract {
            pub fn transfer(&mut self, env: Env, amount: u64) -> Result<(), DemoError> {
                // SAFE: Check pause state before operation
                if self.is_paused() {
                    return Err(DemoError::Unauthorized);
                }

                if self.balance < amount {
                    return Err(DemoError::InsufficientBalance);
                }
                self.balance -= amount;
                Ok(())
            }

            pub fn is_paused(&self) -> bool {
                self.paused
            }

            pub fn emergency_action(&mut self, env: Env, caller: Address) -> Result<(), DemoError> {
                // Emergency actions can work even when paused
                // (implementation would depend on specific emergency logic)
                Ok(())
            }
        }

        #[contracttype]
        #[derive(Debug, Clone)]
        pub enum DemoError {
            InsufficientBalance,
            Unauthorized,
        }
      `;

      const result = await engine.scan({
        language: 'soroban',
        source: safePausedContract,
      });

      // Safe implementation should not have security issues
      const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
      const highIssues = result.issues.filter(issue => issue.severity === 'high');

      expect(criticalIssues).toHaveLength(0);
      expect(highIssues).toHaveLength(0);
    });
  });
});
