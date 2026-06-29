import { detectMissingEmergencyWithdrawal } from '../../rules/security/emergency/detect-missing-emergency-withdrawal';

describe('detectMissingEmergencyWithdrawal', () => {
  // ── ETH-receiver cases ────────────────────────────────────────────────────

  it('flags a contract with receive() payable but no withdrawal function', () => {
    const code = `
      pragma solidity ^0.8.0;
      contract Vault {
        receive() external payable {}
      }
    `;
    const result = detectMissingEmergencyWithdrawal(code);
    expect(result.detected).toBe(true);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].kind).toBe('eth-receiver-no-withdrawal');
    expect(result.violations[0].contractName).toBe('Vault');
    expect(result.violations[0].suggestion).toContain('emergencyWithdraw');
  });

  it('flags a contract with a payable function but no recovery path', () => {
    const code = `
      pragma solidity ^0.8.0;
      contract Deposit {
        function deposit() external payable {
          balances[msg.sender] += msg.value;
        }
      }
    `;
    const result = detectMissingEmergencyWithdrawal(code);
    expect(result.detected).toBe(true);
    expect(result.violations[0].kind).toBe('eth-receiver-no-withdrawal');
  });

  it('does NOT flag a contract with receive() payable AND a withdraw function', () => {
    const code = `
      pragma solidity ^0.8.0;
      contract SafeVault {
        receive() external payable {}
        function withdraw(uint256 amount) external onlyOwner {
          payable(msg.sender).transfer(amount);
        }
      }
    `;
    const result = detectMissingEmergencyWithdrawal(code);
    expect(result.detected).toBe(false);
  });

  it('does NOT flag when selfdestruct is used as an escape hatch', () => {
    const code = `
      pragma solidity ^0.8.0;
      contract LegacyVault {
        receive() external payable {}
        function kill(address payable to) external onlyOwner {
          selfdestruct(to);
        }
      }
    `;
    const result = detectMissingEmergencyWithdrawal(code);
    expect(result.detected).toBe(false);
  });

  // ── Token-handler cases ───────────────────────────────────────────────────

  it('flags a contract that uses IERC20 but has no rescue function', () => {
    const code = `
      pragma solidity ^0.8.0;
      contract TokenStaker {
        IERC20 public token;
        function stake(uint256 amount) external {
          token.transferFrom(msg.sender, address(this), amount);
        }
      }
    `;
    const result = detectMissingEmergencyWithdrawal(code);
    expect(result.detected).toBe(true);
    expect(result.violations[0].kind).toBe('token-handler-no-withdrawal');
    expect(result.violations[0].suggestion).toContain('rescueTokens');
  });

  it('does NOT flag a token contract that exposes a rescue function', () => {
    const code = `
      pragma solidity ^0.8.0;
      contract SafeStaker {
        IERC20 public token;
        function stake(uint256 amount) external {
          token.transferFrom(msg.sender, address(this), amount);
        }
        function rescueTokens(address tkn, address to, uint256 amt) external onlyOwner {
          IERC20(tkn).transfer(to, amt);
        }
      }
    `;
    const result = detectMissingEmergencyWithdrawal(code);
    expect(result.detected).toBe(false);
  });

  // ── Pausable cases ────────────────────────────────────────────────────────

  it('flags a pausable contract with no withdrawal path', () => {
    const code = `
      pragma solidity ^0.8.0;
      contract PausableProtocol {
        bool public paused;
        modifier whenNotPaused() { require(!paused); _; }
        function pause() external onlyOwner { paused = true; }
        function doSomething() external whenNotPaused {}
      }
    `;
    const result = detectMissingEmergencyWithdrawal(code);
    expect(result.detected).toBe(true);
    expect(result.violations[0].kind).toBe('pausable-no-withdrawal');
    expect(result.violations[0].suggestion).toContain('emergencyExit');
  });

  it('does NOT flag a pausable contract that also has emergencyExit', () => {
    const code = `
      pragma solidity ^0.8.0;
      contract SafePausable {
        bool public paused;
        modifier whenNotPaused() { require(!paused); _; }
        function pause() external onlyOwner { paused = true; }
        function emergencyExit(address payable to) external onlyOwner {
          to.transfer(address(this).balance);
        }
      }
    `;
    const result = detectMissingEmergencyWithdrawal(code);
    expect(result.detected).toBe(false);
  });

  // ── Clean contract ────────────────────────────────────────────────────────

  it('does NOT flag a contract that neither receives funds nor has pause', () => {
    const code = `
      pragma solidity ^0.8.0;
      contract Registry {
        mapping(address => bool) public registered;
        function register() external {
          registered[msg.sender] = true;
        }
      }
    `;
    const result = detectMissingEmergencyWithdrawal(code);
    expect(result.detected).toBe(false);
    expect(result.violations).toHaveLength(0);
  });

  // ── Multiple contracts ────────────────────────────────────────────────────

  it('reports violations for each affected contract separately', () => {
    const code = `
      pragma solidity ^0.8.0;
      contract A {
        receive() external payable {}
      }
      contract B {
        IERC20 token;
        function deposit(uint256 amt) external {
          token.transferFrom(msg.sender, address(this), amt);
        }
      }
      contract C {
        receive() external payable {}
        function withdraw() external onlyOwner {
          payable(msg.sender).transfer(address(this).balance);
        }
      }
    `;
    const result = detectMissingEmergencyWithdrawal(code);
    expect(result.detected).toBe(true);
    // A and B should be flagged; C should be clean
    expect(result.violations).toHaveLength(2);
    const names = result.violations.map((v) => v.contractName);
    expect(names).toContain('A');
    expect(names).toContain('B');
    expect(names).not.toContain('C');
  });

  // ── Line numbers ──────────────────────────────────────────────────────────

  it('provides a correct line number for the violation', () => {
    const code = `pragma solidity ^0.8.0;\ncontract Vault {\n  receive() external payable {}\n}`;
    const result = detectMissingEmergencyWithdrawal(code);
    expect(result.violations[0].line).toBe(2);
  });

  // ── Result message ────────────────────────────────────────────────────────

  it('includes contract names in the message', () => {
    const code = `
      contract Risky { receive() external payable {} }
    `;
    const result = detectMissingEmergencyWithdrawal(code);
    expect(result.message).toContain('Risky');
  });
});
