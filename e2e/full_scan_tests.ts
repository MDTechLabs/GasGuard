import { GasGuardScanner } from '../src/scanner/GasGuardScanner';
import { ScanResult, ScanConfig } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';

describe('End-to-End Scan Tests', () => {
  let scanner: GasGuardScanner;
  const testProjectsDir = path.join(__dirname, 'fixtures/projects');

  beforeAll(() => {
    scanner = new GasGuardScanner();
    // Ensure test fixtures directory exists
    if (!fs.existsSync(testProjectsDir)) {
      fs.mkdirSync(testProjectsDir, { recursive: true });
    }
  });

  describe('Full Scanning Pipeline', () => {
    test('should scan complete Solidity project', async () => {
      const projectPath = createTestSolidityProject();
      const config: ScanConfig = {
        include: ['**/*.sol'],
        exclude: ['node_modules/**', 'test/**'],
        rules: ['solidity-gas-optimizations'],
        outputFormat: 'json',
        verbose: false
      };

      const result: ScanResult = await scanner.scanProject(projectPath, config);

      expect(result).toBeDefined();
      expect(result.summary.totalFiles).toBeGreaterThan(0);
      expect(result.summary.totalViolations).toBeGreaterThan(0);
      expect(result.files).toHaveLength(result.summary.totalFiles);
      
      // Verify specific gas optimization findings
      const gasViolations = result.violations.filter(v => 
        v.category === 'gas-optimization'
      );
      expect(gasViolations.length).toBeGreaterThan(0);
      
      // Check for expected rule types
      const ruleTypes = new Set(gasViolations.map(v => v.ruleId));
      expect(ruleTypes.has('SOL-001')).toBe(true); // String storage rule
      expect(ruleTypes.has('SOL-002')).toBe(true); // Redundant SLOAD rule
    });

    test('should scan Soroban Rust project', async () => {
      const projectPath = createTestSorobanProject();
      const config: ScanConfig = {
        include: ['**/*.rs'],
        exclude: ['target/**', 'test/**'],
        rules: ['soroban-gas-optimizations'],
        outputFormat: 'json',
        verbose: false
      };

      const result: ScanResult = await scanner.scanProject(projectPath, config);

      expect(result).toBeDefined();
      expect(result.summary.totalFiles).toBeGreaterThan(0);
      expect(result.files).toHaveLength(result.summary.totalFiles);
      
      // Verify Soroban-specific findings
      const sorobanViolations = result.violations.filter(v => 
        v.language === 'rust' && v.category === 'gas-optimization'
      );
      expect(sorobanViolations.length).toBeGreaterThan(0);
      
      // Check for Soroban-specific rule types
      const ruleTypes = new Set(sorobanViolations.map(v => v.ruleId));
      expect(ruleTypes.has('SOROBAN-001')).toBe(true); // Unused state variables
      expect(ruleTypes.has('SOROBAN-002')).toBe(true); // Inefficient integers
    });

    test('should handle multi-language project', async () => {
      const projectPath = createMultiLanguageProject();
      const config: ScanConfig = {
        include: ['**/*.sol', '**/*.rs', '**/*.vy'],
        exclude: ['node_modules/**', 'target/**'],
        rules: ['all'],
        outputFormat: 'json',
        verbose: true
      };

      const result: ScanResult = await scanner.scanProject(projectPath, config);

      expect(result).toBeDefined();
      expect(result.summary.totalFiles).toBeGreaterThanOrEqual(3);
      
      // Should detect violations from multiple languages
      const languages = new Set(result.violations.map(v => v.language));
      expect(languages.has('solidity')).toBe(true);
      expect(languages.has('rust')).toBe(true);
      
      // Verify language-specific rules
      const solidityViolations = result.violations.filter(v => v.language === 'solidity');
      const rustViolations = result.violations.filter(v => v.language === 'rust');
      
      expect(solidityViolations.length).toBeGreaterThan(0);
      expect(rustViolations.length).toBeGreaterThan(0);
    });

    test('should validate outputs and generate reports', async () => {
      const projectPath = createTestSolidityProject();
      const config: ScanConfig = {
        include: ['**/*.sol'],
        exclude: ['test/**'],
        rules: ['all'],
        outputFormat: 'json',
        verbose: true,
        outputPath: path.join(testProjectsDir, 'scan-report.json')
      };

      const result: ScanResult = await scanner.scanProject(projectPath, config);

      // Verify result structure
      expect(result.summary).toBeDefined();
      expect(result.summary.totalFiles).toBeGreaterThan(0);
      expect(result.summary.totalViolations).toBeGreaterThan(0);
      expect(result.summary.scanDuration).toBeGreaterThan(0);
      
      expect(result.files).toBeDefined();
      expect(result.files.length).toBe(result.summary.totalFiles);
      
      expect(result.violations).toBeDefined();
      expect(result.violations.length).toBe(result.summary.totalViolations);
      
      // Verify violation structure
      if (result.violations.length > 0) {
        const violation = result.violations[0];
        expect(violation.ruleId).toBeDefined();
        expect(violation.ruleName).toBeDefined();
        expect(violation.severity).toBeDefined();
        expect(violation.message).toBeDefined();
        expect(violation.file).toBeDefined();
        expect(violation.line).toBeDefined();
        expect(violation.language).toBeDefined();
        expect(violation.category).toBeDefined();
      }
      
      // Verify report file generation
      expect(fs.existsSync(config.outputPath!)).toBe(true);
      const reportContent = fs.readFileSync(config.outputPath!, 'utf8');
      const parsedReport = JSON.parse(reportContent);
      expect(parsedReport).toEqual(result);
    });

    test('should handle incremental scanning', async () => {
      const projectPath = createTestSolidityProject();
      const config: ScanConfig = {
        include: ['**/*.sol'],
        exclude: ['test/**'],
        rules: ['all'],
        outputFormat: 'json',
        incremental: true,
        cacheDir: path.join(testProjectsDir, '.cache')
      };

      // First scan
      const firstResult: ScanResult = await scanner.scanProject(projectPath, config);
      expect(firstResult.summary.totalFiles).toBeGreaterThan(0);

      // Second scan (should use cache)
      const secondResult: ScanResult = await scanner.scanProject(projectPath, config);
      expect(secondResult.summary.totalFiles).toBe(firstResult.summary.totalFiles);
      
      // Second scan should be faster due to caching
      expect(secondResult.summary.scanDuration).toBeLessThanOrEqual(
        firstResult.summary.scanDuration
      );
    });

    test('should handle configuration validation', async () => {
      const projectPath = createTestSolidityProject();
      
      // Test invalid configuration
      const invalidConfig: ScanConfig = {
        include: ['**/*.sol'],
        exclude: ['test/**'],
        rules: ['invalid-rule-name'],
        outputFormat: 'json',
        verbose: false
      };

      await expect(scanner.scanProject(projectPath, invalidConfig))
        .rejects.toThrow('Invalid rule configuration');
    });

    test('should handle empty project gracefully', async () => {
      const emptyProjectPath = path.join(testProjectsDir, 'empty-project');
      if (!fs.existsSync(emptyProjectPath)) {
        fs.mkdirSync(emptyProjectPath, { recursive: true });
      }

      const config: ScanConfig = {
        include: ['**/*.sol'],
        exclude: ['test/**'],
        rules: ['all'],
        outputFormat: 'json',
        verbose: false
      };

      const result: ScanResult = await scanner.scanProject(emptyProjectPath, config);

      expect(result).toBeDefined();
      expect(result.summary.totalFiles).toBe(0);
      expect(result.summary.totalViolations).toBe(0);
      expect(result.files).toHaveLength(0);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle large project within reasonable time', async () => {
      const projectPath = createLargeTestProject();
      const config: ScanConfig = {
        include: ['**/*.sol'],
        exclude: ['node_modules/**', 'test/**'],
        rules: ['all'],
        outputFormat: 'json',
        verbose: false
      };

      const startTime = Date.now();
      const result: ScanResult = await scanner.scanProject(projectPath, config);
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(result.summary.totalFiles).toBeGreaterThan(10);
      
      // Should complete within reasonable time (adjust threshold as needed)
      const scanTime = endTime - startTime;
      expect(scanTime).toBeLessThan(30000); // 30 seconds
    });

    test('should handle memory usage efficiently', async () => {
      const projectPath = createLargeTestProject();
      const config: ScanConfig = {
        include: ['**/*.sol'],
        exclude: ['node_modules/**'],
        rules: ['all'],
        outputFormat: 'json',
        verbose: false
      };

      // Monitor memory usage (simplified)
      const initialMemory = process.memoryUsage().heapUsed;
      const result: ScanResult = await scanner.scanProject(projectPath, config);
      const finalMemory = process.memoryUsage().heapUsed;
      
      expect(result).toBeDefined();
      
      // Memory growth should be reasonable (adjust threshold as needed)
      const memoryGrowth = finalMemory - initialMemory;
      expect(memoryGrowth).toBeLessThan(100 * 1024 * 1024); // 100MB
    });
  });

  // Helper functions to create test projects
  function createTestSolidityProject(): string {
    const projectPath = path.join(testProjectsDir, 'solidity-project');
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    const contract1 = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract GasWaster {
    string public expensiveString = "This is an expensive string storage";
    uint256 public counter;
    
    function increment() public {
        counter++;
        uint256 storageRead = counter; // First read
        uint256 anotherRead = counter;  // Redundant SLOAD
        storageRead += anotherRead;
    }
    
    function unusedFunction() public pure returns (string memory) {
        return "This function is never called";
    }
    
    uint256 private unusedVariable = 42;
}`;
    
    const contract2 = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TokenContract is ERC20 {
    string public tokenName = "Test Token";
    mapping(address => uint256) public balances;
    
    constructor() ERC20("Test Token", "TEST") {
        _mint(msg.sender, 1000000 * 10**18);
    }
    
    function transfer(address to, uint256 amount) public override {
        uint256 fromBalance = balances[msg.sender];
        uint256 fromBalanceAgain = balances[msg.sender]; // Redundant read
        require(fromBalance >= amount, "Insufficient balance");
        
        balances[msg.sender] = fromBalance - amount;
        balances[to] += amount;
    }
}`;

    fs.writeFileSync(path.join(projectPath, 'GasWaster.sol'), contract1);
    fs.writeFileSync(path.join(projectPath, 'TokenContract.sol'), contract2);
    
    return projectPath;
  }

  function createTestSorobanProject(): string {
    const projectPath = path.join(testProjectsDir, 'soroban-project');
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    const contract = `
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
pub struct TokenContract {
    pub admin: Address,
    pub total_supply: u128, // Inefficient integer type
    pub balances: Map<Address, u64>,
    pub unused_data: String, // Unused state variable
    pub expensive_metadata: String, // Expensive string storage
}

#[contractimpl]
impl TokenContract {
    pub fn new(admin: Address, initial_supply: u64) -> Self {
        let mut balances = Map::new(&env);
        balances.set(admin, initial_supply);
        
        Self {
            admin,
            total_supply: initial_supply as u128,
            balances,
            unused_data: "Never used".to_string(),
            expensive_metadata: "Expensive metadata that costs gas".to_string(),
        }
    }
    
    pub fn transfer(env: Env, from: Address, to: Address, amount: u64) {
        let from_balance = env.storage().instance().get(&from).unwrap_or(0);
        let from_balance_again = env.storage().instance().get(&from).unwrap_or(0); // Redundant read
        let to_balance = env.storage().instance().get(&to).unwrap_or(0);
        
        env.storage().instance().set(&from, &(from_balance - amount));
        env.storage().instance().set(&to, &(to_balance + amount));
    }
    
    pub fn unused_function(env: Env) -> u64 {
        // This function is never called
        env.block_timestamp()
    }
}`;

    fs.writeFileSync(path.join(projectPath, 'contract.rs'), contract);
    
    return projectPath;
  }

  function createMultiLanguageProject(): string {
    const projectPath = path.join(testProjectsDir, 'multi-lang-project');
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    // Create Solidity contract
    const solidityContract = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SolidityContract {
    string public name = "Solidity";
    uint256 public value;
    
    function setValue(uint256 _value) public {
        value = _value;
        uint256 readAgain = value; // Redundant read
    }
}`;

    // Create Rust contract
    const rustContract = `
use soroban_sdk::{contract, contractimpl, contracttype};

#[contracttype]
pub struct RustContract {
    pub value: u64,
    pub unused_field: String,
}

#[contractimpl]
impl RustContract {
    pub fn new() -> Self {
        Self {
            value: 42,
            unused_field: "unused".to_string(),
        }
    }
}`;

    fs.writeFileSync(path.join(projectPath, 'SolidityContract.sol'), solidityContract);
    fs.writeFileSync(path.join(projectPath, 'RustContract.rs'), rustContract);
    
    return projectPath;
  }

  function createLargeTestProject(): string {
    const projectPath = path.join(testProjectsDir, 'large-project');
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    // Create multiple contracts to simulate a larger project
    for (let i = 0; i < 15; i++) {
      const contract = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract LargeContract${i} {
    string public name${i} = "Contract ${i}";
    uint256 public counter${i};
    uint256 private unused${i} = ${i};
    
    function increment${i}() public {
        counter${i}++;
        uint256 read1 = counter${i};
        uint256 read2 = counter${i}; // Redundant read
        counter${i} = read1 + read2;
    }
    
    function unusedFunction${i}() public pure returns (uint256) {
        return ${i};
    }
}`;
      
      fs.writeFileSync(path.join(projectPath, `LargeContract${i}.sol`), contract);
    }
    
    return projectPath;
  }
});
