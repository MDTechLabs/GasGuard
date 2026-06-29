import { detectStorageGapsMisconfiguration } from '../detect-storage-gaps-misconfiguration';

describe('detectStorageGapsMisconfiguration', () => {
  it('detects missing storage gap', () => {
    const code = `
      contract UpgradeableContract {
        uint256 public value;
        address public admin;
      }
    `;
    const result = detectStorageGapsMisconfiguration(code);
    expect(result.detected).toBe(true);
    expect(result.issues.some(i => i.type === 'missing-gap')).toBe(true);
  });

  it('passes when proper storage gap exists', () => {
    const code = `
      contract UpgradeableContract {
        uint256 public value;
        address public admin;
        uint256[50] private __gap;
      }
    `;
    const result = detectStorageGapsMisconfiguration(code);
    expect(result.detected).toBe(false);
  });

  it('detects too-small storage gap', () => {
    const code = `
      contract UpgradeableContract {
        uint256 public value;
        uint256[3] private __gap;
      }
    `;
    const result = detectStorageGapsMisconfiguration(code);
    expect(result.detected).toBe(true);
    expect(result.issues.some(i => i.type === 'incorrect-gap-size')).toBe(true);
  });

  it('detects gap declared before state variables', () => {
    const code = `
      contract UpgradeableContract {
        uint256[50] private __gap;
        uint256 public value;
      }
    `;
    const result = detectStorageGapsMisconfiguration(code);
    expect(result.detected).toBe(true);
    expect(result.issues.some(i => i.type === 'gap-after-variables')).toBe(true);
  });

  it('handles contracts without state variables', () => {
    const code = `
      contract SimpleContract {
        function foo() external {}
      }
    `;
    const result = detectStorageGapsMisconfiguration(code);
    expect(result.detected).toBe(false);
  });

  it('handles non-upgradeable contracts', () => {
    const code = `
      contract BasicToken {
        string public name;
        string public symbol;
      }
    `;
    const result = detectStorageGapsMisconfiguration(code);
    expect(result.detected).toBe(true);
  });
});
