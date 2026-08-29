import { SolidityImmutableCheckRule } from '../src/immutable-check';

describe('SolidityImmutableCheckRule', () => {
  let rule: SolidityImmutableCheckRule;

  beforeEach(() => {
    rule = new SolidityImmutableCheckRule();
  });

  it('should detect a constant candidate variable assigned only at declaration', () => {
    const code = `
      contract TestContract {
        uint256 public MAX_SUPPLY = 10000;
      }
    `;
    const warnings = rule.analyze(code);
    expect(warnings.length).toBe(1);
    expect(warnings[0].variableName).toBe('MAX_SUPPLY');
    expect(warnings[0].modifier).toBe('constant');
  });

  it('should detect an immutable candidate variable assigned only in the constructor', () => {
    const code = `
      contract TestContract {
        address public owner;

        constructor(address _owner) {
          owner = _owner;
        }
      }
    `;
    const warnings = rule.analyze(code);
    expect(warnings.length).toBe(1);
    expect(warnings[0].variableName).toBe('owner');
    expect(warnings[0].modifier).toBe('immutable');
  });

  it('should not flag variables already marked as constant', () => {
    const code = `
      contract TestContract {
        uint256 public constant MAX_SUPPLY = 10000;
      }
    `;
    const warnings = rule.analyze(code);
    expect(warnings.length).toBe(0);
  });

  it('should not flag variables already marked as immutable', () => {
    const code = `
      contract TestContract {
        address public immutable owner;

        constructor(address _owner) {
          owner = _owner;
        }
      }
    `;
    const warnings = rule.analyze(code);
    expect(warnings.length).toBe(0);
  });

  it('should not flag variables modified in functions outside the constructor', () => {
    const code = `
      contract TestContract {
        address public owner;

        constructor(address _owner) {
          owner = _owner;
        }

        function transferOwnership(address newOwner) public {
          owner = newOwner;
        }
      }
    `;
    const warnings = rule.analyze(code);
    expect(warnings.length).toBe(0);
  });

  it('should not flag variables that are never assigned', () => {
    const code = `
      contract TestContract {
        uint256 public counter;
      }
    `;
    const warnings = rule.analyze(code);
    expect(warnings.length).toBe(0);
  });

  it('should flag multiple candidates in the same contract', () => {
    const code = `
      contract TestContract {
        uint256 public MAX_SUPPLY = 10000;
        address public owner;
        string public name = "Test";

        constructor(address _owner) {
          owner = _owner;
        }
      }
    `;
    const warnings = rule.analyze(code);
    expect(warnings.length).toBe(3);
    const names = warnings.map(w => w.variableName);
    expect(names).toContain('MAX_SUPPLY');
    expect(names).toContain('owner');
    expect(names).toContain('name');
  });

  it('should handle contracts with no constructor', () => {
    const code = `
      contract TestContract {
        uint256 public MAX_SUPPLY = 10000;
      }
    `;
    const warnings = rule.analyze(code);
    expect(warnings.length).toBe(1);
    expect(warnings[0].modifier).toBe('constant');
  });

  it('should not flag mapping state variables', () => {
    const code = `
      contract TestContract {
        mapping(address => uint256) public balances;
      }
    `;
    const warnings = rule.analyze(code);
    expect(warnings.length).toBe(0);
  });
});
