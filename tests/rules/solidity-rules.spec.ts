/**
 * Example: Testing Solidity Rules with the GasGuard Testing Framework
 * 
 * This demonstrates how to use the RuleTester with fixtures and snapshots
 */

import { RuleTester } from '../../libs/testing/src/rule-tester';
import { FixtureLoader } from '../../libs/testing/src/fixture-loader';
import { SnapshotManager } from '../../libs/testing/src/snapshot-manager';
import { RuleAssertions } from '../../libs/testing/src/assertions';
import { SolidityAnalyzer } from '../../libs/engine/analyzers/solidity-analyzer';

describe('Solidity Rule Tests', () => {
  let analyzer: SolidityAnalyzer;
  let tester: RuleTester;
  let snapshotManager: SnapshotManager;

  beforeAll(async () => {
    analyzer = new SolidityAnalyzer();
    await analyzer.initialize();
    
    tester = new RuleTester(analyzer, {
      snapshotEnabled: false,
      verbose: true,
    });
    
    snapshotManager = new SnapshotManager('./tests/rules/__snapshots__');
  });

  describe('sol-003: Uncached Array Length', () => {
    it('should detect uncached array.length in for loop', async () => {
      const fixture = FixtureLoader.loadFixture(
        './tests/rules/fixtures/sol-003-uncached-array.json'
      );

      const result = await tester.runFixture(fixture);
      
      expect(result.passed).toBe(true);
      expect(result.matchedExpected.length).toBe(1);
      expect(result.missedExpected.length).toBe(0);
      expect(result.unexpectedFindings.length).toBe(0);
    });

    it('should NOT flag cached array.length', async () => {
      const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract OptimizedContract {
    uint[] public numbers;
    
    function sumNumbers() public view returns (uint) {
        uint total = 0;
        uint length = numbers.length;
        for (uint i = 0; i < length; i++) {
            total += numbers[i];
        }
        return total;
    }
}
`;

      const result = await analyzer.analyze(code, 'optimized.sol');
      
      // Should not have sol-003 violations
      RuleAssertions.assertNotHasFinding(result.findings, 'sol-003');
    });
  });

  describe('sol-006: Missing Reentrancy Guard', () => {
    it('should detect missing reentrancy guard on withdraw function', async () => {
      const fixture = FixtureLoader.loadFixture(
        './tests/rules/fixtures/sol-006-reentrancy.json'
      );

      const result = await tester.runFixture(fixture);
      
      expect(result.passed).toBe(true);
      expect(result.matchedExpected.length).toBeGreaterThanOrEqual(1);
    });

    it('should NOT flag function with nonReentrant modifier', async () => {
      const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract SecureBank is ReentrancyGuard {
    mapping(address => uint) public balances;
    
    function withdraw(uint amount) public nonReentrant {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }
}
`;

      const result = await analyzer.analyze(code, 'secure-bank.sol');
      
      // Should not have sol-006 violations
      RuleAssertions.assertNotHasFinding(result.findings, 'sol-006');
    });
  });

  describe('sol-013: Unsafe Timestamp Dependency', () => {
    it('should detect unsafe reliance on block.timestamp and now in critical logic', async () => {
      const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract TimeSensitive {
    uint256 public deadline;

    function bid() external {
        require(block.timestamp <= deadline, "Auction expired");
        // bidding logic
    }

    function recordStart() external {
        uint256 startTime = now;
        // start logic
    }
}
`;

      const result = await analyzer.analyze(code, 'time-sensitive.sol');
      RuleAssertions.assertHasFinding(result.findings, 'sol-013');
      RuleAssertions.assertFindingSeverity(result.findings, 'sol-013', 'high');
    });

    it('should not flag block.timestamp when used only for event emission', async () => {
      const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract LogTimestamp {
    event Timestamped(uint256 timestamp);

    function log() external {
        emit Timestamped(block.timestamp);
    }
}
`;

      const result = await analyzer.analyze(code, 'timestamp-log.sol');
      RuleAssertions.assertNotHasFinding(result.findings, 'sol-013');
    });

    it('should detect insecure tx.origin authentication usage', async () => {
      const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract OriginAuth {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function adminAction() external {
        require(tx.origin == owner, "Not authorized");
        // sensitive logic
    }
}
`;

      const result = await analyzer.analyze(code, 'origin-auth.sol');
      RuleAssertions.assertHasFinding(result.findings, 'sol-014');
      RuleAssertions.assertFindingMessage(result.findings, 'sol-014', 'tx.origin');
    });

    it('should not flag msg.sender authentication', async () => {
      const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SenderAuth {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function adminAction() external {
        require(msg.sender == owner, "Not authorized");
        // sensitive logic
    }
}
`;

      const result = await analyzer.analyze(code, 'sender-auth.sol');
      RuleAssertions.assertNotHasFinding(result.findings, 'sol-014');
    });
  });

  describe('Rule Assertions', () => {
    it('should provide helpful assertion messages', async () => {
      const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract TestContract {
    uint[] public numbers;
    
    function process() public view {
        for (uint i = 0; i < numbers.length; i++) {
            // do something
        }
    }
}
`;

      const result = await analyzer.analyze(code, 'test.sol');
      
      // Test various assertions
      RuleAssertions.assertHasFinding(result.findings, 'sol-003');
      RuleAssertions.assertFindingSeverity(result.findings, 'sol-003', 'medium');
      RuleAssertions.assertFindingAtLine(result.findings, 'sol-003', 9, 1);
      RuleAssertions.assertFindingMessage(
        result.findings, 
        'sol-003', 
        'Array length is not cached'
      );
    });
  });

  describe('Fixture Loading', () => {
    it('should load fixtures from directory', () => {
      const fixtures = FixtureLoader.loadFixturesFromDir(
        './tests/rules/fixtures'
      );
      
      expect(fixtures.length).toBeGreaterThan(0);
      
      // Each fixture should have required fields
      for (const fixture of fixtures) {
        expect(fixture.id).toBeDefined();
        expect(fixture.name).toBeDefined();
        expect(fixture.input).toBeDefined();
        expect(fixture.expectedFindings).toBeDefined();
      }
    });

    it('should load test suites', () => {
      const suite = FixtureLoader.loadTestSuite(
        './tests/rules/suites/sol-003-suite.json'
      );
      
      expect(suite.ruleId).toBe('sol-003');
      expect(suite.fixtures.length).toBeGreaterThan(0);
    });
  });

// Helper config to isolate a single rule by disabling all others
   function isolateRule(ruleId: string): any {
     const allRuleIds = [
       'sol-003', 'sol-004', 'sol-005', 'sol-006', 'sol-007',
       'sol-008', 'sol-009', 'sol-010', 'sol-011', 'sol-012',
       'sol-015', 'sol-017'
     ];
     const rules: any = {};
     for (const id of allRuleIds) {
       rules[id] = { enabled: id === ruleId };
     }
     return { rules };
   }

  describe('sol-015: Dead Code Paths', () => {
    it('should detect dead code after return/revert statements', async () => {
      const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract TestContract {
    function revertBefore() external {
        revert("always revert");
        uint256 x = 200;
    }

    function returnEarly() external {
        return;
        uint256 y = 300;
    }
}
`;

      const result = await analyzer.analyze(code, 'test015.sol', isolateRule('sol-015'));
      
      RuleAssertions.assertHasFinding(result.findings, 'sol-015');
      const sol015Findings = result.findings.filter(f => f.ruleId === 'sol-015');
      expect(sol015Findings.length).toBe(2);
    });

    it('should NOT flag clean code without dead paths', async () => {
      const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract CleanContract {
    function setValue(uint256 newValue) external {
        // no dead code
    }

    function getValue() external view returns (uint256) {
        return 42;
    }
}
`;

      const result = await analyzer.analyze(code, 'clean.sol', isolateRule('sol-015'));
      
      RuleAssertions.assertNotHasFinding(result.findings, 'sol-015');
    });
  });

  describe('sol-017: Missing Immutable Variables', () => {
    it('should detect variables only assigned in constructor that could be immutable', async () => {
      const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract TestContract {
    address public owner;
    uint256 public factor;
    
    constructor() {
        owner = msg.sender;
        factor = 100;
    }
    
    function getValue() public view returns (uint256) {
        return factor * 2;
    }
}
`;

      const result = await analyzer.analyze(code, 'test017.sol', isolateRule('sol-017'));
      
      RuleAssertions.assertHasFinding(result.findings, 'sol-017');
      const sol017Findings = result.findings.filter(f => f.ruleId === 'sol-017');
      expect(sol017Findings.length).toBeGreaterThan(0);
    });

    it('should NOT flag variables already marked as immutable', async () => {
      const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract OptimizedContract {
    address public immutable owner;
    uint256 public immutable constantFactor;
    
    constructor() {
        owner = msg.sender;
        constantFactor = 100;
    }
    
    function getValue() public view returns (uint256) {
        return constantFactor * 2;
    }
}
`;

      const result = await analyzer.analyze(code, 'optimized.sol', isolateRule('sol-017'));
      
      RuleAssertions.assertNotHasFinding(result.findings, 'sol-017');
    });

    it('should NOT flag variables modified after constructor', async () => {
      const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MutableContract {
    address public owner;
    uint256 public value;
    
    constructor() {
        owner = msg.sender;
        value = 0;
    }
    
    function updateOwner(address newOwner) public {
        owner = newOwner;
    }
    
    function updateValue(uint256 newValue) public {
        value = newValue;
    }
}
`;

      const result = await analyzer.analyze(code, 'mutable.sol', isolateRule('sol-017'));
      
      RuleAssertions.assertNotHasFinding(result.findings, 'sol-017');
    });
  });

  describe('Batch Testing', () => {
    it('should run multiple fixtures and generate report', async () => {
      const fixtures = FixtureLoader.loadFixturesFromDir(
        './tests/rules/fixtures'
      ).filter(f => f.metadata?.language === 'solidity');

      const summary = await tester.runAll(fixtures);
      
      const report = tester.generateReport(summary.results);
      console.log(report);
      
      expect(summary.passed + summary.failed).toBe(summary.results.length);
    });
  });
});
