import { detectUnnecessaryPublicFunctions } from '../../rules/optimization/visibility/detect-unnecessary-public-functions';

describe('detectUnnecessaryPublicFunctions', () => {
  it('flags a public function never called internally', () => {
    const code = `
      contract Token {
        function transfer(address to, uint256 amount) public returns (bool) {
          return true;
        }
      }
    `;
    const result = detectUnnecessaryPublicFunctions(code);
    expect(result.detected).toBe(true);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].functionName).toBe('transfer');
    expect(result.violations[0].suggestion).toContain('external');
  });

  it('does not flag a public function that is called internally', () => {
    const code = `
      contract Token {
        function transfer(address to, uint256 amount) public returns (bool) {
          return true;
        }
        function batchTransfer(address[] memory to, uint256 amt) public {
          for (uint i = 0; i < to.length; i++) {
            transfer(to[i], amt);
          }
        }
      }
    `;
    const result = detectUnnecessaryPublicFunctions(code);
    // transfer is called internally, so only batchTransfer may be flagged
    const names = result.violations.map((v) => v.functionName);
    expect(names).not.toContain('transfer');
  });

  it('flags multiple public-only functions', () => {
    const code = `
      contract Multi {
        function foo() public returns (uint) { return 1; }
        function bar() public returns (uint) { return 2; }
      }
    `;
    const result = detectUnnecessaryPublicFunctions(code);
    expect(result.detected).toBe(true);
    expect(result.violations.length).toBe(2);
  });

  it('returns detected=false when no public functions exist', () => {
    const code = `
      contract Empty {
        function _helper() internal returns (uint) { return 0; }
      }
    `;
    const result = detectUnnecessaryPublicFunctions(code);
    expect(result.detected).toBe(false);
    expect(result.violations).toHaveLength(0);
  });

  it('provides a line number in violations', () => {
    const code = `contract C {\n  function go() public {}\n}`;
    const result = detectUnnecessaryPublicFunctions(code);
    expect(result.violations[0].line).toBeGreaterThan(0);
  });

  it('reports functionsScanned count', () => {
    const code = `
      contract C {
        function a() public {}
        function b() public {}
        function c() internal {}
      }
    `;
    const result = detectUnnecessaryPublicFunctions(code);
    expect(result.functionsScanned).toBe(2);
  });
});
