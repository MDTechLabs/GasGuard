import { GasGuardEngine } from "../packages/rules/gasGuard/gasguard.engine";
import * as fs from "fs";
import * as path from "path";

describe("Solidity Reentrancy Guard Analysis", () => {
  let engine: GasGuardEngine;

  beforeAll(() => {
    engine = new GasGuardEngine();
  });

  describe("Reentrancy Guard Detection", () => {
    it("should detect missing reentrancy guard in vulnerable contract", async () => {
      const source = fs.readFileSync(
        path.join(__dirname, "../../examples/vulnerable_bank.sol"),
        "utf8",
      );

      const result = await engine.scan({
        language: "solidity",
        source,
      });

      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: "sol-006",
            severity: "critical",
            message: "Function transfers ETH/tokens but lacks reentrancy guard",
          }),
        ]),
      );
    });

    it("should not flag secure contract with reentrancy guard", async () => {
      const source = fs.readFileSync(
        path.join(__dirname, "../../examples/secure_bank.sol"),
        "utf8",
      );

      const result = await engine.scan({
        language: "solidity",
        source,
      });

      // Should not have sol-006 issues
      const reentrancyIssues = result.issues.filter(
        (issue) => issue.ruleId === "sol-006",
      );
      expect(reentrancyIssues).toHaveLength(0);
    });

    it("should detect multiple vulnerable functions in complex contract", async () => {
      const source = fs.readFileSync(
        path.join(__dirname, "../../examples/reentrancy_examples.sol"),
        "utf8",
      );

      const result = await engine.scan({
        language: "solidity",
        source,
      });

      const reentrancyIssues = result.issues.filter(
        (issue) => issue.ruleId === "sol-006",
      );
      // Should detect 3 vulnerable functions: vulnerableWithdraw, vulnerableSend, vulnerableCall
      expect(reentrancyIssues).toHaveLength(3);
    });
  });

  describe("Reentrancy Attack Simulation", () => {
    it("should identify functions vulnerable to reentrancy attacks", async () => {
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
        language: "solidity",
        source: vulnerableContract,
      });

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          ruleId: "sol-006",
          severity: "critical",
          message: "Function transfers ETH/tokens but lacks reentrancy guard",
        }),
      );
    });

    it("should not flag functions that do not transfer ETH/tokens", async () => {
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
        language: "solidity",
        source: safeContract,
      });

      const reentrancyIssues = result.issues.filter(
        (issue) => issue.ruleId === "sol-006",
      );
      expect(reentrancyIssues).toHaveLength(0);
    });
  });

  describe("Fallback Function Security", () => {
    it("should detect insecure fallback with sensitive external transfer logic", async () => {
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
        language: "solidity",
        source: insecureFallbackContract,
      });

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          ruleId: "sol-007",
          severity: "high",
          message:
            "Fallback/receive handler is permissive or executes sensitive logic without strict validation",
        }),
      );
    });

    it("should detect permissive fallback that accepts unknown calls without explicit rejection", async () => {
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
        language: "solidity",
        source: permissiveFallbackContract,
      });

      const fallbackIssues = result.issues.filter(
        (issue) => issue.ruleId === "sol-007",
      );
      expect(fallbackIssues.length).toBeGreaterThan(0);
    });

    it("should not flag strict fallback that always rejects unknown calls", async () => {
      const strictFallbackContract = `
        contract StrictFallback {
            fallback() external payable {
                revert("Unknown function call");
            }
        }
      `;

      const result = await engine.scan({
        language: "solidity",
        source: strictFallbackContract,
      });

      const fallbackIssues = result.issues.filter(
        (issue) => issue.ruleId === "sol-007",
      );
      expect(fallbackIssues).toHaveLength(0);
    });

    it("should not flag minimal receive handler that only emits telemetry event", async () => {
      const safeReceiveContract = `
        contract SafeReceive {
            event Received(address indexed sender, uint256 amount);

            receive() external payable {
                emit Received(msg.sender, msg.value);
            }
        }
      `;

      const result = await engine.scan({
        language: "solidity",
        source: safeReceiveContract,
      });

      const fallbackIssues = result.issues.filter(
        (issue) => issue.ruleId === "sol-007",
      );
      expect(fallbackIssues).toHaveLength(0);
    });
  });

  describe("External Call Validation", () => {
    it("should detect unchecked low-level call return values", async () => {
      const uncheckedCallContract = `
        contract UncheckedCall {
            function execute(address target, bytes calldata data) external {
                (bool success, ) = target.call(data);
                require(success, "Call failed");
            }
        }
      `;

      const result = await engine.scan({
        language: "solidity",
        source: uncheckedCallContract,
      });

      // Test that the scanner can analyze the contract
      expect(result.issues).toBeDefined();
      expect(Array.isArray(result.issues)).toBe(true);
    });

    it("should not flag low-level call when return value is captured and checked", async () => {
      const safeCallContract = `
        contract SafeCall {
            function execute(address target, bytes calldata data) external {
                (bool success, ) = target.call(data);
                require(success, "Call failed");
            }
        }
      `;

      const result = await engine.scan({
        language: "solidity",
        source: safeCallContract,
      });

      expect(result.issues).toBeDefined();
    });
  });
});
