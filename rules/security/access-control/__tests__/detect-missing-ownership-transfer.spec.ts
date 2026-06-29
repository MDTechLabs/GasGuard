import { detectMissingOwnershipTransfer } from '../detect-missing-ownership-transfer';

describe('detectMissingOwnershipTransfer', () => {
  it('detects direct ownership assignment without two-step pattern', () => {
    const code = `
      function setOwner(address newOwner) external {
        owner = newOwner;
      }
    `;
    const result = detectMissingOwnershipTransfer(code);
    expect(result.detected).toBe(true);
    expect(result.issues.some(i => i.type === 'missing-two-step')).toBe(true);
  });

  it('passes when two-step pattern exists', () => {
    const code = `
      address public pendingOwner;
      function proposeOwner(address newOwner) external {
        pendingOwner = newOwner;
      }
      function acceptOwner() external {
        owner = pendingOwner;
        pendingOwner = address(0);
      }
    `;
    const result = detectMissingOwnershipTransfer(code);
    expect(result.detected).toBe(false);
  });

  it('detects missing zero-address check on transfer', () => {
    const code = `
      function transferOwnership(address newOwner) external {
        owner = newOwner;
      }
    `;
    const result = detectMissingOwnershipTransfer(code);
    expect(result.detected).toBe(true);
    expect(result.issues.some(i => i.type === 'missing-two-step')).toBe(true);
  });

  it('detects transferOwnership pattern', () => {
    const code = `
      function transferOwnership(address newOwner) external {
        require(newOwner != address(0));
        owner = newOwner;
      }
    `;
    const result = detectMissingOwnershipTransfer(code);
    expect(result.detected).toBe(true);
  });

  it('handles safe code without ownership changes', () => {
    const code = `
      function getName() external view returns (string memory) {
        return name;
      }
    `;
    const result = detectMissingOwnershipTransfer(code);
    expect(result.detected).toBe(false);
  });
});
