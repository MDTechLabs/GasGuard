import { detectConstructorVisibility } from '../../rules/security/constructors/detect-constructor-visibility';

describe('detectConstructorVisibility', () => {
  it('flags a constructor with public modifier', () => {
    const code = `
      pragma solidity ^0.8.0;
      contract Token {
        constructor(uint256 supply) public {
          totalSupply = supply;
        }
      }
    `;
    const result = detectConstructorVisibility(code);
    expect(result.detected).toBe(true);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].kind).toBe('constructor-public');
    expect(result.violations[0].fix).toContain('Remove');
  });

  it('flags a constructor with internal modifier', () => {
    const code = `
      pragma solidity ^0.6.0;
      contract Base {
        constructor() internal {}
      }
    `;
    const result = detectConstructorVisibility(code);
    expect(result.detected).toBe(true);
    expect(result.violations[0].kind).toBe('constructor-internal');
    expect(result.violations[0].fix).toContain('abstract');
  });

  it('flags a legacy function-style constructor with public', () => {
    const code = `
      contract OldToken {
        function OldToken(uint256 supply) public {
          totalSupply = supply;
        }
      }
    `;
    const result = detectConstructorVisibility(code);
    expect(result.detected).toBe(true);
    expect(result.violations[0].kind).toBe('legacy-constructor-public');
  });

  it('flags a legacy function-style constructor with internal', () => {
    const code = `
      contract OldBase {
        function OldBase() internal {}
      }
    `;
    const result = detectConstructorVisibility(code);
    expect(result.detected).toBe(true);
    expect(result.violations[0].kind).toBe('legacy-constructor-internal');
  });

  it('does not flag a clean modern constructor', () => {
    const code = `
      pragma solidity ^0.8.0;
      contract Modern {
        constructor(uint256 supply) {
          totalSupply = supply;
        }
      }
    `;
    const result = detectConstructorVisibility(code);
    expect(result.detected).toBe(false);
    expect(result.violations).toHaveLength(0);
  });

  it('extracts solc version from pragma', () => {
    const code = `pragma solidity ^0.7.6;\ncontract C { constructor() {} }`;
    const result = detectConstructorVisibility(code);
    expect(result.solcVersion).toBe('^0.7.6');
  });

  it('returns null solcVersion when no pragma present', () => {
    const code = `contract C { constructor() {} }`;
    const result = detectConstructorVisibility(code);
    expect(result.solcVersion).toBeNull();
  });

  it('provides a line number for each violation', () => {
    const code = `contract C {\n  constructor() public {}\n}`;
    const result = detectConstructorVisibility(code);
    expect(result.violations[0].line).toBe(2);
  });
});
